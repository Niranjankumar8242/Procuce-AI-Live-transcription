export interface Transcription {
  id: string;
  title: string;
  text: string;
  languages: string;
  durationMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryResponse {
  data: Transcription[];
  meta: { page: number; limit: number; total: number; pages: number };
}

export type SocketMessage =
  | { type: "ready" }
  | { type: "processing"; bufferedMs?: number }
  | { type: "silence" }
  | { type: "segment"; text: string; language: string; durationMs: number }
  | { type: "stopped"; saved: Transcription | null; timedOut?: boolean; usedPreview?: boolean }
  | { type: "error"; message: string; recoverable?: boolean };
