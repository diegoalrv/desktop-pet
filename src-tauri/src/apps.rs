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
