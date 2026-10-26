-- Rutinas (F18): ciclos propios hechos de actividades. Sin rutina activa manda el esquema clásico de Ajustes.
CREATE TABLE activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('focus', 'break')),
  min INTEGER NOT NULL CHECK (min BETWEEN 1 AND 180), -- minutos por defecto
  emoji TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#888888',
  archived INTEGER NOT NULL DEFAULT 0, -- borrar = archivar: no rompe rutinas ni historial
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE routines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX routines_one_active ON routines (active) WHERE active = 1;
CREATE TABLE routine_steps (
  routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL,
  activity_id INTEGER NOT NULL REFERENCES activities(id),
  min INTEGER CHECK (min BETWEEN 1 AND 180), -- nulo = el de la actividad
  PRIMARY KEY (routine_id, pos)
);
ALTER TABLE sessions ADD COLUMN activity_id INTEGER; -- qué actividad fue el bloque (nulo = esquema clásico)
INSERT INTO activities (name, kind, min, emoji, color, sort) VALUES
  ('Foco', 'focus', 25, '🍅', '#e8523c', 0),
  ('Descanso', 'break', 5, '☕', '#3cb371', 1),
  ('Descanso largo', 'break', 15, '🛋️', '#3c78e8', 2),
  ('Pausa activa', 'break', 10, '🤸', '#e8a33c', 3);
