-- Bloques de ~10 líneas de cada transcripción con su embedding (Ollama nomic-embed-text) para preguntarle a las
-- reuniones. Se llena al guardar cada reunión y al arrancar lo que falte (meeting.rs: index_missing).
CREATE TABLE IF NOT EXISTS meeting_chunks (
  meeting INTEGER NOT NULL,  -- epoch s de la reunión = nombre de $APPDATA/meetings/<epoch>.md
  idx INTEGER NOT NULL,      -- n.º de bloque dentro de la reunión
  text TEXT NOT NULL,
  vec BLOB NOT NULL,         -- f32 little-endian
  PRIMARY KEY (meeting, idx)
);
