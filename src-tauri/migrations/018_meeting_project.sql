-- Proyecto de cada reunión (el mismo texto libre que tasks.project), elegido a mano; vacío = sin proyecto.
-- Vive en meeting_notes (no hay otra tabla por reunión): la fila puede crearse solo con el proyecto, antes del resumen.
ALTER TABLE meeting_notes ADD COLUMN project TEXT;
