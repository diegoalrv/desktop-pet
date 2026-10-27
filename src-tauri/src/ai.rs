//! IA por el proxy propio (F19): en Windows una sola "Key de Candola" (Ajustes) reemplaza la cadena de modelos y
//! todo va a ai.spadelab.xyz (LiteLLM). En Mac nada cambia, salvo que se arranque con `PET_AI=candola` para probar
//! el flujo de Windows.
use crate::meeting::Llm;
use std::time::Duration;
use tauri::AppHandle;

/// Mismo destino que `meeting::base_url("candola")`.
const PROXY: &str = "https://ai.spadelab.xyz/v1";

/// ¿La IA va por el proxy? Windows siempre; en otro sistema solo con `PET_AI=candola`.
fn proxy_mode() -> bool {
    cfg!(windows) || std::env::var("PET_AI").is_ok_and(|v| v == "candola")
}

fn candola_key(app: &AppHandle) -> String {
    use tauri_plugin_store::StoreExt;
    let prefs = app.store("settings.json").ok().and_then(|s| s.get("prefs")).unwrap_or_default();
    prefs["candolaKey"].as_str().unwrap_or("").trim().to_string()
}

/// En modo proxy, solo el alias `candola` con la key (vacía = el error "falta la API key"); si no, la cadena tal cual.
fn chain(proxy: bool, key: String, llms: Vec<Llm>) -> Vec<Llm> {
    if proxy {
        vec![Llm { provider: "candola".into(), apikey: key, models: vec!["candola".into()] }]
    } else {
        llms
    }
}

/// La cadena de modelos que de verdad se usa: reuniones, gestión y preguntas pasan por aquí.
pub fn llms(app: &AppHandle, llms: Vec<Llm>) -> Vec<Llm> {
    let proxy = proxy_mode();
    chain(proxy, if proxy { candola_key(app) } else { String::new() }, llms)
}

/// Para Ajustes: muestra solo el campo de la key en vez del editor de modelos.
#[tauri::command]
pub fn ai_proxy() -> bool {
    proxy_mode()
}

/// Botón "Probar" de Ajustes: la key abre `/models` del proxy.
#[tauri::command]
pub async fn ai_check(key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let res = ureq::get(format!("{PROXY}/models"))
            .config()
            .timeout_global(Some(Duration::from_secs(20)))
            .http_status_as_error(false)
            .build()
            .header("Authorization", format!("Bearer {}", key.trim()))
            .call()
            .map_err(|_| "No pude conectar con el servidor de la Candola".to_string())?;
        match res.status().as_u16() {
            200 => Ok(()),
            401 | 403 | 404 => Err("Key inválida".into()), // sin key el proxy responde 404
            s => Err(format!("El servidor respondió {s}")),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn en_modo_proxy_solo_va_candola() {
        let mac = vec![Llm { provider: "claude-code".into(), apikey: "".into(), models: vec!["sonnet".into()] }];
        let c = chain(true, "sk-x".into(), mac.clone());
        assert_eq!((c.len(), c[0].provider.as_str(), c[0].apikey.as_str(), c[0].models[0].as_str()), (1, "candola", "sk-x", "candola"));
        let c = chain(false, "sk-x".into(), mac);
        assert_eq!((c.len(), c[0].provider.as_str(), c[0].apikey.as_str()), (1, "claude-code", "")); // Mac: intacta
    }
}
