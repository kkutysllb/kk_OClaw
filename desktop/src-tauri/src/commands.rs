use crate::AppState;
use crate::backend::BackendStatus;
use serde::Serialize;
use tauri::{AppHandle, State};

/// Response payload for backend status queries.
#[derive(Serialize)]
pub struct BackendStatusResponse {
    pub status: String,
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl BackendStatusResponse {
    fn from_backend(mgr: &crate::backend::BackendManager) -> Self {
        match mgr.status() {
            BackendStatus::Stopped => Self {
                status: "stopped".into(),
                port: mgr.port(),
                error: None,
            },
            BackendStatus::Starting => Self {
                status: "starting".into(),
                port: mgr.port(),
                error: None,
            },
            BackendStatus::Running => Self {
                status: "running".into(),
                port: mgr.port(),
                error: None,
            },
            BackendStatus::Error(msg) => Self {
                status: "error".into(),
                port: mgr.port(),
                error: Some(msg.clone()),
            },
        }
    }
}

/// Start the embedded backend Gateway process.
#[tauri::command]
pub async fn start_backend(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BackendStatusResponse, String> {
    let mut mgr = state.backend.lock().await;
    mgr.start(&app).await?;

    Ok(BackendStatusResponse::from_backend(&mgr))
}

/// Stop the embedded backend Gateway process.
#[tauri::command]
pub async fn stop_backend(state: State<'_, AppState>) -> Result<BackendStatusResponse, String> {
    let mut mgr = state.backend.lock().await;
    mgr.stop()?;

    Ok(BackendStatusResponse::from_backend(&mgr))
}

/// Get the current backend status.
#[tauri::command]
pub async fn get_backend_status(state: State<'_, AppState>) -> Result<BackendStatusResponse, String> {
    let mgr = state.backend.lock().await;
    Ok(BackendStatusResponse::from_backend(&mgr))
}

/// Get recent backend log lines.
#[tauri::command]
pub async fn get_backend_logs(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let mgr = state.backend.lock().await;
    Ok(mgr.logs().to_vec())
}

/// Restart the backend process.
#[tauri::command]
pub async fn restart_backend(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BackendStatusResponse, String> {
    let mut mgr = state.backend.lock().await;
    mgr.restart(&app).await?;

    Ok(BackendStatusResponse::from_backend(&mgr))
}
