-- Historial del chat con Claude Code: una fila por orden (lo que pediste, qué corrió y cómo terminó).
CREATE TABLE IF NOT EXISTS chat_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,          -- epoch ms
  session TEXT,                 -- session_id de Claude Code (para --resume)
  prompt TEXT NOT NULL,
  reply TEXT,
  tools TEXT,                   -- comandos/herramientas usados, uno por línea
  outcome TEXT NOT NULL,        -- mission | oops | ask
  god INTEGER NOT NULL DEFAULT 0
);
