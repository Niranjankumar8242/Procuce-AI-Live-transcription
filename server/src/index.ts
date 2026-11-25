import { createServer } from "node:http";
import path from "node:path";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import pino from "pino";
import pinoHttp from "pino-http";
import { ZodError } from "zod";
import { config } from "./config.js";
import { closeDatabase, migrate, pool } from "./db.js";
import { transcriptionRouter } from "./transcriptions.js";
import { attachTranscriptionSocket } from "./websocket.js";
import { getSttStatus, warmUpStt } from "./stt.js";

const logger = pino({ level: config.NODE_ENV === "production" ? "info" : "debug" });
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(pinoHttp({ logger }));

app.get("/api/health", async (_request, response) => {
  try {
    await pool.query("SELECT 1");
    response.set("Cache-Control", "no-store, no-cache, must-revalidate");
    response.json({
      status: "ok",
      database: "connected",
      sttMode: config.STT_DEMO_MODE ? "demo" : "self-hosted",
      speechToText: getSttStatus()
    });
  } catch {
    response.status(503).json({ status: "degraded", database: "unavailable" });
  }
});
app.use("/api/transcriptions", transcriptionRouter);

if (config.NODE_ENV === "production") {
  const clientPath = path.resolve(process.cwd(), "client/dist");
  app.use(express.static(clientPath));
  app.get("*", (_request, response) => response.sendFile(path.join(clientPath, "index.html")));
}

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  logger.error(error);
  if (error instanceof ZodError) {
    response.status(400).json({ error: "Validation failed", details: error.flatten() });
    return;
  }
  response.status(500).json({ error: error instanceof Error ? error.message : "Internal server error" });
};
app.use(errorHandler);

const server = createServer(app);
attachTranscriptionSocket(server);

async function start(): Promise<void> {
  await migrate();
  server.listen(config.PORT, () => logger.info(`API listening on http://localhost:${config.PORT}`));
  void warmUpStt().catch((error) => logger.error(error, "Speech model warm-up failed"));
  setInterval(() => {
    if (getSttStatus().status === "unavailable") {
      void warmUpStt().catch((error) => logger.error(error, "Speech model readiness retry failed"));
    }
  }, 15_000).unref();
}

async function shutdown(): Promise<void> {
  server.close();
  await closeDatabase();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

start().catch((error) => {
  logger.fatal(error, "Failed to start application");
  process.exit(1);
});
