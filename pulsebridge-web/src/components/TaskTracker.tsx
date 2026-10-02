import { useEffect, useState } from 'react'
import {
  Clock,
  CheckCircle2,
  Circle,
  Loader2,
  Terminal,
  Activity,
  Layers,
  Sparkles,
  Zap,
} from 'lucide-react'
import type { AgentStatus, TaskProgress } from '../types'
import { hapticLight } from '../utils/haptics'

interface TaskTrackerProps {
  task: TaskProgress | null
}

export function TaskTracker({ task }: TaskTrackerProps) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!task) return
    setElapsed(task.elapsed_seconds)

    const timer = setInterval(() => {
      setElapsed((prev) => prev + 1)
    }, 1000)

    return () => clearInterval(timer)
  }, [task?.task_id, task?.elapsed_seconds])

  const formatTimer = (totalSecs: number) => {
    const hrs = Math.floor(totalSecs / 3600)
    const mins = Math.floor((totalSecs % 3600) / 60)
    const secs = totalSecs % 60
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins
        .toString()
        .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const getStatusBadge = (status: AgentStatus = 'idle') => {
    switch (status) {
      case 'thinking':
        return {
          label: 'Reasoning & Planning',
          color: 'bg-amber-950/70 border-amber-600/80 text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.3)]',
          icon: <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-spin" />,
        }
      case 'runningtool':
        return {
          label: 'Executing Action',
          color: 'bg-emerald-950/70 border-emerald-600/80 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.3)]',
          icon: <Terminal className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />,
        }
      case 'waitinginput':
        return {
          label: 'Awaiting User Prompt',
          color: 'bg-yellow-950/70 border-yellow-600/80 text-yellow-300 shadow-[0_0_12px_rgba(234,179,8,0.3)]',
          icon: <Activity className="w-3.5 h-3.5 text-yellow-400" />,
        }
      case 'completed':
        return {
          label: 'Goal Achieved',
          color: 'bg-emerald-950/80 border-emerald-500 text-emerald-200 shadow-[0_0_15px_rgba(16,185,129,0.4)]',
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
        }
      default:
        return {
          label: 'Standby / Ready',
          color: 'bg-[#0d140f] border-emerald-950 text-emerald-500/70',
          icon: <Circle className="w-3.5 h-3.5 text-emerald-700" />,
        }
    }
  }

  const statusInfo = getStatusBadge(task?.status)
  const percent = task?.percent_complete || 0

  // Circular progress calculation (r=42, circumference ~ 264)
  const radius = 42
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (percent / 100) * circumference

  return (
    <div className="space-y-4 pb-24 p-3.5 sm:p-5 max-w-xl mx-auto select-none">
      {/* HUD Radial Progress & Objective Card */}
      <div className="relative overflow-hidden rounded-3xl bg-[#080d0a] border border-amber-500/30 p-5 sm:p-6 shadow-2xl">
        {/* Ambient Auric & Emerald Glows */}
        <div className="absolute top-0 right-0 w-44 h-44 bg-gradient-to-br from-amber-500/10 via-yellow-500/5 to-transparent rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-44 h-44 bg-gradient-to-tr from-emerald-500/10 via-emerald-600/5 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1.5 flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-widest text-amber-400 uppercase flex items-center gap-1 font-mono">
                <Layers className="w-3.5 h-3.5 text-amber-400" />
                Active Objective
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <h2 className="text-sm sm:text-base font-bold text-gray-100 leading-snug line-clamp-2">
              {task?.task_title || 'Monitoring AI IDE session...'}
            </h2>
            <div className="flex items-center gap-2 pt-0.5">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1 font-mono ${statusInfo.color}`}>
                {statusInfo.icon}
                <span>{statusInfo.label}</span>
              </span>
            </div>
          </div>

          {/* SVG Circular Radial Progress Gauge */}
          <div className="relative shrink-0 flex items-center justify-center">
            <svg className="w-24 h-24 transform -rotate-90" viewBox="0 0 100 100">
              {/* Background Track */}
              <circle
                cx="50"
                cy="50"
                r={radius}
                className="text-[#0e1711] stroke-current"
                strokeWidth="7"
                fill="transparent"
              />
              {/* Progress Arc */}
              <circle
                cx="50"
                cy="50"
                r={radius}
                className="text-amber-400 stroke-current transition-all duration-700 ease-out"
                strokeWidth="7"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="transparent"
                style={{
                  filter: 'drop-shadow(0 0 6px rgba(251,191,36,0.6))',
                }}
              />
            </svg>
            <div className="absolute flex flex-col items-center justify-center">
              <span className="text-lg font-black font-mono text-amber-300 tracking-tighter">
                {percent}%
              </span>
              <span className="text-[8px] font-mono text-emerald-400 uppercase tracking-wider">
                Progress
              </span>
            </div>
          </div>
        </div>

        {/* Stopwatch & Step Stats Banner */}
        <div className="mt-4 pt-3.5 border-t border-emerald-950/80 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#0c140f] border border-amber-500/40 text-amber-300 shadow-sm">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-semibold tracking-wider">{formatTimer(elapsed)}</span>
          </div>

          <div className="flex items-center gap-2 text-emerald-400">
            <span className="text-gray-400 text-[11px]">Completed Steps:</span>
            <span className="font-bold text-amber-400 px-2 py-0.5 rounded-lg bg-[#0c140f] border border-emerald-950">
              {task?.total_steps || 0}
            </span>
          </div>
        </div>

        {/* Current Live Step Ticker */}
        <div className="mt-3 p-3 rounded-2xl bg-black/60 border border-emerald-900/60 flex items-start gap-2.5 shadow-inner">
          <Zap className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5 min-w-0">
            <div className="text-[10px] font-mono text-emerald-400/90 font-semibold uppercase">
              Current Live Action
            </div>
            <div className="text-xs text-emerald-100 font-mono leading-relaxed truncate">
              {task?.current_step_desc || 'Listening for IDE commands & tool calls...'}
            </div>
          </div>
        </div>
      </div>

      {/* Living Milestones Checklist Card */}
      <div className="rounded-3xl bg-[#080d0a] border border-emerald-950/90 p-5 space-y-3.5 shadow-xl">
        <div className="flex items-center justify-between pb-2 border-b border-emerald-950/80">
          <h3 className="text-xs sm:text-sm font-bold text-gray-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Living Milestones & Checkpoints</span>
          </h3>
          <span className="text-xs text-amber-400 font-mono font-bold px-2 py-0.5 rounded-full bg-amber-950/40 border border-amber-500/40">
            {task?.milestones.filter((m) => m.completed).length || 0} /{' '}
            {task?.milestones.length || 0}
          </span>
        </div>

        <div className="space-y-2 pt-1">
          {task?.milestones && task.milestones.length > 0 ? (
            task.milestones.map((m) => (
              <div
                key={m.id}
                onClick={() => hapticLight()}
                className={`flex items-start gap-3 p-3 rounded-2xl border transition-all cursor-pointer ${
                  m.completed
                    ? 'bg-emerald-950/20 border-emerald-700/60 text-emerald-200 shadow-sm'
                    : m.in_progress
                    ? 'bg-amber-950/30 border-amber-500/80 text-amber-100 ring-1 ring-amber-400/50 shadow-md shadow-amber-950/30'
                    : 'bg-[#0b120e] border-emerald-950 text-gray-400 hover:border-emerald-800'
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {m.completed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : m.in_progress ? (
                    <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                  ) : (
                    <Circle className="w-4 h-4 text-emerald-900" />
                  )}
                </div>
                <div className="flex-1 text-xs leading-relaxed font-medium">
                  {m.title}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-xs text-emerald-600/70 font-mono space-y-1">
              <Sparkles className="w-6 h-6 text-emerald-500/40 mx-auto" />
              <p>Awaiting active milestones from Antigravity / Cursor...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
