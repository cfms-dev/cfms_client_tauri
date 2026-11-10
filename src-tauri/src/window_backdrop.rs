//! Native window-base material. CSS becomes transparent only after confirmation.
use serde::{Deserialize, Serialize};
use tauri::{Runtime, WebviewWindow};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BackdropTheme {
    Light,
    Dark,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BackdropMode {
    #[cfg(target_os = "windows")]
    Mica,
    Solid,
}

fn solid_color(rgb: [u8; 3]) -> tauri::window::Color {
    tauri::window::Color(rgb[0], rgb[1], rgb[2], 255)
}

#[cfg(target_os = "windows")]
fn apply<R: Runtime>(
    window: &WebviewWindow<R>,
    theme: BackdropTheme,
    enabled: bool,
    solid_color_rgb: [u8; 3],
) -> Result<BackdropMode, String> {
    if enabled {
        match window_vibrancy::apply_mica(window, Some(matches!(theme, BackdropTheme::Dark))) {
            Ok(()) => {
                window
                    .set_background_color(Some(tauri::window::Color(0, 0, 0, 0)))
                    .map_err(|error| error.to_string())?;
                return Ok(BackdropMode::Mica);
            }
            Err(error) => tracing::debug!("Mica unavailable; using solid window base: {error}"),
        }
    }
    // Unsupported Windows versions may also reject clearing a never-set effect.
    let _ = window_vibrancy::clear_mica(window);
    window
        .set_background_color(Some(solid_color(solid_color_rgb)))
        .map_err(|error| error.to_string())?;
    Ok(BackdropMode::Solid)
}

#[cfg(not(target_os = "windows"))]
fn apply<R: Runtime>(
    window: &WebviewWindow<R>,
    _theme: BackdropTheme,
    _enabled: bool,
    solid_color_rgb: [u8; 3],
) -> Result<BackdropMode, String> {
    window
        .set_background_color(Some(solid_color(solid_color_rgb)))
        .map_err(|error| error.to_string())?;
    Ok(BackdropMode::Solid)
}

#[tauri::command]
pub async fn set_window_backdrop<R: Runtime>(
    window: WebviewWindow<R>,
    theme: BackdropTheme,
    enabled: bool,
    solid_color: [u8; 3],
) -> Result<BackdropMode, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = sender.send(apply(&target, theme, enabled, solid_color));
        })
        .map_err(|error| error.to_string())?;
    receiver.await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_values_and_fallbacks_match_the_frontend_contract() {
        #[cfg(target_os = "windows")]
        assert_eq!(
            serde_json::to_string(&BackdropMode::Mica).unwrap(),
            "\"mica\""
        );
        assert_eq!(
            serde_json::to_string(&BackdropMode::Solid).unwrap(),
            "\"solid\""
        );
        let _light: BackdropTheme = serde_json::from_str("\"light\"").unwrap();
        let _dark: BackdropTheme = serde_json::from_str("\"dark\"").unwrap();
        assert_eq!(
            solid_color([243, 243, 243]),
            tauri::window::Color(243, 243, 243, 255)
        );
        assert_eq!(
            solid_color([32, 32, 32]),
            tauri::window::Color(32, 32, 32, 255)
        );
        assert_eq!(
            solid_color([27, 36, 49]),
            tauri::window::Color(27, 36, 49, 255)
        );
        assert!(serde_json::from_str::<BackdropTheme>("\"auto\"").is_err());
    }
}
