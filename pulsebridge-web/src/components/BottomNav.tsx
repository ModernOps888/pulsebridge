import { Layers, MessageSquare, Zap, Monitor, Cpu } from 'lucide-react'
import { hapticLight } from '../utils/haptics'

export type NavTab = 'tracker' | 'chat' | 'commander' | 'preview' | 'system'

interface BottomNavProps {
  activeTab: NavTab
  onTabChange: (tab: NavTab) => void
  unreadStepsCount?: number
}

export function BottomNav({
  activeTab,
  onTabChange,
  unreadStepsCount = 0,
}: BottomNavProps) {
  const tabs = [
    { id: 'tracker' as NavTab, label: 'Tracker', icon: Layers },
    { id: 'chat' as NavTab, label: 'Chat', icon: MessageSquare, badge: unreadStepsCount },
    { id: 'commander' as NavTab, label: 'Command', icon: Zap, highlight: true },
    { id: 'preview' as NavTab, label: 'IDE View', icon: Monitor },
    { id: 'system' as NavTab, label: 'System', icon: Cpu },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[#060907]/90 backdrop-blur-2xl border-t border-emerald-950/80 px-1.5 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom,0px))] select-none max-w-lg mx-auto shadow-[0_-8px_25px_rgba(0,0,0,0.8)]">
      <div className="flex items-center justify-between gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id

          return (
            <button
              key={tab.id}
              onClick={() => {
                hapticLight()
                onTabChange(tab.id)
              }}
              className={`flex-1 min-w-0 relative flex flex-col items-center justify-center py-1.5 px-1 rounded-2xl transition-all duration-200 touch-manipulation group ${
                isActive
                  ? 'text-amber-400 font-bold'
                  : 'text-emerald-600/70 hover:text-emerald-300 active:scale-95'
              }`}
            >
              {tab.highlight && isActive ? (
                <div className="p-1 rounded-xl bg-gradient-to-tr from-amber-500/20 to-emerald-500/20 text-amber-400 border border-amber-400/50 shadow-[0_0_12px_rgba(251,191,36,0.3)]">
                  <Icon className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
                </div>
              ) : (
                <div className="relative p-0.5">
                  <Icon className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
                  {tab.badge && tab.badge > 0 ? (
                    <span className="absolute -top-1 -right-1 bg-amber-400 text-black text-[9px] font-bold px-1 rounded-full z-10 leading-tight shadow-sm">
                      {tab.badge}
                    </span>
                  ) : null}
                </div>
              )}
              <span className="text-[10px] mt-0.5 tracking-tight font-medium font-mono truncate max-w-full text-center">
                {tab.label}
              </span>
              {isActive && !tab.highlight && (
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-0.5 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
