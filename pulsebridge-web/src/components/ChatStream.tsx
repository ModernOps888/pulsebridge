import { useState, useRef, useEffect, useMemo } from 'react'
import {
  Send,
  Sparkles,
  ChevronDown,
  ChevronUp,
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
  LayoutGrid,
} from 'lucide-react'
import type { ChatStep, ProjectChatInfo } from '../types'

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
  const [isSubPanelOpen, setIsSubPanelOpen] = useState(false)
  const [isSplitView, setIsSplitView] = useState(false)

  const chatEndRef = useRef<HTMLDivElement | null>(null)

  // Aggregate project names from steps and projects list
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

  // Filter steps based on selected project, conversation, and search query
  const filteredSteps = useMemo(() => {
    return steps.filter((step) => {
      const stepProject = step.project_name || 'PulseBridge'

      if (selectedProject !== 'all' && stepProject.toLowerCase() !== selectedProject.toLowerCase()) {
        return false
      }

      if (selectedConversation !== 'all' && step.conversation_id !== selectedConversation) {
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
    setExpandedThinking((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleSend = () => {
    if (!inputMessage.trim()) return
    const target = selectedProject !== 'all' ? selectedProject : undefined
    onSendPrompt(inputMessage.trim(), target)
    setInputMessage('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSend()
    }
  }

  const quickReplies = [
    'Proceed with next step',
    'Looks good, continue',
    'Run tests & verify',
    'Emergency abort',
  ]

  return (
    <div className={`flex flex-col h-[calc(100vh-120px)] w-full mx-auto transition-all ${isSplitView ? 'max-w-6xl px-1' : 'max-w-3xl px-2'}`}>
      {/* Top Multi-Project Header & Toolbar */}
      <div className="bg-[#0a0f0d] border border-emerald-950/80 rounded-2xl p-2.5 mb-2 shadow-xl shrink-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          {/* View Toggles & Search */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
            <button
              onClick={() => {
                setSelectedProject('all')
                setSelectedConversation('all')
              }}
              className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap shadow-sm ${
                selectedProject === 'all'
                  ? 'bg-amber-500 text-black shadow-amber-500/20 font-bold'
                  : 'bg-[#101813] text-emerald-300 hover:bg-[#15221b] border border-emerald-900/60'
              }`}
            >
              <Layers className="w-3 h-3" />
              <span>All Projects ({steps.length})</span>
            </button>

            {projectStats.map((p) => {
              const isActive = selectedProject.toLowerCase() === p.name.toLowerCase()
              return (
                <button
                  key={p.name}
                  onClick={() => {
                    setSelectedProject(p.name)
                    setSelectedConversation('all')
                  }}
                  className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap shadow-sm ${
                    isActive
                      ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-black font-bold shadow-amber-950/40'
                      : 'bg-[#101813] text-emerald-300 hover:bg-[#15221b] border border-emerald-900/60'
                  }`}
                >
                  <Folder className="w-3 h-3 text-amber-400" />
                  <span>{p.name}</span>
                  <span className={`text-[9px] px-1.5 py-0.2 rounded-full ${isActive ? 'bg-black/30 text-black' : 'bg-emerald-950 text-emerald-400'}`}>
                    {p.count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Action Buttons: Sub-Panel Drawer & Split-Window Toggles */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setIsSubPanelOpen((prev) => !prev)}
              className={`p-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1 transition-all ${
                isSubPanelOpen
                  ? 'bg-amber-500 text-black border-amber-400'
                  : 'bg-[#101813] text-amber-300 border-amber-500/40 hover:bg-amber-950/40'
              }`}
              title="Toggle Project Chats Sub-Panel"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-[11px]">Projects Sub-Panel</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
            </button>

            <button
              onClick={() => setIsSplitView((prev) => !prev)}
              className={`p-1.5 rounded-xl border text-xs font-semibold transition-all hidden md:flex items-center gap-1 ${
                isSplitView
                  ? 'bg-emerald-500 text-black border-emerald-400'
                  : 'bg-[#101813] text-emerald-300 border-emerald-800 hover:bg-emerald-950/40'
              }`}
              title="Toggle Split-Window View"
            >
              <Columns className="w-3.5 h-3.5" />
              <span className="text-[11px]">Split</span>
            </button>

            {onRefreshProjects && (
              <button
                onClick={onRefreshProjects}
                className="p-1.5 rounded-xl bg-[#101813] border border-gray-800 text-gray-300 hover:text-white"
                title="Refresh project list"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Search Bar & Active Filter Bar */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-emerald-950/60">
          <div className="relative flex-1">
            <Search className="w-3 h-3 absolute left-2.5 top-2.5 text-emerald-600" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search reasoning, tools, and code across chats..."
              className="w-full bg-[#070c09] border border-emerald-950 rounded-xl pl-8 pr-7 py-1 text-[11px] text-emerald-100 placeholder-emerald-800 focus:outline-none focus:border-amber-500/60 font-mono"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-gray-500 hover:text-gray-300"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {selectedProject !== 'all' && (
            <div className="flex items-center gap-1.5 bg-amber-950/40 border border-amber-500/50 px-2 py-0.5 rounded-lg text-[10px] text-amber-200 shrink-0">
              <span className="font-semibold">📁 {selectedProject}</span>
              <button
                onClick={() => setSelectedProject('all')}
                className="p-0.5 hover:bg-amber-800 rounded"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Container: Split-Window or Single Feed with Overlay Sub-Panel */}
      <div className="flex-1 flex gap-3 min-h-0 relative overflow-hidden">
        {/* Sub-Panel (Window / Drawer) */}
        {(isSubPanelOpen || isSplitView) && (
          <aside
            className={`${
              isSplitView
                ? 'w-72 md:w-80 shrink-0 flex flex-col bg-[#070c09] border border-emerald-950 rounded-2xl overflow-hidden'
                : 'absolute inset-0 z-40 bg-[#070c09]/95 backdrop-blur-md border border-amber-500/40 rounded-2xl p-3 flex flex-col shadow-2xl animate-fadeIn'
            }`}
          >
            {/* Sub-Panel Header */}
            <div className="flex items-center justify-between p-3 border-b border-emerald-950/80 bg-[#0c140f]">
              <div className="flex items-center gap-2">
                <LayoutGrid className="w-4 h-4 text-amber-400" />
                <h3 className="font-bold text-xs text-amber-200 uppercase tracking-wider font-mono">
                  Project Chats Sub-Panel
                </h3>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
                  {projects.length || projectStats.length} active
                </span>
                {!isSplitView && (
                  <button
                    onClick={() => setIsSubPanelOpen(false)}
                    className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Sub-Panel Project Cards List */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
              {/* All Projects Overview Card */}
              <button
                onClick={() => {
                  setSelectedProject('all')
                  setSelectedConversation('all')
                  if (!isSplitView) setIsSubPanelOpen(false)
                }}
                className={`w-full text-left p-3 rounded-xl border transition-all ${
                  selectedProject === 'all'
                    ? 'bg-amber-950/50 border-amber-500 shadow-md shadow-amber-950/40'
                    : 'bg-[#0f1712] border-emerald-950 hover:border-emerald-800'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-amber-300">
                    <Layers className="w-3.5 h-3.5 text-amber-400" />
                    <span>All Streamed Workspaces</span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 font-mono">
                    {steps.length} total
                  </span>
                </div>
                <p className="text-[11px] text-gray-400 line-clamp-2">
                  Unified live feed showing multi-agent reasoning, tool executions, and file events across all projects.
                </p>
              </button>

              {/* Individual Project & Conversation Cards */}
              {(projects.length > 0
                ? projects
                : projectStats.map((p, i) => ({
                    id: `local-p-${i}`,
                    project_name: p.name,
                    conversation_title: `${p.name} Active Session`,
                    ide: p.ide as any,
                    last_updated: p.lastTime || new Date().toISOString(),
                    step_count: p.count,
                    latest_message_snippet: p.latestSnippet,
                    status: 'active',
                  }))
              ).map((proj) => {
                const isSelected = selectedProject.toLowerCase() === proj.project_name.toLowerCase()
                return (
                  <button
                    key={proj.id}
                    onClick={() => {
                      setSelectedProject(proj.project_name)
                      setSelectedConversation(proj.id)
                      if (!isSplitView) setIsSubPanelOpen(false)
                    }}
                    className={`w-full text-left p-3 rounded-xl border transition-all group ${
                      isSelected
                        ? 'bg-gradient-to-r from-amber-950/60 to-yellow-950/40 border-amber-400 shadow-lg shadow-amber-950/50 ring-1 ring-amber-400/40'
                        : 'bg-[#0c140f] border-emerald-950/80 hover:border-amber-500/50 hover:bg-[#111c15]'
                    }`}
                  >
                    {/* Project & IDE Badges */}
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="font-bold text-xs text-amber-100 truncate">
                          {proj.project_name}
                        </span>
                      </div>
                      <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-black/60 border border-emerald-900 text-emerald-300 font-mono shrink-0">
                        {proj.ide}
                      </span>
                    </div>

                    {/* Conversation Title */}
                    <div className="text-[11px] font-semibold text-emerald-200/90 mb-1 line-clamp-1 font-sans">
                      {proj.conversation_title}
                    </div>

                    {/* Latest Message / Thought Snippet */}
                    {proj.latest_message_snippet && (
                      <div className="bg-black/50 border border-emerald-950/60 rounded-lg p-1.5 mb-2 font-mono text-[10px] text-gray-300 line-clamp-2 leading-relaxed">
                        "{proj.latest_message_snippet}"
                      </div>
                    )}

                    {/* Card Footer: Step count and relative timestamp */}
                    <div className="flex items-center justify-between text-[10px] text-emerald-600/80 font-mono pt-1 border-t border-emerald-950/40">
                      <span className="flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {proj.last_updated ? new Date(proj.last_updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Live'}
                      </span>
                      <span className="text-amber-400 font-bold">
                        {proj.step_count} events
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </aside>
        )}

        {/* Primary Chat Feed Section */}
        <section className="flex-1 flex flex-col bg-[#070c09] border border-emerald-950 rounded-2xl overflow-hidden min-h-0 relative shadow-xl">
          {/* Active Filter Pill Bar in Chat Header */}
          <div className="bg-[#0b120e] px-3.5 py-2 border-b border-emerald-950 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-bold text-amber-200">
                {selectedProject === 'all' ? 'Unified Live Stream' : `Project: ${selectedProject}`}
              </span>
              <span className="text-[10px] text-emerald-500 font-mono">
                ({filteredSteps.length} of {steps.length} messages)
              </span>
            </div>

            {selectedProject !== 'all' && (
              <button
                onClick={() => {
                  setSelectedProject('all')
                  setSelectedConversation('all')
                }}
                className="text-[11px] text-amber-400 hover:text-amber-300 underline font-semibold flex items-center gap-1"
              >
                <span>View all projects</span>
              </button>
            )}
          </div>

          {/* Steps Scroll Area */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 pb-28">
            {filteredSteps.length === 0 ? (
              <div className="text-center py-20 text-emerald-600/70 text-xs font-mono space-y-2">
                <Bot className="w-10 h-10 text-emerald-500/30 mx-auto opacity-50" />
                <p>No chat events found matching the active project filter.</p>
                {selectedProject !== 'all' && (
                  <button
                    onClick={() => setSelectedProject('all')}
                    className="px-3 py-1.5 rounded-xl bg-amber-500 text-black font-bold text-xs"
                  >
                    Switch back to All Projects
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
                    className={`flex gap-2.5 sm:gap-3 text-xs leading-relaxed ${
                      isUser ? 'flex-row-reverse' : 'flex-row'
                    }`}
                  >
                    {/* User / Agent Avatar */}
                    <div
                      className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 shadow-md ${
                        isUser
                          ? 'bg-gradient-to-tr from-amber-500 to-yellow-500 text-black font-bold'
                          : 'bg-gradient-to-tr from-emerald-800 to-emerald-600 text-emerald-200'
                      }`}
                    >
                      {isUser ? <User className="w-4 h-4 text-black" /> : <Bot className="w-4 h-4" />}
                    </div>

                    {/* Chat Bubble Container */}
                    <div
                      className={`max-w-[88%] sm:max-w-[82%] rounded-2xl p-3.5 space-y-2 shadow-xl ${
                        isUser
                          ? 'bg-gradient-to-r from-amber-600 to-yellow-600 text-black font-medium rounded-tr-none shadow-amber-950/40'
                          : 'bg-[#0c140f] border border-emerald-900/70 text-emerald-100 rounded-tl-none shadow-emerald-950/20'
                      }`}
                    >
                      {/* Project & Context Badge Header */}
                      <div className="flex items-center justify-between gap-2 pb-1 border-b border-white/10 text-[10px] font-mono">
                        <button
                          onClick={() => setSelectedProject(stepProject)}
                          className={`flex items-center gap-1 font-bold hover:underline transition-all ${
                            isUser ? 'text-black/80' : 'text-amber-400'
                          }`}
                          title={`Filter to ${stepProject}`}
                        >
                          <Folder className="w-3 h-3 text-amber-400" />
                          <span>{stepProject}</span>
                          <span className="opacity-60">·</span>
                          <span className="uppercase text-[9px]">{step.ide}</span>
                        </button>

                        <span className={isUser ? 'text-black/60' : 'text-emerald-500'}>
                          {step.timestamp ? new Date(step.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>

                      {/* Agent Reasoning Box in Radiant Gold */}
                      {step.thinking && (
                        <div className="rounded-xl bg-amber-950/30 border border-amber-700/50 p-2.5 text-amber-200">
                          <button
                            onClick={() => toggleThinking(step.id)}
                            className="flex items-center justify-between w-full text-[11px] font-bold text-amber-300"
                          >
                            <span className="flex items-center gap-1.5 font-mono">
                              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                              Agent Reasoning
                            </span>
                            {isThinkingExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5 text-amber-400" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5 text-amber-400" />
                            )}
                          </button>
                          {isThinkingExpanded && (
                            <div className="mt-2 text-[11px] text-amber-100/90 whitespace-pre-wrap font-mono max-h-52 overflow-y-auto leading-normal">
                              {step.thinking}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Tool Calls Display */}
                      {step.tool_calls && step.tool_calls.length > 0 && (
                        <div className="space-y-1.5">
                          {step.tool_calls.map((call, idx) => (
                            <div
                              key={idx}
                              className="rounded-lg bg-black/60 border border-emerald-950 p-2 font-mono text-[11px] space-y-1"
                            >
                              <div className="flex items-center gap-1.5 text-amber-400 font-semibold">
                                <Terminal className="w-3 h-3 text-emerald-400" />
                                <span>{call.tool_name}</span>
                              </div>
                              {call.action && <div className="text-emerald-300 text-[10px]">{call.action}</div>}
                              {call.summary && <div className="text-gray-400 text-[10px] italic">{call.summary}</div>}
                            </div>
                          ))}
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
                                const target = selectedProject !== 'all' ? selectedProject : undefined
                                onSendPrompt(opt, target)
                              }}
                              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-950/80 hover:bg-amber-900 border border-amber-500/80 text-amber-200 active:bg-amber-500 active:text-black transition-all shadow-sm flex items-center gap-1.5"
                            >
                              <Sparkles className="w-3 h-3 text-amber-400" />
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

          {/* Floating Prompt Bar with Project Routing */}
          <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-[#060907] via-[#060907]/95 to-transparent z-20">
            {/* Quick Suggestion Chips */}
            <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-none">
              {quickReplies.map((reply, i) => (
                <button
                  key={i}
                  onClick={() => {
                    const target = selectedProject !== 'all' ? selectedProject : undefined
                    onSendPrompt(reply, target)
                  }}
                  className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-[#0d140f] border border-emerald-900/80 text-emerald-300 whitespace-nowrap active:bg-amber-950 active:border-amber-400 active:text-amber-300"
                >
                  {reply}
                </button>
              ))}
            </div>

            {/* Input Bar with Target Project Tag */}
            <div className="flex items-center gap-2 bg-[#0c140f] border border-amber-500/40 rounded-2xl px-3 py-2 shadow-2xl focus-within:border-amber-400">
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg bg-black/60 border border-amber-500/40 text-amber-300 shrink-0">
                To: {selectedProject === 'all' ? 'Active IDE' : selectedProject}
              </span>
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Prompt ${selectedProject === 'all' ? 'AI agent' : selectedProject}...`}
                className="flex-1 bg-transparent text-xs text-amber-100 placeholder-emerald-600/60 focus:outline-none"
              />
              <button
                onClick={handleSend}
                disabled={!inputMessage.trim()}
                className="p-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 disabled:opacity-40 text-black font-bold transition-all shadow-md shadow-amber-950/40 shrink-0"
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
