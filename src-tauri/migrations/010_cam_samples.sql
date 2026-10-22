-- F17: cada muestra de la cámara del foco (cada ~2 s), para calibrar o entrenar la detección más adelante.
-- Solo números, nunca imágenes. Se une a `sessions` por tiempo (`at` entre start y end del foco).
-- Ángulos en grados de la pose de la cabeza (null sin cara); pitch positivo = cabeza abajo.
CREATE TABLE cam_samples (
  at INTEGER NOT NULL,        -- epoch ms
  face INTEGER NOT NULL,      -- 0/1
  pitch REAL,
  yaw REAL,
  roll REAL,
  phone REAL NOT NULL,        -- mejor score de "cell phone" (0 si nada sobre 0,2); cuenta como teléfono desde 0,5
  idle REAL NOT NULL,         -- s sin teclado ni mouse
  base REAL NOT NULL,         -- postura normal calibrada (mediana) en ese momento
  events TEXT                 -- lo que decidió step(): "growl", "bark", "calm", "away", "back" (separados por coma)
);
CREATE INDEX cam_samples_at ON cam_samples(at);
