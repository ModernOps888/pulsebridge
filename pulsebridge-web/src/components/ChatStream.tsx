import { useState, useRef, useEffect } from 'react'
import {
  Send,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Terminal,
  User,
  Bot,
} from 'lucide-react'
import type { ChatStep } from '../types'

interface ChatStreamProps {
  steps: ChatStep[]
  onSendPrompt: (msg: string) => void
}

export function ChatStream({ steps, onSendPrompt }: ChatStreamProps) {
  const [inputMessage, setInputMessage] = useState('')
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({})
  const chatEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [steps.length])

  const toggleThinking = (id: string) => {
    setExpandedThinking((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleSend = () => {
    if (!inputMessage.trim()) return
    onSendPrompt(inputMessage.trim())
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
    'Wait, check the tests first',
    'Emergency abort',
  ]

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] max-w-2xl mx-auto">
      {/* Steps Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-28">
        {steps.length === 0 ? (
          <div className="text-center py-16 text-emerald-600/70 text-xs font-mono">
            <Bot className="w-8 h-8 text-emerald-500/40 mx-auto mb-2 opacity-50" />
            No chat events logged yet. Real-time reasoning and actions will stream here.
          </div>
        ) : (
          steps.map((step) => {
            const isUser = step.source === 'USER'
            const isThinkingExpanded = expandedThinking[step.id] || false

            return (
              <div
                key={step.id}
                className={`flex gap-3 text-xs leading-relaxed ${
                  isUser ? 'flex-row-reverse' : 'flex-row'
                }`}
              >
                {/* Avatar */}
                <div
                  className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${
                    isUser
                      ? 'bg-gradient-to-tr from-amber-500 to-yellow-500 text-black font-bold'
                      : 'bg-gradient-to-tr from-emerald-800 to-emerald-600 text-emerald-200'
                  }`}
                >
                  {isUser ? <User className="w-4 h-4 text-black" /> : <Bot className="w-4 h-4" />}
                </div>

                {/* Content Bubble */}
                <div
                  className={`max-w-[85%] rounded-2xl p-3.5 space-y-2 shadow-lg ${
                    isUser
                      ? 'bg-gradient-to-r from-amber-600 to-yellow-600 text-black font-medium rounded-tr-none shadow-amber-950/30'
                      : 'bg-[#0c140f] border border-emerald-900/60 text-emerald-100 rounded-tl-none shadow-emerald-950/20'
                  }`}
                >
                  {/* Thinking Section in Auric Gold */}
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
                        <div className="mt-2 text-[11px] text-amber-100/90 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto leading-normal">
                          {step.thinking}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tool Call Section */}
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

                  {/* Text Content */}
                  {step.content && (
                    <div className="whitespace-pre-wrap font-sans text-xs">
                      {step.content}
                    </div>
                  )}

                  {/* Footer Timestamp */}
                  <div
                    className={`text-[9px] text-right font-mono ${
                      isUser ? 'text-black/60 font-semibold' : 'text-emerald-600/80'
                    }`}
                  >
                    {step.timestamp ? new Date(step.timestamp).toLocaleTimeString() : ''}
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Floating Prompt Input & Quick Replies */}
      <div className="fixed bottom-14 left-0 right-0 max-w-md mx-auto p-3 bg-gradient-to-t from-[#060907] via-[#060907]/95 to-transparent">
        {/* Quick Suggestion Chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-none">
          {quickReplies.map((reply, i) => (
            <button
              key={i}
              onClick={() => onSendPrompt(reply)}
              className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-[#0d140f] border border-emerald-900/80 text-emerald-300 whitespace-nowrap active:bg-amber-950 active:border-amber-400 active:text-amber-300"
            >
              {reply}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <div className="flex items-center gap-2 bg-[#0c140f] border border-amber-500/40 rounded-2xl px-3 py-2 shadow-2xl focus-within:border-amber-400">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Instruct agent from phone..."
            className="flex-1 bg-transparent text-xs text-amber-100 placeholder-emerald-600/60 focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!inputMessage.trim()}
            className="p-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 disabled:opacity-40 text-black font-bold transition-all shadow-md shadow-amber-950/40"
          >
            <Send className="w-3.5 h-3.5 text-black" />
          </button>
        </div>
      </div>
    </div>
  )
}
