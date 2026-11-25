import type { HistoryResponse, Transcription } from "./types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export function getTranscriptions(search = "", page = 1): Promise<HistoryResponse> {
  const params = new URLSearchParams({ search, page: String(page), limit: "8" });
  return request(`/api/transcriptions?${params}`);
}

export function updateTranscription(id: string, update: Partial<Transcription>): Promise<{ data: Transcription }> {
  return request(`/api/transcriptions/${id}`, { method: "PATCH", body: JSON.stringify(update) });
}

export function deleteTranscription(id: string): Promise<void> {
  return request(`/api/transcriptions/${id}`, { method: "DELETE" });
}

export function deleteTranscriptions(ids: string[]): Promise<{ deletedCount: number; ids: string[] }> {
  return request("/api/transcriptions/bulk", { method: "DELETE", body: JSON.stringify({ ids }) });
}
