-- Registro por hora del trabajo con Claude, con o sin foco (worklog.rs `hours`). `hour` = inicio de la hora (ms epoch).
-- Desatendido: lo que Claude hizo en un proyecto mientras tu atención no estaba ahí (de noche, sin foco, en otro proyecto).
CREATE TABLE claude_hours (
  hour INTEGER NOT NULL,
  project TEXT NOT NULL,
  you_secs INTEGER NOT NULL DEFAULT 0,        -- tu atención: desde cada mensaje tuyo hasta el siguiente, máx. 10 min
  claude_secs INTEGER NOT NULL DEFAULT 0,     -- Claude trabajando (su sesión escribe algo al menos cada 3 min)
  unattended_secs INTEGER NOT NULL DEFAULT 0, -- parte de claude_secs sin tu atención en el proyecto
  commits INTEGER NOT NULL DEFAULT 0,
  unattended_commits INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  features INTEGER NOT NULL DEFAULT 0,        -- commits/merges que llegaron a main o master
  PRIMARY KEY (hour, project)
);
CREATE TABLE claude_hour_tokens (
  hour INTEGER NOT NULL,
  project TEXT NOT NULL,
  model TEXT NOT NULL,
  input INTEGER NOT NULL,
  output INTEGER NOT NULL,
  cache_read INTEGER NOT NULL,
  cache_write INTEGER NOT NULL,
  unattended INTEGER NOT NULL, -- tokens (los cuatro tipos) de respuestas sin tu atención en el proyecto
  PRIMARY KEY (hour, project, model)
);
