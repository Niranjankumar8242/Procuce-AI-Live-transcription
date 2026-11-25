import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { serializeTranscription, type TranscriptionRow } from "./types.js";

const createSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  text: z.string().trim().min(1).max(100_000),
  languages: z.string().trim().min(1).max(120).default("Auto-detected"),
  durationMs: z.number().int().min(0).max(86_400_000).default(0)
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  text: z.string().trim().min(1).max(100_000).optional(),
  languages: z.string().trim().min(1).max(120).optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional()
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required"
});

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100)
});

function defaultTitle(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 52 ? `${compact.slice(0, 52)}…` : compact;
}

export async function createTranscription(input: z.infer<typeof createSchema>) {
  const parsed = createSchema.parse(input);
  const id = randomUUID();
  const result = await pool.query<TranscriptionRow>(
    `INSERT INTO transcriptions (id, title, text, languages, duration_ms)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [id, parsed.title ?? defaultTitle(parsed.text), parsed.text, parsed.languages, parsed.durationMs]
  );
  return serializeTranscription(result.rows[0]);
}

export const transcriptionRouter = Router();

transcriptionRouter.get("/", async (request, response, next) => {
  try {
    const query = z.object({
      search: z.string().trim().max(200).default(""),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10)
    }).parse(request.query);
    const offset = (query.page - 1) * query.limit;
    const search = `%${query.search}%`;
    const [items, total] = await Promise.all([
      pool.query<TranscriptionRow>(
        `SELECT * FROM transcriptions
         WHERE ($1 = '%%' OR title ILIKE $1 OR text ILIKE $1 OR languages ILIKE $1)
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [search, query.limit, offset]
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM transcriptions
         WHERE ($1 = '%%' OR title ILIKE $1 OR text ILIKE $1 OR languages ILIKE $1)`,
        [search]
      )
    ]);
    const count = Number(total.rows[0].count);
    response.json({
      data: items.rows.map(serializeTranscription),
      meta: { page: query.page, limit: query.limit, total: count, pages: Math.max(1, Math.ceil(count / query.limit)) }
    });
  } catch (error) {
    next(error);
  }
});

transcriptionRouter.post("/", async (request, response, next) => {
  try {
    response.status(201).json({ data: await createTranscription(request.body) });
  } catch (error) {
    next(error);
  }
});

transcriptionRouter.delete("/bulk", async (request, response, next) => {
  try {
    const { ids } = bulkDeleteSchema.parse(request.body);
    const result = await pool.query<{ id: string }>(
      "DELETE FROM transcriptions WHERE id = ANY($1::uuid[]) RETURNING id",
      [ids]
    );
    response.json({ deletedCount: result.rowCount ?? 0, ids: result.rows.map((row) => row.id) });
  } catch (error) {
    next(error);
  }
});

transcriptionRouter.get("/:id", async (request, response, next) => {
  try {
    const id = z.string().uuid().parse(request.params.id);
    const result = await pool.query<TranscriptionRow>("SELECT * FROM transcriptions WHERE id = $1", [id]);
    if (!result.rowCount) return response.status(404).json({ error: "Transcription not found" });
    response.json({ data: serializeTranscription(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

transcriptionRouter.patch("/:id", async (request, response, next) => {
  try {
    const id = z.string().uuid().parse(request.params.id);
    const updates = updateSchema.parse(request.body);
    const current = await pool.query<TranscriptionRow>("SELECT * FROM transcriptions WHERE id = $1", [id]);
    if (!current.rowCount) return response.status(404).json({ error: "Transcription not found" });
    const row = current.rows[0];
    const result = await pool.query<TranscriptionRow>(
      `UPDATE transcriptions SET title = $2, text = $3, languages = $4, duration_ms = $5, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, updates.title ?? row.title, updates.text ?? row.text, updates.languages ?? row.languages, updates.durationMs ?? row.duration_ms]
    );
    response.json({ data: serializeTranscription(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

transcriptionRouter.delete("/:id", async (request, response, next) => {
  try {
    const id = z.string().uuid().parse(request.params.id);
    const result = await pool.query("DELETE FROM transcriptions WHERE id = $1", [id]);
    if (!result.rowCount) return response.status(404).json({ error: "Transcription not found" });
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});
