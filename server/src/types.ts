export interface TranscriptionRow {
  id: string;
  title: string;
  text: string;
  languages: string;
  duration_ms: number;
  created_at: Date;
  updated_at: Date;
}

export interface Transcription {
  id: string;
  title: string;
  text: string;
  languages: string;
  durationMs: number;
  createdAt: string;
  updatedAt: string;
}

export function serializeTranscription(row: TranscriptionRow): Transcription {
  return {
    id: row.id,
    title: row.title,
    text: row.text,
    languages: row.languages,
    durationMs: row.duration_ms,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}
