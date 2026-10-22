-- Tareas recurrentes: none | daily | weekdays | weekly | monthly. Al completarla, db.rs `task_set_done` crea la siguiente.
ALTER TABLE tasks ADD COLUMN repeat TEXT NOT NULL DEFAULT 'none';
-- Cuándo se completó (ms epoch; NULL = pendiente o hecha antes de esta columna): cierre del día y standup.
ALTER TABLE tasks ADD COLUMN done_at INTEGER;
