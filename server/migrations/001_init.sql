CREATE TABLE users (
  id uuid PRIMARY KEY,
  plan text NOT NULL DEFAULT 'free',
  key_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invites (
  code text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  used_by uuid REFERENCES users(id),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  ts timestamptz NOT NULL,
  props jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_received_at ON events (received_at);
