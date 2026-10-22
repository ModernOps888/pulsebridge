import { useState, useRef, useEffect, useMemo } from 'react'
import {
  Send,
  Terminal,
  Brain,
  ChevronDown,
  ChevronRight,
  User,
  Bot,
  Sparkles,
  Wrench,
  FolderGit2,
  MessageSquare,
  Search,
  Check,
  Clock,
  RefreshCw,
  Folder,
  FileText,
  FolderTree,
  X,
  Copy,
  FileCode,
  Globe,
  Cpu,
  Layers,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Activity,
} from 'lucide-react'
import type {
  ChatStep,
  ProjectChatInfo,
  ProjectFileEntry,
  ProjectStructureResponse,
  PromptContextOptions,
  ToolCallInfo,
} from '../types'

interface ChatStreamProps {
  steps: ChatStep[]
  projects?: ProjectChatInfo[]
  onSendPrompt: (message: string, options?: PromptContextOptions) => void
  onRefreshProjects?: (days?: number) => void
  onLoadConversation?: (convId: string, days?: number) => Promise<ChatStep[]>
  onFetchProjectStructure?: (projectOrPath: string) => Promise<ProjectStructureResponse | null>
}

function extractDecisionOptions(content: string): { cleanContent: string; options: string[] } {
  const match = content.match(/\[OPTIONS:\s*([^\]]+)\]/i)
  if (!match) {
    return { cleanContent: content, options: [] }
  }
  const options = match[1]
    .split('|')
    .map((o) => o.trim())
    .filter(Boolean)
  const cleanContent = content.replace(/\[OPTIONS:\s*[^\]]+\]/gi, '').trim()
  return { cleanContent, options }
}

type ViewMode = 'turns' | 'steps' | 'responses'

interface TurnExecutionItem {
  stepIndex: number
  timestamp: string
  thinking?: string
  toolCalls: ToolCallInfo[]
  standaloneOutput?: string
  status: string
}

interface ChatTurn {
  id: string
  kind: 'user' | 'agent'
  userStep?: ChatStep
  agentSteps: ChatStep[]
  executionItems: TurnExecutionItem[]
  finalResponses: { stepIndex: number; content: string; timestamp: string }[]
  firstStepIndex: number
  lastStepIndex: number
  timestamp: string
  ide: string
  projectName?: string
  conversationTitle?: string
  totalThoughts: number
  totalToolCalls: number
  touchedTargets: string[]
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  isRunning: boolean
}

function isUserStep(step: ChatStep): boolean {
  return (
    step.source === 'USER' ||
    step.source === 'USER_EXPLICIT' ||
    step.step_type === 'USER_INPUT'
  )
}

function sanitizeUserText(raw?: string): string {
  if (!raw) return ''
  let text = raw
  const reqStart = text.indexOf('<USER_REQUEST>')
  const reqEnd = text.indexOf('</USER_REQUEST>')
  if (reqStart !== -1 && reqEnd !== -1 && reqEnd > reqStart + 14) {
    text = text.slice(reqStart + 14, reqEnd)
  }
  const tagsToStrip: [string, string][] = [
    ['<CONTEXT_SUMMARY>', '</CONTEXT_SUMMARY>'],
    ['<ADDITIONAL_METADATA>', '</ADDITIONAL_METADATA>'],
    ['<USER_SETTINGS_CHANGE>', '</USER_SETTINGS_CHANGE>'],
    ['<SYSTEM_MESSAGE>', '</SYSTEM_MESSAGE>'],
    ['<EPHEMERAL_MESSAGE>', '</EPHEMERAL_MESSAGE>'],
  ]
  for (const [openTag, closeTag] of tagsToStrip) {
    while (true) {
      const s = text.indexOf(openTag)
      if (s === -1) break
      const e = text.indexOf(closeTag, s)
      if (e !== -1) {
        text = text.slice(0, s) + text.slice(e + closeTag.length)
      } else {
        text = text.slice(0, s)
        break
      }
    }
  }
  return text.trim()
}

function cleanQuotedString(val?: string): string {
  if (!val) return ''
  const trimmed = val.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed === 'string') return parsed
    } catch (_) {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

function formatShortTarget(target?: string): string {
  if (!target) return ''
  const cleaned = cleanQuotedString(target)
  const normalized = cleaned.replace(/\\/g, '/')
  if (normalized.includes('/')) {
    const parts = normalized.split('/')
    return parts[parts.length - 1] || cleaned
  }
  return cleaned.length > 36 ? cleaned.slice(0, 33) + '...' : cleaned
}

function formatTokenCount(n?: number): string {
  if (!n || n <= 0) return ''
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  // Split by inline code `...`, bold **...**, and markdown links [label](url)
  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g
  const parts = text.split(tokenRegex)
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code
          key={i}
          className="px-1.5 py-0.5 mx-0.5 rounded bg-emerald-950/90 border border-emerald-800/70 text-amber-300 font-mono text-[11px] break-all"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={i} className="font-bold text-amber-200">
          {part.slice(2, -2)}
        </strong>
      )
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (linkMatch) {
      const [, label, href] = linkMatch
      const isFileLink = href.startsWith('file://')
      return (
        <span
          key={i}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-amber-950/50 border border-amber-500/40 text-amber-300 font-mono text-[11px] underline decoration-amber-500/50"
          title={href}
        >
          {isFileLink && <FileCode className="w-3 h-3 text-amber-400 shrink-0 inline" />}
          {label}
        </span>
      )
    }
    return <span key={i}>{part}</span>
  })
}

function MarkdownContent({ content }: { content: string }) {
  const [copiedBlock, setCopiedBlock] = useState<number | null>(null)

  const copyCode = (code: string, idx: number) => {
    navigator.clipboard?.writeText(code)
    setCopiedBlock(idx)
    setTimeout(() => setCopiedBlock(null), 1800)
  }

  // Split by fenced code blocks ```lang ... ```
  const segments = useMemo(() => {
    const result: { type: 'text' | 'code'; lang?: string; value: string }[] = []
    const fenceRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g
    let lastIdx = 0
    let match: RegExpExecArray | null
    while ((match = fenceRegex.exec(content)) !== null) {
      if (match.index > lastIdx) {
        result.push({ type: 'text', value: content.slice(lastIdx, match.index) })
      }
      result.push({
        type: 'code',
        lang: match[1] || 'code',
        value: match[2].replace(/\n$/, ''),
      })
      lastIdx = match.index + match[0].length
    }
    if (lastIdx < content.length) {
      result.push({ type: 'text', value: content.slice(lastIdx) })
    }
    return result
  }, [content])

  return (
    <div className="space-y-2.5 text-xs sm:text-[13px] leading-relaxed text-gray-100">
      {segments.map((seg, idx) => {
        if (seg.type === 'code') {
          return (
            <div
              key={idx}
              className="rounded-xl overflow-hidden border border-emerald-900/90 bg-[#050806] shadow-inner my-2"
            >
              <div className="flex items-center justify-between px-3 py-1.5 bg-[#0b120e] border-b border-emerald-950 text-[10px] font-mono text-emerald-400">
                <span className="uppercase font-bold tracking-wider text-amber-400/90">
                  {seg.lang || 'snippet'}
                </span>
                <button
                  type="button"
                  onClick={() => copyCode(seg.value, idx)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/80 hover:bg-amber-950/80 text-emerald-300 hover:text-amber-300 border border-emerald-800/60 transition-all"
                >
                  {copiedBlock === idx ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-3 text-[11px] font-mono text-emerald-200 overflow-x-auto leading-relaxed whitespace-pre">
                {seg.value}
              </pre>
            </div>
          )
        }

        const lines = seg.value.split('\n')
        const blocks: React.ReactNode[] = []
        let i = 0

        while (i < lines.length) {
          const line = lines[i]
          const trimmed = line.trim()

          if (!trimmed) {
            i++
            continue
          }

          // Headings
          if (trimmed.startsWith('#### ')) {
            blocks.push(
              <h5 key={i} className="text-xs font-bold text-amber-300 pt-1">
                {renderInlineMarkdown(trimmed.slice(5))}
              </h5>
            )
            i++
            continue
          }
          if (trimmed.startsWith('### ')) {
            blocks.push(
              <h4 key={i} className="text-[13px] font-bold text-amber-300 pt-1.5 border-b border-emerald-950/80 pb-1">
                {renderInlineMarkdown(trimmed.slice(4))}
              </h4>
            )
            i++
            continue
          }
          if (trimmed.startsWith('## ')) {
            blocks.push(
              <h3 key={i} className="text-sm font-bold text-amber-200 pt-2 border-b border-amber-500/30 pb-1">
                {renderInlineMarkdown(trimmed.slice(3))}
              </h3>
            )
            i++
            continue
          }
          if (trimmed.startsWith('# ')) {
            blocks.push(
              <h2 key={i} className="text-base font-extrabold text-amber-200 pt-2">
                {renderInlineMarkdown(trimmed.slice(2))}
              </h2>
            )
            i++
            continue
          }

          // Horizontal Rule
          if (trimmed === '---' || trimmed === '***') {
            blocks.push(<hr key={i} className="border-emerald-900/60 my-2" />)
            i++
            continue
          }

          // Blockquote / GitHub Alert
          if (trimmed.startsWith('>')) {
            const quoteLines: string[] = []
            while (i < lines.length && lines[i].trim().startsWith('>')) {
              quoteLines.push(lines[i].trim().replace(/^>\s?/, ''))
              i++
            }
            const joined = quoteLines.join('\n')
            const isWarning = joined.includes('[!WARNING]') || joined.includes('[!CAUTION]')
            const isImportant = joined.includes('[!IMPORTANT]')
            const cleanQuote = joined.replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, '')
            blocks.push(
              <div
                key={`q-${i}`}
                className={`p-2.5 rounded-xl border-l-4 text-xs ${
                  isWarning
                    ? 'bg-rose-950/30 border-rose-500 text-rose-200'
                    : isImportant
                    ? 'bg-amber-950/30 border-amber-400 text-amber-100'
                    : 'bg-emerald-950/30 border-emerald-500 text-emerald-100'
                }`}
              >
                {renderInlineMarkdown(cleanQuote)}
              </div>
            )
            continue
          }

          // Markdown Table
          if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
            const tableRows: string[][] = []
            while (i < lines.length && lines[i].trim().startsWith('|')) {
              const rowStr = lines[i].trim()
              // Skip separator row |---|---|
              if (!/^\|[\s\-:|]+\|$/.test(rowStr)) {
                const cells = rowStr
                  .slice(1, -1)
                  .split('|')
                  .map((c) => c.trim())
                tableRows.push(cells)
              }
              i++
            }
            if (tableRows.length > 0) {
              const header = tableRows[0]
              const body = tableRows.slice(1)
              blocks.push(
                <div key={`tbl-${i}`} className="overflow-x-auto rounded-xl border border-emerald-900/80 my-1.5">
                  <table className="w-full text-left text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-emerald-950/80 text-amber-300 border-b border-emerald-900">
                        {header.map((h, ci) => (
                          <th key={ci} className="px-2.5 py-1.5 font-bold">
                            {renderInlineMarkdown(h)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-emerald-950/70 bg-[#070b09]">
                      {body.map((row, ri) => (
                        <tr key={ri} className="hover:bg-emerald-950/30">
                          {row.map((cell, ci) => (
                            <td key={ci} className="px-2.5 py-1.5 text-gray-200">
                              {renderInlineMarkdown(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
            continue
          }

          // Unordered or Ordered Lists
          if (/^(\s*[-*•]|\s*\d+\.)\s+/.test(line)) {
            const listItems: { ordered: boolean; marker: string; text: string }[] = []
            while (i < lines.length && /^(\s*[-*•]|\s*\d+\.)\s+/.test(lines[i])) {
              const m = lines[i].match(/^(\s*)([-*•]|\d+\.)\s+(.*)$/)
              if (m) {
                listItems.push({
                  ordered: /\d+\./.test(m[2]),
                  marker: m[2],
                  text: m[3],
                })
              }
              i++
            }
            blocks.push(
              <ul key={`list-${i}`} className="space-y-1 pl-1">
                {listItems.map((item, li) => (
                  <li key={li} className="flex items-start gap-2">
                    <span className="text-amber-400 font-mono text-[11px] font-bold shrink-0 mt-0.5">
                      {item.ordered ? item.marker : '•'}
                    </span>
                    <span className="flex-1">{renderInlineMarkdown(item.text)}</span>
                  </li>
                ))}
              </ul>
            )
            continue
          }

          // Standard Paragraph
          blocks.push(
            <p key={i} className="whitespace-pre-wrap break-words leading-relaxed">
              {renderInlineMarkdown(line)}
            </p>
          )
          i++
        }

        return (
          <div key={idx} className="space-y-2">
            {blocks}
          </div>
        )
      })}
    </div>
  )
}

function getToolIcon(toolName: string) {
  const lower = toolName.toLowerCase()
  if (lower.includes('file') || lower.includes('view') || lower.includes('replace') || lower.includes('write')) {
    return <FileCode className="w-3.5 h-3.5 text-amber-400 shrink-0" />
  }
  if (lower.includes('command') || lower.includes('task') || lower.includes('shell')) {
    return <Terminal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
  }
  if (lower.includes('web') || lower.includes('url') || lower.includes('search')) {
    return <Globe className="w-3.5 h-3.5 text-sky-400 shrink-0" />
  }
  if (lower.includes('mcp') || lower.includes('chronofact') || lower.includes('spine')) {
    return <Cpu className="w-3.5 h-3.5 text-purple-400 shrink-0" />
  }
  return <Wrench className="w-3.5 h-3.5 text-amber-400 shrink-0" />
}

export function ChatStream({
  steps,
  projects = [],
  onSendPrompt,
  onRefreshProjects,
  onLoadConversation,
  onFetchProjectStructure,
}: ChatStreamProps) {
  const [promptInput, setPromptInput] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('turns')
  const [expandedTurns, setExpandedTurns] = useState<Record<string, boolean>>({})
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({})
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string>('ALL')
  const [showProjectDrawer, setShowProjectDrawer] = useState<boolean>(false)
  const [projectSearch, setProjectSearch] = useState<string>('')
  const [loadingConvId, setLoadingConvId] = useState<string | null>(null)
  const [historyDays, setHistoryDays] = useState<number>(30)
  const [showFolderModal, setShowFolderModal] = useState<boolean>(false)
  const [folderStructure, setFolderStructure] = useState<ProjectStructureResponse | null>(null)
  const [loadingFolder, setLoadingFolder] = useState<boolean>(false)
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({})
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const openProjectFolderExplorer = async () => {
    if (!onFetchProjectStructure) return
    setShowFolderModal(true)
    setLoadingFolder(true)
    const activeProj = projects.find((p) => p.id === selectedProjectId)
    const targetQuery =
      activeProj?.project_path ||
      activeProj?.project_name ||
      (selectedProjectId !== 'ALL' ? selectedProjectId : 'PulseBridge')
    const res = await onFetchProjectStructure(targetQuery)
    setFolderStructure(res)
    setLoadingFolder(false)
  }

  const toggleDir = (relPath: string) => {
    setExpandedDirs((prev) => ({ ...prev, [relPath]: !prev[relPath] }))
  }

  // Filter projects by search query
  const filteredProjects = useMemo(() => {
    if (!projectSearch.trim()) return projects
    const q = projectSearch.toLowerCase()
    return projects.filter(
      (p) =>
        p.project_name.toLowerCase().includes(q) ||
        p.conversation_title.toLowerCase().includes(q) ||
        p.ide.toLowerCase().includes(q) ||
        (p.latest_message_snippet && p.latest_message_snippet.toLowerCase().includes(q))
    )
  }, [projects, projectSearch])

  // Filter steps by selected project/conversation without cross-conversation bleed
  const displayedSteps = useMemo(() => {
    let base = steps
    if (selectedProjectId !== 'ALL') {
      const targetProj = projects.find((p) => p.id === selectedProjectId)
      const isWorkspaceId =
        selectedProjectId.startsWith('project-') ||
        selectedProjectId.startsWith('cursor-') ||
        selectedProjectId.startsWith('vscode-') ||
        selectedProjectId === 'pulsebridge'

      base = steps.filter((s) => {
        if (s.conversation_id) {
          if (s.conversation_id === selectedProjectId) return true
          if (
            isWorkspaceId &&
            targetProj &&
            s.project_name &&
            s.project_name.toLowerCase() === targetProj.project_name.toLowerCase()
          ) {
            return true
          }
          return false
        }
        if (
          targetProj &&
          s.project_name &&
          s.project_name.toLowerCase() === targetProj.project_name.toLowerCase()
        ) {
          return true
        }
        return false
      })
    }
    // Filter out empty noise steps
    return base.filter((s) => {
      if (s.step_type === 'CHECKPOINT' || s.step_type === 'SYSTEM_MESSAGE') return false
      return true
    })
  }, [steps, selectedProjectId, projects])

  // Group steps into Antigravity Turns (User Prompt -> Collapsible Agent Thought/Tool Pipeline -> Final Agent Response)
  const chatTurns = useMemo<ChatTurn[]>(() => {
    const turns: ChatTurn[] = []
    let currentAgentTurn: ChatTurn | null = null

    for (const step of displayedSteps) {
      if (isUserStep(step)) {
        const cleanText = sanitizeUserText(step.content)
        if (!cleanText) continue

        if (currentAgentTurn) {
          turns.push(currentAgentTurn)
          currentAgentTurn = null
        }

        turns.push({
          id: `user-${step.id}`,
          kind: 'user',
          userStep: { ...step, content: cleanText },
          agentSteps: [],
          executionItems: [],
          finalResponses: [],
          firstStepIndex: step.step_index,
          lastStepIndex: step.step_index,
          timestamp: step.timestamp,
          ide: step.ide,
          projectName: step.project_name,
          conversationTitle: step.conversation_title,
          totalThoughts: 0,
          totalToolCalls: 0,
          touchedTargets: [],
          isRunning: false,
        })
      } else {
        if (!currentAgentTurn) {
          currentAgentTurn = {
            id: `agent-turn-${step.id}`,
            kind: 'agent',
            agentSteps: [],
            executionItems: [],
            finalResponses: [],
            firstStepIndex: step.step_index,
            lastStepIndex: step.step_index,
            timestamp: step.timestamp,
            ide: step.ide,
            projectName: step.project_name,
            conversationTitle: step.conversation_title,
            totalThoughts: 0,
            totalToolCalls: 0,
            touchedTargets: [],
            isRunning: false,
          }
        }

        currentAgentTurn.agentSteps.push(step)
        currentAgentTurn.lastStepIndex = step.step_index
        currentAgentTurn.timestamp = step.timestamp
        if (step.project_name) currentAgentTurn.projectName = step.project_name
        if (step.conversation_title) currentAgentTurn.conversationTitle = step.conversation_title
        if (step.input_tokens) currentAgentTurn.inputTokens = step.input_tokens
        if (step.output_tokens) {
          currentAgentTurn.outputTokens = (currentAgentTurn.outputTokens || 0) + step.output_tokens
        }
        if (step.cache_read_tokens) currentAgentTurn.cacheReadTokens = step.cache_read_tokens

        const cleanedCalls: ToolCallInfo[] = (step.tool_calls || []).map((tc) => ({
          ...tc,
          action: cleanQuotedString(tc.action),
          summary: cleanQuotedString(tc.summary),
          target_file: tc.target_file ? cleanQuotedString(tc.target_file) : undefined,
        }))

        if (step.thinking) {
          currentAgentTurn.totalThoughts += 1
        }
        if (cleanedCalls.length > 0) {
          currentAgentTurn.totalToolCalls += cleanedCalls.length
          for (const tc of cleanedCalls) {
            if (tc.target_file) {
              const shortTarget = formatShortTarget(tc.target_file)
              if (shortTarget && !currentAgentTurn.touchedTargets.includes(shortTarget)) {
                currentAgentTurn.touchedTargets.push(shortTarget)
              }
            }
          }
        }

        if (step.step_type === 'TOOL_OUTPUT') {
          // If an unpaired tool output arrived, attach to the last execution item's pending tool call if possible
          let attached = false
          for (let i = currentAgentTurn.executionItems.length - 1; i >= 0; i--) {
            const item = currentAgentTurn.executionItems[i]
            const pending = item.toolCalls.find((t) => !t.output)
            if (pending && step.content) {
              pending.output = step.content
              attached = true
              break
            }
          }
          if (!attached && step.content) {
            currentAgentTurn.executionItems.push({
              stepIndex: step.step_index,
              timestamp: step.timestamp,
              toolCalls: [],
              standaloneOutput: step.content,
              status: step.status,
            })
          }
        } else {
          if (step.thinking || cleanedCalls.length > 0) {
            currentAgentTurn.executionItems.push({
              stepIndex: step.step_index,
              timestamp: step.timestamp,
              thinking: step.thinking,
              toolCalls: cleanedCalls,
              status: step.status,
            })
          }
          if (step.content && step.content.trim()) {
            currentAgentTurn.finalResponses.push({
              stepIndex: step.step_index,
              content: step.content.trim(),
              timestamp: step.timestamp,
            })
          }
        }
      }
    }

    if (currentAgentTurn) {
      // Check if the final turn is still actively executing tools without a final response
      const lastStep = currentAgentTurn.agentSteps[currentAgentTurn.agentSteps.length - 1]
      if (
        currentAgentTurn.finalResponses.length === 0 ||
        (lastStep && lastStep.tool_calls && lastStep.tool_calls.length > 0 && !lastStep.content)
      ) {
        currentAgentTurn.isRunning = true
      }
      turns.push(currentAgentTurn)
    }

    return turns
  }, [displayedSteps])

  const activeProjectInfo = useMemo(() => {
    if (selectedProjectId === 'ALL') return null
    return projects.find((p) => p.id === selectedProjectId) || null
  }, [projects, selectedProjectId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [displayedSteps.length])

  const toggleTurnPipeline = (turnId: string) => {
    setExpandedTurns((prev) => ({ ...prev, [turnId]: !prev[turnId] }))
  }

  const toggleThought = (key: string) => {
    setExpandedThoughts((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const toggleToolOutput = (key: string) => {
    setExpandedTools((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const [promptSentToast, setPromptSentToast] = useState<string | null>(null)

  const copyText = (text: string, id: string) => {
    navigator.clipboard?.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1800)
  }

  const sendContextualPrompt = (text: string) => {
    const clean = text.trim()
    if (!clean) return
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(15)
      }
    } catch (_) {}
    onSendPrompt(clean, {
      targetIde: activeProjectInfo?.ide,
      projectName: activeProjectInfo?.project_name,
      conversationId: selectedProjectId !== 'ALL' ? selectedProjectId : undefined,
      projectPath: activeProjectInfo?.project_path,
    })
    setPromptSentToast(
      `✓ Sent to ${activeProjectInfo ? activeProjectInfo.project_name : 'Active IDE'}`
    )
    setTimeout(() => setPromptSentToast(null), 2000)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!promptInput.trim()) return
    sendContextualPrompt(promptInput)
    setPromptInput('')
  }

  const quickReplies = [
    'Proceed with the plan',
    'Run tests & verify',
    'Fix any build errors',
    'Summarize changes',
    'Commit & push',
  ]

  const renderFileTree = (entries: ProjectFileEntry[], level = 0) => {
    return entries.map((entry) => {
      const isExpanded = !!expandedDirs[entry.relative_path]
      return (
        <div key={entry.relative_path} style={{ paddingLeft: level > 0 ? '12px' : '0px' }}>
          <div
            onClick={() => entry.is_dir && toggleDir(entry.relative_path)}
            className={`flex items-center justify-between py-1.5 px-2 rounded-lg text-xs font-mono transition-all ${
              entry.is_dir
                ? 'cursor-pointer hover:bg-emerald-950/60 text-amber-300 font-semibold'
                : 'text-emerald-200/90 hover:bg-emerald-950/30'
            }`}
          >
            <div className="flex items-center gap-2 truncate">
              {entry.is_dir ? (
                <>
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  )}
                  <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                </>
              ) : (
                <>
                  <span className="w-3.5 shrink-0" />
                  <FileText className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                </>
              )}
              <span className="truncate">{entry.name}</span>
            </div>
            {!entry.is_dir && (
              <span className="text-[9px] text-emerald-600 shrink-0 ml-2">
                {entry.size > 1024 ? `${(entry.size / 1024).toFixed(1)} KB` : `${entry.size} B`}
              </span>
            )}
          </div>
          {entry.is_dir && isExpanded && entry.children && entry.children.length > 0 && (
            <div className="border-l border-emerald-900/60 ml-3 mt-0.5 space-y-0.5">
              {renderFileTree(entry.children, level + 1)}
            </div>
          )}
        </div>
      )
    })
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8.5rem)] max-w-4xl mx-auto">
      {/* Top Multi-Project & View Mode Selector Bar */}
      <div className="px-3 pt-2.5 pb-1.5 bg-[#060907]/95 backdrop-blur-md border-b border-emerald-950/80 z-20 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => {
              const nextState = !showProjectDrawer
              setShowProjectDrawer(nextState)
              if (nextState && onRefreshProjects) {
                onRefreshProjects(historyDays)
              }
            }}
            className="flex-1 flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#0a0f0c] border border-amber-500/40 hover:border-amber-400 text-left transition-all shadow-sm min-w-0"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                <FolderGit2 className="w-4 h-4" />
              </div>
              <div className="truncate">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-amber-200 truncate">
                    {activeProjectInfo ? activeProjectInfo.project_name : 'All Active IDE Projects'}
                  </span>
                  <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/60">
                    {activeProjectInfo ? activeProjectInfo.ide.toUpperCase() : `${projects.length} Chats`}
                  </span>
                </div>
                <p className="text-[10px] text-emerald-400/80 truncate font-mono">
                  {activeProjectInfo
                    ? activeProjectInfo.conversation_title
                    : 'Antigravity IDE Structured Stream'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 text-[10px] font-mono text-amber-300 shrink-0 bg-amber-950/50 px-2 py-1 rounded-lg border border-amber-500/30">
              <MessageSquare className="w-3 h-3 text-amber-400" />
              <span className="hidden sm:inline">Chats</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${showProjectDrawer ? 'rotate-180' : ''}`}
              />
            </div>
          </button>

          {/* View Project Folder Structure Button */}
          {onFetchProjectStructure && (
            <button
              onClick={openProjectFolderExplorer}
              className="px-3 py-2 rounded-xl bg-[#0a0f0c] border border-emerald-800/70 hover:border-amber-400 text-emerald-300 hover:text-amber-300 text-xs font-mono font-bold flex items-center gap-1.5 shrink-0 shadow-sm transition-all"
              title="Inspect Project Directory Tree"
            >
              <FolderTree className="w-4 h-4 text-amber-400" />
              <span className="hidden sm:inline">Files</span>
            </button>
          )}
        </div>

        {/* Antigravity Breakdown Mode Switcher */}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <div className="flex items-center gap-1 bg-[#0a0f0c] p-1 rounded-xl border border-emerald-950">
            <button
              type="button"
              onClick={() => setViewMode('turns')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold flex items-center gap-1 transition-all ${
                viewMode === 'turns'
                  ? 'bg-gradient-to-r from-amber-500 to-yellow-400 text-black shadow-sm'
                  : 'text-emerald-400/80 hover:text-amber-200'
              }`}
            >
              <Layers className="w-3 h-3" />
              <span>Antigravity Turns ({chatTurns.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('responses')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold flex items-center gap-1 transition-all ${
                viewMode === 'responses'
                  ? 'bg-gradient-to-r from-amber-500 to-yellow-400 text-black shadow-sm'
                  : 'text-emerald-400/80 hover:text-amber-200'
              }`}
            >
              <Eye className="w-3 h-3" />
              <span>Clean Chat</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('steps')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold flex items-center gap-1 transition-all ${
                viewMode === 'steps'
                  ? 'bg-gradient-to-r from-amber-500 to-yellow-400 text-black shadow-sm'
                  : 'text-emerald-400/80 hover:text-amber-200'
              }`}
            >
              <Activity className="w-3 h-3" />
              <span>Raw Steps ({displayedSteps.length})</span>
            </button>
          </div>

          {promptSentToast ? (
            <span className="text-[9.5px] font-mono font-bold text-amber-300 bg-amber-950/80 border border-amber-500/50 px-2 py-0.5 rounded-lg animate-fadeIn">
              {promptSentToast}
            </span>
          ) : (
            <span className="text-[9px] font-mono text-emerald-500/80 hidden sm:inline">
              Live Transcript Sync
            </span>
          )}
        </div>

        {/* Collapsible Project & Chat Switcher Drawer */}
        {showProjectDrawer && (
          <div className="mt-2 rounded-2xl bg-[#0a0f0c] border border-amber-500/50 p-3 shadow-2xl space-y-2.5 animate-slideDown max-h-80 flex flex-col">
            <div className="flex items-center justify-between flex-wrap gap-1.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400 font-bold flex items-center gap-1.5">
                <FolderGit2 className="w-3.5 h-3.5" /> Active Chats ({projects.length})
              </span>
              <div className="flex items-center gap-1">
                {[
                  { label: '7d', days: 7 },
                  { label: '30d', days: 30 },
                  { label: 'All', days: 3650 },
                ].map((opt) => (
                  <button
                    key={opt.days}
                    onClick={() => {
                      setHistoryDays(opt.days)
                      onRefreshProjects?.(opt.days)
                    }}
                    className={`text-[9px] font-mono px-2 py-0.5 rounded border transition-all ${
                      historyDays === opt.days
                        ? 'bg-amber-500 text-black font-bold border-amber-300'
                        : 'bg-amber-950/40 text-amber-300 border-amber-500/30 hover:border-amber-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
                {onRefreshProjects && (
                  <button
                    onClick={() => onRefreshProjects(historyDays)}
                    className="text-[10px] font-mono text-emerald-300 hover:text-amber-300 flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/60"
                  >
                    <RefreshCw className="w-2.5 h-2.5" /> Refresh
                  </button>
                )}
              </div>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-emerald-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                placeholder="Search project, folder, or chat topic..."
                className="w-full bg-[#060907] border border-emerald-900/80 rounded-xl pl-8 pr-3 py-1.5 text-xs text-amber-100 placeholder-emerald-600/60 focus:outline-none focus:border-amber-400 font-mono"
              />
            </div>

            <div className="overflow-y-auto space-y-1.5 pr-1 max-h-52">
              <button
                onClick={async () => {
                  setSelectedProjectId('ALL')
                  setShowProjectDrawer(false)
                  if (onLoadConversation) {
                    await onLoadConversation('ALL', historyDays)
                  }
                }}
                className={`w-full p-2.5 rounded-xl border text-left flex items-center justify-between transition-all ${
                  selectedProjectId === 'ALL'
                    ? 'bg-amber-950/50 border-amber-400 text-amber-200'
                    : 'bg-[#0d140f]/70 border-emerald-950 hover:border-emerald-800 text-gray-300'
                }`}
              >
                <div>
                  <div className="text-xs font-bold flex items-center gap-1.5">
                    <span>All Projects & Conversations</span>
                    <span className="text-[9px] font-mono bg-emerald-950 text-emerald-300 px-1.5 py-0.2 rounded">
                      Unified
                    </span>
                  </div>
                  <div className="text-[10px] text-emerald-500/80 font-mono">
                     Combined live stream ({steps.length} steps cached)
                  </div>
                </div>
                {selectedProjectId === 'ALL' && <Check className="w-4 h-4 text-amber-400 shrink-0" />}
              </button>

              {filteredProjects.map((proj) => {
                const isSelected = selectedProjectId === proj.id
                return (
                  <button
                    key={proj.id}
                    onClick={async () => {
                      setSelectedProjectId(proj.id)
                      setShowProjectDrawer(false)
                      if (onLoadConversation) {
                        setLoadingConvId(proj.id)
                        await onLoadConversation(proj.id, historyDays)
                        setLoadingConvId(null)
                      }
                    }}
                    className={`w-full p-2.5 rounded-xl border text-left flex items-center justify-between gap-2 transition-all ${
                      isSelected
                        ? 'bg-amber-950/50 border-amber-400 text-amber-100 shadow-md'
                        : 'bg-[#0d140f]/70 border-emerald-950 hover:border-emerald-800 text-gray-200'
                    }`}
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[8px] font-mono font-bold px-1.5 py-0.2 rounded uppercase border ${
                            proj.ide === 'antigravity'
                              ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                              : proj.ide === 'cursor'
                              ? 'bg-amber-950 border-amber-700 text-amber-300'
                              : 'bg-sky-950 border-sky-700 text-sky-300'
                          }`}
                        >
                          {proj.ide}
                        </span>
                        <span className="text-xs font-bold text-amber-200 truncate">
                          {proj.project_name}
                        </span>
                        <span className="text-[9px] font-mono text-emerald-400 ml-auto shrink-0 flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {new Date(proj.last_updated).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <div className="text-[11px] font-medium text-emerald-300 truncate">
                        {proj.conversation_title}
                      </div>
                      {proj.latest_message_snippet && (
                        <div className="text-[10px] text-gray-400 truncate font-mono">
                          {proj.latest_message_snippet}
                        </div>
                      )}
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-amber-400 shrink-0" />}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Project Folder Structure Modal */}
      {showFolderModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0a0f0c] border border-amber-500/50 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-slideDown">
            <div className="p-3.5 border-b border-emerald-950 flex items-center justify-between bg-[#060907]">
              <div className="flex items-center gap-2 min-w-0">
                <FolderTree className="w-4 h-4 text-amber-400 shrink-0" />
                <div className="truncate">
                  <h3 className="text-xs font-bold text-amber-200 truncate">
                    {folderStructure ? folderStructure.project_name : 'Project Directory Explorer'}
                  </h3>
                  <p className="text-[10px] font-mono text-emerald-400 truncate">
                    {folderStructure ? folderStructure.root_path : 'Scanning workstation filesystem...'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowFolderModal(false)}
                className="p-1.5 rounded-lg bg-emerald-950/60 hover:bg-amber-950 text-gray-300 hover:text-amber-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {loadingFolder ? (
                <div className="py-12 text-center text-xs font-mono text-amber-300 animate-pulse">
                  Reading project directory tree...
                </div>
              ) : folderStructure && folderStructure.entries.length > 0 ? (
                renderFileTree(folderStructure.entries)
              ) : (
                <div className="py-12 text-center text-xs font-mono text-gray-500">
                  No files found in project directory.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Conversation Stream */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {loadingConvId && (
          <div className="text-center py-6 text-xs text-amber-300 font-mono animate-pulse">
            Loading conversation transcript from disk...
          </div>
        )}

        {displayedSteps.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-gray-500 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-[#0d140f] border border-emerald-900/60 flex items-center justify-center text-amber-400 shadow-[0_0_20px_rgba(234,179,8,0.1)]">
              <Sparkles className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-amber-200">No Conversation Steps Yet</p>
              <p className="text-xs text-emerald-500/70 max-w-xs">
                Send a prompt below or switch projects above to inspect live AI reasoning, tool calls, and responses.
              </p>
            </div>
          </div>
        ) : viewMode === 'turns' || viewMode === 'responses' ? (
          /* ANTIGRAVITY TURN-GROUPED VIEW (OR CLEAN RESPONSES VIEW) */
          chatTurns.map((turn, turnIdx) => {
            if (turn.kind === 'user' && turn.userStep) {
              return (
                <div key={turn.id} className="flex flex-col items-end">
                  <div className="max-w-[90%] sm:max-w-[82%] rounded-2xl rounded-tr-sm p-3.5 bg-gradient-to-br from-amber-600/95 via-amber-500/95 to-yellow-500/95 text-black font-medium shadow-[0_4px_20px_rgba(234,179,8,0.2)] border border-amber-300/60 space-y-1.5">
                    <div className="flex items-center justify-between gap-3 text-[10px] text-black/75 font-mono font-bold">
                      <div className="flex items-center gap-1.5">
                        <User className="w-3 h-3 text-black" />
                        <span>YOU</span>
                        {turn.projectName && (
                          <span className="px-1.5 py-0.2 rounded bg-black/15 text-black text-[9px]">
                            {turn.projectName}
                          </span>
                        )}
                      </div>
                      <span>
                        {new Date(turn.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    </div>
                    <div className="text-xs sm:text-[13px] leading-relaxed whitespace-pre-wrap break-words font-sans font-semibold">
                      {turn.userStep.content}
                    </div>
                  </div>
                </div>
              )
            }

            // Agent Turn
            const isLatestTurn = turnIdx === chatTurns.length - 1
            const hasPipeline = turn.executionItems.length > 0

            // In Clean Chat mode, skip empty intermediate tool turns unless currently running
            if (viewMode === 'responses' && turn.finalResponses.length === 0) {
              if (!turn.isRunning) return null
              return (
                <div key={turn.id} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#080d0a] border border-amber-500/40 text-amber-300 text-xs font-mono animate-pulse">
                  <Brain className="w-3.5 h-3.5 text-amber-400" />
                  <span>Agent executing ({turn.totalToolCalls} tools)...</span>
                </div>
              )
            }

            // Auto-expand pipeline if the turn has no final response yet, or if user explicitly toggled it
            const isPipelineOpen =
              expandedTurns[turn.id] !== undefined
                ? expandedTurns[turn.id]
                : turn.finalResponses.length === 0 && isLatestTurn

            return (
              <div key={turn.id} className="flex flex-col items-start space-y-2">
                <div className="w-full max-w-[97%] sm:max-w-[92%] space-y-2">
                  {/* 1. Collapsible Antigravity Thought & Tool Execution Accordion */}
                  {hasPipeline && viewMode === 'turns' && (
                    <div className="rounded-2xl bg-[#080d0a] border border-emerald-900/70 overflow-hidden shadow-md">
                      <button
                        type="button"
                        onClick={() => toggleTurnPipeline(turn.id)}
                        className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-left bg-[#0b120e] hover:bg-emerald-950/50 transition-all"
                      >
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          {isPipelineOpen ? (
                            <ChevronDown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          )}
                          <span className="text-[11px] font-mono font-bold text-emerald-300 flex items-center gap-1">
                            <Brain className="w-3.5 h-3.5 text-amber-400" />
                            <span>
                              {turn.totalThoughts > 0
                                ? `${turn.totalThoughts} ${turn.totalThoughts === 1 ? 'Thought' : 'Thoughts'}`
                                : 'Agent Execution'}
                            </span>
                          </span>

                          {turn.totalToolCalls > 0 && (
                            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-amber-950/70 border border-amber-500/40 text-amber-300 flex items-center gap-1">
                              <Wrench className="w-3 h-3 text-amber-400" />
                              <span>
                                {turn.totalToolCalls} {turn.totalToolCalls === 1 ? 'Tool' : 'Tools'}
                              </span>
                            </span>
                          )}

                          {/* Touched file/command badges */}
                          {turn.touchedTargets.slice(0, 3).map((target, idx) => (
                            <span
                              key={idx}
                              className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/90 border border-emerald-800/70 text-emerald-300 truncate max-w-[140px]"
                            >
                              {target}
                            </span>
                          ))}
                          {turn.touchedTargets.length > 3 && (
                            <span className="text-[9px] font-mono text-emerald-500">
                              +{turn.touchedTargets.length - 3} more
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {turn.isRunning ? (
                            <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-400 text-amber-300 animate-pulse">
                              Running...
                            </span>
                          ) : (
                            <span className="text-[9px] font-mono text-emerald-500 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              <span className="hidden sm:inline">
                                Steps #{turn.firstStepIndex}–#{turn.lastStepIndex}
                              </span>
                            </span>
                          )}
                        </div>
                      </button>

                      {/* Expanded Pipeline Timeline */}
                      {isPipelineOpen && (
                        <div className="p-3 space-y-2.5 border-t border-emerald-950/90 bg-[#060907]/90">
                          {turn.executionItems.map((item, itemIdx) => {
                            const thoughtKey = `${turn.id}-thought-${itemIdx}`
                            const isThoughtLong = (item.thinking?.length || 0) > 280
                            const isThoughtExpanded =
                              expandedThoughts[thoughtKey] !== undefined
                                ? expandedThoughts[thoughtKey]
                                : !isThoughtLong

                            return (
                              <div key={itemIdx} className="space-y-2">
                                {/* Reasoning Block */}
                                {item.thinking && (
                                  <div className="rounded-xl bg-[#0a100d] border-l-2 border-amber-400/80 border border-emerald-950/90 p-2.5 space-y-1">
                                    <div className="flex items-center justify-between text-[10px] font-mono text-amber-300/90">
                                      <span className="flex items-center gap-1.5 font-semibold">
                                        <Brain className="w-3 h-3 text-amber-400" />
                                        <span>Reasoning · Step #{item.stepIndex}</span>
                                      </span>
                                      {isThoughtLong && (
                                        <button
                                          type="button"
                                          onClick={() => toggleThought(thoughtKey)}
                                          className="text-[9px] text-emerald-400 hover:text-amber-300 underline"
                                        >
                                          {isThoughtExpanded ? 'Collapse' : 'Expand full thought'}
                                        </button>
                                      )}
                                    </div>
                                    <div className="text-[11px] text-emerald-100/85 font-mono leading-relaxed whitespace-pre-wrap">
                                      {isThoughtExpanded
                                        ? item.thinking
                                        : `${item.thinking.slice(0, 280)}...`}
                                    </div>
                                  </div>
                                )}

                                {/* Tool Call Cards */}
                                {item.toolCalls.map((tc, tcIdx) => {
                                  const toolKey = `${turn.id}-tool-${itemIdx}-${tcIdx}`
                                  const isToolOpen = !!expandedTools[toolKey]
                                  const hasDetails = !!(tc.output || tc.arguments)

                                  return (
                                    <div
                                      key={tcIdx}
                                      className="rounded-xl bg-[#090e0b] border border-emerald-900/70 p-2.5 space-y-1.5"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                          {getToolIcon(tc.tool_name)}
                                          <span className="text-[11px] font-bold text-amber-200 truncate">
                                            {tc.action || tc.tool_name}
                                          </span>
                                          <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/60">
                                            {tc.tool_name}
                                          </span>
                                          {tc.target_file && (
                                            <span
                                              className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-950/60 border border-amber-500/40 text-amber-300 truncate max-w-[220px]"
                                              title={tc.target_file}
                                            >
                                              {formatShortTarget(tc.target_file)}
                                            </span>
                                          )}
                                        </div>

                                        {hasDetails && (
                                          <button
                                            type="button"
                                            onClick={() => toggleToolOutput(toolKey)}
                                            className="px-2 py-0.5 rounded-lg bg-emerald-950/80 hover:bg-amber-950 border border-emerald-800/70 text-[9px] font-mono text-emerald-300 hover:text-amber-300 shrink-0 flex items-center gap-1"
                                          >
                                            <span>{ tc.output ? 'Output' : 'Args' }</span>
                                            {isToolOpen ? (
                                              <ChevronDown className="w-2.5 h-2.5" />
                                            ) : (
                                              <ChevronRight className="w-2.5 h-2.5" />
                                            )}
                                          </button>
                                        )}
                                      </div>

                                      {tc.summary && tc.summary !== tc.action && (
                                        <div className="text-[10px] text-gray-400 font-mono pl-5">
                                          {tc.summary}
                                        </div>
                                      )}

                                      {isToolOpen && (
                                        <div className="mt-1.5 pt-1.5 border-t border-emerald-950 space-y-1.5">
                                          {tc.arguments && (
                                            <div>
                                              <div className="text-[9px] font-mono uppercase text-amber-400/80 mb-0.5">
                                                Arguments:
                                              </div>
                                              <pre className="p-2 rounded-lg bg-[#050806] border border-emerald-950 text-[10px] font-mono text-emerald-300 overflow-x-auto max-h-40">
                                                {typeof tc.arguments === 'string'
                                                  ? tc.arguments
                                                  : JSON.stringify(tc.arguments, null, 2)}
                                              </pre>
                                            </div>
                                          )}
                                          {tc.output && (
                                            <div>
                                              <div className="text-[9px] font-mono uppercase text-emerald-400/80 mb-0.5">
                                                Result / Output:
                                              </div>
                                              <pre className="p-2 rounded-lg bg-[#050806] border border-emerald-950 text-[10px] font-mono text-gray-300 overflow-x-auto max-h-52 whitespace-pre-wrap">
                                                {tc.output}
                                              </pre>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}

                                {/* Fallback standalone tool output */}
                                {item.standaloneOutput && (
                                  <div className="rounded-xl bg-[#070b09] border border-emerald-950 p-2 text-[10px] font-mono text-gray-400 overflow-x-auto max-h-36 whitespace-pre-wrap">
                                    {item.standaloneOutput}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 2. Prominent Final Agent Response Card(s) */}
                  {turn.finalResponses.map((resp, rIdx) => {
                    const respKey = `${turn.id}-resp-${rIdx}`
                    const isLastResponseInTurn = rIdx === turn.finalResponses.length - 1
                    const { cleanContent, options: decisionOptions } = extractDecisionOptions(
                      resp.content
                    )

                    return (
                      <div
                        key={respKey}
                        className="rounded-2xl rounded-tl-sm bg-[#0b110e] border border-emerald-800/80 p-4 shadow-xl space-y-3"
                      >
                        <div className="flex items-center justify-between gap-2 pb-2 border-b border-emerald-950">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-lg bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                              <Bot className="w-3.5 h-3.5" />
                            </div>
                            <span className="text-[11px] font-mono font-bold text-amber-300 tracking-wide">
                              ANTIGRAVITY
                            </span>
                            {turn.projectName && (
                              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/60 truncate">
                                {turn.projectName}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {(turn.inputTokens || turn.outputTokens) && (
                              <span
                                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#060907] border border-emerald-900 text-emerald-400 hidden sm:inline"
                                title="Model token telemetry"
                              >
                                {turn.inputTokens ? `In: ${formatTokenCount(turn.inputTokens)}` : ''}
                                {turn.outputTokens ? ` · Out: ${formatTokenCount(turn.outputTokens)}` : ''}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => copyText(cleanContent, respKey)}
                              className="px-2 py-0.5 rounded-lg bg-emerald-950/70 hover:bg-amber-950 text-emerald-300 hover:text-amber-300 border border-emerald-800/60 text-[9px] font-mono flex items-center gap-1 transition-all"
                              title="Copy response markdown"
                            >
                              {copiedId === respKey ? (
                                <>
                                  <Check className="w-2.5 h-2.5 text-emerald-400" />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-2.5 h-2.5" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                            <span className="text-[9px] font-mono text-gray-500">
                              {new Date(resp.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                        </div>

                        <MarkdownContent content={cleanContent} />

                        {/* Interactive Decision Chips (when agent asks a question with [OPTIONS: ...]) */}
                        {decisionOptions.length > 0 && (
                          <div className="pt-2 border-t border-amber-500/30 space-y-1.5">
                            <span className="text-[9.5px] font-mono uppercase tracking-wider text-amber-400 font-bold block">
                              Tap Decision to Reply Instantly:
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {decisionOptions.map((opt, oIdx) => (
                                <button
                                  key={oIdx}
                                  type="button"
                                  onClick={() => sendContextualPrompt(opt)}
                                  className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black text-xs font-bold shadow-[0_0_12px_rgba(234,179,8,0.3)] transition-all active:scale-95"
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Contextual 1-Tap Response Feedback Bar on the Latest Agent Turn */}
                        {isLatestTurn && isLastResponseInTurn && decisionOptions.length === 0 && (
                          <div className="pt-2 border-t border-emerald-950/90 flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-[9px] font-mono text-emerald-500/80">
                              Quick Feedback:
                            </span>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {[
                                { label: '👍 Approve & Continue', prompt: 'Approved. Proceed with the next step.' },
                                { label: '🧪 Run Tests', prompt: 'Run the test suite and verify everything passes.' },
                                { label: '🔍 Explain Changes', prompt: 'Briefly explain the key changes made.' },
                              ].map((fb) => (
                                <button
                                  key={fb.label}
                                  type="button"
                                  onClick={() => sendContextualPrompt(fb.prompt)}
                                  className="px-2 py-1 rounded-lg bg-[#060907] hover:bg-amber-950/70 border border-emerald-900/80 hover:border-amber-400 text-[10px] font-mono text-amber-200 transition-all active:scale-95"
                                >
                                  {fb.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })
        ) : (
          /* RAW STEP-BY-STEP STREAM VIEW */
          displayedSteps.map((step) => {
            const isUser = isUserStep(step)
            const hasThinking = !!step.thinking
            const hasTools = step.tool_calls && step.tool_calls.length > 0
            const isError = step.status === 'ERROR'
            const { cleanContent, options: stepOptions } = step.content
              ? extractDecisionOptions(step.content)
              : { cleanContent: '', options: [] }

            return (
              <div
                key={step.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[94%] rounded-2xl p-3.5 space-y-2 border transition-all ${
                    isUser
                      ? 'bg-gradient-to-br from-amber-600/90 to-yellow-500/90 border-amber-400/60 text-black font-medium rounded-tr-xs shadow-lg'
                      : isError
                      ? 'bg-rose-950/40 border-rose-700/60 text-rose-200 rounded-tl-xs'
                      : 'bg-[#0a0f0c] border-emerald-900/60 text-gray-200 rounded-tl-xs shadow-md'
                  }`}
                >
                  <div
                    className={`flex items-center justify-between gap-3 text-[10px] ${
                      isUser ? 'text-black/80 font-bold' : 'text-gray-400'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-mono">
                      {isUser ? (
                        <User className="w-3 h-3 text-black" />
                      ) : isError ? (
                        <AlertTriangle className="w-3 h-3 text-rose-400" />
                      ) : (
                        <Bot className="w-3 h-3 text-amber-400" />
                      )}
                      <span className="font-bold">
                        {isUser ? 'YOU' : `${step.ide.toUpperCase()} · #${step.step_index}`}
                      </span>
                    </div>
                    <span className="font-mono">
                      {new Date(step.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>

                  {hasThinking && (
                    <div className="p-2.5 rounded-xl bg-[#060907] border border-emerald-950 text-[11px] font-mono text-emerald-200/90 whitespace-pre-wrap">
                      {step.thinking}
                    </div>
                  )}

                  {hasTools && (
                    <div className="space-y-1.5">
                      {step.tool_calls!.map((tool, idx) => (
                        <div
                          key={idx}
                          className="p-2 rounded-xl bg-[#060907] border border-emerald-900/80 text-xs font-mono space-y-1"
                        >
                          <div className="flex items-center gap-1.5 text-amber-300 font-bold">
                            {getToolIcon(tool.tool_name)}
                            <span>{cleanQuotedString(tool.action)}</span>
                            <span className="text-[9px] text-emerald-400">({tool.tool_name})</span>
                          </div>
                          {tool.output && (
                            <pre className="p-2 rounded bg-black/60 text-[10px] text-gray-300 overflow-x-auto max-h-40 whitespace-pre-wrap">
                              {tool.output}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {cleanContent && (
                    <div className={isUser ? 'text-xs font-semibold whitespace-pre-wrap' : ''}>
                      {isUser ? sanitizeUserText(cleanContent) : <MarkdownContent content={cleanContent} />}
                    </div>
                  )}

                  {!isUser && stepOptions.length > 0 && (
                    <div className="pt-2 border-t border-amber-500/30 flex flex-wrap gap-1.5">
                      {stepOptions.map((opt, oIdx) => (
                        <button
                          key={oIdx}
                          type="button"
                          onClick={() => sendContextualPrompt(opt)}
                          className="px-3 py-1 rounded-xl bg-amber-500 text-black text-xs font-bold"
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}

        <div ref={bottomRef} />
      </div>

      {/* Quick Reply Chips + Prompt Composer */}
      <div className="p-3 bg-[#060907]/95 backdrop-blur-lg border-t border-emerald-950/80 space-y-2.5">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {quickReplies.map((reply) => (
            <button
              key={reply}
              type="button"
              onClick={() => sendContextualPrompt(reply)}
              className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-[#0d140f] hover:bg-emerald-950/80 text-amber-200/90 border border-emerald-900/70 hover:border-amber-500/50 whitespace-nowrap transition-colors shrink-0"
            >
              {reply}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            placeholder={
              activeProjectInfo
                ? `Prompt ${activeProjectInfo.project_name} (${activeProjectInfo.ide})...`
                : 'Send prompt or instruction to Antigravity IDE...'
            }
            className="flex-1 bg-[#0d140f] border border-emerald-900/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-emerald-600/60 focus:outline-none focus:border-amber-400"
          />
          <button
            type="submit"
            disabled={!promptInput.trim()}
            className="p-2.5 rounded-xl bg-gradient-to-tr from-amber-600 to-yellow-500 hover:from-amber-500 hover:to-yellow-400 disabled:opacity-40 text-black font-bold transition-all shrink-0 shadow-[0_0_15px_rgba(234,179,8,0.3)]"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  )
}
