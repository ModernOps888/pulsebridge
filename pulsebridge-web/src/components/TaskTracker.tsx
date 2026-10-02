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
} from 'lucide-react'
import type { AgentStatus, TaskProgress } from '../types'

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
          color: 'bg-amber-950/70 border-amber-600/80 text-amber-300',
          icon: <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-spin" />,
        }
      case 'runningtool':
        return {
          label: 'Executing Action',
          color: 'bg-emerald-950/70 border-emerald-600/80 text-emerald-300',
          icon: <Terminal className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />,
        }
      case 'waitinginput':
        return {
          label: 'Awaiting User Prompt',
          color: 'bg-yellow-950/70 border-yellow-600/80 text-yellow-300',
          icon: <Activity className="w-3.5 h-3.5 text-yellow-400" />,
        }
      case 'completed':
        return {
          label: 'Goal Achieved',
          color: 'bg-emerald-950/80 border-emerald-500 text-emerald-200',
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

  return (
    <div className="space-y-4 pb-20 p-4">
      {/* Objective Card */}
      <div className="relative overflow-hidden rounded-2xl bg-[#0a0f0c] border border-amber-500/30 p-5 shadow-2xl">
        <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />

        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <span className="text-[11px] font-bold tracking-widest text-amber-400 uppercase flex items-center gap-1.5 font-mono">
              <Layers className="w-3.5 h-3.5 text-emerald-400" />
              Active Objective
            </span>
            <h2 className="text-base font-bold text-gray-100 leading-snug">
              {task?.task_title || 'Monitoring AI IDE session...'}
            </h2>
          </div>

          {/* Stopwatch */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#0d140f] border border-amber-500/40 text-amber-300 font-mono text-xs font-semibold shrink-0 shadow-sm">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>{formatTimer(elapsed)}</span>
          </div>
        </div>

        {/* Current action description */}
        <div className="mt-4 p-3 rounded-xl bg-black/40 border border-emerald-950 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-emerald-200 truncate">
            {statusInfo.icon}
            <span className="truncate">{task?.current_step_desc || 'Listening for IDE commands'}</span>
          </div>
          <span
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${statusInfo.color}`}
          >
            {statusInfo.label}
          </span>
        </div>

        {/* Progress Bar with Gold & Emerald Gradient */}
        <div className="mt-4 space-y-1.5">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-gray-400">Completion</span>
            <span className="font-bold text-amber-400">{task?.percent_complete || 0}%</span>
          </div>
          <div className="h-2 rounded-full bg-emerald-950/60 overflow-hidden border border-emerald-900/40">
            <div
              className="h-full bg-gradient-to-r from-amber-400 via-yellow-500 to-emerald-400 transition-all duration-500 rounded-full shadow-[0_0_10px_rgba(234,179,8,0.5)]"
              style={{ width: `${task?.percent_complete || 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* Living Milestones Checklist */}
      <div className="rounded-2xl bg-[#0a0f0c] border border-emerald-900/50 p-5 space-y-3 shadow-md">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-200 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Milestones & Checkpoints
          </h3>
          <span className="text-xs text-amber-400 font-mono font-semibold">
            {task?.milestones.filter((m) => m.completed).length || 0} /{' '}
            {task?.milestones.length || 0}
          </span>
        </div>

        <div className="space-y-2 pt-1">
          {task?.milestones && task.milestones.length > 0 ? (
            task.milestones.map((m) => (
              <div
                key={m.id}
                className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${
                  m.completed
                    ? 'bg-emerald-950/20 border-emerald-700/50 text-emerald-200'
                    : m.in_progress
                    ? 'bg-amber-950/20 border-amber-600/70 text-amber-200 ring-1 ring-amber-500/40'
                    : 'bg-[#0d140f]/60 border-emerald-950 text-gray-400'
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
            <div className="text-center py-6 text-xs text-emerald-600/70 font-mono">
              Awaiting active milestones from Antigravity / Cursor...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
