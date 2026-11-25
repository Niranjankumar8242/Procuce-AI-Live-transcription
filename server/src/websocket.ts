import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { audioDurationMs } from "./audio.js";
import { config } from "./config.js";
import { getSttStatus, transcribePcm } from "./stt.js";
import { createTranscription } from "./transcriptions.js";

interface Session {
  sampleRate: number;
  startedAt: number;
  durationMs: number;
  segments: string[];
  languages: Set<string>;
  pendingAudio: Buffer[];
  worker?: Promise<void>;
  abortController: AbortController;
  stopping: boolean;
}

const startMessage = z.object({
  type: z.literal("start"),
  sampleRate: z.number().int().min(8_000).max(48_000).default(16_000)
});

const stopMessage = z.object({
  type: z.literal("stop"),
  previewText: z.string().trim().max(100_000).optional().default("")
});

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

async function processPendingAudio(session: Session, socket: WebSocket): Promise<void> {
  while (session.pendingAudio.length > 0 && !session.abortController.signal.aborted) {
    // Coalesce everything received while the previous request was running. This
    // keeps the tail at one request instead of building an unbounded serial queue.
    const pcm = Buffer.concat(session.pendingAudio.splice(0));
    send(socket, { type: "processing", bufferedMs: audioDurationMs(pcm.length, session.sampleRate) });
    try {
      const result = await transcribePcm(pcm, session.sampleRate, session.abortController.signal);
      if (result.text) {
        session.segments.push(result.text);
        session.languages.add(result.language);
        send(socket, {
          type: "segment",
          text: result.text,
          language: result.language,
          durationMs: session.durationMs
        });
      } else {
        send(socket, { type: "silence" });
      }
    } catch (error) {
      if (session.abortController.signal.aborted) break;
      send(socket, {
        type: "error",
        recoverable: true,
        message: error instanceof Error ? error.message : "Transcription failed"
      });
    }
  }
}

function startWorker(session: Session, socket: WebSocket): void {
  if (session.worker || session.pendingAudio.length === 0 || session.stopping) return;
  const worker = processPendingAudio(session, socket);
  session.worker = worker;
  void worker.finally(() => {
    if (session.worker !== worker) return;
    session.worker = undefined;
    // Audio can arrive between the loop's last check and this finalizer.
    if (session.pendingAudio.length > 0 && !session.stopping) startWorker(session, socket);
  });
}

export function attachTranscriptionSocket(server: Server): void {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: config.MAX_AUDIO_CHUNK_BYTES });

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname !== "/ws/transcribe") return socket.destroy();
    sockets.handleUpgrade(request, socket, head, (ws) => sockets.emit("connection", ws));
  });

  sockets.on("connection", (socket) => {
    let session: Session | undefined;

    socket.on("message", (data, isBinary) => {
      if (!isBinary) {
        void (async () => {
          try {
            const message = JSON.parse(data.toString()) as unknown;
            if ((message as { type?: string }).type === "start") {
              const parsed = startMessage.parse(message);
              session = {
                sampleRate: parsed.sampleRate,
                startedAt: Date.now(),
                durationMs: 0,
                segments: [],
                languages: new Set(),
                pendingAudio: [],
                abortController: new AbortController(),
                stopping: false
              };
              send(socket, { type: "ready" });
              return;
            }
            if ((message as { type?: string }).type === "stop" && session && !session.stopping) {
              const stop = stopMessage.parse(message);
              const finalizing = session;
              finalizing.stopping = true;
              const finishPending = async () => {
                await finalizing.worker;
                if (finalizing.pendingAudio.length > 0) {
                  await processPendingAudio(finalizing, socket);
                }
              };
              let timeoutId: NodeJS.Timeout | undefined;
              const timeout = new Promise<"timeout">((resolve) => {
                timeoutId = setTimeout(() => resolve("timeout"), config.STT_FINALIZE_TIMEOUT_MS);
              });
              const timedOut = await Promise.race([finishPending().then(() => false), timeout]) === "timeout";
              if (timeoutId) clearTimeout(timeoutId);
              if (timedOut) {
                finalizing.pendingAudio = [];
                finalizing.abortController.abort(new Error("Finalization timed out"));
                await finishPending();
              }
              const whisperText = finalizing.segments.join(" ").replace(/\s+/g, " ").trim();
              // Never replace words the user already saw live with a later
              // monolingual interpretation. Whisper remains the fallback for
              // browsers without interim recognition.
              const usePreview = Boolean(stop.previewText);
              const text = usePreview ? stop.previewText : whisperText;
              if (!text) {
                send(socket, { type: "stopped", saved: null, timedOut, usedPreview: false });
                return;
              }
              const languages = usePreview
                ? "Hindi + English (live)"
                : [...finalizing.languages].filter((item) => item !== "auto").join(", ") || "Auto-detected";
              const saved = await createTranscription({ text, languages, durationMs: finalizing.durationMs });
              send(socket, { type: "stopped", saved, timedOut, usedPreview: usePreview });
            }
          } catch (error) {
            send(socket, { type: "error", message: error instanceof Error ? error.message : "Invalid socket message" });
          }
        })();
        return;
      }

      if (!session || session.stopping) {
        send(socket, { type: "error", message: "Start a transcription before sending audio" });
        return;
      }
      const pcm = Buffer.from(data as Buffer);
      if (!pcm.length) return;
      const current = session;
      current.durationMs += audioDurationMs(pcm.length, current.sampleRate);
      // The browser interim engine can keep the experience live while the
      // self-hosted model is loading. Avoid queuing doomed STT requests; the
      // preview text supplied on stop will be persisted as the fallback.
      if (getSttStatus().status !== "ready") return;
      current.pendingAudio.push(pcm);
      startWorker(current, socket);
    });
  });
}
