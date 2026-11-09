-- Ficha de la tarea: qué es, contexto y qué la da por cerrada (texto libre, varias líneas). NULL = sin ficha.
ALTER TABLE tasks ADD COLUMN description TEXT;
-- Bitácora de cada tarea: comentarios del usuario ('Yo'), de la Candola o de Claude por el MCP.
CREATE TABLE task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL -- ms epoch
);
CREATE INDEX task_comments_task ON task_comments(task_id);
