import { useCallback, useEffect, useRef, useState } from "react";
import { deleteTranscription, deleteTranscriptions, getTranscriptions, updateTranscription } from "./api";
import { AudioStreamer } from "./audio";
import { BrowserSpeechPreview } from "./browserSpeech";
import { ClockIcon, EditIcon, HistoryIcon, MenuIcon, MicIcon, SearchIcon, TrashIcon, XIcon } from "./icons";
import type { HistoryResponse, SocketMessage, Transcription } from "./types";

type View = "live" | "history";
type RecordingState = "idle" | "connecting" | "recording" | "stopping" | "error";
type SttStatus = "checking" | "warming" | "ready" | "unavailable";

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.round(milliseconds / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function formatDate(date: string): string {
  const value = new Date(date);
  const today = new Date();
  const label = value.toDateString() === today.toDateString()
    ? "Today"
    : value.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${label}, ${value.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function languageLabel(code: string): string {
  const labels: Record<string, string> = { en: "English", hi: "Hindi", auto: "Auto" };
  return labels[code] ?? code.toUpperCase();
}



interface SidebarProps { view: View; setView: (view: View) => void; open: boolean; close: () => void }
function Sidebar({ view, setView, open, close }: SidebarProps) {
  const choose = (next: View) => { setView(next); close(); };
  return <>
    {open && <button className="scrim" aria-label="Close menu" onClick={close} />}
    <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
     
      <nav aria-label="Main navigation">
        <button className={view === "live" ? "active" : ""} onClick={() => choose("live")}><MicIcon />Live transcription</button>
        <button className={view === "history" ? "active" : ""} onClick={() => choose("history")}><HistoryIcon />History</button>
      </nav>
      <div className="sidebar-footer"><span className="avatar">PC</span><div><strong>Procucev AI</strong></div></div>
    </aside>
  </>;
}

function Waveform({ active, level }: { active: boolean; level: number }) {
  return <div className={`waveform ${active ? "active" : ""}`} aria-hidden="true">
    {Array.from({ length: 56 }, (_, index) => {
      const curve = 0.25 + Math.sin(index * 0.61) ** 2 * 0.75;
      const height = active ? 7 + curve * (18 + level * 42) : 5 + curve * 8;
      return <i key={index} style={{ height }} />;
    })}
  </div>;
}

interface RecorderProps {
  onSaved: (item: Transcription) => void;
  toast: (message: string, kind?: "error" | "success") => void;
}
function Recorder({ onSaved, toast }: RecorderProps) {
  const [state, setState] = useState<RecordingState>("idle");
  const [text, setText] = useState("");
  const [livePreview, setLivePreview] = useState("");
  const [languages, setLanguages] = useState<string[]>([]);
  const [duration, setDuration] = useState(0);
  const [level, setLevel] = useState(0);
  const [sttStatus, setSttStatus] = useState<SttStatus>("checking");
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const audioRef = useRef<AudioStreamer | undefined>(undefined);
  const previewRef = useRef<BrowserSpeechPreview | undefined>(undefined);
  const timerRef = useRef<number | undefined>(undefined);
  const finalizeTimerRef = useRef<number | undefined>(undefined);
  const startTimeRef = useRef(0);

  const cleanup = useCallback(async () => {
    window.clearInterval(timerRef.current);
    await audioRef.current?.stop().catch(() => undefined);
    audioRef.current = undefined;
  }, []);

  useEffect(() => () => {
    window.clearTimeout(finalizeTimerRef.current);
    void cleanup();
    void previewRef.current?.stop();
    socketRef.current?.close();
  }, [cleanup]);

  useEffect(() => {
    let mounted = true;
    const checkStatus = async () => {
      try {
        const response = await fetch(`/api/health?t=${Date.now()}`, { cache: "no-store" });
        const health = await response.json() as { speechToText?: { status?: SttStatus } };
        if (mounted) setSttStatus(health.speechToText?.status ?? "unavailable");
      } catch {
        if (mounted) setSttStatus("unavailable");
      }
    };
    void checkStatus();
    const interval = window.setInterval(() => void checkStatus(), 3_000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, []);

  const start = async () => {
    const instantPreviewAvailable = BrowserSpeechPreview.isSupported();
    if (sttStatus !== "ready" && !instantPreviewAvailable) {
      toast(sttStatus === "warming" || sttStatus === "checking" ? "The speech model is warming up. Recording will be available when it is ready." : "The speech service is unavailable. Check the Whisper container logs.", "error");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast("Microphone capture is not supported in this browser.", "error");
      return;
    }
    setState("connecting");
    setText("");
    setLivePreview("");
    setLanguages([]);
    setDuration(0);
    window.clearTimeout(finalizeTimerRef.current);
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${location.host}/ws/transcribe`);
    socketRef.current = socket;

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as SocketMessage;
      if (message.type === "ready") setState("recording");
      if (message.type === "segment") {
        setText((current) => `${current} ${message.text}`.trim());
        setLanguages((current) => current.includes(message.language) ? current : [...current, message.language]);
      }
      if (message.type === "stopped") {
        window.clearTimeout(finalizeTimerRef.current);
        setState("idle");
        if (message.saved) {
          setText(message.saved.text);
          setLivePreview("");
          onSaved(message.saved);
          toast(message.usedPreview ? "Live transcript saved successfully." : message.timedOut ? "A partial transcript was saved; final processing reached its time limit." : "Transcription saved to history.", message.timedOut && !message.usedPreview ? "error" : "success");
        } else if (message.timedOut) {
          toast("Transcription timed out. The speech model may still be warming up—please try once more.", "error");
        } else toast("No speech was detected.", "error");
        socket.close();
      }
      if (message.type === "error") {
        toast(message.message, "error");
        if (!message.recoverable) {
          void cleanup();
          void previewRef.current?.stop();
          socket.close();
          setState("idle");
        }
      }
    };
    socket.onerror = () => { setState("error"); toast("Could not connect to the transcription server.", "error"); };

    try {
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        window.setTimeout(() => reject(new Error("Connection timed out")), 8_000);
      });
      const audio = new AudioStreamer(
        (chunk) => { if (socket.readyState === WebSocket.OPEN) socket.send(chunk); },
        setLevel
      );
      audioRef.current = audio;
      const sampleRate = await audio.start();
      const preview = new BrowserSpeechPreview(setLivePreview);
      const previewStarted = preview.start();
      if (previewStarted) previewRef.current = preview;
      if (!previewStarted && sttStatus !== "ready") {
        await cleanup();
        socket.close();
        setState("idle");
        toast("Both live preview and Whisper are unavailable. Please use Chrome or wait for the model to finish loading.", "error");
        return;
      }
      socket.send(JSON.stringify({ type: "start", sampleRate }));
      startTimeRef.current = Date.now();
      timerRef.current = window.setInterval(() => setDuration(Date.now() - startTimeRef.current), 250);
    } catch (error) {
      void previewRef.current?.stop();
      socket.close();
      setState("idle");
      toast(error instanceof Error ? error.message : "Microphone permission was denied.", "error");
    }
  };

  const stop = async () => {
    setState("stopping");
    const previewPromise = previewRef.current?.stop() ?? Promise.resolve(livePreview);
    const [, previewText] = await Promise.all([cleanup(), previewPromise]);
    previewRef.current = undefined;
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setState("idle");
      toast("The transcription connection closed before the recording could be saved.", "error");
      return;
    }
    socket.send(JSON.stringify({ type: "stop", previewText }));
    window.clearTimeout(finalizeTimerRef.current);
    finalizeTimerRef.current = window.setTimeout(() => {
      socket.close();
      setState("idle");
      toast("Finalization exceeded 25 seconds. Please retry after the speech model has warmed up.", "error");
    }, 25_000);
  };

  const isRecording = state === "recording";
  const isStopping = state === "stopping";
  const isActive = isRecording || isStopping;
  const modelReady = sttStatus === "ready";
  const instantPreviewAvailable = BrowserSpeechPreview.isSupported();
  const canRecord = modelReady || instantPreviewAvailable;
  const readinessText = instantPreviewAvailable ? "Live preview ready · Whisper warming up" : sttStatus === "unavailable" ? "Speech service unavailable" : "Speech model warming up";
  const visibleText = (isActive && livePreview) || text || livePreview;
  return <section className="live-grid">
    <div className="recorder-card">
      <div className="recorder-head">
        <div><span className={`status-dot ${isRecording || canRecord ? "on" : ""}`} />{isRecording ? "Listening live" : isStopping ? "Finishing transcript (max 20s)" : modelReady ? "Ready to listen" : readinessText}</div>
        <span className="timer"><ClockIcon />{formatDuration(duration)}</span>
      </div>
      <div className="mic-zone">
        <div className={`mic-rings ${isRecording ? "recording" : ""}`}><button className="mic-button" onClick={isRecording ? stop : start} disabled={state === "connecting" || isStopping || !canRecord} aria-label={isRecording ? "Stop recording" : "Start recording"}><MicIcon /></button></div>
        <h2>{isRecording ? "I'm listening…" : isStopping ? "Finishing the last audio…" : state === "connecting" ? "Opening microphone…" : canRecord ? "Tap to start speaking" : readinessText}</h2>
        <p>{isStopping ? "This is limited to 20 seconds, even if the speech model is still warming up." : canRecord ? modelReady ? "Speak naturally in Hindi, English, or mix them together." : "Instant preview is available now; Whisper verification will join when ready." : "The first model startup can take several minutes."}</p>
      </div>
      <Waveform active={isRecording} level={level} />
      <div className="recording-actions">
        <span>Auto language detection</span>
        <button className={isActive ? "stop-button" : "start-button"} onClick={isRecording ? stop : start} disabled={state === "connecting" || isStopping || !canRecord}>{isStopping ? <>Finishing…</> : isRecording ? <><span className="stop-square" />Stop & save</> : <><MicIcon />Start recording</>}</button>
        <span>Saved automatically</span>
      </div>
    </div>

    <aside className="transcript-card">
      <div className="card-title"><div><h3>Live transcript</h3><p>Words appear as you speak</p></div>{isRecording && <span className="live-pill">Live</span>}</div>
      <div className={`transcript-body ${visibleText ? "has-text" : ""}`}>
        {visibleText ? <p>{visibleText}</p> : <div className="empty-transcript"><div className="quote-mark">“</div><strong>Your words will show up here</strong><span>Start recording to see a real-time transcript.</span></div>}
      </div>
      <div className="detected-languages"><span>Detected</span><div>{languages.length ? languages.map((language) => <b key={language}>{languageLabel(language)}</b>) : livePreview ? <b>Instant live preview</b> : <b>Waiting for speech</b>}</div></div>
    </aside>
  </section>;
}

interface HistoryProps {
  refreshKey: number;
  toast: (message: string, kind?: "error" | "success") => void;
}
function History({ refreshKey, toast }: HistoryProps) {
  const [result, setResult] = useState<HistoryResponse>({ data: [], meta: { page: 1, limit: 8, total: 0, pages: 1 } });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Transcription | null>(null);
  const [deleting, setDeleting] = useState<Transcription | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setResult(await getTranscriptions(search, page)); }
    catch (error) { toast(error instanceof Error ? error.message : "Could not load history", "error"); }
    finally { setLoading(false); }
  }, [page, search, toast]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load, refreshKey]);

  const saveEdit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    try {
      await updateTranscription(editing.id, { title: String(form.get("title")), text: String(form.get("text")) });
      setEditing(null); toast("Transcript updated.", "success"); void load();
    } catch (error) { toast(error instanceof Error ? error.message : "Update failed", "error"); }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await deleteTranscription(deleting.id);
      setSelectedIds((current) => { const next = new Set(current); next.delete(deleting.id); return next; });
      setDeleting(null); toast("Transcript deleted.", "success"); void load();
    }
    catch (error) { toast(error instanceof Error ? error.message : "Delete failed", "error"); }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allPageSelected = result.data.length > 0 && result.data.every((item) => selectedIds.has(item.id));
  const toggleAll = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPageSelected) result.data.forEach((item) => next.delete(item.id));
      else result.data.forEach((item) => next.add(item.id));
      return next;
    });
  };

  const removeSelected = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    try {
      const deleted = await deleteTranscriptions(ids);
      setConfirmBulkDelete(false);
      setSelectedIds(new Set());
      toast(`${deleted.deletedCount} ${deleted.deletedCount === 1 ? "transcript" : "transcripts"} deleted.`, "success");
      if (result.data.length === deleted.deletedCount && page > 1) setPage((value) => value - 1);
      else void load();
    } catch (error) { toast(error instanceof Error ? error.message : "Bulk delete failed", "error"); }
  };

  return <section className="history-section">
    <div className="history-toolbar"><div><h2>Transcription history</h2><p>{result.meta.total} saved {result.meta.total === 1 ? "conversation" : "conversations"}</p></div><div className="history-controls">{selectedIds.size > 0 && <button className="bulk-delete" onClick={() => setConfirmBulkDelete(true)}><TrashIcon />Delete selected ({selectedIds.size})</button>}<label className="search"><SearchIcon /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); setSelectedIds(new Set()); }} placeholder="Search your transcripts" /></label></div></div>
    <div className="history-card">
      {loading ? <div className="loading-list">{Array.from({ length: 4 }, (_, i) => <div className="skeleton" key={i} />)}</div>
      : result.data.length === 0 ? <div className="empty-history"><HistoryIcon /><h3>No transcripts found</h3><p>{search ? "Try a different search phrase." : "Your saved conversations will appear here."}</p></div>
      : <div className="table-wrap"><table><thead><tr><th className="select-column"><input type="checkbox" checked={allPageSelected} onChange={toggleAll} aria-label="Select all transcripts on this page" /></th><th>Conversation</th><th>Language</th><th>Duration</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{result.data.map((item) => <tr key={item.id} className={selectedIds.has(item.id) ? "selected-row" : ""}><td className="select-column"><input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelected(item.id)} aria-label={`Select ${item.title}`} /></td><td className="conversation-cell"><strong>{item.title}</strong><span>{item.text}</span></td><td><span className="language-tag">{item.languages}</span></td><td>{formatDuration(item.durationMs)}</td><td>{formatDate(item.createdAt)}</td><td><div className="row-actions"><button aria-label={`Edit ${item.title}`} onClick={() => setEditing(item)}><EditIcon /></button><button className="danger" aria-label={`Delete ${item.title}`} onClick={() => setDeleting(item)}><TrashIcon /></button></div></td></tr>)}</tbody></table></div>}
      <div className="pagination"><span>Page {result.meta.page} of {result.meta.pages}</span><div><button disabled={page <= 1} onClick={() => { setSelectedIds(new Set()); setPage((value) => value - 1); }}>Previous</button><button disabled={page >= result.meta.pages} onClick={() => { setSelectedIds(new Set()); setPage((value) => value + 1); }}>Next</button></div></div>
    </div>
    {editing && <div className="modal-backdrop"><form className="modal" onSubmit={saveEdit}><div className="modal-head"><div><h3>Edit transcription</h3><p>Correct the title or transcript text.</p></div><button type="button" onClick={() => setEditing(null)} aria-label="Close"><XIcon /></button></div><label>Title<input name="title" defaultValue={editing.title} maxLength={160} required /></label><label>Transcript<textarea name="text" defaultValue={editing.text} rows={8} required /></label><div className="modal-actions"><button type="button" onClick={() => setEditing(null)}>Cancel</button><button className="primary" type="submit">Save changes</button></div></form></div>}
    {deleting && <div className="modal-backdrop"><div className="modal confirm"><div className="delete-icon"><TrashIcon /></div><h3>Delete this transcript?</h3><p>“{deleting.title}” will be permanently removed. This action cannot be undone.</p><div className="modal-actions"><button onClick={() => setDeleting(null)}>Keep it</button><button className="delete-button" onClick={remove}>Delete transcript</button></div></div></div>}
    {confirmBulkDelete && <div className="modal-backdrop"><div className="modal confirm"><div className="delete-icon"><TrashIcon /></div><h3>Delete {selectedIds.size} transcripts?</h3><p>The selected transcripts will be permanently removed. This action cannot be undone.</p><div className="modal-actions"><button onClick={() => setConfirmBulkDelete(false)}>Cancel</button><button className="delete-button" onClick={() => void removeSelected()}>Delete selected</button></div></div></div>}
  </section>;
}

export function App() {
  const [view, setView] = useState<View>("live");
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState<{ message: string; kind: "error" | "success" } | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const toast = useCallback((message: string, kind: "error" | "success" = "success") => {
    window.clearTimeout(noticeTimer.current); setNotice({ message, kind });
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4500);
  }, []);

  return <div className="app-shell">
    <Sidebar view={view} setView={setView} open={menuOpen} close={() => setMenuOpen(false)} />
    <main>
      <header className="topbar"><button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="Open menu"><MenuIcon /></button><div className="mobile-logo"></div></header>
      <div className="page-content">
        <div className="page-heading"><span className="eyebrow">Multilingual speech intelligence</span><h1>{view === "live" ? "Turn speech into text, instantly." : "Every conversation, easy to find."}</h1><p>{view === "live" ? "Speak naturally. Switch languages mid-sentence. keeps up." : "Review, search, edit, and manage your saved transcripts."}</p></div>
        {view === "live" ? <Recorder onSaved={() => setRefreshKey((key) => key + 1)} toast={toast} /> : <History refreshKey={refreshKey} toast={toast} />}
      </div>
    </main>
    {notice && <div className={`toast ${notice.kind}`}><span>{notice.kind === "success" ? "✓" : "!"}</span>{notice.message}<button onClick={() => setNotice(null)} aria-label="Dismiss"><XIcon /></button></div>}
  </div>;
}
