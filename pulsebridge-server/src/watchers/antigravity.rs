use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use chrono::Local;
use serde_json::Value;
use tracing::info;
use crate::models::{ChatStep, IdeSource, ProjectChatInfo, TaskMilestone, ToolCallInfo};
use crate::state::SharedState;

struct TrackedConversation {
    conv_id: String,
    transcript_path: PathBuf,
    last_file_position: u64,
    last_step_index: u64,
    last_modified: SystemTime,
    project_name: String,
    conversation_title: String,
}

pub struct AntigravityWatcher {
    base_brain_dir: PathBuf,
    tracked: HashMap<String, TrackedConversation>,
    most_recent_conv_id: Option<String>,
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
            tracked: HashMap::new(),
            most_recent_conv_id: None,
        }
    }

    pub fn poll_updates(&mut self, state: &SharedState) {
        if !self.base_brain_dir.exists() {
            return;
        }

        let candidates = self.find_recent_conversations(10);
        if candidates.is_empty() {
            return;
        }

        // Top candidate is the active conversation for workstation Task Tracker
        let (top_conv_id, _, _) = &candidates[0];
        let is_new_top = self.most_recent_conv_id.as_deref() != Some(top_conv_id);
        if is_new_top {
            info!("AntigravityWatcher: Active session switched to {}", top_conv_id);
            self.most_recent_conv_id = Some(top_conv_id.clone());
            self.parse_task_progress(top_conv_id, state);
        }

        // Process all active conversations to collect multi-project chats
        for (conv_id, transcript_path, modified) in candidates {
            let conv_dir = self.base_brain_dir.join(&conv_id);

            // Register newly discovered conversation
            if !self.tracked.contains_key(&conv_id) {
                let (project_name, conversation_title) = Self::detect_project_and_title(&conv_id, &conv_dir, &transcript_path);
                
                state.update_project_info(ProjectChatInfo {
                    id: conv_id.clone(),
                    project_name: project_name.clone(),
                    conversation_title: conversation_title.clone(),
                    ide: IdeSource::Antigravity,
                    last_updated: Local::now().to_rfc3339(),
                    step_count: 0,
                    latest_message_snippet: None,
                    status: "active".to_string(),
                });

                self.tracked.insert(conv_id.clone(), TrackedConversation {
                    conv_id: conv_id.clone(),
                    transcript_path: transcript_path.clone(),
                    last_file_position: 0,
                    last_step_index: 0,
                    last_modified: SystemTime::UNIX_EPOCH,
                    project_name,
                    conversation_title,
                });
            }

            // Read new increments if modified
            if let Some(tracker) = self.tracked.get_mut(&conv_id) {
                if modified > tracker.last_modified {
                    tracker.last_modified = modified;
                    Self::read_transcript_increments(tracker, state);
                }
            }
        }

        // Keep top task milestones refreshed
        if let Some(ref top_id) = self.most_recent_conv_id {
            self.parse_task_progress(top_id, state);
        }
    }

    fn find_recent_conversations(&self, limit: usize) -> Vec<(String, PathBuf, SystemTime)> {
        let entries = match fs::read_dir(&self.base_brain_dir) {
            Ok(e) => e,
            Err(_) => return Vec::new(),
        };

        let mut candidates: Vec<(String, PathBuf, SystemTime)> = Vec::new();

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let conv_id = match path.file_name() {
                    Some(name) => name.to_string_lossy().to_string(),
                    None => continue,
                };
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
        candidates.truncate(limit);
        candidates
    }

    fn detect_project_and_title(conv_id: &str, conv_dir: &Path, transcript_path: &Path) -> (String, String) {
        let mut project_name = "PulseBridge".to_string();
        let mut conv_title = format!("Session {}", &conv_id[..conv_id.len().min(8)]);

        // 1. Check task.md or implementation_plan.md
        let task_file = conv_dir.join("task.md");
        let impl_file = conv_dir.join("implementation_plan.md");
        let target_file = if task_file.exists() {
            Some(task_file)
        } else if impl_file.exists() {
            Some(impl_file)
        } else {
            None
        };

        if let Some(f) = target_file {
            if let Ok(content) = fs::read_to_string(&f) {
                for line in content.lines().take(25) {
                    let trimmed = line.trim();
                    if trimmed.starts_with("# ") {
                        conv_title = trimmed.trim_start_matches("# ").trim().to_string();
                        break;
                    }
                }
            }
        }

        // 2. Inspect first lines of transcript.jsonl for workspace/project indicators
        if let Ok(file) = File::open(transcript_path) {
            let reader = BufReader::new(file);
            for line_res in reader.lines().take(6) {
                if let Ok(line) = line_res {
                    let lower = line.to_lowercase();
                    if lower.contains("c:\\\\infinity") || lower.contains("c:/infinity") || lower.contains("claude-academy") || lower.contains("academy") {
                        project_name = "Infinity TechStack".to_string();
                    } else if lower.contains("c:\\\\pulsebridge") || lower.contains("c:/pulsebridge") {
                        project_name = "PulseBridge".to_string();
                    }

                    // Extract title from first user prompt if still default
                    if conv_title.starts_with("Session ") {
                        if let Ok(v) = serde_json::from_str::<Value>(&line) {
                            let is_user = v.get("source").and_then(|s| s.as_str()).map(|s| s.starts_with("USER")).unwrap_or(false);
                            if is_user {
                                if let Some(content) = v.get("content").and_then(|c| c.as_str()) {
                                    for cl in content.lines() {
                                        let t = cl.trim();
                                        if !t.is_empty() && !t.starts_with('<') {
                                            let clean = if t.chars().count() > 60 {
                                                let trunc: String = t.chars().take(57).collect();
                                                format!("{trunc}...")
                                            } else {
                                                t.to_string()
                                            };
                                            conv_title = clean;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        (project_name, conv_title)
    }

    fn read_transcript_increments(tracker: &mut TrackedConversation, state: &SharedState) {
        let file = match File::open(&tracker.transcript_path) {
            Ok(f) => f,
            Err(_) => return,
        };

        let mut reader = BufReader::new(file);
        if reader.seek(SeekFrom::Start(tracker.last_file_position)).is_err() {
            return;
        }

        let mut line = String::new();
        while let Ok(bytes_read) = reader.read_line(&mut line) {
            if bytes_read == 0 {
                break;
            }

            tracker.last_file_position += bytes_read as u64;
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
                    if let Some(mut step) = Self::parse_json_step(&v, &tracker.conv_id) {
                        if step.step_index > tracker.last_step_index {
                            tracker.last_step_index = step.step_index;
                        }
                        step.project_name = Some(tracker.project_name.clone());
                        step.conversation_id = Some(tracker.conv_id.clone());
                        step.conversation_title = Some(tracker.conversation_title.clone());
                        state.add_chat_step(step);
                    }
                }
            }
            line.clear();
        }
    }

    fn parse_json_step(v: &Value, conv_id: &str) -> Option<ChatStep> {
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

        let short_id = if conv_id.len() >= 8 { &conv_id[..8] } else { conv_id };

        Some(ChatStep {
            id: format!("antigravity-{short_id}-{step_index}"),
            step_index,
            timestamp,
            source,
            step_type,
            status,
            content,
            thinking,
            tool_calls: tool_calls_opt,
            ide: IdeSource::Antigravity,
            project_name: None,
            conversation_id: None,
            conversation_title: None,
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
