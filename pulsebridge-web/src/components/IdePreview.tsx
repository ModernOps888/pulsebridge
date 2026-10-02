import { useState, useEffect, useRef } from 'react'
import {
  Monitor,
  RefreshCw,
  Maximize2,
  ZoomIn,
  ZoomOut,
  Layers,
  Camera,
  Play,
  Pause,
  MousePointer,
  Send,
  Zap,
} from 'lucide-react'
import type { IdeWindowInfo } from '../types'

interface IdePreviewProps {
  windows: IdeWindowInfo[]
  token: string | null
  onRequestSnapshot: (windowId?: number) => void
  latestFrame: string | null
}

export function IdePreview({
  windows,
  token,
  onRequestSnapshot,
  latestFrame,
}: IdePreviewProps) {
  const [selectedWindowId, setSelectedWindowId] = useState<number | undefined>(undefined)
  const [refreshInterval, setRefreshInterval] = useState<number>(3000)
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true)
  const [zoomLevel, setZoomLevel] = useState<number>(1)
  const [loading, setLoading] = useState<boolean>(false)
  const [directImageUrl, setDirectImageUrl] = useState<string>('')
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>('')

  // TeamViewer touch-to-click ripple
  const [clickIndicator, setClickIndicator] = useState<{ x: number; y: number } | null>(null)
  const [quickTypeText, setQuickTypeText] = useState('')
  const [touchMode, setTouchMode] = useState<boolean>(true)
  const imgRef = useRef<HTMLImageElement | null>(null)

  const fetchSnapshot = () => {
    setLoading(true)
    const timestamp = Date.now()
    const winParam = selectedWindowId ? `&window_id=${selectedWindowId}` : ''
    const tokParam = token ? `?token=${encodeURIComponent(token)}` : '?token='
    const url = `/api/preview/frame${tokParam}${winParam}&quality=70&_t=${timestamp}`
    setDirectImageUrl(url)
    setLastRefreshedAt(new Date().toLocaleTimeString())
    onRequestSnapshot(selectedWindowId)
    setTimeout(() => setLoading(false), 250)
  }

  useEffect(() => {
    fetchSnapshot()
    if (!autoRefresh || refreshInterval === 0) return

    const timer = setInterval(() => {
      fetchSnapshot()
    }, refreshInterval)

    return () => clearInterval(timer)
  }, [selectedWindowId, autoRefresh, refreshInterval, token])

  const handleImageClick = async (e: React.PointerEvent<HTMLImageElement>) => {
    if (!touchMode || !imgRef.current) return

    const img = imgRef.current
    const rect = img.getBoundingClientRect()

    const naturalWidth = img.naturalWidth || rect.width
    const naturalHeight = img.naturalHeight || rect.height
    if (naturalWidth === 0 || naturalHeight === 0) return

    const imgAspect = naturalWidth / naturalHeight
    const boxAspect = rect.width / rect.height

    let renderWidth = rect.width
    let renderHeight = rect.height
    let offsetX = 0
    let offsetY = 0

    if (boxAspect > imgAspect) {
      // Pillarboxed (empty padding on left/right)
      renderWidth = rect.height * imgAspect
      offsetX = (rect.width - renderWidth) / 2
    } else {
      // Letterboxed (empty padding on top/bottom)
      renderHeight = rect.width / imgAspect
      offsetY = (rect.height - renderHeight) / 2
    }

    const clickX = e.clientX - rect.left - offsetX
    const clickY = e.clientY - rect.top - offsetY

    // If tap was in empty letterbox margins, ignore
    if (clickX < 0 || clickX > renderWidth || clickY < 0 || clickY > renderHeight) {
      return
    }

    const xRatio = Math.max(0, Math.min(1, clickX / renderWidth))
    const yRatio = Math.max(0, Math.min(1, clickY / renderHeight))

    setClickIndicator({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    setTimeout(() => setClickIndicator(null), 600)

    try {
      await fetch('/api/action/click', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          window_id: selectedWindowId,
          x_ratio: xRatio,
          y_ratio: yRatio,
          is_right: false,
        }),
      })
      setTimeout(fetchSnapshot, 200)
    } catch (err) {
      console.error('Failed to trigger remote click', err)
    }
  }

  const sendHotkey = async (key: string) => {
    try {
      await fetch('/api/action/hotkey', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key }),
      })
      setTimeout(fetchSnapshot, 300)
    } catch (err) {
      console.error('Failed to send hotkey', err)
    }
  }

  const handleQuickType = async () => {
    if (!quickTypeText.trim()) return
    try {
      await fetch('/api/action/remote_prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: quickTypeText.trim(),
          action_mode: 'inject_window',
        }),
      })
      setQuickTypeText('')
      setTimeout(fetchSnapshot, 500)
    } catch (err) {
      console.error('Failed to type text', err)
    }
  }

  const selectedWindow = windows.find((w) => w.hwnd === selectedWindowId)

  return (
    <div className="space-y-4 pb-28 p-4 max-w-2xl mx-auto select-none">
      {/* TeamViewer Header Card */}
      <div className="rounded-2xl bg-[#0a0f0c] border border-amber-500/30 p-4 space-y-3 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Monitor className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-amber-200">Remote IDE Control (TeamViewer Mode)</h3>
              <p className="text-[10px] text-emerald-400/80 font-mono">
                {lastRefreshedAt ? `Last frame: ${lastRefreshedAt}` : 'Capturing live preview...'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setTouchMode(!touchMode)}
              className={`p-2 rounded-xl text-xs font-semibold border flex items-center gap-1 transition-all ${
                touchMode
                  ? 'bg-amber-950/80 border-amber-500 text-amber-300'
                  : 'bg-[#0d140f] border-emerald-950 text-emerald-600'
              }`}
              title="Toggle Tap-to-Click"
            >
              <MousePointer className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[10px]">{touchMode ? 'Touch On' : 'Touch Off'}</span>
            </button>

            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`p-2 rounded-xl text-xs font-semibold border flex items-center gap-1 transition-all ${
                autoRefresh
                  ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                  : 'bg-[#0d140f] border-emerald-950 text-gray-500'
              }`}
            >
              {autoRefresh ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span className="text-[10px]">{autoRefresh ? 'Live' : 'Paused'}</span>
            </button>

            <button
              onClick={fetchSnapshot}
              disabled={loading}
              className="p-2 rounded-xl bg-gradient-to-tr from-amber-600 to-yellow-500 active:from-amber-500 active:to-yellow-400 text-black font-bold border border-amber-300/40 shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Window Selector & Refresh Rates */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <div className="space-y-1">
            <label className="text-[10px] text-amber-400/90 font-medium">Target Screen / Window</label>
            <select
              value={selectedWindowId ?? ''}
              onChange={(e) =>
                setSelectedWindowId(e.target.value ? Number(e.target.value) : undefined)
              }
              className="w-full bg-[#0d140f] border border-emerald-900/80 rounded-xl px-3 py-2 text-xs text-emerald-100 focus:outline-none focus:border-amber-400"
            >
              <option value="">Full Desktop Screen (Primary Display)</option>
              {windows.map((w) => (
                <option key={w.hwnd} value={w.hwnd}>
                  [{w.ide.toUpperCase()}] {w.title.slice(0, 36)}...
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-amber-400/90 font-medium">Auto-Refresh Rate</label>
            <div className="flex gap-1.5">
              {[
                { label: '1s Fast', ms: 1000 },
                { label: '3s Normal', ms: 3000 },
                { label: '5s Eco', ms: 5000 },
              ].map((rate) => (
                <button
                  key={rate.ms}
                  onClick={() => {
                    setRefreshInterval(rate.ms)
                    setAutoRefresh(true)
                  }}
                  className={`flex-1 py-1.5 text-[10px] font-bold rounded-xl border transition-all ${
                    refreshInterval === rate.ms && autoRefresh
                      ? 'bg-amber-950/90 border-amber-500 text-amber-300'
                      : 'bg-[#0d140f] border-emerald-950 text-emerald-600 hover:text-emerald-300'
                  }`}
                >
                  {rate.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Screen Frame Viewport with Tap-to-Click */}
      <div className="relative rounded-2xl bg-black border border-emerald-950 overflow-hidden shadow-2xl min-h-[220px] flex items-center justify-center">
        {latestFrame || directImageUrl ? (
          <div className="relative w-full overflow-auto max-h-[70vh] flex items-center justify-center p-1">
            <div className="relative inline-block">
              <img
                ref={imgRef}
                src={latestFrame || directImageUrl || ''}
                alt="Remote IDE Live Screen"
                onPointerDown={handleImageClick}
                className={`max-w-full h-auto rounded-lg object-contain transition-transform duration-200 shadow-md ${
                  touchMode ? 'cursor-crosshair touch-none' : 'cursor-default'
                }`}
                style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top center' }}
              />

              {/* Click Indicator Ripple in Radiant Gold */}
              {clickIndicator && (
                <div
                  className="absolute w-7 h-7 rounded-full border-2 border-amber-400 bg-amber-400/50 -translate-x-1/2 -translate-y-1/2 animate-ping pointer-events-none z-20"
                  style={{ left: `${clickIndicator.x}px`, top: `${clickIndicator.y}px` }}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="text-center p-8 text-xs text-emerald-600/70 space-y-2 font-mono">
            <Camera className="w-8 h-8 text-emerald-500 mx-auto animate-pulse" />
            <p>Streaming IDE workspace canvas...</p>
          </div>
        )}

        {/* Floating Zoom Controls */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-[#060907]/80 backdrop-blur-md p-1.5 rounded-xl border border-emerald-900/60 shadow-lg">
          <button
            onClick={() => setZoomLevel((z) => Math.max(0.75, z - 0.25))}
            className="p-1.5 rounded-lg bg-[#0d140f] hover:bg-emerald-950 text-emerald-300"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] font-mono text-amber-300 px-1 font-bold">
            {Math.round(zoomLevel * 100)}%
          </span>
          <button
            onClick={() => setZoomLevel((z) => Math.min(2.5, z + 0.25))}
            className="p-1.5 rounded-lg bg-[#0d140f] hover:bg-emerald-950 text-emerald-300"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setZoomLevel(1)}
            className="p-1.5 rounded-lg bg-[#0d140f] hover:bg-emerald-950 text-amber-400"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {selectedWindow && (
          <div className="absolute top-3 left-3 bg-[#060907]/80 backdrop-blur-md px-2.5 py-1 rounded-xl border border-emerald-900/60 text-[10px] text-amber-300 font-mono truncate max-w-[70%]">
            {selectedWindow.title}
          </div>
        )}
      </div>

      {/* TeamViewer Virtual IDE Hotkeys Bar */}
      <div className="rounded-2xl bg-[#0a0f0c] border border-amber-500/30 p-3 space-y-2 shadow-md">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1">
            <Zap className="w-3.5 h-3.5 text-amber-400" /> Remote IDE Hotkeys
          </span>
          <span className="text-[10px] text-emerald-400/80 font-mono">1-Tap Win32 Injection</span>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
          {[
            { label: 'Ctrl+L', id: 'ctrl_l', hint: 'Composer / Chat' },
            { label: 'Ctrl+K', id: 'ctrl_k', hint: 'Inline Edit' },
            { label: 'Ctrl+`', id: 'ctrl_tilde', hint: 'Terminal' },
            { label: 'Ctrl+S', id: 'ctrl_s', hint: 'Save All' },
            { label: 'Ctrl+C', id: 'ctrl_c', hint: 'Break / Abort' },
            { label: 'Esc', id: 'esc', hint: 'Close Dialog' },
            { label: 'Enter', id: 'enter', hint: 'Confirm' },
            { label: 'F5', id: 'f5', hint: 'Debug / Run' },
          ].map((key) => (
            <button
              key={key.id}
              onClick={() => sendHotkey(key.id)}
              className="py-2 px-1 rounded-xl bg-[#0d140f] border border-emerald-950 hover:border-amber-400 text-emerald-200 active:bg-amber-600 active:text-black transition-all text-center flex flex-col items-center justify-center hover:scale-[1.02]"
            >
              <span className="text-[11px] font-mono font-bold text-amber-400">{key.label}</span>
              <span className="text-[8px] text-emerald-500/80 truncate max-w-full">{key.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Remote Quick Type Input */}
      <div className="rounded-2xl bg-[#0a0f0c] border border-emerald-900/60 p-3 flex items-center gap-2">
        <input
          type="text"
          value={quickTypeText}
          onChange={(e) => setQuickTypeText(e.target.value)}
          placeholder="Type or paste text directly into remote IDE..."
          className="flex-1 bg-[#0d140f] border border-emerald-900/80 rounded-xl px-3 py-2 text-xs text-amber-100 placeholder-emerald-600/60 focus:outline-none focus:border-amber-400 font-mono"
          onKeyDown={(e) => e.key === 'Enter' && handleQuickType()}
        />
        <button
          onClick={handleQuickType}
          disabled={!quickTypeText.trim()}
          className="py-2 px-3 rounded-xl bg-gradient-to-r from-amber-600 to-yellow-500 disabled:opacity-40 text-black text-xs font-bold flex items-center gap-1.5"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Type</span>
        </button>
      </div>

      {/* Discovered Windows List */}
      <div className="rounded-2xl bg-[#0a0f0c] border border-emerald-950 p-4 space-y-2">
        <h4 className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-amber-400" />
          Discovered Open IDE Windows ({windows.length})
        </h4>
        <div className="space-y-1.5">
          {windows.map((win) => (
            <div
              key={win.hwnd}
              onClick={() => setSelectedWindowId(win.hwnd)}
              className={`p-2.5 rounded-xl border cursor-pointer flex items-center justify-between text-xs transition-all ${
                selectedWindowId === win.hwnd
                  ? 'bg-amber-950/40 border-amber-500 text-amber-200'
                  : 'bg-[#0d140f]/60 border-emerald-950 hover:border-emerald-800 text-emerald-200'
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                <span
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                    win.ide === 'cursor'
                      ? 'bg-amber-950 border-amber-700 text-amber-300'
                      : win.ide === 'antigravity'
                      ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                      : 'bg-yellow-950 border-yellow-700 text-yellow-300'
                  }`}
                >
                  {win.ide}
                </span>
                <span className="truncate font-medium">{win.title}</span>
              </div>
              <span className="text-[10px] text-emerald-600 font-mono shrink-0">
                {win.width}x{win.height}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
