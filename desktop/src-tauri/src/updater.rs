use serde::Serialize;
use tauri_plugin_updater::UpdaterExt;

/// Information about an available update.
#[derive(Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub version: Option<String>,
    pub date: Option<String>,
    pub body: Option<String>,
}

/// Check for application updates.
#[tauri::command]
pub async fn check_for_updates(
    app: tauri::AppHandle,
) -> Result<UpdateInfo, String> {
    let updater = app
        .updater_builder()
        .build()
        .map_err(|e| format!("Failed to build updater: {}", e))?;

    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateInfo {
            available: true,
            version: Some(update.version.clone()),
            date: update.date.map(|d| d.to_string()),
            body: update.body.clone(),
        }),
        Ok(None) => Ok(UpdateInfo {
            available: false,
            version: None,
            date: None,
            body: None,
        }),
        Err(e) => Err(format!("Failed to check for updates: {}", e)),
    }
}

/// Download and install an available update, then restart.
#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
) -> Result<(), String> {
    let updater = app
        .updater_builder()
        .build()
        .map_err(|e| format!("Failed to build updater: {}", e))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("Failed to check for updates: {}", e))?;

    match update {
        Some(update) => {
            update
                .download_and_install(
                    |chunk_length, content_length| {
                        log::info!(
                            "Downloading update: {} / {}",
                            chunk_length,
                            content_length.unwrap_or(0)
                        );
                    },
                    || {
                        log::info!("Update download finished");
                    },
                )
                .await
                .map_err(|e| format!("Failed to install update: {}", e))?;
            Ok(())
        }
        None => Err("No update available".into()),
    }
}
