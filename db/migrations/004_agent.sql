-- Private, text-only Agent conversations.  Every row carries the user that
-- owns it so API queries can enforce account isolation without relying on
-- the caller's account type (the owner must not see a member's chat).

CREATE TABLE IF NOT EXISTS agent_conversations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_conversations_user_updated_idx
  ON agent_conversations (user_id, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS agent_messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL CHECK (char_length(trim(content)) BETWEEN 1 AND 200000),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_messages_conversation_created_idx
  ON agent_messages (conversation_id, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS agent_messages_user_created_idx
  ON agent_messages (user_id, created_at DESC, id DESC);

-- One confirmed selection per conversation.  Arrays keep confirmation
-- atomic: a conversation can never observe a partially-updated set of assets.
-- The API validates each ID against the current user's readable scope before
-- writing these arrays.
CREATE TABLE IF NOT EXISTS agent_conversation_assets (
  conversation_id UUID PRIMARY KEY REFERENCES agent_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_ids UUID[] NOT NULL DEFAULT '{}',
  profile_ids UUID[] NOT NULL DEFAULT '{}',
  library_item_ids UUID[] NOT NULL DEFAULT '{}',
  confirmed BOOLEAN NOT NULL DEFAULT true,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_conversation_assets_user_idx
  ON agent_conversation_assets (user_id, updated_at DESC, conversation_id);
