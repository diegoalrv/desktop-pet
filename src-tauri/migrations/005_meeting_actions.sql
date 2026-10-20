-- Modo gestión: la acción propuesta por el LLM (JSON: crear | editar | completar; ver meeting.rs `Action`).
-- NULL = sugerencia de reunión clásica (crear la tarea con el título).
ALTER TABLE meeting_tasks ADD COLUMN action TEXT;
