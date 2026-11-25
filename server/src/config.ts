import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@localhost:5432/procucev"),
  STT_SERVICE_URL: z.string().url().default("http://localhost:9000"),
  STT_MODEL: z.string().default("base"),
  STT_DEMO_MODE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  STT_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(30_000),
  STT_FINALIZE_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(60_000).default(20_000),
  STT_WARMUP_TIMEOUT_MS: z.coerce.number().int().min(30_000).max(1_800_000).default(900_000),
  MAX_AUDIO_CHUNK_BYTES: z.coerce.number().int().positive().default(1_000_000)
});

export const config = envSchema.parse(process.env);
