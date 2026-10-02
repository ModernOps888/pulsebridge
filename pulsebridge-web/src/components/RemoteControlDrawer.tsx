import { useState } from 'react'
import {
  Send,
  Mic,
  MicOff,
  FolderOpen,
  Terminal,
  Zap,
  Sparkles,
  CheckCircle,
  AlertCircle,
} from 'lucide-react'
import type { IdeSource } from '../types'

interface RemoteControlDrawerProps {
  token: string | null
  activeIde?: IdeSource
  onAlert: (msg: string) => void
}

export function RemoteControlDrawer({
  token,
  activeIde = 'antigravity',
  onAlert,
}: RemoteControlDrawerProps) {
  const [prompt, setPrompt] = useState('')
  const [targetIde, setTargetIde] = useState<IdeSource>(activeIde)
  const [actionMode, setActionMode] = useState<
    'inject_window' | 'direct_inbox' | 'launch_project' | 'execute_command'
  >('inject_window')
  const [projectPath, setProjectPath] = useState('C:\\')
  const [isRecording, setIsRecording] = useState(false)
  const [loading, setLoading] = useState(false)
  const [lastResult, setLastResult] = useState<{ success: boolean; message: string } | null>(null)

  const toggleSpeechRecognition = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser.')
      return
    }

    if (isRecording) {
      setIsRecording(false)
      return
    }

    try {
      const recognition = new SpeechRecognition()
      recognition.lang = 'en-US'
      recognition.interimResults = false
      recognition.maxAlternatives = 1

      recognition.onstart = () => {
        setIsRecording(true)
      }

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript
        setPrompt((prev) => (prev ? `${prev} ${transcript}` : transcript))
      }

      recognition.onerror = () => {
        setIsRecording(false)
      }

      recognition.onend = () => {
        setIsRecording(false)
      }

      recognition.start()
    } catch (err) {
      console.error(err)
      setIsRecording(false)
    }
  }

  const handleDispatch = async () => {
    if (!prompt.trim() || loading) return
    setLoading(true)
    setLastResult(null)

    try {
      const res = await fetch('/api/action/remote_prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: prompt.trim(),
          target_ide: targetIde,
          action_mode: actionMode,
          project_path: projectPath,
          command: actionMode === 'execute_command' ? prompt.trim() : undefined,
        }),
      })

      const data = await res.json()
      if (res.ok && data.success) {
        setLastResult({ success: true, message: data.message })
        setPrompt('')
        onAlert('Prompt dispatched to your PC!')
      } else {
        setLastResult({
          success: false,
          message: data.message || 'Failed to dispatch command',
        })
      }
    } catch (err) {
      setLastResult({
        success: false,
        message: 'Could not connect to PulseBridge server',
      })
    } finally {
      setLoading(false)
    }
  }

  const applyPreset = (presetText: string) => {
    setPrompt(presetText)
  }

  return (
    <div className="space-y-4 pb-28 p-4 max-w-2xl mx-auto select-none">
      {/* Title Card */}
      <div className="rounded-2xl bg-[#0a0f0c] border border-amber-500/30 p-5 space-y-2 shadow-lg">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500/20 to-emerald-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-100">Remote IDE Commander</h2>
            <p className="text-[11px] text-emerald-400/80">
              Trigger fixes, send prompts, or launch tasks on your PC while you are out.
            </p>
          </div>
        </div>

        {/* Action Mode Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-2">
          {[
            { id: 'inject_window', label: 'Type in Active IDE', icon: Zap },
            { id: 'direct_inbox', label: 'Queue in Inbox', icon: Sparkles },
            { id: 'launch_project', label: 'Open Project', icon: FolderOpen },
            { id: 'execute_command', label: 'Shell Command', icon: Terminal },
          ].map((mode) => {
            const Icon = mode.icon
            const isSelected = actionMode === mode.id
            return (
              <button
                key={mode.id}
                onClick={() => setActionMode(mode.id as any)}
                className={`p-2 rounded-xl text-[10px] font-bold border flex flex-col items-center gap-1 transition-all ${
                  isSelected
                    ? 'bg-amber-950/80 border-amber-400 text-amber-300 ring-1 ring-amber-400/40'
                    : 'bg-[#0d140f] border-emerald-950 text-emerald-400 hover:text-emerald-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{mode.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Target IDE & Configuration */}
      <div className="rounded-2xl bg-[#0a0f0c] border border-emerald-900/60 p-4 space-y-3 shadow-md">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] text-amber-400/90 font-medium">Target IDE</label>
            <select
              value={targetIde}
              onChange={(e) => setTargetIde(e.target.value as IdeSource)}
              className="w-full bg-[#0d140f] border border-emerald-900/80 rounded-xl px-3 py-2 text-xs text-emerald-100 focus:outline-none focus:border-amber-400"
            >
              <option value="antigravity">Antigravity (Default)</option>
              <option value="cursor">Cursor AI (Composer)</option>
              <option value="vscode">VS Code / Copilot</option>
              <option value="visualstudio">Visual Studio</option>
            </select>
          </div>

          {actionMode === 'launch_project' && (
            <div className="space-y-1">
              <label className="text-[10px] text-amber-400/90 font-medium">Project Folder Path</label>
              <input
                type="text"
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                placeholder="e.g. C:\Infinity\frontend"
                className="w-full bg-[#0d140f] border border-emerald-900/80 rounded-xl px-3 py-2 text-xs text-amber-100 focus:outline-none focus:border-amber-400 font-mono"
              />
            </div>
          )}
        </div>

        {/* Quick Presets */}
        <div className="space-y-1.5 pt-1">
          <label className="text-[10px] text-amber-400/90 font-medium">Quick Remote Actions</label>
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {[
              'Fix typo on website: check the header and change to correct spelling',
              'Check git status, commit changes, and run npm run build',
              'Explain what the agent is currently working on',
              'Run full test suite and notify me of any errors',
            ].map((preset, i) => (
              <button
                key={i}
                onClick={() => applyPreset(preset)}
                className="text-[10px] font-semibold px-2.5 py-1.5 rounded-xl bg-[#0d140f] border border-emerald-950 text-emerald-300 whitespace-nowrap active:bg-amber-950 active:border-amber-400 active:text-amber-300"
              >
                {preset.slice(0, 32)}...
              </button>
            ))}
          </div>
        </div>

        {/* Main Prompt Textarea */}
        <div className="space-y-2 pt-1">
          <div className="relative">
            <textarea
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                actionMode === 'execute_command'
                  ? 'Enter shell command to run on PC (e.g. git status, npm test)...'
                  : 'Describe what you want fixed or instructed on your PC...'
              }
              className="w-full bg-[#0d140f] border border-emerald-900/80 rounded-xl p-3 text-xs text-emerald-100 placeholder-emerald-600/50 focus:outline-none focus:border-amber-400 resize-none font-sans"
            />

            {/* Voice Dictation Button */}
            <button
              onClick={toggleSpeechRecognition}
              title="Dictate with Voice"
              className={`absolute bottom-3 right-3 p-2 rounded-xl transition-all ${
                isRecording
                  ? 'bg-amber-500 text-black animate-pulse'
                  : 'bg-emerald-950/80 border border-emerald-800 text-amber-400 hover:text-amber-300'
              }`}
            >
              {isRecording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Dispatch Button in Gold & Emerald */}
          <button
            onClick={handleDispatch}
            disabled={!prompt.trim() || loading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 via-yellow-500 to-emerald-500 hover:from-amber-400 hover:to-emerald-400 active:scale-[0.99] text-black font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-amber-950/40 disabled:opacity-40 transition-all tracking-wide"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Send to PC & Execute</span>
              </>
            )}
          </button>
        </div>

        {/* Feedback Alert Card */}
        {lastResult && (
          <div
            className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 animate-fadeIn ${
              lastResult.success
                ? 'bg-emerald-950/40 border-emerald-700/80 text-emerald-300'
                : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
            }`}
          >
            {lastResult.success ? (
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 font-medium leading-relaxed">{lastResult.message}</div>
          </div>
        )}
      </div>
    </div>
  )
}
