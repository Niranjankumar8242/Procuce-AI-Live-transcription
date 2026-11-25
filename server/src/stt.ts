import { config } from "./config.js";
import { pcm16ToWav } from "./audio.js";

export interface SttResult {
  text: string;
  language: string;
}

export type SttStatus = "warming" | "ready" | "unavailable";

let status: SttStatus = config.STT_DEMO_MODE ? "ready" : "warming";
let statusMessage = config.STT_DEMO_MODE ? "Demo mode" : "Loading speech model";
let warmupInProgress = false;

export function getSttStatus(): { status: SttStatus; message: string } {
  return { status, message: statusMessage };
}

export async function transcribePcm(
  pcm: Buffer,
  sampleRate: number,
  signal?: AbortSignal,
  timeoutMs = config.STT_REQUEST_TIMEOUT_MS
): Promise<SttResult> {
  if (config.STT_DEMO_MODE) {
    return { text: "Demo audio segment", language: "auto" };
  }

  const wav = pcm16ToWav(pcm, sampleRate);
  const form = new FormData();
  // Uint8Array.from guarantees an ArrayBuffer-backed view accepted by Node's Blob types.
  form.append("audio_file", new Blob([Uint8Array.from(wav)], { type: "audio/wav" }), "segment.wav");
  const url = new URL("/asr", config.STT_SERVICE_URL);
  url.searchParams.set("task", "transcribe");
  url.searchParams.set("output", "json");
  url.searchParams.set("word_timestamps", "false");
  url.searchParams.set("encode", "true");
  url.searchParams.set("vad_filter", "true");
  url.searchParams.set(
    "initial_prompt",
    "Hindi and English multilingual conversation. Preserve code-switching exactly as spoken. Do not translate."
  );

  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("STT request timed out")), timeoutMs);
  try {
    const response = await fetch(url, { method: "POST", body: form, signal: controller.signal });
    if (!response.ok) throw new Error(`STT service returned ${response.status}`);
    const result = await response.json() as { text?: string; language?: string };
    return { text: (result.text ?? "").trim(), language: result.language ?? "auto" };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export async function warmUpStt(): Promise<void> {
  if (config.STT_DEMO_MODE || warmupInProgress || status === "ready") return;
  warmupInProgress = true;
  status = "warming";
  statusMessage = "Loading speech model";
  const deadline = Date.now() + config.STT_WARMUP_TIMEOUT_MS;
  const silence = Buffer.alloc(16_000); // 0.5 seconds of mono 16 kHz PCM16

  while (Date.now() < deadline) {
    try {
      await transcribePcm(silence, 16_000, undefined, Math.max(5_000, deadline - Date.now()));
      status = "ready";
      statusMessage = "Speech model ready";
      warmupInProgress = false;
      return;
    } catch (error) {
      statusMessage = "Waiting for speech service";
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }

  status = "unavailable";
  statusMessage = "Speech model failed to become ready";
  warmupInProgress = false;
}
