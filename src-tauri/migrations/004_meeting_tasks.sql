-- Tareas que el LLM sugirió en cada reunión (antes solo vivían en memoria hasta cerrar la app).
CREATE TABLE IF NOT EXISTS meeting_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting INTEGER NOT NULL,              -- epoch s de la reunión = nombre de $APPDATA/meetings/<epoch>.md
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' -- pending | accepted | dismissed
);
