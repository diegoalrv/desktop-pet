-- Con qué modelo se calculó cada vector (F19): en Windows los embeddings salen del proxy (titan-embed-v2, 1024) y en
-- Mac de Ollama (nomic-embed-text, 768). No se comparan entre sí: index_missing reindexa lo que sea de otro modelo.
ALTER TABLE meeting_chunks ADD COLUMN model TEXT NOT NULL DEFAULT 'nomic-embed-text';
