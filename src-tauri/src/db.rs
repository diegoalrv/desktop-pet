use serde_json::{Map, Value};
use sqlx::{
    sqlite::{SqliteArguments, SqliteConnectOptions, SqlitePool},
    Column, Row, Sqlite, TypeInfo, ValueRef,
};
use chrono::{Datelike, Days, Local, Months, NaiveDateTime, TimeZone};
use tauri::{AppHandle, Emitter, Manager};

use crate::timer::{Done, Mode};

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
    let pool = app.state::<Db>().0.clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = sqlx::query("INSERT INTO sessions (start, end, mode, task_id) VALUES (?, ?, ?, ?)")
            .bind(start)
            .bind(end)
            .bind(mode)
            .bind(task)
            .execute(&pool)
            .await;
        if let Some(id) = pomodoro {
            let _ = sqlx::query("UPDATE tasks SET done_pomodoros = done_pomodoros + 1 WHERE id = ?")
                .bind(id)
                .execute(&pool)
                .await;
        }
        let _ = app.emit("db://changed", ());
    });
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
    sqlx::query("UPDATE tasks SET done = ? WHERE id = ?").bind(done).bind(id).execute(&mut *tx).await?;
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
        let rows = select(&pool, "SELECT id, done, due_at, notified, project, repeat FROM tasks ORDER BY id", &[]).await.unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["done"], 1);
        let next = Local.with_ymd_and_hms(2026, 10, 23, 9, 0, 0).unwrap().timestamp_millis();
        assert_eq!((rows[1]["done"].clone(), rows[1]["due_at"].clone(), rows[1]["notified"].clone()), (0.into(), next.into(), 0.into()));
        assert_eq!((rows[1]["project"].as_str(), rows[1]["repeat"].as_str()), (Some("casa"), Some("daily")));
        set_done(&pool, 1, false, now).await.unwrap(); // desmarcar no crea nada
        assert_eq!(select(&pool, "SELECT id FROM tasks", &[]).await.unwrap().len(), 2);
    }
}
