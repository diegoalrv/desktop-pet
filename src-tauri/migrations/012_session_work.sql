-- Trabajo con Claude durante cada foco (worklog.rs): tiempo por proyecto según tus mensajes en Code/Cowork, y git.
CREATE TABLE session_projects (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project TEXT NOT NULL,
  secs INTEGER NOT NULL,               -- atribuido: desde cada mensaje tuyo hasta el siguiente, máx. 10 min
  detail TEXT NOT NULL DEFAULT '',     -- títulos de las sesiones de Claude
  commits INTEGER NOT NULL DEFAULT 0,  -- tus commits en el foco, todas las ramas
  added INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  features INTEGER NOT NULL DEFAULT 0, -- commits/merges que llegaron a main o master (first-parent)
  PRIMARY KEY (session_id, project)
);
CREATE TABLE session_tokens (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project TEXT NOT NULL,
  model TEXT NOT NULL,
  input INTEGER NOT NULL,
  output INTEGER NOT NULL,
  cache_read INTEGER NOT NULL,
  cache_write INTEGER NOT NULL,
  PRIMARY KEY (session_id, project, model)
);
