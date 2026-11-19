CREATE TABLE IF NOT EXISTS schedule_groups (
  id TEXT PRIMARY KEY,
  admin_key TEXT NOT NULL,
  name TEXT NOT NULL,
  system TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_users (
  group_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  is_gm INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, id)
);

CREATE TABLE IF NOT EXISTS availability (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  week TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id, week)
);

CREATE INDEX IF NOT EXISTS availability_week ON availability (group_id, week);
