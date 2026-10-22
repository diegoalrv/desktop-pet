-- Tareas recurrentes: none | daily | weekdays | weekly | monthly. Al completarla, db.rs `task_set_done` crea la siguiente.
ALTER TABLE tasks ADD COLUMN repeat TEXT NOT NULL DEFAULT 'none';
