-- Proyectos por carpeta (relativa a ~) en vez del nombre: los "Laboratorios" de cada curso ya no se suman y la ruta
-- dice de qué es el proyecto. El registro por hora se vacía para que el próximo sync lo rehaga con la nueva clave.
DELETE FROM claude_hours;
DELETE FROM claude_hour_tokens;
-- En qué se trabajó: tiempo por sesión de Claude (su título, o tu primer mensaje si no tiene).
CREATE TABLE claude_hour_titles (
  hour INTEGER NOT NULL,
  project TEXT NOT NULL,
  title TEXT NOT NULL,
  you_secs INTEGER NOT NULL DEFAULT 0,
  claude_secs INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hour, project, title)
);
CREATE TABLE claude_projects (
  project TEXT PRIMARY KEY,
  path TEXT NOT NULL,             -- carpeta absoluta (raíz del repo si tiene git)
  remote TEXT NOT NULL DEFAULT '' -- "github.com/dueño/repo"
);
