import { useState, useRef, useEffect, useMemo } from 'react'
import {
  Send,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Terminal,
  User,
  Bot,
  Folder,
  Layers,
  Columns,
  Search,
  X,
  Clock,
  RefreshCw,
  PanelLeft,
  PanelLeftClose,
  MessageSquare,
  Globe,
  Laptop,
  CheckCircle2,
  Copy,
  Check,
} from 'lucide-react'
import type { ChatStep, ProjectChatInfo } from '../types'
import { hapticLight, hapticMedium, hapticSuccess } from '../utils/haptics'

interface ChatStreamProps {
  steps: ChatStep[]
  projects?: ProjectChatInfo[]
  onSendPrompt: (msg: string, targetProject?: string) => void
  onRefreshProjects?: () => void
}

function extractOptions(step: ChatStep): string[] {
  if (step.tool_calls) {
    for (const call of step.tool_calls) {
      if (call.tool_name === 'ask_phone' || call.tool_name === 'ask_question') {
        try {
          if (call.action) {
            const parsed = JSON.parse(call.action)
            if (Array.isArray(parsed.options) && parsed.options.length > 0) {
              return parsed.options
            }
          }
        } catch (_) {}
      }
    }
  }

  if (step.content) {
    const match = step.content.match(/\[OPTIONS:\s*([^\]]+)\]/i)
    if (match && match[1]) {
      return match[1].split('|').map((s) => s.trim()).filter(Boolean)
    }
  }
  return []
}

interface GroupedProject {
  projectName: string
  ide: string
  totalSteps: number
  lastUpdated: string
  conversations: ProjectChatInfo[]
}

export function ChatStream({
  steps,
  projects = [],
  onSendPrompt,
  onRefreshProjects,
}: ChatStreamProps) {
  const [inputMessage, setInputMessage] = useState('')
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({})
  const [selectedProject, setSelectedProject] = useState<string>('all')
  const [selectedConversation, setSelectedConversation] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(false)
  const [isSplitView, setIsSplitView] = useState(false)
  const [isSearchVisible, setIsSearchVisible] = useState(false)
  const [sidePanelFilter, setSidePanelFilter] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const chatEndRef = useRef<HTMLDivElement | null>(null)

  // Aggregate project names and step counts
  const projectStats = useMemo(() => {
    const map = new Map<string, { count: number; ide: string; latestSnippet?: string; lastTime?: string }>()

    for (const step of steps) {
      const pName = step.project_name || 'PulseBridge'
      const existing = map.get(pName) || {
        count: 0,
        ide: step.ide || 'antigravity',
        latestSnippet: step.content || step.thinking,
        lastTime: step.timestamp,
      }
      existing.count += 1
      if (step.content || step.thinking) {
        existing.latestSnippet = step.content || step.thinking
      }
      existing.lastTime = step.timestamp || existing.lastTime
      map.set(pName, existing)
    }

    // Incorporate server-reported projects
    for (const p of projects) {
      if (!map.has(p.project_name)) {
        map.set(p.project_name, {
          count: p.step_count || 0,
          ide: p.ide || 'antigravity',
          latestSnippet: p.latest_message_snippet,
          lastTime: p.last_updated,
        })
      }
    }

    return Array.from(map.entries()).map(([name, data]) => ({
      name,
      count: data.count,
      ide: data.ide,
      latestSnippet: data.latestSnippet,
      lastTime: data.lastTime,
    }))
  }, [steps, projects])

  // Group conversations hierarchically by project (Antigravity Workspace layout)
  const groupedProjects = useMemo<GroupedProject[]>(() => {
    const map = new Map<string, GroupedProject>()

    for (const p of projects) {
      const key = p.project_name || 'PulseBridge'
      const existing = map.get(key) || {
        projectName: key,
        ide: p.ide || 'antigravity',
        totalSteps: 0,
        lastUpdated: p.last_updated,
        conversations: [],
      }
      existing.totalSteps += p.step_count || 0
      if (!existing.conversations.some((c) => c.id === p.id)) {
        existing.conversations.push(p)
      }
      if (new Date(p.last_updated) > new Date(existing.lastUpdated || 0)) {
        existing.lastUpdated = p.last_updated
      }
      map.set(key, existing)
    }

    // Include any active conversations discovered in live chat steps
    for (const s of steps) {
      const key = s.project_name || 'PulseBridge'
      const group = map.get(key)
      if (!group) {
        map.set(key, {
          projectName: key,
          ide: s.ide || 'antigravity',
          totalSteps: 1,
          lastUpdated: s.timestamp,
          conversations: [
            {
              id: s.conversation_id || 'active',
              project_name: key,
              conversation_title: s.conversation_title || `${key} Active Session`,
              ide: s.ide || 'antigravity',
              last_updated: s.timestamp,
              step_count: 1,
              latest_message_snippet: s.content || s.thinking,
              status: 'active',
            },
          ],
        })
      } else {
        const convId = s.conversation_id || 'active'
        if (!group.conversations.some((c) => c.id === convId)) {
          group.conversations.push({
            id: convId,
            project_name: key,
            conversation_title: s.conversation_title || `${key} Session`,
            ide: s.ide || 'antigravity',
            last_updated: s.timestamp,
            step_count: 1,
            latest_message_snippet: s.content || s.thinking,
            status: 'active',
          })
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      return new Date(b.lastUpdated || 0).getTime() - new Date(a.lastUpdated || 0).getTime()
    })
  }, [projects, steps])

  // Active selected conversation object (if any)
  const activeConversation = useMemo(() => {
    if (selectedConversation === 'all') return null
    for (const group of groupedProjects) {
      const found = group.conversations.find((c) => c.id === selectedConversation)
      if (found) return found
    }
    return null
  }, [groupedProjects, selectedConversation])

  // Filter steps based on selected project, conversation, and search query
  const filteredSteps = useMemo(() => {
    return steps.filter((step) => {
      const stepProject = step.project_name || 'PulseBridge'

      if (selectedProject !== 'all' && stepProject.toLowerCase() !== selectedProject.toLowerCase()) {
        return false
      }

      if (selectedConversation !== 'all' && step.conversation_id && step.conversation_id !== selectedConversation) {
        return false
      }

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        const matchContent = step.content?.toLowerCase().includes(query)
        const matchThinking = step.thinking?.toLowerCase().includes(query)
        const matchTool = step.tool_calls?.some(
          (t) =>
            t.tool_name.toLowerCase().includes(query) ||
            t.action.toLowerCase().includes(query) ||
            t.summary.toLowerCase().includes(query)
        )
        const matchProject = step.project_name?.toLowerCase().includes(query)
        if (!matchContent && !matchThinking && !matchTool && !matchProject) {
          return false
        }
      }

      return true
    })
  }, [steps, selectedProject, selectedConversation, searchQuery])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [filteredSteps.length])

  const toggleThinking = (id: string) => {
    hapticLight()
    setExpandedThinking((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleSend = () => {
    if (!inputMessage.trim()) return
    hapticSuccess()
    const target = selectedProject !== 'all' ? selectedProject : undefined
    onSendPrompt(inputMessage.trim(), target)
    setInputMessage('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSend()
    }
  }

  const selectProjectAndChat = (projectName: string, conversationId: string = 'all') => {
    hapticMedium()
    setSelectedProject(projectName)
    setSelectedConversation(conversationId)
    if (!isSplitView) {
      setIsSidePanelOpen(false)
    }
  }

  const copyText = (id: string, text: string) => {
    hapticSuccess()
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const quickReplies = [
    'Proceed with next step',
    'Looks good, continue',
    'Run tests & verify',
    'Emergency abort',
  ]

  const getProjectIcon = (name: string) => {
    const lower = name.toLowerCase()
    if (lower.includes('infinity')) return Globe
    if (lower.includes('cursor')) return Laptop
    return Folder
  }

  return (
    <div
      className={`flex flex-col h-[calc(100dvh-125px)] w-full mx-auto transition-all ${
        isSplitView ? 'max-w-6xl px-1' : 'max-w-5xl px-1 sm:px-2'
      }`}
    >
      {/* Top Antigravity Header & Toolbar (Optimized for Pixel 9 Pro) */}
      <div className="bg-[#0a0f0d] border border-emerald-950/80 rounded-2xl p-2 sm:p-2.5 mb-1.5 shadow-xl shrink-0">
        <div className="flex items-center justify-between gap-1.5">
          {/* Left: Side Panel Toggle & Active Breadcrumbs */}
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              onClick={() => {
                hapticMedium()
                setIsSidePanelOpen((prev) => !prev)
              }}
              className={`p-1.5 sm:px-2.5 sm:py-1 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm shrink-0 touch-manipulation active:scale-95 ${
                isSidePanelOpen
                  ? 'bg-amber-500 text-black border-amber-400 ring-1 ring-amber-400/50 shadow-[0_0_12px_rgba(251,191,36,0.3)]'
                  : 'bg-[#101813] text-amber-300 border-amber-500/40 hover:bg-amber-950/40'
              }`}
              title="Toggle Antigravity Side Panel (Workspaces & Chats)"
            >
              {isSidePanelOpen ? (
                <PanelLeftClose className="w-4 h-4 text-black" />
              ) : (
                <PanelLeft className="w-4 h-4 text-amber-400" />
              )}
              <span className="hidden xs:inline text-[11px] font-mono">Workspaces</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </button>

            {/* Breadcrumb Indicators */}
            <div className="flex items-center gap-1 text-[11px] font-mono min-w-0">
              <button
                onClick={() => selectProjectAndChat('all', 'all')}
                className={`px-2 py-0.5 rounded-lg border font-semibold flex items-center gap-1 truncate transition-all active:scale-95 ${
                  selectedProject === 'all'
                    ? 'bg-amber-950/60 border-amber-500/60 text-amber-300 shadow-sm'
                    : 'bg-[#0d140f] border-emerald-950 text-emerald-400 hover:text-emerald-200'
                }`}
                title="Active Project"
              >
                <Layers className="w-3 h-3 text-amber-400 shrink-0" />
                <span className="truncate max-w-[95px] sm:max-w-[140px]">
                  {selectedProject === 'all' ? 'All Projects' : selectedProject}
                </span>
              </button>

              {activeConversation && (
                <div className="flex items-center gap-1 bg-amber-950/40 border border-amber-500/50 px-2 py-0.5 rounded-lg text-[10px] text-amber-200 min-w-0">
                  <span className="opacity-50">›</span>
                  <span className="font-semibold truncate max-w-[85px] sm:max-w-[130px]">
                    {activeConversation.conversation_title}
                  </span>
                  <button
                    onClick={() => {
                      hapticLight()
                      setSelectedConversation('all')
                    }}
                    className="p-0.5 hover:bg-amber-800 rounded shrink-0"
                    title="View all chats in this project"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right: Quick Action Icons */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => {
                hapticLight()
                setIsSearchVisible((prev) => !prev)
              }}
              className={`p-1.5 rounded-xl border text-xs font-semibold transition-all active:scale-95 ${
                isSearchVisible || searchQuery
                  ? 'bg-amber-500 text-black border-amber-400'
                  : 'bg-[#101813] text-emerald-300 border-emerald-900/60 hover:bg-[#15221b]'
              }`}
              title="Search Reasoning, Code & Tools"
            >
              <Search className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => {
                hapticLight()
                setIsSplitView((prev) => !prev)
              }}
              className={`p-1.5 rounded-xl border text-xs font-semibold transition-all hidden md:flex items-center gap-1 active:scale-95 ${
                isSplitView
                  ? 'bg-emerald-500 text-black border-emerald-400 font-bold'
                  : 'bg-[#101813] text-emerald-300 border-emerald-800 hover:bg-emerald-950/40'
              }`}
              title="Toggle Antigravity Split-Window View"
            >
              <Columns className="w-3.5 h-3.5" />
              <span className="text-[10px]">Split</span>
            </button>

            {onRefreshProjects && (
              <button
                onClick={() => {
                  hapticLight()
                  onRefreshProjects()
                }}
                className="p-1.5 rounded-xl bg-[#101813] border border-emerald-900/60 text-emerald-300 hover:text-white active:scale-95 transition-all"
                title="Refresh project list"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Search Bar Drawer */}
        {isSearchVisible && (
          <div className="relative pt-1.5 mt-1.5 border-t border-emerald-950/80 animate-fadeIn">
            <Search className="w-3 h-3 absolute left-2.5 top-3.5 text-emerald-600" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search reasoning, tools, and code across chats..."
              className="w-full bg-[#070c09] border border-emerald-950 rounded-xl pl-8 pr-7 py-1 text-[11px] text-emerald-100 placeholder-emerald-800 focus:outline-none focus:border-amber-500/60 font-mono"
              autoFocus
            />
            {searchQuery && (
              <button
                onClick={() => {
                  hapticLight()
                  setSearchQuery('')
                }}
                className="absolute right-2.5 top-3 text-gray-500 hover:text-gray-300"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Container: Activity Rail + Side Panel + Chat Stream (Chat Visibility Guaranteed) */}
      <div className="flex-1 flex gap-1.5 sm:gap-2 min-h-0 relative overflow-hidden">
        {/* Antigravity Left Activity Rail (Native Tactile Project Switcher) */}
        <nav className="w-11 sm:w-12 shrink-0 flex flex-col items-center py-2 bg-[#080d0a] border border-emerald-950 rounded-2xl gap-2 shadow-xl z-20 select-none">
          {/* Top Activity Drawer Trigger */}
          <button
            onClick={() => {
              hapticMedium()
              setIsSidePanelOpen((prev) => !prev)
            }}
            className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all active:scale-90 ${
              isSidePanelOpen
                ? 'bg-amber-500 text-black shadow-[0_0_12px_rgba(251,191,36,0.6)] ring-1 ring-amber-400'
                : 'bg-[#0f1712] border border-amber-500/30 text-amber-400 hover:bg-amber-950/40'
            }`}
            title="Expand Antigravity Workspace Drawer"
          >
            <PanelLeft className="w-4 h-4" />
          </button>

          <div className="w-6 h-px bg-emerald-950/80 my-0.5" />

          {/* All Projects Avatar */}
          <button
            onClick={() => selectProjectAndChat('all', 'all')}
            className={`relative w-8 h-8 rounded-xl flex flex-col items-center justify-center transition-all active:scale-90 ${
              selectedProject === 'all'
                ? 'bg-gradient-to-tr from-amber-500 to-yellow-500 text-black font-bold shadow-[0_0_10px_rgba(251,191,36,0.4)]'
                : 'bg-[#0d140f] border border-emerald-950 text-emerald-400 hover:text-emerald-200'
            }`}
            title="All Workspaces"
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="text-[7.5px] font-mono font-bold leading-none mt-0.5">ALL</span>
            {selectedProject === 'all' && (
              <span className="absolute -left-1 top-2 bottom-2 w-1 bg-amber-400 rounded-r shadow-[0_0_6px_rgba(251,191,36,0.9)]" />
            )}
          </button>

          {/* Individual Project Avatars */}
          <div className="flex-1 flex flex-col gap-2 overflow-y-auto scrollbar-none py-1">
            {projectStats.map((p) => {
              const isActive = selectedProject.toLowerCase() === p.name.toLowerCase()
              const Icon = getProjectIcon(p.name)
              const acronym = p.name
                .split(' ')
                .map((w) => w[0])
                .join('')
                .slice(0, 3)
                .toUpperCase()

              return (
                <button
                  key={p.name}
                  onClick={() => selectProjectAndChat(p.name, 'all')}
                  className={`relative w-8 h-8 rounded-xl flex flex-col items-center justify-center transition-all active:scale-90 shrink-0 ${
                    isActive
                      ? 'bg-gradient-to-tr from-amber-500 to-yellow-500 text-black font-bold shadow-[0_0_10px_rgba(251,191,36,0.4)]'
                      : 'bg-[#0d140f] border border-emerald-950 text-emerald-400 hover:text-emerald-200'
                  }`}
                  title={`${p.name} (${p.count} events)`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="text-[7.5px] font-mono font-bold leading-none mt-0.5">{acronym}</span>
                  {isActive && (
                    <span className="absolute -left-1 top-2 bottom-2 w-1 bg-amber-400 rounded-r shadow-[0_0_6px_rgba(251,191,36,0.9)]" />
                  )}
                </button>
              )
            })}
          </div>
        </nav>

        {/* Antigravity Side Panel Drawer / Docked Column */}
        {(isSidePanelOpen || isSplitView) && (
          <>
            {/* Mobile Translucent Frosted Glass Backdrop (Chat Visibility Guaranteed!) */}
            {!isSplitView && (
              <div
                onClick={() => {
                  hapticLight()
                  setIsSidePanelOpen(false)
                }}
                className="absolute inset-0 z-30 bg-black/45 backdrop-blur-[2px] transition-opacity cursor-pointer"
                title="Tap to focus chat feed"
              />
            )}

            <aside
              className={`${
                isSplitView
                  ? 'w-72 md:w-80 shrink-0 flex flex-col bg-[#070c09] border border-emerald-950 rounded-2xl overflow-hidden shadow-2xl z-10'
                  : 'absolute top-0 bottom-0 left-0 z-40 w-[80vw] sm:w-80 max-w-[320px] bg-[#070c09]/98 border-r border-amber-500/40 rounded-r-2xl p-0 flex flex-col shadow-2xl animate-slideRight overflow-hidden'
              }`}
            >
              {/* Side Panel Header */}
              <div className="p-3 border-b border-emerald-950/80 bg-[#0c140f] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <PanelLeft className="w-4 h-4 text-amber-400 shrink-0" />
                  <div>
                    <h3 className="font-bold text-xs text-amber-200 uppercase tracking-wider font-mono">
                      Antigravity Workspaces
                    </h3>
                    <p className="text-[9.5px] text-emerald-400/80 font-mono">
                      {groupedProjects.length} Projects · {projects.length || projectStats.length} Chats
                    </p>
                  </div>
                </div>

                {!isSplitView && (
                  <button
                    onClick={() => {
                      hapticLight()
                      setIsSidePanelOpen(false)
                    }}
                    className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white shrink-0 active:scale-95"
                    title="Close Side Panel"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Side Panel Internal Search */}
              <div className="p-2 border-b border-emerald-950/60 bg-[#080d0a] shrink-0">
                <div className="relative">
                  <Search className="w-3 h-3 absolute left-2 top-2 text-emerald-600" />
                  <input
                    type="text"
                    value={sidePanelFilter}
                    onChange={(e) => setSidePanelFilter(e.target.value)}
                    placeholder="Filter projects or chats..."
                    className="w-full bg-[#050806] border border-emerald-950 rounded-lg pl-7 pr-6 py-1 text-[10px] text-emerald-100 placeholder-emerald-800 focus:outline-none focus:border-amber-400 font-mono"
                  />
                  {sidePanelFilter && (
                    <button
                      onClick={() => {
                        hapticLight()
                        setSidePanelFilter('')
                      }}
                      className="absolute right-2 top-1.5 text-gray-500 hover:text-white"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Side Panel Content: Hierarchical Projects & Chats */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2.5">
                {/* Unified All Projects Option */}
                <button
                  onClick={() => selectProjectAndChat('all', 'all')}
                  className={`w-full text-left p-2.5 rounded-xl border transition-all active:scale-[0.98] ${
                    selectedProject === 'all'
                      ? 'bg-amber-950/60 border-amber-400 shadow-md ring-1 ring-amber-400/30'
                      : 'bg-[#0c140f] border-emerald-950 hover:border-emerald-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 font-bold text-xs text-amber-300">
                      <Layers className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>All Streamed Workspaces</span>
                    </div>
                    <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 font-mono">
                      {steps.length} msgs
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-400 line-clamp-1">
                    Unified stream of multi-agent reasoning & tools
                  </p>
                </button>

                {/* Grouped Projects & Their Conversations */}
                {groupedProjects
                  .filter((group) => {
                    if (!sidePanelFilter.trim()) return true
                    const q = sidePanelFilter.toLowerCase()
                    return (
                      group.projectName.toLowerCase().includes(q) ||
                      group.conversations.some((c) =>
                        c.conversation_title.toLowerCase().includes(q)
                      )
                    )
                  })
                  .map((group) => {
                    const isGroupActive =
                      selectedProject.toLowerCase() === group.projectName.toLowerCase()
                    const Icon = getProjectIcon(group.projectName)

                    return (
                      <div
                        key={group.projectName}
                        className="rounded-xl bg-[#090f0c] border border-emerald-950/90 overflow-hidden shadow-sm"
                      >
                        {/* Project Header Banner */}
                        <div className="p-2 bg-[#0d1611] border-b border-emerald-950/80 flex items-center justify-between gap-1">
                          <button
                            onClick={() => selectProjectAndChat(group.projectName, 'all')}
                            className="flex items-center gap-1.5 text-left min-w-0 flex-1 hover:opacity-90"
                          >
                            <Icon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            <span className="font-bold text-xs text-amber-100 truncate">
                              {group.projectName}
                            </span>
                            <span className="text-[9px] uppercase px-1 py-0.2 rounded bg-black/60 border border-emerald-900 text-emerald-400 font-mono shrink-0">
                              {group.ide}
                            </span>
                          </button>

                          <button
                            onClick={() => selectProjectAndChat(group.projectName, 'all')}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950/80 hover:bg-amber-950 text-emerald-300 border border-emerald-900/60 font-mono shrink-0 active:scale-95"
                            title="View all chats for this project"
                          >
                            All ({group.totalSteps})
                          </button>
                        </div>

                        {/* Conversations under this Project */}
                        <div className="p-1 space-y-1">
                          {group.conversations.map((conv) => {
                            const isConvActive =
                              isGroupActive && selectedConversation === conv.id

                            return (
                              <button
                                key={conv.id}
                                onClick={() =>
                                  selectProjectAndChat(group.projectName, conv.id)
                                }
                                className={`w-full text-left p-2 rounded-lg border transition-all text-xs group active:scale-[0.98] ${
                                  isConvActive
                                    ? 'bg-amber-950/70 border-amber-400 shadow-md ring-1 ring-amber-400/40 text-amber-100'
                                    : 'bg-[#060a08] border-emerald-950/60 hover:border-amber-500/40 text-gray-300 hover:bg-[#0c140f]'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1 mb-1">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <MessageSquare
                                      className={`w-3 h-3 shrink-0 ${
                                        isConvActive ? 'text-amber-400' : 'text-emerald-500/70'
                                      }`}
                                    />
                                    <span className="font-semibold text-[11px] truncate leading-tight">
                                      {conv.conversation_title}
                                    </span>
                                  </div>
                                  <span className="text-[9px] font-mono text-emerald-400/80 shrink-0">
                                    {conv.step_count} ev
                                  </span>
                                </div>

                                {conv.latest_message_snippet && (
                                  <div className="text-[9.5px] font-mono text-gray-400 truncate opacity-75 pl-4">
                                    "{conv.latest_message_snippet}"
                                  </div>
                                )}

                                <div className="flex items-center justify-between text-[8.5px] text-emerald-600/70 font-mono pt-1 pl-4">
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-2.5 h-2.5" />
                                    {conv.last_updated
                                      ? new Date(conv.last_updated).toLocaleTimeString([], {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })
                                      : 'Live'}
                                  </span>
                                  {isConvActive && (
                                    <span className="flex items-center gap-1 text-amber-400 font-bold">
                                      <CheckCircle2 className="w-2.5 h-2.5" />
                                      Active
                                    </span>
                                  )}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
              </div>
            </aside>
          </>
        )}

        {/* Primary Chat Feed Section */}
        <section className="flex-1 flex flex-col bg-[#070c09] border border-emerald-950 rounded-2xl overflow-hidden min-h-0 relative shadow-xl">
          {/* Active Filter Pill Bar in Chat Header */}
          <div className="bg-[#0b120e] px-3 py-1.5 border-b border-emerald-950 flex items-center justify-between text-xs shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span className="font-bold text-amber-200 truncate">
                {activeConversation
                  ? activeConversation.conversation_title
                  : selectedProject === 'all'
                  ? 'Unified Live Stream'
                  : `Project: ${selectedProject}`}
              </span>
              <span className="text-[10px] text-emerald-500 font-mono shrink-0">
                ({filteredSteps.length} of {steps.length})
              </span>
            </div>

            {(selectedProject !== 'all' || selectedConversation !== 'all') && (
              <button
                onClick={() => selectProjectAndChat('all', 'all')}
                className="text-[10px] text-amber-400 hover:text-amber-300 font-mono font-semibold flex items-center gap-1 shrink-0 active:scale-95"
              >
                <span>Reset to All</span>
              </button>
            )}
          </div>

          {/* Steps Scroll Area with Safe Bottom Padding */}
          <div className="flex-1 overflow-y-auto p-2.5 sm:p-4 space-y-3 sm:space-y-4 pb-36">
            {filteredSteps.length === 0 ? (
              <div className="text-center py-20 text-emerald-600/70 text-xs font-mono space-y-2">
                <Bot className="w-10 h-10 text-emerald-500/30 mx-auto opacity-50" />
                <p>No chat events found matching the active filter.</p>
                {selectedProject !== 'all' && (
                  <button
                    onClick={() => selectProjectAndChat('all', 'all')}
                    className="px-3 py-1.5 rounded-xl bg-amber-500 text-black font-bold text-xs active:scale-95 transition-all shadow-sm"
                  >
                    Switch back to All Workspaces
                  </button>
                )}
              </div>
            ) : (
              filteredSteps.map((step) => {
                const isUser = step.source === 'USER'
                const isThinkingExpanded = expandedThinking[step.id] || false
                const options = extractOptions(step)
                const displayContent = step.content
                  ? step.content.replace(/\[OPTIONS:\s*[^\]]+\]/gi, '').trim()
                  : ''

                const stepProject = step.project_name || 'PulseBridge'

                return (
                  <div
                    key={step.id}
                    className={`flex gap-2 text-xs leading-relaxed ${
                      isUser ? 'flex-row-reverse' : 'flex-row'
                    }`}
                  >
                    {/* User / Agent Avatar */}
                    <div
                      className={`w-6 h-6 sm:w-7 sm:h-7 rounded-xl flex items-center justify-center shrink-0 shadow-md ${
                        isUser
                          ? 'bg-gradient-to-tr from-amber-500 to-yellow-500 text-black font-bold'
                          : 'bg-gradient-to-tr from-emerald-800 to-emerald-600 text-emerald-200'
                      }`}
                    >
                      {isUser ? <User className="w-3.5 h-3.5 text-black" /> : <Bot className="w-3.5 h-3.5" />}
                    </div>

                    {/* Chat Bubble Container with Top Hairline Light */}
                    <div
                      className={`max-w-[90%] sm:max-w-[82%] rounded-2xl p-3 sm:p-3.5 space-y-2 shadow-xl border-t ${
                        isUser
                          ? 'bg-gradient-to-r from-amber-600 to-yellow-600 text-black font-medium rounded-tr-none shadow-amber-950/40 border-t-white/30'
                          : 'bg-[#0c140f] border border-emerald-900/70 text-emerald-100 rounded-tl-none shadow-emerald-950/20 border-t-emerald-500/30'
                      }`}
                    >
                      {/* Project & Context Badge Header */}
                      <div className="flex items-center justify-between gap-2 pb-1 border-b border-white/10 text-[10px] font-mono">
                        <button
                          onClick={() => selectProjectAndChat(stepProject, 'all')}
                          className={`flex items-center gap-1 font-bold hover:underline transition-all ${
                            isUser ? 'text-black/80' : 'text-amber-400'
                          }`}
                          title={`Filter to ${stepProject}`}
                        >
                          <Folder className="w-3 h-3 text-amber-400 shrink-0" />
                          <span className="truncate max-w-[120px]">{stepProject}</span>
                          <span className="opacity-60">·</span>
                          <span className="uppercase text-[9px]">{step.ide}</span>
                        </button>

                        <span className={isUser ? 'text-black/60' : 'text-emerald-500'}>
                          {step.timestamp
                            ? new Date(step.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : ''}
                        </span>
                      </div>

                      {/* Agent Reasoning Box in Radiant Gold */}
                      {step.thinking && (
                        <div className="rounded-xl bg-amber-950/30 border border-amber-700/50 p-2 sm:p-2.5 text-amber-200 shadow-sm">
                          <button
                            onClick={() => toggleThinking(step.id)}
                            className="flex items-center justify-between w-full text-[11px] font-bold text-amber-300"
                          >
                            <span className="flex items-center gap-1.5 font-mono">
                              <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              Agent Reasoning
                            </span>
                            {isThinkingExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            )}
                          </button>
                          {isThinkingExpanded && (
                            <div className="mt-2 text-[11px] text-amber-100/90 whitespace-pre-wrap font-mono max-h-52 overflow-y-auto leading-normal">
                              {step.thinking}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Tool Calls Display with Quick Copy */}
                      {step.tool_calls && step.tool_calls.length > 0 && (
                        <div className="space-y-1.5">
                          {step.tool_calls.map((call, idx) => {
                            const callKey = `${step.id}-${idx}`
                            const isCopied = copiedId === callKey
                            return (
                              <div
                                key={idx}
                                className="rounded-lg bg-black/60 border border-emerald-950 p-2 font-mono text-[10px] sm:text-[11px] space-y-1 relative group"
                              >
                                <div className="flex items-center justify-between text-amber-400 font-semibold">
                                  <div className="flex items-center gap-1.5">
                                    <Terminal className="w-3 h-3 text-emerald-400 shrink-0" />
                                    <span>{call.tool_name}</span>
                                  </div>
                                  <button
                                    onClick={() =>
                                      copyText(callKey, `${call.tool_name}: ${call.action || ''}\n${call.summary || ''}`)
                                    }
                                    className="p-1 rounded hover:bg-white/10 text-emerald-500 hover:text-amber-300 transition-all opacity-80 group-hover:opacity-100"
                                    title="Copy tool call"
                                  >
                                    {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                  </button>
                                </div>
                                {call.action && (
                                  <div className="text-emerald-300 text-[9.5px]">{call.action}</div>
                                )}
                                {call.summary && (
                                  <div className="text-gray-400 text-[9.5px] italic">{call.summary}</div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* Message Content */}
                      {displayContent && (
                        <div className="whitespace-pre-wrap font-sans text-xs">
                          {displayContent}
                        </div>
                      )}

                      {/* Interactive Option Chips */}
                      {options.length > 0 && (
                        <div className="pt-2 flex flex-wrap gap-1.5 border-t border-amber-500/20 mt-1">
                          {options.map((opt, i) => (
                            <button
                              key={i}
                              onClick={() => {
                                hapticLight()
                                const target =
                                  selectedProject !== 'all' ? selectedProject : undefined
                                onSendPrompt(opt, target)
                              }}
                              className="px-2.5 py-1 rounded-xl text-xs font-semibold bg-amber-950/80 hover:bg-amber-900 border border-amber-500/80 text-amber-200 active:bg-amber-500 active:text-black active:scale-95 transition-all shadow-sm flex items-center gap-1.5"
                            >
                              <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
                              <span>{opt}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Floating Prompt Bar with Non-Overlapping Project Routing */}
          <div className="absolute bottom-0 left-0 right-0 p-2 sm:p-3 bg-gradient-to-t from-[#060907] via-[#060907]/95 to-transparent z-20">
            {/* Quick Suggestion Chips */}
            <div className="flex gap-1.5 overflow-x-auto pb-1.5 scrollbar-none flex-nowrap -mx-0.5 px-0.5">
              {quickReplies.map((reply, i) => (
                <button
                  key={i}
                  onClick={() => {
                    hapticLight()
                    const target = selectedProject !== 'all' ? selectedProject : undefined
                    onSendPrompt(reply, target)
                  }}
                  className="text-[9.5px] font-semibold px-2.5 py-1 rounded-full bg-[#0d140f] border border-emerald-900/80 text-emerald-300 whitespace-nowrap shrink-0 active:bg-amber-950 active:border-amber-400 active:text-amber-300 active:scale-95 transition-all"
                >
                  {reply}
                </button>
              ))}
            </div>

            {/* Input Bar with Target Project Tag & Glowing Ring */}
            <div className="flex items-center gap-1.5 sm:gap-2 bg-[#0c140f] border border-amber-500/40 rounded-2xl px-2.5 py-1.5 sm:py-2 shadow-2xl focus-within:border-amber-400 focus-within:ring-2 focus-within:ring-amber-400/30 transition-all">
              <span className="text-[9.5px] font-mono font-bold px-2 py-0.5 rounded-lg bg-black/60 border border-amber-500/40 text-amber-300 shrink-0 truncate max-w-[110px] sm:max-w-[150px]">
                To: {selectedProject === 'all' ? 'Active IDE' : selectedProject}
              </span>
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Prompt ${selectedProject === 'all' ? 'AI agent' : selectedProject}...`}
                className="flex-1 bg-transparent text-xs text-amber-100 placeholder-emerald-600/60 focus:outline-none min-w-0"
              />
              <button
                onClick={handleSend}
                disabled={!inputMessage.trim()}
                className="p-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 disabled:opacity-40 text-black font-bold transition-all shadow-md shadow-amber-950/40 shrink-0 active:scale-95"
                title="Send Prompt to Workstation"
              >
                <Send className="w-3.5 h-3.5 text-black" />
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
