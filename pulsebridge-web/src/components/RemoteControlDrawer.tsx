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
  Clipboard,
  Copy,
  Check,
  BellRing,
  TerminalSquare,
} from 'lucide-react'
import type { IdeSource } from '../types'

interface RemoteControlDrawerProps {
  token: string | null
  activeIde?: IdeSource
  onAlert: (msg: string) => void
  notificationPermission?: NotificationPermission
  onRequestNotificationPermission?: () => Promise<boolean>
  onFetchClipboard?: () => Promise<string>
  onSendClipboard?: (text: string) => Promise<boolean>
}

export function RemoteControlDrawer({
  token,
  activeIde = 'antigravity',
  onAlert,
  notificationPermission = 'default',
  onRequestNotificationPermission,
  onFetchClipboard,
  onSendClipboard,
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

  // Workstation Clipboard Sync State
  const [clipboardText, setClipboardText] = useState('')
  const [clipboardStatus, setClipboardStatus] = useState<string | null>(null)
  const [clipboardCopied, setClipboardCopied] = useState(false)

  // DevOps Terminal Output State
  const [terminalOutput, setTerminalOutput] = useState<string | null>(null)

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
    setTerminalOutput(null)

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
        if (data.stdout) {
          setTerminalOutput(data.stdout)
        }
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

  const handleQuickCommand = async (cmd: string) => {
    setPrompt(cmd)
    setActionMode('execute_command')
    setLoading(true)
    setLastResult(null)
    setTerminalOutput(null)

    try {
      const res = await fetch('/api/action/remote_prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: cmd,
          target_ide: targetIde,
          action_mode: 'execute_command',
          command: cmd,
        }),
      })

      const data = await res.json()
      if (res.ok && data.success) {
        setLastResult({ success: true, message: `Executed: ${cmd}` })
        setTerminalOutput(data.stdout || data.message || 'Command executed.')
        onAlert(`Executed: ${cmd}`)
      } else {
        setLastResult({
          success: false,
          message: data.message || 'Execution error',
        })
      }
    } catch (err) {
      setLastResult({
        success: false,
        message: 'Connection error',
      })
    } finally {
      setLoading(false)
    }
  }

  const handlePullClipboard = async () => {
    if (onFetchClipboard) {
      setClipboardStatus('Reading...')
      const txt = await onFetchClipboard()
      setClipboardText(txt)
      setClipboardStatus(txt ? 'Pulled from Workstation!' : 'Workstation clipboard empty')
      setTimeout(() => setClipboardStatus(null), 2500)
    }
  }

  const handlePushClipboard = async () => {
    if (onSendClipboard && clipboardText.trim()) {
      setClipboardStatus('Sending...')
      const ok = await onSendClipboard(clipboardText.trim())
      setClipboardStatus(ok ? 'Pushed to Workstation!' : 'Push failed')
      setTimeout(() => setClipboardStatus(null), 2500)
    }
  }

  const handleCopyLocal = () => {
    if (clipboardText) {
      navigator.clipboard.writeText(clipboardText)
      setClipboardCopied(true)
      setTimeout(() => setClipboardCopied(false), 2000)
    }
  }

  const applyPreset = (presetText: string) => {
    setPrompt(presetText)
  }

  return (
    <div className="space-y-4 pb-28 p-4 max-w-2xl mx-auto select-none">
      {/* Background Push Notifications Callout Banner */}
      {notificationPermission !== 'granted' && onRequestNotificationPermission && (
        <div className="rounded-2xl bg-gradient-to-r from-amber-950/60 via-yellow-950/40 to-emerald-950/60 border border-amber-500/40 p-3.5 flex items-center justify-between gap-3 shadow-md animate-slideDown">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
              <BellRing className="w-4 h-4 animate-bounce" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-amber-200">Lock-Screen Push Notifications</h4>
              <p className="text-[10px] text-emerald-400/90 leading-tight">
                Receive vibration & alerts when tasks finish while your phone is locked.
              </p>
            </div>
          </div>
          <button
            onClick={() => onRequestNotificationPermission()}
            className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 text-black text-xs font-bold shrink-0 shadow-sm active:scale-95 transition-all"
          >
            Enable
          </button>
        </div>
      )}

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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
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
                className={`p-2 rounded-xl text-[10px] font-bold border flex flex-col items-center justify-center gap-1 transition-all min-w-0 min-h-[54px] overflow-hidden ${
                  isSelected
                    ? 'bg-amber-950/80 border-amber-400 text-amber-300 ring-1 ring-amber-400/40'
                    : 'bg-[#0d140f] border-emerald-950 text-emerald-400 hover:text-emerald-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate max-w-full text-center leading-tight">{mode.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Workstation Remote Clipboard Sync Card */}
      <div className="rounded-2xl bg-[#0a0f0c] border border-emerald-900/60 p-4 space-y-2.5 shadow-md">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1.5">
            <Clipboard className="w-3.5 h-3.5 text-amber-400" />
            Workstation Clipboard Sync
          </span>
          {clipboardStatus && (
            <span className="text-[10px] font-mono text-emerald-400 animate-pulse">
              {clipboardStatus}
            </span>
          )}
        </div>

        <div className="relative">
          <textarea
            rows={2}
            value={clipboardText}
            onChange={(e) => setClipboardText(e.target.value)}
            placeholder="Type snippet or pull clipboard from workstation..."
            className="w-full bg-[#0d140f] border border-emerald-950 rounded-xl p-2.5 text-xs text-amber-100 placeholder-emerald-600/40 focus:outline-none focus:border-amber-400 font-mono resize-none"
          />
          {clipboardText && (
            <button
              onClick={handleCopyLocal}
              className="absolute top-2 right-2 p-1.5 rounded-lg bg-[#060907] border border-emerald-900 text-emerald-300 hover:text-amber-300"
              title="Copy to Phone"
            >
              {clipboardCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handlePullClipboard}
            className="flex-1 py-1.5 rounded-xl bg-[#0d140f] border border-emerald-950 hover:border-amber-400 text-emerald-300 text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all"
          >
            <span>📥 Pull from PC</span>
          </button>
          <button
            onClick={handlePushClipboard}
            disabled={!clipboardText.trim()}
            className="flex-1 py-1.5 rounded-xl bg-gradient-to-r from-amber-600 to-yellow-500 disabled:opacity-40 text-black text-[10px] font-bold flex items-center justify-center gap-1.5 shadow-sm transition-all"
          >
            <span>📋 Push to PC</span>
          </button>
        </div>
      </div>

      {/* DevOps Quick Runbook Toolbar */}
      <div className="rounded-2xl bg-[#0a0f0c] border border-emerald-900/60 p-4 space-y-2.5 shadow-md">
        <span className="text-[11px] font-bold text-emerald-300 flex items-center gap-1.5">
          <TerminalSquare className="w-3.5 h-3.5 text-amber-400" />
          DevOps Quick Runbook (1-Tap PC Shell)
        </span>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'git status', cmd: 'git status' },
            { label: 'git diff --stat', cmd: 'git diff --stat' },
            { label: 'git log -1', cmd: 'git log -1' },
            { label: 'npm test', cmd: 'npm test' },
            { label: 'cargo check', cmd: 'cargo check' },
            { label: 'git pull', cmd: 'git pull' },
            { label: 'dir / ls', cmd: 'dir' },
            { label: 'whoami / info', cmd: 'whoami; hostname' },
          ].map((action, i) => (
            <button
              key={i}
              onClick={() => handleQuickCommand(action.cmd)}
              disabled={loading}
              className="p-2 rounded-xl bg-[#0d140f] border border-emerald-950 hover:border-amber-400 text-emerald-300 active:bg-amber-600 active:text-black transition-all text-center flex flex-col items-center justify-center font-mono text-[10px] font-bold min-w-0 overflow-hidden"
            >
              <span className="truncate max-w-full">{action.label}</span>
            </button>
          ))}
        </div>

        {/* Live Terminal Output Drawer */}
        {terminalOutput && (
          <div className="mt-2 rounded-xl bg-black border border-emerald-900/80 p-3 font-mono text-[10px] text-emerald-300 max-h-48 overflow-y-auto whitespace-pre-wrap select-text">
            <div className="flex items-center justify-between pb-1 mb-1 border-b border-emerald-950 text-[9px] text-gray-400">
              <span>WORKSTATION TERMINAL OUTPUT</span>
              <button onClick={() => setTerminalOutput(null)} className="text-amber-400 hover:text-amber-300">
                Close
              </button>
            </div>
            {terminalOutput}
          </div>
        )}
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
          <label className="text-[10px] text-amber-400/90 font-medium">Quick AI Prompts</label>
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
