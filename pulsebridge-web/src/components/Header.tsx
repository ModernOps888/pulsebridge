import { Lock, Battery, BatteryCharging, AlertOctagon, Sparkles } from 'lucide-react'
import type { IdeSource, SystemTelemetry } from '../types'

interface HeaderProps {
  isConnected: boolean
  activeIde?: IdeSource
  telemetry: SystemTelemetry | null
  onLock: () => void
  onEmergencyStop: () => void
}

export function Header({
  isConnected,
  activeIde = 'antigravity',
  telemetry,
  onLock,
  onEmergencyStop,
}: HeaderProps) {
  const getIdeBadge = (ide: IdeSource) => {
    switch (ide) {
      case 'antigravity':
        return { name: 'Antigravity', color: 'bg-emerald-950/80 text-emerald-300 border-emerald-600/70' }
      case 'cursor':
        return { name: 'Cursor AI', color: 'bg-amber-950/80 text-amber-300 border-amber-600/70' }
      case 'vscode':
      case 'visualstudio':
        return { name: 'VS Code', color: 'bg-yellow-950/80 text-yellow-300 border-yellow-600/70' }
      default:
        return { name: 'IDE Bridge', color: 'bg-emerald-950/60 text-emerald-400 border-emerald-800' }
    }
  }

  const badge = getIdeBadge(activeIde)

  return (
    <header className="sticky top-0 z-40 bg-[#060907]/90 backdrop-blur-md border-b border-emerald-900/50 px-4 py-3 select-none">
      <div className="flex items-center justify-between">
        {/* Left: Status & App */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2.5 w-2.5">
              {isConnected ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]"></span>
                </>
              ) : (
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
              )}
            </span>
            <span className="text-xs font-semibold text-emerald-300 tracking-wide font-mono">
              {isConnected ? 'LIVE' : 'DISCONNECTED'}
            </span>
          </div>

          <span
            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${badge.color} flex items-center gap-1 shadow-sm`}
          >
            <Sparkles className="w-2.5 h-2.5 text-amber-400" />
            {badge.name}
          </span>
        </div>

        {/* Right: Quick actions & telemetry */}
        <div className="flex items-center gap-2">
          {telemetry?.battery_percent !== undefined && (
            <div className="flex items-center gap-1 text-[11px] text-amber-300 bg-[#0d140f] px-2 py-0.5 rounded-md border border-emerald-900/80">
              {telemetry.is_charging ? (
                <BatteryCharging className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Battery className="w-3.5 h-3.5 text-amber-400" />
              )}
              <span className="font-mono font-medium">{telemetry.battery_percent}%</span>
            </div>
          )}

          <button
            onClick={onEmergencyStop}
            title="Emergency Stop"
            className="p-1.5 rounded-lg bg-rose-950/60 active:bg-rose-900 border border-rose-800/50 text-rose-300"
          >
            <AlertOctagon className="w-4 h-4" />
          </button>

          <button
            onClick={onLock}
            title="Lock Session"
            className="p-1.5 rounded-lg bg-[#0d140f] active:bg-amber-950/60 border border-emerald-900/60 text-amber-400 hover:text-amber-300"
          >
            <Lock className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  )
}
