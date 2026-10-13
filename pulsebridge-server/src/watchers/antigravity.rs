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
    has_indexed_history: bool,
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
            has_indexed_history: false,
        }
    }

    pub fn poll_updates(&mut self, state: &SharedState) {
        if !self.base_brain_dir.exists() {
            return;
        }

        // On first run, index all live projects and recent historical conversations across the system
        if !self.has_indexed_history {
            self.has_indexed_history = true;
            self.index_live_projects_and_history(state);
        }

        let candidates = self.find_recent_conversations(12, 30);
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

        let live_projects = Self::discover_live_projects();

        // Process active conversations to collect multi-project chat increments
        for (conv_id, transcript_path, modified) in candidates {
            let conv_dir = self.base_brain_dir.join(&conv_id);

            // Register newly discovered conversation
            if !self.tracked.contains_key(&conv_id) {
                let (project_name, conversation_title) = Self::detect_project_and_title(&conv_id, &conv_dir, &transcript_path, &live_projects);
                let project_path = live_projects.iter().find(|(n, _, _)| n.eq_ignore_ascii_case(&project_name)).map(|(_, p, _)| p.clone());
                let mod_rfc = chrono::DateTime::<Local>::from(modified).to_rfc3339();
                
                state.update_project_info(ProjectChatInfo {
                    id: conv_id.clone(),
                    project_name: project_name.clone(),
                    conversation_title: conversation_title.clone(),
                    ide: IdeSource::Antigravity,
                    last_updated: mod_rfc,
                    step_count: 0,
                    latest_message_snippet: None,
                    status: "active".to_string(),
                    project_path,
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

    fn index_live_projects_and_history(&mut self, state: &SharedState) {
        let live_projects = Self::discover_live_projects();

        // 1. Register base project workspaces for live folders on disk (modified within 30 days)
        for (name, path, mod_time) in &live_projects {
            let mod_rfc = chrono::DateTime::<Local>::from(*mod_time).to_rfc3339();
            state.update_project_info(ProjectChatInfo {
                id: format!("project-{}", name.to_lowercase()),
                project_name: name.clone(),
                conversation_title: format!("{name} Live Workspace"),
                ide: IdeSource::Antigravity,
                last_updated: mod_rfc,
                step_count: 0,
                latest_message_snippet: Some(format!("Workspace root: {path}")),
                status: "active".to_string(),
                project_path: Some(path.clone()),
            });
        }

        // 2. Index historical sessions from brain within the last 30 days
        let all_sessions = self.find_recent_conversations(60, 30);
        for (conv_id, transcript_path, modified_time) in all_sessions {
            let conv_dir = self.base_brain_dir.join(&conv_id);
            let (proj_name, conv_title) = Self::detect_project_and_title(&conv_id, &conv_dir, &transcript_path, &live_projects);
            let project_path = live_projects.iter().find(|(n, _, _)| n.eq_ignore_ascii_case(&proj_name)).map(|(_, p, _)| p.clone());
            
            let mod_rfc = chrono::DateTime::<Local>::from(modified_time).to_rfc3339();
            let (step_count, snippet) = Self::inspect_transcript_summary(&transcript_path);

            state.update_project_info(ProjectChatInfo {
                id: conv_id,
                project_name: proj_name,
                conversation_title: conv_title,
                ide: IdeSource::Antigravity,
                last_updated: mod_rfc,
                step_count,
                latest_message_snippet: snippet,
                status: "active".to_string(),
                project_path,
            });
        }
    }

    pub fn discover_live_projects() -> Vec<(String, String, SystemTime)> {
        let mut projects = Vec::new();
        let ignored = [
            "$recycle.bin", "windows", "program files", "program files (x86)",
            "programdata", "perflogs", "inetpub", "msys64", "users", "temp",
            "intel", "xboxgames", "documents and settings", "recovery", "system volume information"
        ];

        let now = SystemTime::now();
        let max_age_secs = 30 * 24 * 3600;
        let cutoff = now.checked_sub(std::time::Duration::from_secs(max_age_secs)).unwrap_or(SystemTime::UNIX_EPOCH);

        if let Ok(entries) = fs::read_dir("C:\\") {
            for entry in entries.flatten() {
                if let Ok(ft) = entry.file_type() {
                    if ft.is_dir() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if !name.starts_with('.') && !ignored.iter().any(|&ign| ign.eq_ignore_ascii_case(&name)) {
                            let path = entry.path();
                            let mod_time = path.metadata().and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
                            // Only include projects modified within the last 30 days
                            if mod_time >= cutoff {
                                projects.push((name, path.to_string_lossy().to_string(), mod_time));
                            }
                        }
                    }
                }
            }
        }

        // Prioritize key projects so they appear first in the catalogue
        let priority = ["PulseBridge", "Infinity", "Axiom", "Harness", "Marketing", "Clients", "InfinityTrader", "BRain"];
        projects.sort_by(|a, b| {
            let idx_a = priority.iter().position(|&p| p.eq_ignore_ascii_case(&a.0)).unwrap_or(999);
            let idx_b = priority.iter().position(|&p| p.eq_ignore_ascii_case(&b.0)).unwrap_or(999);
            idx_a.cmp(&idx_b).then_with(|| b.2.cmp(&a.2))
        });

        projects
    }

    pub fn clean_user_prompt(raw: &str) -> String {
        let mut s = raw.trim().to_string();

        // If <USER_REQUEST>...</USER_REQUEST> exists, extract the inner content directly
        if let Some(start_idx) = s.find("<USER_REQUEST>") {
            let after_start = &s[start_idx + "<USER_REQUEST>".len()..];
            if let Some(end_idx) = after_start.find("</USER_REQUEST>") {
                return after_start[..end_idx].trim().to_string();
            } else {
                s = after_start.trim().to_string();
            }
        }

        // Remove known system metadata blocks if no explicit <USER_REQUEST> wrapper
        let tags_to_strip = [
            ("<CONTEXT_SUMMARY>", "</CONTEXT_SUMMARY>"),
            ("<ADDITIONAL_METADATA>", "</ADDITIONAL_METADATA>"),
            ("<USER_SETTINGS_CHANGE>", "</USER_SETTINGS_CHANGE>"),
            ("<SYSTEM_MESSAGE>", "</SYSTEM_MESSAGE>"),
            ("<EPHEMERAL_MESSAGE>", "</EPHEMERAL_MESSAGE>"),
        ];
        for (open_tag, close_tag) in tags_to_strip {
            while let Some(start) = s.find(open_tag) {
                if let Some(end_rel) = s[start..].find(close_tag) {
                    let end = start + end_rel + close_tag.len();
                    s.replace_range(start..end, "");
                } else {
                    s.replace_range(start.., "");
                }
            }
        }

        // Strip stray boilerplate notice lines
        let filtered_lines: Vec<&str> = s
            .lines()
            .filter(|line| {
                let t = line.trim();
                !t.starts_with("The following is a <SYSTEM_MESSAGE>")
                    && !t.starts_with("The following is an <EPHEMERAL_MESSAGE>")
                    && t != "<USER_REQUEST>"
                    && t != "</USER_REQUEST>"
            })
            .collect();

        filtered_lines.join("\n").trim().to_string()
    }

    fn clean_arg_string(val: &Value) -> Option<String> {
        let raw = val.as_str()?.trim();
        if raw.is_empty() {
            return None;
        }
        if raw.starts_with('"') && raw.ends_with('"') && raw.len() >= 2 {
            if let Ok(decoded) = serde_json::from_str::<String>(raw) {
                return Some(decoded.trim().to_string());
            }
            return Some(raw.trim_matches('"').replace("\\\\", "\\").replace("\\\"", "\""));
        }
        Some(raw.to_string())
    }

    fn extract_tool_target(tool_name: &str, args: Option<&Value>) -> Option<String> {
        let a = args?;
        if let Some(path) = a
            .get("AbsolutePath")
            .or_else(|| a.get("TargetFile"))
            .or_else(|| a.get("File"))
            .or_else(|| a.get("DirectoryPath"))
            .or_else(|| a.get("SearchPath"))
            .and_then(Self::clean_arg_string)
        {
            let start = a.get("StartLine").and_then(Self::clean_arg_string);
            let end = a.get("EndLine").and_then(Self::clean_arg_string);
            return match (start, end) {
                (Some(s), Some(e)) => Some(format!("{path}#L{s}-{e}")),
                (Some(s), None) => Some(format!("{path}#L{s}")),
                _ => Some(path),
            };
        }

        if let Some(cmd) = a.get("CommandLine").and_then(Self::clean_arg_string) {
            let clean_cmd = if cmd.chars().count() > 90 {
                let trunc: String = cmd.chars().take(87).collect();
                format!("{trunc}...")
            } else {
                cmd
            };
            return Some(clean_cmd);
        }

        if tool_name == "call_mcp_tool" {
            let srv = a.get("ServerName").and_then(Self::clean_arg_string).unwrap_or_default();
            let tname = a.get("ToolName").and_then(Self::clean_arg_string).unwrap_or_default();
            if !srv.is_empty() || !tname.is_empty() {
                return Some(format!("{srv}:{tname}"));
            }
        }

        if let Some(q) = a
            .get("Query")
            .or_else(|| a.get("Pattern"))
            .or_else(|| a.get("query"))
            .or_else(|| a.get("Url"))
            .and_then(Self::clean_arg_string)
        {
            return Some(q);
        }

        None
    }

    pub fn summarize_tool_output(raw: &str) -> (String, String) {
        let trimmed = raw.trim();
        let is_err = trimmed.contains("The command exited with code 1")
            || trimmed.starts_with("Error:")
            || trimmed.starts_with("Traceback (most recent call last):");
        let status = if is_err { "ERROR".to_string() } else { "DONE".to_string() };

        // Strip verbose line-number boilerplate injected by view_file
        let boilerplate = "The following code has been modified to include a line number before every line, in the format: <line_number>: <original_line>. Please note that any changes targeting the original code should remove the line number, colon, and leading space.";
        let cleaned = trimmed.replace(boilerplate, "").trim().to_string();

        let max_chars = 2400;
        let final_out = if cleaned.chars().count() > max_chars {
            let head: String = cleaned.chars().take(max_chars).collect();
            format!("{head}\n... [truncated for mobile view]")
        } else {
            cleaned
        };

        (status, final_out)
    }

    fn inspect_transcript_summary(transcript_path: &Path) -> (usize, Option<String>) {
        let mut count = 0;
        let mut snippet = None;
        if let Ok(file) = File::open(transcript_path) {
            let reader = BufReader::new(file);
            for line_res in reader.lines() {
                if let Ok(line) = line_res {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        count += 1;
                        if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
                            let step_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
                            if step_type == "USER_INPUT" || step_type == "PLANNER_RESPONSE" {
                                if let Some(content) = v.get("content").and_then(|c| c.as_str()) {
                                    let clean = Self::clean_user_prompt(content);
                                    if !clean.is_empty() && !clean.starts_with('<') {
                                        let first_line = clean.lines().next().unwrap_or(&clean).trim();
                                        let s = if first_line.chars().count() > 85 {
                                            let trunc: String = first_line.chars().take(82).collect();
                                            format!("{trunc}...")
                                        } else {
                                            first_line.to_string()
                                        };
                                        snippet = Some(s);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        (count, snippet)
    }

    fn find_recent_conversations(&self, limit: usize, max_age_days: u64) -> Vec<(String, PathBuf, SystemTime)> {
        let entries = match fs::read_dir(&self.base_brain_dir) {
            Ok(e) => e,
            Err(_) => return Vec::new(),
        };

        let now = SystemTime::now();
        let max_age_secs = max_age_days * 24 * 3600;
        let cutoff = now.checked_sub(std::time::Duration::from_secs(max_age_secs)).unwrap_or(SystemTime::UNIX_EPOCH);

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
                        if modified >= cutoff {
                            candidates.push((conv_id, transcript, modified));
                        }
                    }
                }
            }
        }

        candidates.sort_by(|a, b| b.2.cmp(&a.2));
        candidates.truncate(limit);
        candidates
    }

    pub fn detect_project_and_title_for_conv(conv_id: &str, base_brain_dir: &Path) -> (String, String) {
        let conv_dir = base_brain_dir.join(conv_id);
        let transcript_path = conv_dir.join(".system_generated").join("logs").join("transcript.jsonl");
        let live_projects = Self::discover_live_projects();
        Self::detect_project_and_title(conv_id, &conv_dir, &transcript_path, &live_projects)
    }

    fn detect_project_and_title(
        conv_id: &str,
        conv_dir: &Path,
        transcript_path: &Path,
        live_projects: &[(String, String, SystemTime)],
    ) -> (String, String) {
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
            for line_res in reader.lines().take(35) {
                if let Ok(line) = line_res {
                    let lower = line.to_lowercase();
                    
                    // Match against all known live projects
                    for (name, _, _) in live_projects {
                        let name_lower = name.to_lowercase();
                        if lower.contains(&format!("c:\\\\{}", name_lower)) 
                            || lower.contains(&format!("c:/{}", name_lower))
                            || lower.contains(&format!("/{}/", name_lower))
                        {
                            project_name = name.clone();
                            break;
                        }
                    }

                    // Extract title from first user prompt if still default
                    if conv_title.starts_with("Session ") {
                        if let Ok(v) = serde_json::from_str::<Value>(&line) {
                            let is_user = v.get("source").and_then(|s| s.as_str()).map(|s| s.starts_with("USER")).unwrap_or(false)
                                || v.get("type").and_then(|t| t.as_str()) == Some("USER_INPUT");
                            if is_user {
                                if let Some(content) = v.get("content").and_then(|c| c.as_str()) {
                                    let cleaned = Self::clean_user_prompt(content);
                                    if let Some(first_line) = cleaned.lines().find(|l| !l.trim().is_empty()) {
                                        let t = first_line.trim();
                                        let clean = if t.chars().count() > 60 {
                                            let trunc: String = t.chars().take(57).collect();
                                            format!("{trunc}...")
                                        } else {
                                            t.to_string()
                                        };
                                        conv_title = clean;
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

        let file_len = file.metadata().map(|m| m.len()).unwrap_or(0);
        let mut reader = BufReader::new(file);

        // On initial attach to a huge transcript file (> 1MB), seek to the last 768KB
        // so startup is instantaneous and doesn't flood 4,000+ historical broadcasts.
        if tracker.last_file_position == 0 && file_len > 768 * 1024 {
            let seek_pos = file_len - (768 * 1024);
            if reader.seek(SeekFrom::Start(seek_pos)).is_ok() {
                let mut discard = String::new();
                if let Ok(n) = reader.read_line(&mut discard) {
                    tracker.last_file_position = seek_pos + n as u64;
                }
            }
        } else if reader.seek(SeekFrom::Start(tracker.last_file_position)).is_err() {
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

    pub fn parse_json_step(v: &Value, conv_id: &str) -> Option<ChatStep> {
        let step_index = v.get("step_index").and_then(|x| x.as_u64()).unwrap_or(0);
        let raw_source = v.get("source").and_then(|x| x.as_str()).unwrap_or("SYSTEM");
        let raw_type = v.get("type").and_then(|x| x.as_str()).unwrap_or("STEP");
        let status = v.get("status").and_then(|x| x.as_str()).unwrap_or("DONE").to_string();
        let timestamp = v.get("created_at")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| Local::now().to_rfc3339());

        // Skip internal context compaction checkpoints and background system noise
        if raw_type == "CHECKPOINT" || raw_type == "SYSTEM_MESSAGE" {
            return None;
        }

        let is_user = raw_source.starts_with("USER") || raw_type == "USER_INPUT";
        let source = if is_user {
            "USER".to_string()
        } else if raw_source == "MODEL" {
            "MODEL".to_string()
        } else {
            "SYSTEM".to_string()
        };

        let step_type = if is_user {
            "USER_INPUT".to_string()
        } else if raw_type == "GENERIC" {
            "TOOL_OUTPUT".to_string()
        } else {
            raw_type.to_string()
        };

        let raw_content = v.get("content").and_then(|x| x.as_str());
        let content = if is_user {
            let cleaned = raw_content.map(Self::clean_user_prompt).unwrap_or_default();
            if cleaned.is_empty() {
                return None;
            }
            Some(cleaned)
        } else if step_type == "TOOL_OUTPUT" {
            raw_content.map(|c| Self::summarize_tool_output(c).1)
        } else {
            raw_content.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
        };

        let thinking = v
            .get("thinking")
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let input_tokens = v.get("input_tokens").and_then(|x| x.as_u64());
        let output_tokens = v.get("output_tokens").and_then(|x| x.as_u64());
        let cache_read_tokens = v.get("cache_read_tokens").and_then(|x| x.as_u64());

        let mut tool_calls = Vec::new();
        if let Some(calls) = v.get("tool_calls").and_then(|x| x.as_array()) {
            for call in calls {
                let name = call
                    .get("name")
                    .and_then(Self::clean_arg_string)
                    .unwrap_or_else(|| "unknown_tool".to_string());
                let args = call.get("args").cloned();

                let summary = args
                    .as_ref()
                    .and_then(|a| a.get("toolSummary"))
                    .and_then(Self::clean_arg_string)
                    .unwrap_or_default();

                let action = args
                    .as_ref()
                    .and_then(|a| a.get("toolAction"))
                    .and_then(Self::clean_arg_string)
                    .unwrap_or_default();

                let target_file = Self::extract_tool_target(&name, args.as_ref());

                tool_calls.push(ToolCallInfo {
                    tool_name: name,
                    action,
                    summary,
                    target_file,
                    status: Some("DONE".to_string()),
                    arguments: args,
                    output: None,
                });
            }
        }

        // Ignore completely empty PLANNER_RESPONSE steps
        if !is_user && step_type != "TOOL_OUTPUT" && content.is_none() && thinking.is_none() && tool_calls.is_empty() {
            return None;
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
            input_tokens,
            output_tokens,
            cache_read_tokens,
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
