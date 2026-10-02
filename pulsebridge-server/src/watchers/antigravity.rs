use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use chrono::Local;
use serde_json::Value;
use tracing::info;
use crate::models::{ChatStep, IdeSource, TaskMilestone, ToolCallInfo};
use crate::state::SharedState;

pub struct AntigravityWatcher {
    base_brain_dir: PathBuf,
    current_conv_id: Option<String>,
    current_transcript_path: Option<PathBuf>,
    last_file_position: u64,
    last_step_index: u64,
}

impl AntigravityWatcher {
    pub fn new() -> Self {
        let user_profile = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
        let base_brain_dir = Path::new(&user_profile)
            .join(".gemini")
            .join("antigravity")
            .join("brain");

        Self {
            base_brain_dir,
            current_conv_id: None,
            current_transcript_path: None,
            last_file_position: 0,
            last_step_index: 0,
        }
    }

    pub fn poll_updates(&mut self, state: &SharedState) {
        if !self.base_brain_dir.exists() {
            return;
        }

        // Find the latest active conversation folder
        let active_conv = self.find_latest_conversation();
        if let Some((conv_id, transcript_path)) = active_conv {
            let is_new_conv = self.current_conv_id.as_deref() != Some(&conv_id);
            if is_new_conv {
                info!("AntigravityWatcher: Switched to conversation {}", conv_id);
                self.current_conv_id = Some(conv_id.clone());
                self.current_transcript_path = Some(transcript_path.clone());
                self.last_file_position = 0;
                self.last_step_index = 0;

                // Parse task.md or implementation plan if present
                self.parse_task_progress(&conv_id, state);
            }

            // Read new lines from transcript
            self.read_transcript_increments(&transcript_path, state);
            
            // Periodically refresh task milestones
            self.parse_task_progress(&conv_id, state);
        }
    }

    fn find_latest_conversation(&self) -> Option<(String, PathBuf)> {
        let entries = fs::read_dir(&self.base_brain_dir).ok()?;
        let mut candidates: Vec<(String, PathBuf, SystemTime)> = Vec::new();

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let conv_id = path.file_name()?.to_string_lossy().to_string();
                if conv_id.starts_with('.') || conv_id == "tempmediaStorage" || conv_id == "forge-inbox" {
                    continue;
                }

                let transcript = path.join(".system_generated").join("logs").join("transcript.jsonl");
                if transcript.exists() {
                    if let Ok(metadata) = transcript.metadata() {
                        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                        candidates.push((conv_id, transcript, modified));
                    }
                }
            }
        }

        candidates.sort_by(|a, b| b.2.cmp(&a.2));
        candidates.into_iter().next().map(|(id, path, _)| (id, path))
    }

    fn read_transcript_increments(&mut self, transcript_path: &Path, state: &SharedState) {
        let file = match File::open(transcript_path) {
            Ok(f) => f,
            Err(_) => return,
        };

        let mut reader = BufReader::new(file);
        if let Err(_) = reader.seek(SeekFrom::Start(self.last_file_position)) {
            return;
        }

        let mut line = String::new();
        while let Ok(bytes_read) = reader.read_line(&mut line) {
            if bytes_read == 0 {
                break;
            }

            self.last_file_position += bytes_read as u64;
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
                    if let Some(step) = self.parse_json_step(&v) {
                        if step.step_index > self.last_step_index {
                            self.last_step_index = step.step_index;
                        }
                        state.add_chat_step(step);
                    }
                }
            }
            line.clear();
        }
    }

    fn parse_json_step(&self, v: &Value) -> Option<ChatStep> {
        let step_index = v.get("step_index").and_then(|x| x.as_u64()).unwrap_or(0);
        let source = v.get("source").and_then(|x| x.as_str()).unwrap_or("SYSTEM").to_string();
        let step_type = v.get("type").and_then(|x| x.as_str()).unwrap_or("STEP").to_string();
        let status = v.get("status").and_then(|x| x.as_str()).unwrap_or("DONE").to_string();
        let timestamp = v.get("created_at")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| Local::now().to_rfc3339());

        let content = v.get("content").and_then(|x| x.as_str()).map(|s| s.to_string());
        let thinking = v.get("thinking").and_then(|x| x.as_str()).map(|s| s.to_string());

        let mut tool_calls = Vec::new();
        if let Some(calls) = v.get("tool_calls").and_then(|x| x.as_array()) {
            for call in calls {
                let name = call.get("name").and_then(|x| x.as_str()).unwrap_or("unknown_tool").to_string();
                let args = call.get("args").cloned();
                
                let summary = args.as_ref()
                    .and_then(|a| a.get("toolSummary"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string();

                let action = args.as_ref()
                    .and_then(|a| a.get("toolAction"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string();

                tool_calls.push(ToolCallInfo {
                    tool_name: name,
                    action,
                    summary,
                    arguments: args,
                    output: None,
                });
            }
        }

        let tool_calls_opt = if tool_calls.is_empty() { None } else { Some(tool_calls) };

        Some(ChatStep {
            id: format!("antigravity-{step_index}"),
            step_index,
            timestamp,
            source,
            step_type,
            status,
            content,
            thinking,
            tool_calls: tool_calls_opt,
            ide: IdeSource::Antigravity,
        })
    }

    fn parse_task_progress(&self, conv_id: &str, state: &SharedState) {
        let conv_dir = self.base_brain_dir.join(conv_id);
        let task_file = conv_dir.join("task.md");
        let impl_file = conv_dir.join("implementation_plan.md");

        let target_file = if task_file.exists() {
            Some(task_file)
        } else if impl_file.exists() {
            Some(impl_file)
        } else {
            None
        };

        let mut milestones = Vec::new();
        let mut task_title = format!("Active Session ({})", &conv_id[..conv_id.len().min(8)]);

        if let Some(file_path) = target_file {
            if let Ok(content) = fs::read_to_string(&file_path) {
                let mut idx = 1;
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("# ") && task_title.starts_with("Active Session") {
                        task_title = trimmed.trim_start_matches("# ").trim().to_string();
                    }

                    if trimmed.starts_with("- [ ]") {
                        milestones.push(TaskMilestone {
                            id: format!("m-{idx}"),
                            title: trimmed.trim_start_matches("- [ ]").trim().to_string(),
                            completed: false,
                            in_progress: false,
                        });
                        idx += 1;
                    } else if trimmed.starts_with("- [/]") {
                        milestones.push(TaskMilestone {
                            id: format!("m-{idx}"),
                            title: trimmed.trim_start_matches("- [/]").trim().to_string(),
                            completed: false,
                            in_progress: true,
                        });
                        idx += 1;
                    } else if trimmed.starts_with("- [x]") || trimmed.starts_with("- [X]") {
                        milestones.push(TaskMilestone {
                            id: format!("m-{idx}"),
                            title: trimmed[5..].trim().to_string(),
                            completed: true,
                            in_progress: false,
                        });
                        idx += 1;
                    }
                }
            }
        }

        // Calculate progress percentage
        let total = milestones.len();
        let completed = milestones.iter().filter(|m| m.completed).count();
        let percent = if total > 0 {
            ((completed as f32 / total as f32) * 100.0) as u8
        } else {
            50 // In-progress default
        };

        state.update_task_progress(|p| {
            p.task_id = conv_id.to_string();
            p.task_title = task_title;
            p.active_ide = IdeSource::Antigravity;
            p.percent_complete = percent;
            p.milestones = milestones;
        });
    }
}
