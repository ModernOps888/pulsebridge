import { Lock, Battery, BatteryCharging, AlertOctagon, Sparkles, Volume2, VolumeX, Zap } from 'lucide-react'
import type { IdeSource, SystemTelemetry } from '../types'
import { hapticLight, hapticWarning } from '../utils/haptics'

interface HeaderProps {
  isConnected: boolean
  activeIde?: IdeSource
  telemetry: SystemTelemetry | null
  latencyMs?: number | null
  isSoundEnabled?: boolean
  onToggleSound?: () => void
  onLock: () => void
  onEmergencyStop: () => void
}

export function Header({
  isConnected,
  activeIde = 'antigravity',
  telemetry,
  latencyMs,
  isSoundEnabled = true,
  onToggleSound,
  onLock,
  onEmergencyStop,
}: HeaderProps) {
  const getIdeBadge = (ide: IdeSource) => {
    switch (ide) {
      case 'antigravity':
        return { name: 'Antigravity', color: 'bg-emerald-950/80 text-emerald-300 border-emerald-600/70 shadow-[0_0_10px_rgba(16,185,129,0.2)]' }
      case 'cursor':
        return { name: 'Cursor AI', color: 'bg-amber-950/80 text-amber-300 border-amber-600/70 shadow-[0_0_10px_rgba(251,191,36,0.2)]' }
      case 'vscode':
      case 'visualstudio':
        return { name: 'VS Code', color: 'bg-yellow-950/80 text-yellow-300 border-yellow-600/70 shadow-[0_0_10px_rgba(234,179,8,0.2)]' }
      default:
        return { name: 'IDE Bridge', color: 'bg-emerald-950/60 text-emerald-400 border-emerald-800' }
    }
  }

  const badge = getIdeBadge(activeIde)

  return (
    <header className="sticky top-0 z-40 bg-[#060907]/90 backdrop-blur-2xl border-b border-emerald-950/80 px-3.5 sm:px-4 pt-[max(0.75rem,env(safe-area-inset-top,0px))] pb-2.5 select-none shadow-[0_4px_20px_rgba(0,0,0,0.7)]">
      <div className="flex items-center justify-between">
        {/* Left: Status & App */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#090f0c] border border-emerald-950">
            <span className="relative flex h-2 w-2">
              {isConnected ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,1)]"></span>
                </>
              ) : (
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
              )}
            </span>
            <span className="text-[11px] font-semibold text-emerald-300 tracking-wider font-mono">
              {isConnected ? 'LIVE' : 'OFFLINE'}
            </span>
          </div>

          <span
            className={`text-[10px] sm:text-[11px] font-semibold px-2 py-0.5 rounded-full border ${badge.color} flex items-center gap-1 transition-all`}
          >
            <Sparkles className="w-2.5 h-2.5 text-amber-400 shrink-0" />
            <span>{badge.name}</span>
          </span>
        </div>

        {/* Right: Quick actions & telemetry */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {latencyMs !== null && latencyMs !== undefined && (
            <div
              className="flex items-center gap-1 text-[10px] sm:text-[11px] font-mono px-2 py-0.5 rounded-md border bg-[#0d140f] border-emerald-900/80 text-amber-300 shadow-sm"
              title={`Network RTT Latency: ${latencyMs}ms`}
            >
              <Zap className="w-3 h-3 text-amber-400 shrink-0" />
              <span>{latencyMs}ms</span>
            </div>
          )}

          {onToggleSound && (
            <button
              onClick={() => {
                hapticLight()
                onToggleSound()
              }}
              title={isSoundEnabled ? 'Audio Chimes Enabled' : 'Audio Muted'}
              className={`p-1.5 rounded-lg border transition-all active:scale-95 ${
                isSoundEnabled
                  ? 'bg-amber-950/60 border-amber-600/70 text-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.2)]'
                  : 'bg-[#0d140f] border-emerald-950 text-gray-500'
              }`}
            >
              {isSoundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            </button>
          )}

          {telemetry?.battery_percent !== undefined && (
            <div className="flex items-center gap-1 text-[10px] sm:text-[11px] text-amber-300 bg-[#0d140f] px-2 py-0.5 rounded-md border border-emerald-900/80 font-mono">
              {telemetry.is_charging ? (
                <BatteryCharging className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <Battery className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              )}
              <span className="font-medium">{telemetry.battery_percent}%</span>
            </div>
          )}

          <button
            onClick={() => {
              hapticWarning()
              onEmergencyStop()
            }}
            title="Emergency Stop Workstation Process"
            className="p-1.5 rounded-lg bg-rose-950/60 active:bg-rose-900 border border-rose-800/70 text-rose-300 active:scale-95 transition-all hover:shadow-[0_0_10px_rgba(244,63,94,0.4)]"
          >
            <AlertOctagon className="w-4 h-4 text-rose-400" />
          </button>

          <button
            onClick={() => {
              hapticLight()
              onLock()
            }}
            title="Lock Companion Session"
            className="p-1.5 rounded-lg bg-[#0d140f] active:bg-amber-950/60 border border-emerald-900/60 text-amber-400 hover:text-amber-300 active:scale-95 transition-all hover:shadow-[0_0_10px_rgba(251,191,36,0.3)]"
          >
            <Lock className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  )
}
