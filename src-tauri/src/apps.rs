//! Qué aplicación está al frente (F11: tiempo por app y distracciones durante el foco).
//! Solo macOS (`NSWorkspace`); en Windows queda pendiente (`GetForegroundWindow` + `GetWindowThreadProcessId`).
use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct App {
    pub bundle: String,
    pub name: String,
}

#[cfg(target_os = "macos")]
fn of(a: &objc2_app_kit::NSRunningApplication) -> Option<App> {
    let bundle = a.bundleIdentifier()?.to_string();
    let name = a.localizedName().map(|n| n.to_string()).unwrap_or_else(|| bundle.clone());
    Some(App { bundle, name })
}

/// Aplicación al frente ahora (None si no hay o no se puede saber).
#[cfg(target_os = "macos")]
pub fn frontmost() -> Option<App> {
    let front = objc2_app_kit::NSWorkspace::sharedWorkspace().frontmostApplication();
    front.as_deref().and_then(of)
}

#[cfg(not(target_os = "macos"))]
pub fn frontmost() -> Option<App> {
    None
}

/// Aplicaciones normales (con ícono en el Dock) abiertas ahora, para el selector de distracciones.
#[tauri::command]
pub fn running_apps() -> Vec<App> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSApplicationActivationPolicy;
        let mut apps: Vec<App> = objc2_app_kit::NSWorkspace::sharedWorkspace()
            .runningApplications()
            .iter()
            .filter(|a| a.activationPolicy() == NSApplicationActivationPolicy::Regular)
            .filter_map(|a| of(&a))
            .collect();
        apps.sort_by_key(|a| a.name.to_lowercase());
        apps
    }
    #[cfg(not(target_os = "macos"))]
    Vec::new()
}

/// Segundos desde el último teclado o mouse (F17: cabeza abajo sin usar el computador). No pide Accesibilidad.
#[cfg(target_os = "macos")]
fn idle_secs() -> f64 {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: i32, ty: u32) -> f64;
    }
    // kCGEventSourceStateCombinedSessionState = 0, kCGAnyInputEventType = !0
    unsafe { CGEventSourceSecondsSinceLastEventType(0, !0) }
}

#[cfg(not(target_os = "macos"))]
fn idle_secs() -> f64 {
    0.0 // ponytail: sin dato en Windows = siempre "usando el computador"; solo cuenta el teléfono a la vista
}

#[derive(Serialize)]
pub struct CamCtx {
    idle: f64,
    meeting: bool,
}

/// Lo que la cámara del foco necesita de la app en cada muestra: inactividad y si hay una reunión grabando
/// (entonces no gruñe ni ladra, para no meterle ladridos al micrófono de la llamada).
#[tauri::command]
pub fn focus_cam_ctx(app: tauri::AppHandle) -> CamCtx {
    CamCtx { idle: idle_secs(), meeting: crate::meeting::recording(&app) }
}
