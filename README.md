# real-time multilingual transcription

A production-minded hiring assignment built with **Node.js, TypeScript, React, PostgreSQL, WebSockets, and self-hosted Faster Whisper**. Users can speak Hindi, English, or code-switch between them; transcript segments appear while they speak and are saved automatically to a searchable CRUD dashboard.

![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Faster Whisper](https://img.shields.io/badge/STT-Faster_Whisper-0b8060)

## Features

- Live microphone streaming over WebSockets in 2-second PCM chunks
- Immediate browser interim words in supported Chromium browsers; the exact live text is preserved, with self-hosted Whisper as the fallback
- Coalesced STT processing so slow model inference cannot create an unbounded request backlog
- Bounded finalization: stopping always returns within 20 seconds and can preserve a partial transcript
- Multilingual transcription with automatic language detection
- Self-hosted, open-source Faster Whisper service — no audio sent to a commercial API
- PostgreSQL persistence with create, read, edit, delete, search, and pagination
- Responsive React dashboard with recording, processing, empty, error, and loading states
- Automatic SQL migration, health endpoint, input validation, graceful shutdown, and structured logs
- Docker Compose setup for the complete app, database, and speech model
- Unit tests, type checking, CI, and a Render deployment blueprint

## Architecture

```text
Browser microphone
  │  16 kHz PCM chunks
  ▼
Node.js WebSocket server ─── HTTP/WAV ───▶ Faster Whisper (self-hosted)
  │                                      ◀── transcript segment
  │ REST CRUD
  ▼
PostgreSQL  ◀──────────────────────────── React dashboard
```

The browser downsamples microphone audio to mono 16 kHz PCM. The Node server queues chunks per connection so segments remain ordered, wraps each chunk in a WAV header, and sends it to the local Faster Whisper container. On stop, it combines the segments and writes one transcription record to PostgreSQL.

## Quick start with Docker

Requirements: Docker Desktop or Docker Engine with Compose, 4 GB free memory, and a modern browser.

```bash
docker compose up --build
```

Open [http://localhost:4000](http://localhost:4000). The first startup downloads the Whisper `base` model and can take a few minutes. Browser microphone access works on `localhost`; a remote deployment must use HTTPS.

The default `base` model favors responsiveness on CPU hardware. For better Hindi/English code-switching accuracy, use `small` or `medium` where memory permits.

## Local development

Start PostgreSQL and Whisper:

```bash
docker compose up postgres whisper
```

Then run the application with hot reload:

```bash
cp .env.example .env
npm install
npm run dev
```

The web app runs at `http://localhost:5173`; Vite proxies REST and WebSocket traffic to the API on port 4000.
The development PostgreSQL container is exposed on host port `5433` to avoid clashing with an existing local PostgreSQL installation.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Database and service mode health |
| `GET` | `/api/transcriptions?search=&page=1&limit=10` | Searchable, paginated history |
| `POST` | `/api/transcriptions` | Create a transcript manually |
| `GET` | `/api/transcriptions/:id` | Read one transcript |
| `PATCH` | `/api/transcriptions/:id` | Edit title, text, language, or duration |
| `DELETE` | `/api/transcriptions/:id` | Delete a transcript |
| `WS` | `/ws/transcribe` | Stream PCM audio and receive live segments |

### WebSocket protocol

1. Send `{ "type": "start", "sampleRate": 16000 }`.
2. Send binary signed 16-bit little-endian PCM chunks.
3. Receive `segment`, `silence`, `processing`, or recoverable `error` messages.
4. Send `{ "type": "stop" }`; receive `stopped` with the saved PostgreSQL record.

## Verification

```bash
npm run typecheck
npm test
npm run build
```
