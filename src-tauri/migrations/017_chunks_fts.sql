-- Búsqueda por texto (FTS5/BM25) sobre los bloques de reunión (BACKEND_ROADMAP, Fase 0): preguntarle a las reuniones
-- funciona aunque no haya embeddings. Copia del texto (no external content: un VACUUM renumera los rowid de
-- meeting_chunks) y triggers para mantenerla al insertar/borrar bloques.
CREATE VIRTUAL TABLE IF NOT EXISTS meeting_chunks_fts USING fts5(text, meeting UNINDEXED, idx UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');
INSERT INTO meeting_chunks_fts (text, meeting, idx) SELECT text, meeting, idx FROM meeting_chunks;
CREATE TRIGGER IF NOT EXISTS meeting_chunks_ai AFTER INSERT ON meeting_chunks BEGIN
  INSERT INTO meeting_chunks_fts (text, meeting, idx) VALUES (new.text, new.meeting, new.idx);
END;
-- ponytail: borrar por meeting+idx recorre la tabla FTS (no hay índice); sobra para unos miles de bloques.
CREATE TRIGGER IF NOT EXISTS meeting_chunks_ad AFTER DELETE ON meeting_chunks BEGIN
  DELETE FROM meeting_chunks_fts WHERE meeting = old.meeting AND idx = old.idx;
END;
