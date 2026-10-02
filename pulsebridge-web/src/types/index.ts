export type IdeSource = 'antigravity' | 'cursor' | 'visualstudio' | 'vscode' | 'custom'

export type AgentStatus = 'idle' | 'thinking' | 'runningtool' | 'waitinginput' | 'completed' | 'failed'

export interface ToolCallInfo {
  tool_name: string
  action: string
  summary: string
  arguments?: any
  output?: string
}

export interface ChatStep {
  id: string
  step_index: number
  timestamp: string
  source: 'USER' | 'MODEL' | 'SYSTEM'
  step_type: string
  status: string
  content?: string
  thinking?: string
  tool_calls?: ToolCallInfo[]
  ide: IdeSource
  project_name?: string
  conversation_id?: string
  conversation_title?: string
}

export interface ProjectChatInfo {
  id: string
  project_name: string
  conversation_title: string
  ide: IdeSource
  last_updated: string
  step_count: number
  latest_message_snippet?: string
  status: string
  project_path?: string
}

export interface ProjectFileEntry {
  name: string
  relative_path: string
  is_dir: boolean
  size: number
  children?: ProjectFileEntry[]
}

export interface ProjectStructureResponse {
  project_name: string
  root_path: string
  entries: ProjectFileEntry[]
}

export interface TaskMilestone {
  id: string
  title: string
  completed: boolean
  in_progress: boolean
}

export interface TaskProgress {
  task_id: string
  task_title: string
  started_at: string
  elapsed_seconds: number
  total_steps: number
  current_step_desc: string
  status: AgentStatus
  percent_complete: number
  active_ide: IdeSource
  milestones: TaskMilestone[]
}

export interface SystemTelemetry {
  hostname: string
  os: string
  memory_used_mb: number
  memory_total_mb: number
  memory_percent: number
  battery_percent?: number
  is_charging?: boolean
  lan_ip: string
  server_port: number
  active_ide_name: string
  uptime_seconds: number
}

export interface IdeWindowInfo {
  hwnd: number
  title: string
  ide: IdeSource
  width: number
  height: number
  is_minimized: boolean
}

export interface ServerAlert {
  id: string
  level: 'info' | 'success' | 'warning' | 'error'
  title: string
  message: string
  timestamp: string
}
