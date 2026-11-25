CREATE TABLE IF NOT EXISTS transcriptions (
  id UUID PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  text TEXT NOT NULL,
  languages VARCHAR(120) NOT NULL DEFAULT 'Auto-detected',
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at
  ON transcriptions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transcriptions_search
  ON transcriptions USING GIN (to_tsvector('simple', title || ' ' || text));
