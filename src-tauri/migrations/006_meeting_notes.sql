-- Resumen y decisiones que el LLM saca de cada reunión (el modo gestión no escribe aquí). meeting_retry la reemplaza.
CREATE TABLE IF NOT EXISTS meeting_notes (
  meeting INTEGER PRIMARY KEY,            -- epoch s de la reunión = nombre de $APPDATA/meetings/<epoch>.md
  summary TEXT NOT NULL DEFAULT '',
  decisions TEXT NOT NULL DEFAULT '[]',   -- JSON: ["…", …]
  model TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL                     -- epoch ms
);
