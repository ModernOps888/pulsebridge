use std::path::{Path, PathBuf};
use std::time::SystemTime;
use crate::models::{AgentStatus, IdeSource};
use crate::state::SharedState;

pub struct CursorWatcher {
    workspace_storage_dir: PathBuf,
    last_check: SystemTime,
}

impl CursorWatcher {
    pub fn new() -> Self {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| "C:\\Users\\Default\\AppData\\Roaming".to_string());
        let workspace_storage_dir = Path::new(&appdata)
            .join("Cursor")
            .join("User")
            .join("workspaceStorage");

        Self {
            workspace_storage_dir,
            last_check: SystemTime::now(),
        }
    }

    pub fn poll_updates(&mut self, state: &SharedState) {
        if !self.workspace_storage_dir.exists() {
            return;
        }

        // Check if any state.vscdb was modified recently
        if let Ok(entries) = std::fs::read_dir(&self.workspace_storage_dir) {
            for entry in entries.flatten() {
                let db_path = entry.path().join("state.vscdb");
                if db_path.exists() {
                    if let Ok(meta) = db_path.metadata() {
                        if let Ok(modified) = meta.modified() {
                            if modified > self.last_check {
                                self.last_check = modified;
                                // Emit a status ping indicating Cursor activity
                                state.update_task_progress(|p| {
                                    if p.active_ide == IdeSource::Cursor {
                                        p.status = AgentStatus::RunningTool;
                                        p.current_step_desc = "Cursor AI Composer active".to_string();
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
