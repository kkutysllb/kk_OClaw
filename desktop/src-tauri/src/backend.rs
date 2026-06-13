use std::fs;
use std::path::PathBuf;
use std::process::Child;
use std::time::Duration;

use serde::{Deserialize, Serialize};

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
    pub async fn start(&mut self, project_root: &PathBuf) -> Result<(), String> {
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

        // Resolve project root
        let root = self.resolve_project_root(project_root)?;
        let backend_dir = root.join("backend");
        if !backend_dir.is_dir() {
            return Err(format!(
                "Backend directory not found at {}",
                backend_dir.display()
            ));
        }

        // Load .env file for environment variables
        let env_vars = self.load_env_file(&root);

        // Detect Python/uv command
        let (cmd, args) = self.build_start_command(&backend_dir)?;

        self.append_log(format!(
            "Starting gateway: {} {}",
            cmd,
            args.join(" ")
        ));
        self.status = BackendStatus::Starting;

        // Build environment for the child process
        let mut command = std::process::Command::new(&cmd);
        command
            .args(&args)
            .current_dir(&backend_dir)
            .env("KKOCLAW_PROJECT_ROOT", &root)
            .env("KKOCLAW_HOME", root.join("backend/.kkoclaw"))
            .env("PYTHONPATH", ".")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

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

    /// Restart the backend.
    pub async fn restart(&mut self, project_root: &PathBuf) -> Result<(), String> {
        self.stop()?;
        // Give it a moment to fully release the port
        tokio::time::sleep(Duration::from_secs(1)).await;
        self.start(project_root).await
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

    /// Build the command to start the Gateway.
    fn build_start_command(&self, _backend_dir: &PathBuf) -> Result<(String, Vec<String>), String> {
        // Prefer `uv run uvicorn` (matches existing start.sh)
        let uv_path = which("uv").or_else(|| which("uvx"));

        if let Some(uv) = uv_path {
            Ok((
                uv,
                vec![
                    "run".into(),
                    "uvicorn".into(),
                    "app.gateway.app:app".into(),
                    "--host".into(),
                    "0.0.0.0".into(),
                    "--port".into(),
                    self.port.to_string(),
                ],
            ))
        } else {
            // Fallback: try python3 -m uvicorn
            let python = which("python3").or_else(|| which("python")).ok_or_else(|| {
                String::from("Neither 'uv' nor 'python3' found. Please install Python 3.12+ and uv.")
            })?;
            Ok((
                python,
                vec![
                    "-m".into(),
                    "uvicorn".into(),
                    "app.gateway.app:app".into(),
                    "--host".into(),
                    "0.0.0.0".into(),
                    "--port".into(),
                    self.port.to_string(),
                ],
            ))
        }
    }

    fn resolve_project_root(&self, provided: &PathBuf) -> Result<PathBuf, String> {
        // Check provided path first
        if provided.join("backend").is_dir() {
            return Ok(provided.clone());
        }

        // Try walking up from provided
        let mut dir = provided.as_path();
        while let Some(parent) = dir.parent() {
            if parent.join("backend").is_dir() && parent.join(".env").is_file() {
                return Ok(parent.to_path_buf());
            }
            dir = parent;
        }

        // Try current directory
        if let Ok(cwd) = std::env::current_dir() {
            let mut d = cwd.as_path();
            loop {
                if d.join("backend").is_dir() && d.join(".env").is_file() {
                    return Ok(d.to_path_buf());
                }
                match d.parent() {
                    Some(p) => d = p,
                    None => break,
                }
            }
        }

        Err("Could not find project root (directory with backend/ and .env)".into())
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
    fn test_resolve_project_root_finds_backend_dir() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        // Create backend/ and .env
        std::fs::create_dir_all(root.join("backend")).unwrap();
        std::fs::write(root.join(".env"), "GATEWAY_PORT=9987\n").unwrap();

        let mgr = make_manager();
        let result = mgr.resolve_project_root(&root.to_path_buf());
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), root);
    }

    #[test]
    fn test_resolve_project_root_walks_up() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        std::fs::create_dir_all(root.join("backend")).unwrap();
        std::fs::write(root.join(".env"), "GATEWAY_PORT=9987\n").unwrap();

        // Simulate a subdirectory of the project root
        let subdir = root.join("some/deep/nested/dir");
        std::fs::create_dir_all(&subdir).unwrap();

        let mgr = make_manager();
        let result = mgr.resolve_project_root(&subdir);
        assert!(result.is_ok());
    }

    #[test]
    fn test_resolve_project_root_not_found_in_temp() {
        // Note: resolve_project_root falls back to current_dir(), so if the
        // test runner's cwd happens to contain a backend/ dir (i.e. we're in
        // the project root), the function will succeed. We can only assert
        // that the *provided* temp path itself is not returned.
        let dir = tempfile::tempdir().unwrap();
        let mgr = make_manager();
        let result = mgr.resolve_project_root(&dir.path().to_path_buf());
        // The temp dir itself should never be the resolved root
        if let Ok(resolved) = result {
            assert_ne!(resolved, dir.path());
        }
    }

    #[test]
    fn test_build_start_command_structure() {
        let mgr = make_manager();
        let backend_dir = std::path::PathBuf::from("/fake/backend");
        // This test only validates structure, not the actual binary existence
        let result = mgr.build_start_command(&backend_dir);

        // Should return Ok (since `which` may or may not find uv/python in test env)
        if let Ok((cmd, args)) = result {
            // Regardless of uv or python, should include these args
            assert!(args.contains(&"app.gateway.app:app".to_string()));
            assert!(args.contains(&"--host".to_string()));
            assert!(args.contains(&"0.0.0.0".to_string()));
            assert!(args.contains(&"--port".to_string()));
            assert!(args.contains(&"19999".to_string()));
            assert!(!cmd.is_empty());
        }
        // If Err, it means neither uv nor python is on PATH — acceptable in CI
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
