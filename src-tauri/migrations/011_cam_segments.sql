-- F17: la cámara del foco se guarda por tramos en vez de una fila cada 2 s (cam_samples, 010, solo duró unas horas
-- de prueba). Un tramo junta muestras seguidas con la misma presencia de cara, el mismo rango de teléfono y la
-- cabeza quieta (pitch dentro de 6°, yaw dentro de 10°); un evento va en su propia fila. Ver lib/focusCam.ts.
-- Solo números, nunca imágenes. Se une a `sessions` por tiempo. Ángulos en grados; pitch positivo = cabeza abajo.
DROP TABLE cam_samples;
CREATE TABLE cam_segments (
  start INTEGER NOT NULL,     -- epoch ms de la primera muestra
  end INTEGER NOT NULL,       -- epoch ms de la última
  n INTEGER NOT NULL,         -- muestras (~1 cada 2 s)
  face INTEGER NOT NULL,      -- 0/1
  pitch REAL, pitch_min REAL, pitch_max REAL, -- promedio, mínimo, máximo (null sin cara)
  yaw REAL, yaw_min REAL, yaw_max REAL,
  roll REAL,
  phone REAL NOT NULL,        -- mejor score de "cell phone" en el tramo (0 si nada sobre 0,2; cuenta desde 0,5)
  active INTEGER NOT NULL,    -- muestras con teclado o mouse en los últimos 3 s
  base REAL NOT NULL,         -- postura normal calibrada al final del tramo
  events TEXT                 -- "growl", "bark", "calm", "away", "back" (separados por coma)
);
CREATE INDEX cam_segments_start ON cam_segments(start);
