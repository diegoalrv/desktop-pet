-- F11: tiempo por app durante cada foco. `hits` = veces que se abrió como distracción (app de la pref `distractions`).
CREATE TABLE session_apps (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  bundle TEXT NOT NULL,
  name TEXT NOT NULL,
  secs INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, bundle)
);
