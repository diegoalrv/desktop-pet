use serde_json::{Map, Value};
use sqlx::{
    sqlite::{SqliteArguments, SqliteConnectOptions, SqlitePool},
    Column, Row, Sqlite, TypeInfo, ValueRef,
};
use chrono::{Datelike, Days, Local, Months, NaiveDateTime, TimeZone};
use tauri::{AppHandle, Emitter, Manager};

use crate::timer::{Done, Mode, Step};

/// Pool propio sobre la misma pet.db que usa el frontend (tauri-plugin-sql); WAL permite ambos.
/// Lo usan el timer (registrar sesiones aunque no haya ventana escuchando) y la web local.
pub struct Db(pub SqlitePool);

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let opts = SqliteConnectOptions::new().filename(dir.join("pet.db")).create_if_missing(true);
    // El pool necesita contexto Tokio (en setup no lo hay): se crea dentro del runtime de Tauri.
    let pool = tauri::async_runtime::block_on(async { SqlitePool::connect_lazy_with(opts) });
    app.manage(Db(pool));
    Ok(())
}

/// Guarda una sesión del timer. Un foco completo suma 🍅 a su tarea; uno cortado solo suma tiempo.
pub fn record_session(app: &AppHandle, d: &Done, end_ms: u64) {
    if d.skipped && (d.mode != Mode::Focus || d.elapsed < 60) {
        return; // pausas saltadas y focos de menos de 1 min no cuentan
    }
    let mode = match d.mode {
        Mode::Focus => "focus",
        Mode::Short => "short",
        Mode::Long => "long",
    };
    let (start, end) = ((end_ms - d.elapsed * 1000) as i64, end_ms as i64);
    let pomodoro = (d.mode == Mode::Focus && !d.skipped).then_some(d.task_id).flatten();
    let task = d.task_id;
    let activity = d.activity_id;
    let apps = d.apps.clone();
    let pool = app.state::<Db>().0.clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let session = sqlx::query("INSERT INTO sessions (start, end, mode, task_id, activity_id) VALUES (?, ?, ?, ?, ?)")
            .bind(start)
            .bind(end)
            .bind(mode)
            .bind(task)
            .bind(activity)
            .execute(&pool)
            .await;
        if let Ok(session) = session {
            for a in apps.iter().filter(|a| a.ms >= 1000 || a.hits > 0) {
                let _ = sqlx::query("INSERT INTO session_apps (session_id, bundle, name, secs, hits) VALUES (?, ?, ?, ?, ?)")
                    .bind(session.last_insert_rowid())
                    .bind(&a.bundle)
                    .bind(&a.name)
                    .bind((a.ms / 1000) as i64)
                    .bind(a.hits)
                    .execute(&pool)
                    .await;
            }
            if mode == "focus" {
                let work = tauri::async_runtime::spawn_blocking(move || crate::worklog::collect(start, end)).await;
                if let Ok(w) = work {
                    save_work(&pool, session.last_insert_rowid(), &w).await;
                }
            }
        }
        if let Some(id) = pomodoro {
            let _ = sqlx::query("UPDATE tasks SET done_pomodoros = done_pomodoros + 1 WHERE id = ?")
                .bind(id)
                .execute(&pool)
                .await;
        }
        let _ = app.emit("db://changed", ());
    });
}

/// Bloques de la rutina activa (F18), con los minutos de cada paso o los de su actividad. Vacía si no hay
/// rutina activa o si no tiene ningún foco (una rutina de puras pausas no sirve: manda la clásica).
pub async fn active_routine(pool: &SqlitePool) -> Result<Vec<Step>, sqlx::Error> {
    let rows: Vec<(i64, String, String, String, String, i64)> = sqlx::query_as(
        "SELECT a.id, a.kind, a.name, a.emoji, a.color, COALESCE(rs.min, a.min) FROM routine_steps rs
         JOIN routines r ON r.id = rs.routine_id AND r.active = 1
         JOIN activities a ON a.id = rs.activity_id
         ORDER BY rs.pos",
    )
    .fetch_all(pool)
    .await?;
    let steps: Vec<Step> = rows.into_iter().map(|(id, kind, name, emoji, color, min)| Step::new(&kind, min.max(1) as u64, id, name, emoji, color)).collect();
    Ok(if steps.iter().any(|s| s.mode == Mode::Focus) { steps } else { vec![] })
}

async fn save_work(pool: &SqlitePool, session: i64, w: &crate::worklog::Work) {
    for (project, p) in &w.projects {
        let _ = sqlx::query(
            "INSERT INTO session_projects (session_id, project, secs, detail, commits, added, removed, features) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(session)
        .bind(project)
        .bind(p.secs)
        .bind(&p.detail)
        .bind(p.commits)
        .bind(p.added)
        .bind(p.removed)
        .bind(p.features)
        .execute(pool)
        .await;
    }
    for ((project, model), t) in &w.tokens {
        let _ = sqlx::query(
            "INSERT INTO session_tokens (session_id, project, model, input, output, cache_read, cache_write) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(session)
        .bind(project)
        .bind(model)
        .bind(t.input)
        .bind(t.output)
        .bind(t.cache_read)
        .bind(t.cache_write)
        .execute(pool)
        .await;
    }
}

/// Registro por hora del trabajo con Claude (migración 013): al arrancar rehace todo el historial que falte y después,
/// cada 15 min, desde la última hora guardada (la última puede haber quedado a medias). Hilo propio: lee archivos y git.
pub fn spawn_claude_hours(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(30)); // las migraciones corren cuando carga el frontend
        loop {
            let pool = app.state::<Db>().0.clone();
            let ok = tauri::async_runtime::block_on(sync_hours(&pool));
            if matches!(ok, Ok(true)) {
                let _ = app.emit("db://changed", ());
            }
            std::thread::sleep(std::time::Duration::from_secs(if ok.is_ok() { 15 * 60 } else { 60 }));
        }
    });
}

/// Devuelve si guardó algo.
async fn sync_hours(pool: &SqlitePool) -> Result<bool, sqlx::Error> {
    let last: Option<i64> = sqlx::query_scalar("SELECT MAX(hour) FROM claude_hours").fetch_one(pool).await?;
    let from = last.map_or(0, |h| h - crate::worklog::HOUR_MS);
    let to = Local::now().timestamp_millis();
    let h = tauri::async_runtime::spawn_blocking(move || crate::worklog::hours(from, to)).await.unwrap_or_default();
    save_hours(pool, from, &h).await?;
    Ok(!h.work.is_empty() || !h.tokens.is_empty())
}

async fn save_hours(pool: &SqlitePool, from: i64, h: &crate::worklog::Hours) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM claude_hours WHERE hour >= ?").bind(from).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM claude_hour_tokens WHERE hour >= ?").bind(from).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM claude_hour_titles WHERE hour >= ?").bind(from).execute(&mut *tx).await?;
    for ((hour, project, title), (you, claude)) in &h.titles {
        sqlx::query("INSERT INTO claude_hour_titles (hour, project, title, you_secs, claude_secs) VALUES (?, ?, ?, ?, ?)")
            .bind(hour)
            .bind(project)
            .bind(title)
            .bind(you / 1000)
            .bind(claude / 1000)
            .execute(&mut *tx)
            .await?;
    }
    for (project, path, remote) in &h.projects {
        sqlx::query("INSERT OR REPLACE INTO claude_projects (project, path, remote) VALUES (?, ?, ?)")
            .bind(project)
            .bind(path)
            .bind(remote)
            .execute(&mut *tx)
            .await?;
    }
    // Solo proyectos con horas o tokens: las carpetas por las que Claude pasó de largo (`cd 03/datos`) no tienen ficha.
    sqlx::query("DELETE FROM claude_projects WHERE project NOT IN (SELECT project FROM claude_hours UNION SELECT project FROM claude_hour_tokens)")
        .execute(&mut *tx)
        .await?;
    for ((hour, project), w) in &h.work {
        sqlx::query(
            "INSERT INTO claude_hours (hour, project, you_secs, claude_secs, unattended_secs, commits, unattended_commits, added, removed, features) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(hour)
        .bind(project)
        .bind(w.you / 1000)
        .bind(w.claude / 1000)
        .bind(w.unattended / 1000)
        .bind(w.commits)
        .bind(w.unattended_commits)
        .bind(w.added)
        .bind(w.removed)
        .bind(w.features)
        .execute(&mut *tx)
        .await?;
    }
    for ((hour, project, model), (t, away)) in &h.tokens {
        sqlx::query(
            "INSERT INTO claude_hour_tokens (hour, project, model, input, output, cache_read, cache_write, unattended) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(hour)
        .bind(project)
        .bind(model)
        .bind(t.input)
        .bind(t.output)
        .bind(t.cache_read)
        .bind(t.cache_write)
        .bind(away)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await
}

fn query<'q>(sql: &'q str, args: &'q [Value]) -> sqlx::query::Query<'q, Sqlite, SqliteArguments<'q>> {
    args.iter().fold(sqlx::query(sql), |q, a| match a {
        Value::Null => q.bind(None::<i64>),
        Value::Bool(b) => q.bind(*b),
        Value::Number(n) => match n.as_i64() {
            Some(i) => q.bind(i),
            None => q.bind(n.as_f64()),
        },
        Value::String(s) => q.bind(s.as_str()),
        other => q.bind(other.to_string()),
    })
}

/// Mismo contrato que `select` de tauri-plugin-sql: filas como objetos JSON.
pub async fn select(pool: &SqlitePool, sql: &str, args: &[Value]) -> Result<Vec<Map<String, Value>>, sqlx::Error> {
    let rows = query(sql, args).fetch_all(pool).await?;
    rows.iter()
        .map(|row| {
            row.columns()
                .iter()
                .map(|c| {
                    let i = c.ordinal();
                    let raw = row.try_get_raw(i)?;
                    let v = if raw.is_null() {
                        Value::Null
                    } else {
                        match raw.type_info().name() {
                            "INTEGER" | "BOOLEAN" => row.try_get::<i64, _>(i)?.into(),
                            "REAL" => row.try_get::<f64, _>(i)?.into(),
                            _ => row.try_get::<String, _>(i)?.into(),
                        }
                    };
                    Ok((c.name().to_string(), v))
                })
                .collect()
        })
        .collect()
}

pub async fn execute(pool: &SqlitePool, sql: &str, args: &[Value]) -> Result<Value, sqlx::Error> {
    let r = query(sql, args).execute(pool).await?;
    Ok(serde_json::json!({ "rowsAffected": r.rows_affected(), "lastInsertId": r.last_insert_rowid() }))
}

/// Siguiente vencimiento de una tarea recurrente: la primera ocurrencia posterior a `due` y a `now` (una tarea vencida
/// hace días no genera una nueva ya vencida), a la misma hora. `monthly` cuenta los meses desde la fecha original, así
/// el 31 vuelve a ser 31 después de febrero. `none` o un valor desconocido → `None`.
pub fn next_due(due: NaiveDateTime, repeat: &str, now: NaiveDateTime) -> Option<NaiveDateTime> {
    let nth = |k: u32| match repeat {
        "daily" => due.checked_add_days(Days::new(k as u64)),
        "weekly" => due.checked_add_days(Days::new(7 * k as u64)),
        "monthly" => due.checked_add_months(Months::new(k)), // chrono recorta al último día del mes
        _ => None,
    };
    if repeat == "weekdays" {
        let mut d = due;
        loop {
            d = d.checked_add_days(Days::new(1))?;
            if d > now && d.weekday().num_days_from_monday() < 5 {
                return Some(d);
            }
        }
    }
    (1..).map(nth).take_while(|d| d.is_some()).flatten().find(|d| *d > now)
}

fn to_naive(ms: i64) -> Option<NaiveDateTime> {
    Some(Local.timestamp_millis_opt(ms).single()?.naive_local())
}

/// Marca la tarea y, si se completa una recurrente que no estaba hecha, crea la siguiente (misma hora, `notified = 0`).
/// La original queda hecha: el historial no se toca. Sin fecha, la base es `now`.
pub async fn set_done(pool: &SqlitePool, id: i64, done: bool, now_ms: i64) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query("SELECT done, due_at, repeat, title, category_id, project, priority, est_pomodoros FROM tasks WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
    let Some(r) = row else { return Ok(()) };
    // done_at: se fija al completarla (una vez) y se borra al desmarcarla.
    sqlx::query("UPDATE tasks SET done = ?1, done_at = CASE WHEN ?1 = 0 THEN NULL WHEN done = 0 THEN ?2 ELSE done_at END WHERE id = ?3")
        .bind(done)
        .bind(now_ms)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let repeat: String = r.get("repeat");
    if done && r.get::<i64, _>("done") == 0 && repeat != "none" {
        let due_ms = r.get::<Option<i64>, _>("due_at").unwrap_or(now_ms);
        let next = to_naive(due_ms)
            .zip(to_naive(now_ms))
            .and_then(|(d, n)| next_due(d, &repeat, n))
            .and_then(|n| Local.from_local_datetime(&n).earliest()); // hora inexistente por cambio de horario → None
        if let Some(next) = next {
            sqlx::query(
                "INSERT INTO tasks (title, category_id, project, priority, est_pomodoros, due_at, repeat, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(r.get::<String, _>("title"))
            .bind(r.get::<Option<i64>, _>("category_id"))
            .bind(r.get::<Option<String>, _>("project"))
            .bind(r.get::<i64, _>("priority"))
            .bind(r.get::<i64, _>("est_pomodoros"))
            .bind(next.timestamp_millis())
            .bind(&repeat)
            .bind(now_ms)
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await
}

/// Lo usan el panel, la web (`/api/invoke`) y, más adelante, el MCP: completar siempre pasa por la recurrencia.
#[tauri::command]
pub async fn task_set_done(app: AppHandle, id: i64, done: bool) -> Result<(), String> {
    let now = Local::now().timestamp_millis();
    set_done(&app.state::<Db>().0, id, done, now).await.map_err(|e| e.to_string())?;
    let _ = app.emit("db://changed", ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap()
    }

    #[test]
    fn diaria_y_semanal_mantienen_la_hora() {
        assert_eq!(next_due(dt("2026-10-22 09:30"), "daily", dt("2026-10-22 10:00")), Some(dt("2026-10-23 09:30")));
        assert_eq!(next_due(dt("2026-10-22 09:30"), "weekly", dt("2026-10-22 10:00")), Some(dt("2026-10-29 09:30")));
    }

    #[test]
    fn vencida_hace_dias_salta_al_futuro() {
        assert_eq!(next_due(dt("2026-10-12 09:30"), "daily", dt("2026-10-22 10:00")), Some(dt("2026-10-23 09:30")));
        assert_eq!(next_due(dt("2026-10-01 09:30"), "weekly", dt("2026-10-22 10:00")), Some(dt("2026-10-29 09:30")));
        // aún no vencida (se completó antes de tiempo): la siguiente es la que sigue a la fecha, no a hoy
        assert_eq!(next_due(dt("2026-10-25 09:30"), "daily", dt("2026-10-22 10:00")), Some(dt("2026-10-26 09:30")));
        // hoy a las 09:00 y ya son las 08:00 del día siguiente: la de hoy+1 09:00 sigue en el futuro
        assert_eq!(next_due(dt("2026-10-22 09:00"), "daily", dt("2026-10-23 08:00")), Some(dt("2026-10-23 09:00")));
    }

    #[test]
    fn entre_semana_salta_el_fin_de_semana() {
        // viernes 23-oct-2026 → lunes 26
        assert_eq!(next_due(dt("2026-10-23 18:00"), "weekdays", dt("2026-10-23 18:30")), Some(dt("2026-10-26 18:00")));
        // sábado → lunes
        assert_eq!(next_due(dt("2026-10-24 18:00"), "weekdays", dt("2026-10-24 19:00")), Some(dt("2026-10-26 18:00")));
        // lunes → martes
        assert_eq!(next_due(dt("2026-10-26 18:00"), "weekdays", dt("2026-10-26 19:00")), Some(dt("2026-10-27 18:00")));
        // vencida hace días: el primer día hábil futuro
        assert_eq!(next_due(dt("2026-10-12 08:00"), "weekdays", dt("2026-10-24 12:00")), Some(dt("2026-10-26 08:00")));
    }

    #[test]
    fn mensual_recorta_a_fin_de_mes_y_recupera_el_dia() {
        assert_eq!(next_due(dt("2026-01-31 10:00"), "monthly", dt("2026-01-31 11:00")), Some(dt("2026-02-28 10:00")));
        assert_eq!(next_due(dt("2028-01-31 10:00"), "monthly", dt("2028-01-31 11:00")), Some(dt("2028-02-29 10:00"))); // bisiesto
        // vencida: el 31 de enero completada el 15 de marzo → 31 de marzo (no el 28)
        assert_eq!(next_due(dt("2026-01-31 10:00"), "monthly", dt("2026-03-15 09:00")), Some(dt("2026-03-31 10:00")));
        assert_eq!(next_due(dt("2026-12-15 10:00"), "monthly", dt("2026-12-15 11:00")), Some(dt("2027-01-15 10:00")));
    }

    #[test]
    fn sin_repeticion_no_hay_siguiente() {
        assert_eq!(next_due(dt("2026-10-22 09:30"), "none", dt("2026-10-22 10:00")), None);
        assert_eq!(next_due(dt("2026-10-22 09:30"), "cada-tanto", dt("2026-10-22 10:00")), None);
    }

    #[test]
    fn guarda_el_trabajo_del_foco() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            sqlx::raw_sql(include_str!("../migrations/001_init.sql")).execute(&pool).await.unwrap();
            sqlx::raw_sql(include_str!("../migrations/012_session_work.sql")).execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO sessions (id, start, end, mode) VALUES (7, 0, 1, 'focus')").execute(&pool).await.unwrap();
            let mut w = crate::worklog::Work::default();
            w.projects.insert("pet".into(), crate::worklog::ProjectWork { secs: 600, commits: 2, added: 40, features: 1, ..Default::default() });
            w.tokens.insert(("pet".into(), "claude-opus-5-5".into()), crate::worklog::Tokens { output: 900, ..Default::default() });
            save_work(&pool, 7, &w).await;
            let p = select(&pool, "SELECT session_id, project, secs, commits, added, features FROM session_projects", &[]).await.unwrap();
            assert_eq!(Value::from(p[0].clone()), serde_json::json!({"session_id":7,"project":"pet","secs":600,"commits":2,"added":40,"features":1}));
            let t = select(&pool, "SELECT model, output FROM session_tokens", &[]).await.unwrap();
            assert_eq!(Value::from(t[0].clone()), serde_json::json!({"model":"claude-opus-5-5","output":900}));
        });
    }

    #[test]
    fn la_rutina_activa_con_sus_minutos() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            sqlx::raw_sql(include_str!("../migrations/001_init.sql")).execute(&pool).await.unwrap();
            sqlx::raw_sql(include_str!("../migrations/015_routines.sql")).execute(&pool).await.unwrap();
            assert!(active_routine(&pool).await.unwrap().is_empty()); // sin rutina: la clásica
            // Constanza: Foco 25 · Descanso 5 · Foco 25 · Pausa activa (10 por defecto, aquí 12)
            sqlx::raw_sql(
                "INSERT INTO routines (id, name, active) VALUES (1, 'Constanza', 1), (2, 'Pausas', 0);
                 INSERT INTO routine_steps (routine_id, pos, activity_id, min) VALUES
                   (1, 0, 1, NULL), (1, 1, 2, NULL), (1, 2, 1, NULL), (1, 3, 4, 12), (2, 0, 2, NULL);",
            )
            .execute(&pool)
            .await
            .unwrap();
            let r = active_routine(&pool).await.unwrap();
            let v: Vec<_> = r.iter().map(|s| (s.mode, s.secs / 60, s.label.as_str(), s.color.as_str())).collect();
            assert_eq!(
                v,
                [(Mode::Focus, 25, "Foco", "#e8523c"), (Mode::Short, 5, "Descanso", "#3cb371"), (Mode::Focus, 25, "Foco", "#e8523c"), (Mode::Short, 12, "Pausa activa", "#e8a33c")]
            );
            // una sola activa, y una rutina sin focos no sirve
            assert!(sqlx::query("UPDATE routines SET active = 1 WHERE id = 2").execute(&pool).await.is_err());
            sqlx::raw_sql("UPDATE routines SET active = 0; UPDATE routines SET active = 1 WHERE id = 2;").execute(&pool).await.unwrap();
            assert!(active_routine(&pool).await.unwrap().is_empty());
        });
    }

    #[test]
    fn el_registro_por_hora_rehace_desde_from() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            sqlx::raw_sql(include_str!("../migrations/013_claude_hours.sql")).execute(&pool).await.unwrap();
            sqlx::raw_sql(include_str!("../migrations/014_claude_projects.sql")).execute(&pool).await.unwrap();
            let hr = crate::worklog::HOUR_MS;
            let mut h = crate::worklog::Hours::default();
            let w = crate::worklog::Hour { claude: 1_800_000, unattended: 600_000, commits: 2, ..Default::default() };
            h.work.insert((0, "pet".into()), w.clone());
            h.work.insert((hr, "pet".into()), w);
            h.tokens.insert((hr, "pet".into(), "opus".into()), (crate::worklog::Tokens { output: 5, ..Default::default() }, 5));
            h.titles.insert((hr, "pet".into(), "Rastreo de horas".into()), (60_000, 120_000));
            h.projects.push(("pet".into(), "/x/pet".into(), "github.com/a/pet".into()));
            h.projects.push(("pet/03".into(), "/x/pet/03".into(), "".into())); // sin horas: no se guarda
            save_hours(&pool, 0, &h).await.unwrap();
            // segunda pasada desde la hora 1: la 0 queda, la 1 se reemplaza (sin duplicar la clave)
            h.work.remove(&(0, "pet".into()));
            save_hours(&pool, hr, &h).await.unwrap();
            let rows = select(&pool, "SELECT hour, claude_secs, unattended_secs FROM claude_hours ORDER BY hour", &[]).await.unwrap();
            assert_eq!(Value::from(rows.into_iter().map(Value::Object).collect::<Vec<_>>()), serde_json::json!([
                {"hour":0,"claude_secs":1800,"unattended_secs":600},
                {"hour":hr,"claude_secs":1800,"unattended_secs":600}]));
            let t = select(&pool, "SELECT title, you_secs, claude_secs FROM claude_hour_titles", &[]).await.unwrap();
            assert_eq!(Value::from(t[0].clone()), serde_json::json!({"title":"Rastreo de horas","you_secs":60,"claude_secs":120}));
            save_hours(&pool, hr, &h).await.unwrap(); // el proyecto se reemplaza, no choca con la clave
            let p = select(&pool, "SELECT project, remote FROM claude_projects", &[]).await.unwrap();
            assert_eq!(p.len(), 1);
        });
    }

    #[test]
    fn completar_crea_la_siguiente_una_sola_vez() {
        tauri::async_runtime::block_on(completar_crea_la_siguiente());
    }

    async fn completar_crea_la_siguiente() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/001_init.sql")).execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/002_project.sql")).execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/007_task_repeat.sql")).execute(&pool).await.unwrap();
        let due = Local.with_ymd_and_hms(2026, 10, 20, 9, 0, 0).unwrap().timestamp_millis();
        let now = Local.with_ymd_and_hms(2026, 10, 22, 10, 0, 0).unwrap().timestamp_millis();
        sqlx::query("INSERT INTO tasks (title, project, due_at, notified, repeat, created_at) VALUES ('regar', 'casa', ?, 1, 'daily', 0)")
            .bind(due)
            .execute(&pool)
            .await
            .unwrap();
        set_done(&pool, 1, true, now).await.unwrap();
        set_done(&pool, 1, true, now).await.unwrap(); // ya estaba hecha: no duplica
        let rows = select(&pool, "SELECT id, done, done_at, due_at, notified, project, repeat FROM tasks ORDER BY id", &[]).await.unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!((rows[0]["done"].clone(), rows[0]["done_at"].clone()), (1.into(), now.into()));
        let next = Local.with_ymd_and_hms(2026, 10, 23, 9, 0, 0).unwrap().timestamp_millis();
        assert_eq!((rows[1]["done"].clone(), rows[1]["due_at"].clone(), rows[1]["notified"].clone()), (0.into(), next.into(), 0.into()));
        assert_eq!((rows[1]["project"].as_str(), rows[1]["repeat"].as_str()), (Some("casa"), Some("daily")));
        set_done(&pool, 1, false, now).await.unwrap(); // desmarcar no crea nada y borra done_at
        let rows = select(&pool, "SELECT done_at FROM tasks", &[]).await.unwrap();
        assert_eq!((rows.len(), rows[0]["done_at"].clone()), (2, Value::Null));
    }
}
