import { useState } from 'react'
import { usePulseBridge } from './hooks/usePulseBridge'
import { PinLockScreen } from './components/PinLockScreen'
import { Header } from './components/Header'
import { TaskTracker } from './components/TaskTracker'
import { ChatStream } from './components/ChatStream'
import { IdePreview } from './components/IdePreview'
import { RemoteControlDrawer } from './components/RemoteControlDrawer'
import { SystemTelemetry } from './components/SystemTelemetry'
import { BottomNav, type NavTab } from './components/BottomNav'
import { X, Bell } from 'lucide-react'

export function App() {
  const {
    isAuthenticated,
    isConnected,
    authError,
    token,
    task,
    chatSteps,
    projects,
    refreshProjects,
    telemetry,
    windows,
    latestFrame,
    alerts,
    latencyMs,
    isSoundEnabled,
    toggleSound,
    notificationPermission,
    requestNotificationPermission,
    fetchWorkstationClipboard,
    sendToWorkstationClipboard,
    loginWithPin,
    logout,
    sendPrompt,
    sendScroll,
    sendHotkey,
    requestSnapshot,
    emergencyStop,
    dismissAlert,
  } = usePulseBridge()

  const [activeTab, setActiveTab] = useState<NavTab>('tracker')
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3500)
  }

  // If not yet authenticated with PIN / token, show the lock screen
  if (!isAuthenticated) {
    return <PinLockScreen onUnlock={loginWithPin} error={authError} />
  }

  return (
    <div className="min-h-screen bg-[#060907] text-gray-100 flex flex-col font-sans">
      {/* Top Header */}
      <Header
        isConnected={isConnected}
        activeIde={task?.active_ide}
        telemetry={telemetry}
        latencyMs={latencyMs}
        isSoundEnabled={isSoundEnabled}
        onToggleSound={toggleSound}
        onLock={logout}
        onEmergencyStop={emergencyStop}
      />

      {/* Floating System Alerts & Toasts */}
      <div className="fixed top-14 left-0 right-0 z-50 px-4 space-y-2 pointer-events-none max-w-md mx-auto">
        {toastMessage && (
          <div className="pointer-events-auto bg-sky-900/90 backdrop-blur-md border border-sky-500/60 p-3 rounded-2xl shadow-xl flex items-center justify-between text-xs text-sky-100 animate-slideDown">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-sky-300 shrink-0" />
              <span className="font-semibold">{toastMessage}</span>
            </div>
          </div>
        )}

        {alerts.slice(0, 2).map((alert) => (
          <div
            key={alert.id}
            className={`pointer-events-auto p-3 rounded-2xl shadow-xl border flex items-start justify-between text-xs backdrop-blur-md animate-slideDown ${
              alert.level === 'warning' || alert.level === 'error'
                ? 'bg-rose-950/90 border-rose-700/80 text-rose-200'
                : 'bg-[#101524]/95 border-gray-700 text-gray-200'
            }`}
          >
            <div className="space-y-0.5 pr-2">
              <div className="font-bold">{alert.title}</div>
              <div className="text-[11px] opacity-90">{alert.message}</div>
            </div>
            <button
              onClick={() => dismissAlert(alert.id)}
              className="p-1 rounded-lg hover:bg-white/10 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Main Tab View */}
      <main className={`flex-1 w-full mx-auto transition-all ${activeTab === 'preview' || activeTab === 'chat' ? 'max-w-5xl px-2 sm:px-4' : 'max-w-lg'}`}>
        {activeTab === 'tracker' && <TaskTracker task={task} />}
        {activeTab === 'chat' && (
          <ChatStream
            steps={chatSteps}
            projects={projects}
            onSendPrompt={sendPrompt}
            onRefreshProjects={refreshProjects}
          />
        )}
        {activeTab === 'commander' && (
          <RemoteControlDrawer
            token={token}
            activeIde={task?.active_ide}
            onAlert={showToast}
            notificationPermission={notificationPermission}
            onRequestNotificationPermission={requestNotificationPermission}
            onFetchClipboard={fetchWorkstationClipboard}
            onSendClipboard={sendToWorkstationClipboard}
          />
        )}
        {activeTab === 'preview' && (
          <IdePreview
            windows={windows}
            token={token}
            onRequestSnapshot={requestSnapshot}
            latestFrame={latestFrame}
            onScroll={sendScroll}
            onHotkey={sendHotkey}
          />
        )}
        {activeTab === 'system' && <SystemTelemetry telemetry={telemetry} token={token} />}
      </main>

      {/* Mobile Bottom Navigation */}
      <BottomNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        unreadStepsCount={0}
      />
    </div>
  )
}

export default App

