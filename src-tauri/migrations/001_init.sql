CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  icon TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category_id INTEGER,
  priority INTEGER NOT NULL DEFAULT 1, -- 0 baja, 1 media, 2 alta
  done INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER,                      -- ms epoch, opcional
  est_pomodoros INTEGER NOT NULL DEFAULT 1,
  done_pomodoros INTEGER NOT NULL DEFAULT 0,
  notified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start INTEGER NOT NULL,
  end INTEGER NOT NULL,
  mode TEXT NOT NULL,
  task_id INTEGER
);
INSERT INTO categories (name, color, icon, sort) VALUES
  ('Concentración', '#e8523c', '🎯', 0),
  ('Social', '#3c78e8', '💬', 1),
  ('Alarma/Recordatorio', '#e8a33c', '⏰', 2),
  ('Personal', '#3cb371', '🏠', 3);
