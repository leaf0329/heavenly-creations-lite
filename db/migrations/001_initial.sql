-- HCLite starts from a deliberately small schema. There are no billing,
-- invitation, media-library, or legacy application tables in this database.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checksum TEXT
);
ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL CHECK (char_length(trim(username)) BETWEEN 3 AND 50),
  display_name TEXT NOT NULL DEFAULT '' CHECK (char_length(display_name) <= 100),
  password_hash TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'member'
    CHECK (account_type IN ('owner', 'member')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Usernames are case-insensitive while preserving the spelling selected by
-- the owner. The partial unique index is the database-level single-owner
-- invariant; application checks alone are not sufficient under concurrency.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx
  ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_single_owner_idx
  ON users (account_type)
  WHERE account_type = 'owner';
CREATE INDEX IF NOT EXISTS users_created_by_idx ON users (created_by);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  ip_hash TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_idx
  ON auth_sessions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_sessions_active_idx
  ON auth_sessions (expires_at)
  WHERE revoked_at IS NULL;

-- Login throttling stores only a keyed digest, never a raw IP address or
-- username. Rows are intentionally independent from the business data.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  dimension TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  blocked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dimension, key_hash)
);

CREATE INDEX IF NOT EXISTS auth_rate_limits_blocked_idx
  ON auth_rate_limits (blocked_until)
  WHERE blocked_until IS NOT NULL;
