use std::path::{Path, PathBuf};
use std::time::SystemTime;
use chrono::Local;
use crate::models::{AgentStatus, IdeSource, ProjectChatInfo};
use crate::state::SharedState;

pub struct VSCodeWatcher {
    workspace_storage_dir: PathBuf,
    last_check: SystemTime,
    discovered: bool,
}

impl VSCodeWatcher {
    pub fn new() -> Self {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| "C:\\Users\\Default\\AppData\\Roaming".to_string());
        let workspace_storage_dir = Path::new(&appdata)
            .join("Code")
            .join("User")
            .join("workspaceStorage");

        Self {
            workspace_storage_dir,
            last_check: SystemTime::now(),
            discovered: false,
        }
    }

    fn decode_uri_path(uri: &str) -> String {
        let s = uri.strip_prefix("file:///").unwrap_or(uri);
        let s = s.replace("%3A", ":").replace("%3a", ":").replace("%20", " ");
        s.replace('/', "\\")
    }

    pub fn discover_workspaces(&mut self, state: &SharedState) {
        if !self.workspace_storage_dir.exists() {
            return;
        }

        let now = SystemTime::now();
        let max_age_secs = 30 * 24 * 3600;
        let cutoff = now.checked_sub(std::time::Duration::from_secs(max_age_secs)).unwrap_or(SystemTime::UNIX_EPOCH);

        if let Ok(entries) = std::fs::read_dir(&self.workspace_storage_dir) {
            for entry in entries.flatten() {
                let ws_file = entry.path().join("workspace.json");
                if ws_file.exists() {
                    // Check recency: only inspect workspaces active in the last 30 days
                    let db_path = entry.path().join("state.vscdb");
                    let mod_time = db_path.metadata().and_then(|m| m.modified())
                        .or_else(|_| ws_file.metadata().and_then(|m| m.modified()))
                        .unwrap_or(SystemTime::UNIX_EPOCH);

                    if mod_time < cutoff {
                        continue;
                    }

                    if let Ok(content) = std::fs::read_to_string(&ws_file) {
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                            let uri_opt = val.get("folder")
                                .or_else(|| val.get("workspace"))
                                .and_then(|v| v.as_str());

                            if let Some(uri) = uri_opt {
                                let path_str = Self::decode_uri_path(uri);
                                let path = Path::new(&path_str);
                                if path.exists() && path.is_dir() {
                                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                                        // Skip internal or temp folders
                                        if !name.starts_with('.') && name != "temp" && name != "tmp" {
                                            let mod_rfc = chrono::DateTime::<Local>::from(mod_time).to_rfc3339();
                                            state.update_project_info(ProjectChatInfo {
                                                id: format!("vscode-{}", name.to_lowercase()),
                                                project_name: name.to_string(),
                                                conversation_title: format!("{} (VS Code)", name),
                                                ide: IdeSource::VSCode,
                                                last_updated: mod_rfc,
                                                step_count: 0,
                                                latest_message_snippet: Some(format!("VS Code workspace: {}", path_str)),
                                                status: "active".to_string(),
                                                project_path: Some(path_str),
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        self.discovered = true;
    }

    pub fn poll_updates(&mut self, state: &SharedState) {
        if !self.discovered {
            self.discover_workspaces(state);
        }

        if !self.workspace_storage_dir.exists() {
            return;
        }

        if let Ok(entries) = std::fs::read_dir(&self.workspace_storage_dir) {
            for entry in entries.flatten() {
                let db_path = entry.path().join("state.vscdb");
                if db_path.exists() {
                    if let Ok(meta) = db_path.metadata() {
                        if let Ok(modified) = meta.modified() {
                            if modified > self.last_check {
                                self.last_check = modified;
                                state.update_task_progress(|p| {
                                    if p.active_ide == IdeSource::VSCode || p.active_ide == IdeSource::VisualStudio {
                                        p.status = AgentStatus::RunningTool;
                                        p.current_step_desc = "VS Code / Copilot Agent active".to_string();
                                    }
                                });
                            }
                        }
                    }
                }
            }
        }
    }
}
