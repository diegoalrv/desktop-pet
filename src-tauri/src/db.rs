use serde_json::{Map, Value};
use sqlx::{
    sqlite::{SqliteArguments, SqliteConnectOptions, SqlitePool},
    Column, Row, Sqlite, TypeInfo, ValueRef,
};
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
