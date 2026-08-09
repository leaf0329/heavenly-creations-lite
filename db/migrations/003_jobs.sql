-- Asynchronous text jobs used by HCLite. `stt` is reserved here so a later
-- transcription worker can use the same queue without changing this contract.

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'topic-plan', 'topics', 'stt-rewrite', 'xiaohongshu-copy',
    'moments-copy', 'sales-script', 'stt'
  )),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  title TEXT NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  input JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(input) = 'object'),
  result_text TEXT,
  source_kind TEXT NOT NULL DEFAULT 'none'
    CHECK (source_kind IN ('upload', 'url', 'none')),
  source_url TEXT,
  source_filename TEXT,
  temporary_path TEXT,
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source_metadata) = 'object'),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  progress_message TEXT NOT NULL DEFAULT '' CHECK (char_length(progress_message) <= 500),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 2 CHECK (max_attempts BETWEEN 1 AND 2),
  retry_at TIMESTAMPTZ,
  processing_token TEXT,
  lease_until TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_user_created_idx
  ON jobs (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS jobs_user_status_idx
  ON jobs (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_pending_idx
  ON jobs (created_at ASC, id ASC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS jobs_processing_lease_idx
  ON jobs (lease_until)
  WHERE status = 'processing';
