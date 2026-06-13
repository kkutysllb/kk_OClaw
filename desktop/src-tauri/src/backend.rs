use std::fs;
use std::path::PathBuf;
use std::process::Child;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

/// Status of the embedded backend process.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum BackendStatus {
    Stopped,
    Starting,
    Running,
    Error(String),
}

/// Manages the lifecycle of the embedded Python Gateway process.
pub struct BackendManager {
    process: Option<Child>,
    status: BackendStatus,
    port: u16,
    log_buffer: Vec<String>,
}

/// Maximum number of log lines to keep in memory.
const MAX_LOG_LINES: usize = 500;

/// Default gateway port (matches .env GATEWAY_PORT).
const DEFAULT_GATEWAY_PORT: u16 = 9987;

/// Health check polling interval.
const HEALTH_CHECK_INTERVAL_MS: u64 = 500;

/// Maximum time to wait for backend to become healthy (seconds).
const HEALTH_CHECK_TIMEOUT_SECS: u64 = 120;

impl BackendManager {
    pub fn new() -> Self {
        let port = std::env::var("GATEWAY_PORT")
            .ok()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(DEFAULT_GATEWAY_PORT);

        Self {
            process: None,
            status: BackendStatus::Stopped,
            port,
            log_buffer: Vec::new(),
        }
    }

    /// Get the current backend status.
    pub fn status(&self) -> &BackendStatus {
        &self.status
    }

    /// Get the gateway port.
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Get recent log lines.
    pub fn logs(&self) -> &[String] {
        &self.log_buffer
    }

    /// Start the backend Gateway process.
    ///
    /// Uses the Tauri app handle to resolve:
    /// - App data directory (where config.yaml, .kkoclaw/, skills/ live)
    /// - Resource directory (where the bundled gateway executable lives)
    ///
    /// In production (installed app), the bundled PyInstaller executable is used.
    /// In development (`tauri dev`), falls back to `uv run uvicorn` from the source tree.
    pub async fn start<R: Runtime>(&mut self, app: &AppHandle<R>) -> Result<(), String> {
        if self.is_running() {
            return Err("Backend is already running".into());
        }

        // Check for port conflict
        if self.is_port_in_use().await {
            // Port is occupied; check if it's already our gateway
            if self.check_health().await {
                self.status = BackendStatus::Running;
                self.append_log("Gateway already running on port, reusing existing process".into());
                return Ok(());
            }
            return Err(format!(
                "Port {} is already in use by another process",
                self.port
            ));
        }

        // Resolve app data directory (platform-specific)
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;

        // Initialize app data directory on first run
        self.init_app_data(app, &app_data)?;

        // Resolve the gateway executable path
        let (cmd, args, working_dir) = self.resolve_gateway_command(app)?;

        // Load .env file for environment variables
        let env_vars = self.load_env_file(&app_data);

        self.append_log(format!(
            "Starting gateway: {} {} (cwd: {})",
            cmd,
            args.join(" "),
            working_dir.display()
        ));
        self.status = BackendStatus::Starting;

        // Redirect stdout/stderr to a log file instead of piping.
        //
        // Using Stdio::piped() without draining the pipe deadlocks the child
        // once the OS pipe buffer (64 KB on macOS/Linux) fills up. The
        // PyInstaller-bundled gateway emits thousands of lines during Python
        // initialisation (LangChain/LangGraph imports, uvicorn startup, etc.),
        // so it silently blocks on write() and never begins listening — the
        // health check then loops until the 120 s timeout, leaving the UI
        // stuck on "Starting OClaw / Initializing backend services".
        //
        // Redirecting to a file avoids the deadlock entirely and gives users
        // a persistent log under <app_data>/logs/gateway.log.
        let log_dir = app_data.join("logs");
        fs::create_dir_all(&log_dir)
            .map_err(|e| format!("Failed to create logs dir: {}", e))?;
        let gateway_log_path = log_dir.join("gateway.log");
        let gateway_log = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&gateway_log_path)
            .map_err(|e| format!("Failed to open gateway log file: {}", e))?;
        let gateway_err_log = gateway_log
            .try_clone()
            .map_err(|e| format!("Failed to clone gateway log handle: {}", e))?;

        self.append_log(format!("Gateway output → {}", gateway_log_path.display()));

        // Build environment for the child process
        let mut command = std::process::Command::new(&cmd);
        command
            .args(&args)
            .current_dir(&working_dir)
            .env("KKOCLAW_PROJECT_ROOT", &app_data)
            .env("KKOCLAW_HOME", app_data.join(".kkoclaw"))
            .env("KKOCLAW_CONFIG_PATH", app_data.join("config.yaml"))
            .env("GATEWAY_PORT", self.port.to_string())
            .env("GATEWAY_HOST", "127.0.0.1")
            .stdout(std::process::Stdio::from(gateway_log))
            .stderr(std::process::Stdio::from(gateway_err_log));

        // Inject .env variables
        for (key, value) in &env_vars {
            command.env(key, value);
        }

        // Start process
        let child = command.spawn().map_err(|e| {
            self.status = BackendStatus::Error(format!("Failed to start process: {}", e));
            format!("Failed to start process: {}", e)
        })?;

        self.process = Some(child);
        self.append_log("Gateway process started, waiting for health check...".into());

        // Wait for health check
        match self.wait_for_health().await {
            Ok(()) => {
                self.status = BackendStatus::Running;
                self.append_log("Gateway is healthy and ready".into());
                Ok(())
            }
            Err(e) => {
                self.status = BackendStatus::Error(e.clone());
                self.append_log(format!("Health check failed: {}", e));
                // Try to kill the process
                self.kill_process();
                Err(e)
            }
        }
    }

    /// Restart the backend.
    pub async fn restart<R: Runtime>(&mut self, app: &AppHandle<R>) -> Result<(), String> {
        self.stop()?;
        // Give it a moment to fully release the port
        tokio::time::sleep(Duration::from_secs(1)).await;
        self.start(app).await
    }

    /// Initialize the app data directory on first run.
    ///
    /// Creates the directory structure and copies bundled defaults:
    /// - config.yaml (from config.embedded.yaml)
    /// - skills/public/ (from bundled skills)
    fn init_app_data<R: Runtime>(&mut self, app: &AppHandle<R>, app_data: &PathBuf) -> Result<(), String> {
        let initialized_marker = app_data.join(".initialized");

        if initialized_marker.exists() {
            // Already initialized — just ensure subdirectories exist
            fs::create_dir_all(app_data.join(".kkoclaw")).map_err(|e| format!("Failed to create .kkoclaw dir: {}", e))?;
            fs::create_dir_all(app_data.join(".kkoclaw").join("data")).map_err(|e| format!("Failed to create data dir: {}", e))?;
            fs::create_dir_all(app_data.join("skills")).map_err(|e| format!("Failed to create skills dir: {}", e))?;
            fs::create_dir_all(app_data.join("skills").join("custom")).map_err(|e| format!("Failed to create custom skills dir: {}", e))?;
            fs::create_dir_all(app_data.join("logs")).map_err(|e| format!("Failed to create logs dir: {}", e))?;
            return Ok(());
        }

        self.append_log(format!("First run detected, initializing app data at {}", app_data.display()));

        // Create directory structure
        let dirs_to_create = [
            app_data.clone(),
            app_data.join(".kkoclaw"),
            app_data.join(".kkoclaw").join("data"),
            app_data.join("skills"),
            app_data.join("skills").join("public"),
            app_data.join("skills").join("custom"),
            app_data.join("logs"),
        ];
        for dir in &dirs_to_create {
            fs::create_dir_all(dir).map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;
        }

        // Copy config template from bundled resources
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to resolve resource directory: {}", e))?;

        let embedded_config = resource_dir.join("gateway").join("_internal").join("config.embedded.yaml");
        let target_config = app_data.join("config.yaml");

        if embedded_config.exists() {
            fs::copy(&embedded_config, &target_config)
                .map_err(|e| format!("Failed to copy config template: {}", e))?;
            self.append_log(format!("Copied config template to {}", target_config.display()));
        } else if !target_config.exists() {
            // Fallback: create a minimal config if no template is bundled
            fs::write(&target_config, DEFAULT_CONFIG_YAML)
                .map_err(|e| format!("Failed to write default config: {}", e))?;
            self.append_log("Created minimal default config (no template found in resources)".into());
        }

        // Copy bundled skills
        let bundled_skills = resource_dir.join("gateway").join("_internal").join("skills").join("public");
        if bundled_skills.is_dir() {
            let target_skills = app_data.join("skills").join("public");
            copy_dir_recursive(&bundled_skills, &target_skills)
                .map_err(|e| format!("Failed to copy skills: {}", e))?;
            self.append_log(format!("Copied bundled skills to {}", target_skills.display()));
        }

        // Create empty .env if it doesn't exist
        let env_path = app_data.join(".env");
        if !env_path.exists() {
            fs::write(&env_path, "# OClaw Desktop Environment Variables\n# Add your API keys here\n")
                .map_err(|e| format!("Failed to create .env: {}", e))?;
        }

        // Create initialized marker
        fs::write(&initialized_marker, chrono::Local::now().to_rfc3339())
            .map_err(|e| format!("Failed to write initialized marker: {}", e))?;

        self.append_log("App data initialization complete".into());
        Ok(())
    }

    /// Resolve the gateway executable command.
    ///
    /// Production mode: use the bundled PyInstaller executable from resources.
    /// Development mode: fall back to `uv run uvicorn` from the source tree.
    fn resolve_gateway_command<R: Runtime>(&mut self, app: &AppHandle<R>) -> Result<(String, Vec<String>, PathBuf), String> {
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to resolve resource directory: {}", e))?;

        // Try bundled gateway executable (production mode)
        #[cfg(target_os = "windows")]
        let gateway_exe = resource_dir.join("gateway").join("oclaw-gateway.exe");
        #[cfg(not(target_os = "windows"))]
        let gateway_exe = resource_dir.join("gateway").join("oclaw-gateway");

        if gateway_exe.is_file() {
            return Ok((
                gateway_exe.to_string_lossy().into_owned(),
                vec![],
                gateway_exe.parent().unwrap_or(&resource_dir).to_path_buf(),
            ));
        }

        // Development fallback: use uv/python from the source tree
        self.append_log("Bundled gateway not found, falling back to development mode (uv run uvicorn)".into());

        // Find the project root by walking up to find backend/
        let exe_dir = std::env::current_exe().unwrap_or_default();
        let mut dir = exe_dir.parent();
        while let Some(d) = dir {
            if d.join("backend").is_dir() && d.join(".env").is_file() {
                let backend_dir = d.join("backend");
                let uv_path = which("uv").or_else(|| which("uvx"));

                let (cmd, args) = if let Some(uv) = uv_path {
                    (
                        uv,
                        vec![
                            "run".into(),
                            "uvicorn".into(),
                            "app.gateway.app:app".into(),
                            "--host".into(),
                            "127.0.0.1".into(),
                            "--port".into(),
                            self.port.to_string(),
                        ],
                    )
                } else {
                    let python = which("python3").or_else(|| which("python")).ok_or_else(|| {
                        String::from("Neither bundled gateway, 'uv', nor 'python3' found.")
                    })?;
                    (
                        python,
                        vec![
                            "-m".into(),
                            "uvicorn".into(),
                            "app.gateway.app:app".into(),
                            "--host".into(),
                            "127.0.0.1".into(),
                            "--port".into(),
                            self.port.to_string(),
                        ],
                    )
                };

                return Ok((cmd, args, backend_dir));
            }
            dir = d.parent();
        }

        Err("Could not find bundled gateway executable or project root with backend/ directory".into())
    }

    /// Stop the backend process gracefully.
    pub fn stop(&mut self) -> Result<(), String> {
        if !self.is_running() {
            return Ok(());
        }
        self.append_log("Stopping backend...".into());
        self.kill_process();
        self.status = BackendStatus::Stopped;
        self.append_log("Backend stopped".into());
        Ok(())
    }

    // ── Private helpers ────────────────────────────────────────────────

    fn is_running(&mut self) -> bool {
        if let Some(ref mut child) = self.process {
            match child.try_wait() {
                Ok(Some(_status)) => {
                    // Process has exited
                    self.process = None;
                    false
                }
                Ok(None) => true, // Still running
                Err(_) => {
                    self.process = None;
                    false
                }
            }
        } else {
            false
        }
    }

    fn kill_process(&mut self) {
        if let Some(ref mut child) = self.process {
            // Try graceful shutdown first (SIGTERM on Unix)
            #[cfg(unix)]
            {
                let _ = unsafe { libc::kill(child.id() as i32, libc::SIGTERM) };
            }
            #[cfg(windows)]
            {
                // On Windows, taskkill with /pid for graceful shutdown
                let _ = std::process::Command::new("taskkill")
                    .args(["/PID", &child.id().to_string()])
                    .output();
            }

            // Wait a bit then force kill
            std::thread::sleep(Duration::from_millis(500));
            let _ = child.kill();
            let _ = child.wait();
        }
        self.process = None;
    }

    async fn is_port_in_use(&self) -> bool {
        // Try to connect to the port
        let addr = format!("127.0.0.1:{}", self.port);
        tokio::net::TcpStream::connect(&addr).await.is_ok()
    }

    async fn check_health(&self) -> bool {
        let url = format!("http://127.0.0.1:{}/health", self.port);
        reqwest::get(&url)
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }

    async fn wait_for_health(&self) -> Result<(), String> {
        let url = format!("http://127.0.0.1:{}/health", self.port);
        let client = reqwest::Client::new();
        let start = std::time::Instant::now();
        let timeout = Duration::from_secs(HEALTH_CHECK_TIMEOUT_SECS);

        loop {
            if start.elapsed() > timeout {
                return Err(format!(
                    "Backend did not become healthy within {} seconds",
                    HEALTH_CHECK_TIMEOUT_SECS
                ));
            }

            match client.get(&url).timeout(Duration::from_secs(2)).send().await {
                Ok(resp) if resp.status().is_success() => return Ok(()),
                _ => {
                    tokio::time::sleep(Duration::from_millis(HEALTH_CHECK_INTERVAL_MS)).await;
                }
            }
        }
    }

    /// Load key=value pairs from a .env file.
    fn load_env_file(&self, root: &PathBuf) -> Vec<(String, String)> {
        let env_path = root.join(".env");
        let mut vars = Vec::new();

        if let Ok(content) = fs::read_to_string(&env_path) {
            for line in content.lines() {
                let line = line.trim();
                // Skip comments and empty lines
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((key, value)) = line.split_once('=') {
                    let key = key.trim().to_string();
                    let value = value.trim().to_string();
                    vars.push((key, value));
                }
            }
        }

        vars
    }

    fn append_log(&mut self, msg: String) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let line = format!("[{}] {}", timestamp, msg);
        log::info!("{}", line);
        self.log_buffer.push(line);
        if self.log_buffer.len() > MAX_LOG_LINES {
            self.log_buffer.drain(0..self.log_buffer.len() - MAX_LOG_LINES);
        }
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_manager() -> BackendManager {
        BackendManager {
            process: None,
            status: BackendStatus::Stopped,
            port: 19999, // Use a test-only port to avoid conflicts
            log_buffer: Vec::new(),
        }
    }

    #[test]
    fn test_backend_status_serialization() {
        // Stopped
        let json = serde_json::to_string(&BackendStatus::Stopped).unwrap();
        assert_eq!(json, "\"stopped\"");

        // Starting
        let json = serde_json::to_string(&BackendStatus::Starting).unwrap();
        assert_eq!(json, "\"starting\"");

        // Running
        let json = serde_json::to_string(&BackendStatus::Running).unwrap();
        assert_eq!(json, "\"running\"");

        // Error
        let json = serde_json::to_string(&BackendStatus::Error("boom".into())).unwrap();
        assert!(json.contains("error"));
        assert!(json.contains("boom"));
    }

    #[test]
    fn test_load_env_file_parses_key_value_pairs() {
        let dir = tempfile::tempdir().unwrap();
        let env_path = dir.path().join(".env");
        let mut f = std::fs::File::create(&env_path).unwrap();
        writeln!(
            f,
            "# This is a comment\n\
             GATEWAY_PORT=12345\n\
             \n\
             DATABASE_URL=postgres://localhost\n\
             EMPTY_VAR=\n"
        )
        .unwrap();

        let mgr = make_manager();
        let vars = mgr.load_env_file(&dir.path().to_path_buf());

        // Should have 3 non-comment, non-empty-line entries
        assert_eq!(vars.len(), 3);
        assert_eq!(vars[0].0, "GATEWAY_PORT");
        assert_eq!(vars[0].1, "12345");
        assert_eq!(vars[1].0, "DATABASE_URL");
        assert_eq!(vars[1].1, "postgres://localhost");
        assert_eq!(vars[2].0, "EMPTY_VAR");
        assert_eq!(vars[2].1, "");
    }

    #[test]
    fn test_load_env_file_missing_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = make_manager();
        let vars = mgr.load_env_file(&dir.path().to_path_buf());
        assert!(vars.is_empty());
    }

    #[test]
    fn test_append_log_truncates_buffer() {
        let mut mgr = make_manager();
        // Fill beyond MAX_LOG_LINES
        for i in 0..MAX_LOG_LINES + 100 {
            mgr.append_log(format!("Line {}", i));
        }
        assert_eq!(mgr.log_buffer.len(), MAX_LOG_LINES);
        // Oldest entries should be dropped, latest should be present
        assert!(mgr.log_buffer.last().unwrap().contains(&format!("Line {}", MAX_LOG_LINES + 99)));
    }

    #[test]
    fn test_backend_manager_new_reads_port_from_env() {
        // Save original
        let orig = std::env::var("GATEWAY_PORT").ok();
        std::env::set_var("GATEWAY_PORT", "7777");
        let mgr = BackendManager::new();
        assert_eq!(mgr.port, 7777);
        // Restore
        match orig {
            Some(v) => std::env::set_var("GATEWAY_PORT", v),
            None => std::env::remove_var("GATEWAY_PORT"),
        }
    }
}

#[cfg(test)]
mod copy_dir_tests {
    use super::copy_dir_recursive;
    use std::fs;

    #[test]
    fn test_copy_dir_recursive_copies_files() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();

        // Create test structure
        fs::write(src.path().join("a.txt"), "hello").unwrap();
        fs::create_dir(src.path().join("subdir")).unwrap();
        fs::write(src.path().join("subdir").join("b.txt"), "world").unwrap();

        copy_dir_recursive(
            &src.path().to_path_buf(),
            &dst.path().join("target"),
        )
        .unwrap();

        // Verify
        assert_eq!(fs::read_to_string(dst.path().join("target").join("a.txt")).unwrap(), "hello");
        assert_eq!(fs::read_to_string(dst.path().join("target").join("subdir").join("b.txt")).unwrap(), "world");
    }
}

/// Simple `which` implementation to find executables on PATH.
fn which(name: &str) -> Option<String> {
    std::process::Command::new(if cfg!(windows) { "where" } else { "which" })
        .arg(name)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            String::from_utf8(o.stdout)
                .ok()
                .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
        })
}

/// Recursively copy a directory tree from `src` to `dst`.
///
/// Creates `dst` if it doesn't exist. Overwrites files that already exist.
fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    if !dst.is_dir() {
        fs::create_dir_all(dst)?;
    }

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());

        if file_type.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if file_type.is_symlink() {
            // Resolve symlink and copy the target
            let target = fs::read_link(&from)?;
            if target.is_dir() {
                copy_dir_recursive(&from, &to)?;
            } else {
                fs::copy(&from, &to)?;
            }
        } else {
            fs::copy(&from, &to)?;
        }
    }

    Ok(())
}

/// Minimal default config used when no config template is bundled.
/// This is a fallback; the real config comes from config.embedded.yaml.
const DEFAULT_CONFIG_YAML: &str = r#"config_version: 8
log_level: info
token_usage:
  enabled: true
models: []
sandbox:
  use: kkoclaw.sandbox.local:LocalSandboxProvider
  allow_host_bash: true
skills:
  container_path: /mnt/skills
database:
  backend: sqlite
  sqlite_dir: .kkoclaw/data
run_events:
  backend: db
  max_trace_content: 10240
  track_token_usage: true
title:
  enabled: true
  max_words: 6
  max_chars: 60
cron_management:
  enabled: false
"#;
