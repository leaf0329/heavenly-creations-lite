-- Shared API configuration and the small, text-only catalog used by HCLite.
-- This migration intentionally contains no billing, media, or legacy tables.

CREATE TABLE IF NOT EXISTS service_configs (
  service TEXT PRIMARY KEY
    CHECK (service IN ('text', 'agent', 'audio', 'video_parser')),
  provider TEXT NOT NULL DEFAULT ''
    CHECK (char_length(provider) <= 100),
  endpoint TEXT NOT NULL DEFAULT ''
    CHECK (char_length(endpoint) <= 2_000),
  model TEXT NOT NULL DEFAULT ''
    CHECK (char_length(model) <= 200),
  encrypted_api_key TEXT,
  options JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(options) = 'object'),
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_configs_updated_idx
  ON service_configs (updated_at DESC);

CREATE TABLE IF NOT EXISTS skills (
  id UUID PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('system', 'private')),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 100),
  summary TEXT NOT NULL DEFAULT '' CHECK (char_length(summary) <= 500),
  content TEXT NOT NULL CHECK (char_length(trim(content)) BETWEEN 1 AND 100000),
  category TEXT NOT NULL DEFAULT 'general' CHECK (char_length(category) <= 100),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS skills_owner_scope_created_idx
  ON skills (owner_id, scope, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS skills_scope_created_idx
  ON skills (scope, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('system', 'private')),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 100),
  summary TEXT NOT NULL DEFAULT '' CHECK (char_length(summary) <= 500),
  content TEXT NOT NULL CHECK (char_length(trim(content)) BETWEEN 1 AND 100000),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_owner_scope_created_idx
  ON profiles (owner_id, scope, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS profiles_scope_created_idx
  ON profiles (scope, created_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_one_default_per_owner_scope_idx
  ON profiles (owner_id, scope)
  WHERE is_default = true;

CREATE TABLE IF NOT EXISTS library_items (
  id UUID PRIMARY KEY,
  creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL CHECK (visibility IN ('team', 'private')),
  category TEXT NOT NULL CHECK (category IN ('copy', 'script', 'topic')),
  title TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 200),
  summary TEXT NOT NULL DEFAULT '' CHECK (char_length(summary) <= 500),
  content TEXT NOT NULL CHECK (char_length(trim(content)) BETWEEN 1 AND 200000),
  tags TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS library_items_creator_visibility_created_idx
  ON library_items (creator_id, visibility, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS library_items_visibility_created_idx
  ON library_items (visibility, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS library_items_category_idx
  ON library_items (category, created_at DESC);
