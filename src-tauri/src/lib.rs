use std::{sync::Mutex, thread, time::Duration};
use tauri::{Manager, State};

/// Zona opaca (px lógicos, relativa a la ventana) donde la ventana captura el mouse.
#[derive(Default)]
struct HitRect(Mutex<[f64; 4]>); // x, y, w, h

#[tauri::command]
fn set_hit_rect(rect: [f64; 4], state: State<HitRect>) {
    *state.0.lock().unwrap() = rect;
}

// Click-through: polling del cursor (~60 ms). Fuera del rect -> ignora eventos.
fn spawn_cursor_poll(app: tauri::AppHandle) {
    thread::spawn(move || {
        let mut ignoring: Option<bool> = None;
        loop {
            thread::sleep(Duration::from_millis(60));
            let Some(win) = app.get_webview_window("pet") else { continue };
            let (Ok(cur), Ok(pos), Ok(scale)) =
                (win.cursor_position(), win.outer_position(), win.scale_factor())
            else { continue };
            let [x, y, w, h] = *app.state::<HitRect>().0.lock().unwrap();
            let (lx, ly) = ((cur.x - pos.x as f64) / scale, (cur.y - pos.y as f64) / scale);
            let inside = lx >= x && lx <= x + w && ly >= y && ly <= y + h;
            if ignoring != Some(!inside) {
                let _ = win.set_ignore_cursor_events(!inside);
                ignoring = Some(!inside);
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(HitRect::default())
        .invoke_handler(tauri::generate_handler![set_hit_rect])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            spawn_cursor_poll(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
