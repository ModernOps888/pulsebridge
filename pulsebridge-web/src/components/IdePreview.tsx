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
  Hand,
  Send,
  Zap,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ChevronUp,
  ChevronDown,
  ChevronsUp,
  ChevronsDown,
  Compass,
} from 'lucide-react'
import type { IdeWindowInfo } from '../types'

interface IdePreviewProps {
  windows: IdeWindowInfo[]
  token: string | null
  onRequestSnapshot: (windowId?: number) => void
  latestFrame: string | null
  onScroll?: (delta: number, xRatio?: number, yRatio?: number, windowId?: number) => void
  onHotkey?: (key: string) => void
}

export function IdePreview({
  windows,
  token,
  onRequestSnapshot,
  latestFrame,
  onScroll,
  onHotkey,
}: IdePreviewProps) {
  const [selectedWindowId, setSelectedWindowId] = useState<number | undefined>(undefined)
  const [refreshInterval, setRefreshInterval] = useState<number>(3000)
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true)
  const [zoomLevel, setZoomLevel] = useState<number>(1)
  const [streamQuality, setStreamQuality] = useState<number>(70)
  const [loading, setLoading] = useState<boolean>(false)
  const [directImageUrl, setDirectImageUrl] = useState<string>('')
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>('')

  // Interaction Mode: 'click' = Tap to trigger remote click; 'pan' = Touch-drag to scroll canvas (useful at 150%+)
  const [interactionMode, setInteractionMode] = useState<'click' | 'pan'>('click')
  const [scrollSpeedMultiplier, setScrollSpeedMultiplier] = useState<number>(1) // 1x = 120, 3x = 360

  // Touch-to-click ripple
  const [clickIndicator, setClickIndicator] = useState<{ x: number; y: number } | null>(null)
  const [quickTypeText, setQuickTypeText] = useState('')

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  // Drag-to-pan tracking state
  const isDraggingRef = useRef<boolean>(false)
  const dragStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number }>({
    x: 0,
    y: 0,
    scrollLeft: 0,
    scrollTop: 0,
  })

  const fetchSnapshot = () => {
    setLoading(true)
    const timestamp = Date.now()
    const winParam = selectedWindowId ? `&window_id=${selectedWindowId}` : ''
    const tokParam = token ? `?token=${encodeURIComponent(token)}` : '?token='
    const url = `/api/preview/frame${tokParam}${winParam}&quality=${streamQuality}&_t=${timestamp}`
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
  }, [selectedWindowId, autoRefresh, refreshInterval, streamQuality, token])

  // Remote click handler
  const handleImageClick = async (e: React.PointerEvent<HTMLImageElement>) => {
    if (interactionMode !== 'click' || !imgRef.current) return

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
      renderWidth = rect.height * imgAspect
      offsetX = (rect.width - renderWidth) / 2
    } else {
      renderHeight = rect.width / imgAspect
      offsetY = (rect.height - renderHeight) / 2
    }

    const clickX = e.clientX - rect.left - offsetX
    const clickY = e.clientY - rect.top - offsetY

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
      setTimeout(fetchSnapshot, 250)
    } catch (err) {
      console.error('Failed to trigger remote click', err)
    }
  }

  // Pointer drag panning (for smooth scrolling at 150%+)
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (interactionMode !== 'pan' || !viewportRef.current) return
    isDraggingRef.current = true
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: viewportRef.current.scrollLeft,
      scrollTop: viewportRef.current.scrollTop,
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch (_) {}
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !viewportRef.current) return
    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y
    viewportRef.current.scrollLeft = dragStartRef.current.scrollLeft - dx
    viewportRef.current.scrollTop = dragStartRef.current.scrollTop - dy
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch (_) {}
    }
  }

  // Directional Nudge pan (scrolls zoomed view by 160px)
  const nudgeScroll = (dirX: number, dirY: number) => {
    if (viewportRef.current) {
      viewportRef.current.scrollBy({
        left: dirX * 160,
        top: dirY * 160,
        behavior: 'smooth',
      })
    }
  }

  // Center scroll container
  const centerViewport = () => {
    if (viewportRef.current) {
      const el = viewportRef.current
      el.scrollTo({
        left: (el.scrollWidth - el.clientWidth) / 2,
        top: (el.scrollHeight - el.clientHeight) / 2,
        behavior: 'smooth',
      })
    }
  }

  // Remote IDE Scroll Trigger (Win32 simulate_scroll)
  const triggerRemoteScroll = async (deltaBase: number) => {
    const delta = deltaBase * scrollSpeedMultiplier
    if (onScroll) {
      onScroll(delta, undefined, undefined, selectedWindowId)
    } else {
      try {
        await fetch('/api/action/scroll', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            delta,
            window_id: selectedWindowId,
          }),
        })
      } catch (err) {
        console.error('Failed to send remote scroll', err)
      }
    }
    setTimeout(fetchSnapshot, 300)
  }

  // Mouse wheel listener over preview image
  const handleWheel = (e: React.WheelEvent) => {
    if (interactionMode === 'click') {
      const delta = e.deltaY < 0 ? 120 : -120
      triggerRemoteScroll(delta)
    }
  }

  // Send hotkey
  const sendHotkey = async (key: string) => {
    if (onHotkey) {
      onHotkey(key)
    } else {
      try {
        await fetch('/api/action/hotkey', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ key }),
        })
      } catch (err) {
        console.error('Failed to send hotkey', err)
      }
    }
    setTimeout(fetchSnapshot, 300)
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
              <h3 className="text-xs font-bold text-amber-200">Remote IDE Control (Precision View)</h3>
              <p className="text-[10px] text-emerald-400/80 font-mono">
                {lastRefreshedAt ? `Last frame: ${lastRefreshedAt}` : 'Capturing live preview...'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Interaction Mode Toggle */}
            <button
              onClick={() => setInteractionMode(interactionMode === 'click' ? 'pan' : 'click')}
              className={`p-2 rounded-xl text-xs font-semibold border flex items-center gap-1 transition-all ${
                interactionMode === 'click'
                  ? 'bg-amber-950/80 border-amber-500 text-amber-300'
                  : 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
              }`}
              title={interactionMode === 'click' ? 'Click Mode: Tap sends click' : 'Pan Mode: Drag scrolls zoomed canvas'}
            >
              {interactionMode === 'click' ? (
                <>
                  <MousePointer className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-[10px] hidden sm:inline">Tap Click</span>
                </>
              ) : (
                <>
                  <Hand className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-[10px] hidden sm:inline">Pan Canvas</span>
                </>
              )}
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
              title="Refresh Frame"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Window Selector, Refresh Rates & Stream Quality */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
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

          <div className="space-y-1">
            <label className="text-[10px] text-amber-400/90 font-medium">Stream Quality</label>
            <div className="flex gap-1.5">
              {[
                { label: 'Eco 40%', q: 40 },
                { label: 'Normal 70%', q: 70 },
                { label: 'Retina 90%', q: 90 },
              ].map((item) => (
                <button
                  key={item.q}
                  onClick={() => setStreamQuality(item.q)}
                  className={`flex-1 py-1.5 text-[10px] font-bold rounded-xl border transition-all ${
                    streamQuality === item.q
                      ? 'bg-amber-950/90 border-amber-500 text-amber-300'
                      : 'bg-[#0d140f] border-emerald-950 text-emerald-600 hover:text-emerald-300'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Screen Frame Viewport with High-Visibility Gilded Scrollbars */}
      <div className="relative rounded-2xl bg-black border border-emerald-950 overflow-hidden shadow-2xl min-h-[240px]">
        {latestFrame || directImageUrl ? (
          <div
            ref={viewportRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onWheel={handleWheel}
            className={`viewport-zoom-scroll relative w-full overflow-auto max-h-[72vh] p-2 flex items-center justify-center ${
              interactionMode === 'pan' ? 'cursor-grab active:cursor-grabbing touch-none' : ''
            }`}
          >
            <div
              className="relative inline-block transition-all duration-200"
              style={{
                width: zoomLevel > 1 ? `${zoomLevel * 100}%` : '100%',
                minWidth: zoomLevel > 1 ? `${zoomLevel * 100}%` : 'auto',
              }}
            >
              <img
                ref={imgRef}
                src={latestFrame || directImageUrl || ''}
                alt="Remote IDE Live Screen"
                onPointerDown={handleImageClick}
                className={`w-full h-auto rounded-lg object-contain shadow-md ${
                  interactionMode === 'click' ? 'cursor-crosshair' : 'cursor-grab pointer-events-none'
                }`}
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
          <div className="text-center p-8 text-xs text-emerald-600/70 space-y-2 font-mono flex flex-col items-center justify-center min-h-[220px]">
            <Camera className="w-8 h-8 text-emerald-500 mx-auto animate-pulse" />
            <p>Streaming IDE workspace canvas...</p>
          </div>
        )}

        {/* Floating Zoom & Preset Bar */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-[#060907]/90 backdrop-blur-md p-1.5 rounded-xl border border-emerald-900/70 shadow-2xl z-30">
          <button
            onClick={() => setZoomLevel((z) => Math.max(0.75, Number((z - 0.25).toFixed(2))))}
            className="p-1.5 rounded-lg bg-[#0d140f] hover:bg-emerald-950 text-emerald-300"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          {/* Quick Preset Buttons for 100%, 150%, 200% */}
          {[1, 1.25, 1.5, 2].map((lvl) => (
            <button
              key={lvl}
              onClick={() => setZoomLevel(lvl)}
              className={`px-1.5 py-1 rounded-lg text-[9px] font-mono font-bold transition-all ${
                zoomLevel === lvl
                  ? 'bg-amber-950 border border-amber-500 text-amber-300'
                  : 'bg-[#0d140f] text-emerald-500 hover:text-emerald-300'
              }`}
            >
              {Math.round(lvl * 100)}%
            </button>
          ))}

          <button
            onClick={() => setZoomLevel((z) => Math.min(2.5, Number((z + 0.25).toFixed(2))))}
            className="p-1.5 rounded-lg bg-[#0d140f] hover:bg-emerald-950 text-emerald-300"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => {
              setZoomLevel(1)
              centerViewport()
            }}
            className="p-1.5 rounded-lg bg-[#0d140f] hover:bg-emerald-950 text-amber-400"
            title="Reset to Fit"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Directional Nudge Pad (Appears when zoomed in > 100% to pan easily on high-res displays) */}
        {zoomLevel > 1 && (
          <div className="absolute top-3 right-3 bg-[#060907]/90 backdrop-blur-md p-1.5 rounded-xl border border-amber-500/40 shadow-xl z-30 flex flex-col items-center gap-1">
            <span className="text-[8px] font-mono font-bold text-amber-400 uppercase">Pan D-Pad</span>
            <div className="grid grid-cols-3 gap-1">
              <div />
              <button
                onClick={() => nudgeScroll(0, -1)}
                className="p-1 rounded bg-[#0d140f] hover:bg-amber-950 text-amber-300 flex items-center justify-center"
                title="Scroll Up"
              >
                <ArrowUp className="w-3 h-3" />
              </button>
              <div />

              <button
                onClick={() => nudgeScroll(-1, 0)}
                className="p-1 rounded bg-[#0d140f] hover:bg-amber-950 text-amber-300 flex items-center justify-center"
                title="Scroll Left"
              >
                <ArrowLeft className="w-3 h-3" />
              </button>
              <button
                onClick={centerViewport}
                className="p-1 rounded bg-[#0d140f] hover:bg-amber-950 text-amber-400 flex items-center justify-center"
                title="Center View"
              >
                <Compass className="w-3 h-3" />
              </button>
              <button
                onClick={() => nudgeScroll(1, 0)}
                className="p-1 rounded bg-[#0d140f] hover:bg-amber-950 text-amber-300 flex items-center justify-center"
                title="Scroll Right"
              >
                <ArrowRight className="w-3 h-3" />
              </button>

              <div />
              <button
                onClick={() => nudgeScroll(0, 1)}
                className="p-1 rounded bg-[#0d140f] hover:bg-amber-950 text-amber-300 flex items-center justify-center"
                title="Scroll Down"
              >
                <ArrowDown className="w-3 h-3" />
              </button>
              <div />
            </div>
          </div>
        )}

        {selectedWindow && (
          <div className="absolute top-3 left-3 bg-[#060907]/80 backdrop-blur-md px-2.5 py-1 rounded-xl border border-emerald-900/60 text-[10px] text-amber-300 font-mono truncate max-w-[60%] z-20">
            {selectedWindow.title}
          </div>
        )}
      </div>

      {/* Remote IDE Mouse Wheel Scroll Bar */}
      <div className="rounded-2xl bg-[#0a0f0c] border border-emerald-900/60 p-3 space-y-2 shadow-md">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-emerald-300 flex items-center gap-1.5">
            <ChevronUp className="w-3.5 h-3.5 text-amber-400" />
            Remote IDE Mouse Scroll (Win32 Wheel)
          </span>
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-gray-400 font-mono">Speed:</span>
            {[
              { label: '1x (120px)', val: 1 },
              { label: '3x (360px)', val: 3 },
            ].map((s) => (
              <button
                key={s.val}
                onClick={() => setScrollSpeedMultiplier(s.val)}
                className={`px-1.5 py-0.5 rounded-md font-mono font-bold border transition-all ${
                  scrollSpeedMultiplier === s.val
                    ? 'bg-amber-950 border-amber-500 text-amber-300'
                    : 'bg-[#0d140f] border-emerald-950 text-emerald-600'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <button
            onClick={() => triggerRemoteScroll(120)}
            className="py-2 rounded-xl bg-[#0d140f] border border-emerald-950 hover:border-amber-400 text-emerald-200 active:bg-amber-600 active:text-black transition-all flex items-center justify-center gap-1"
          >
            <ChevronUp className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[10px] font-bold">Scroll Up</span>
          </button>

          <button
            onClick={() => triggerRemoteScroll(-120)}
            className="py-2 rounded-xl bg-[#0d140f] border border-emerald-950 hover:border-amber-400 text-emerald-200 active:bg-amber-600 active:text-black transition-all flex items-center justify-center gap-1"
          >
            <ChevronDown className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[10px] font-bold">Scroll Down</span>
          </button>

          <button
            onClick={() => sendHotkey('pageup')}
            className="py-2 rounded-xl bg-[#0d140f] border border-emerald-950 hover:border-amber-400 text-emerald-200 active:bg-amber-600 active:text-black transition-all flex items-center justify-center gap-1"
          >
            <ChevronsUp className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[10px] font-bold">Page Up</span>
          </button>

          <button
            onClick={() => sendHotkey('pagedown')}
            className="py-2 rounded-xl bg-[#0d140f] border border-emerald-950 hover:border-amber-400 text-emerald-200 active:bg-amber-600 active:text-black transition-all flex items-center justify-center gap-1"
          >
            <ChevronsDown className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[10px] font-bold">Page Down</span>
          </button>
        </div>
      </div>

      {/* Expanded Dev Keyboard Bar */}
      <div className="rounded-2xl bg-[#0a0f0c] border border-amber-500/30 p-3 space-y-2 shadow-md">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1">
            <Zap className="w-3.5 h-3.5 text-amber-400" /> Remote IDE Hotkeys & Navigation
          </span>
          <span className="text-[10px] text-emerald-400/80 font-mono">1-Tap Win32 Injection</span>
        </div>

        {/* Primary Shortcuts */}
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
          {[
            { label: 'Ctrl+Z', id: 'ctrl_z', hint: 'Undo' },
            { label: 'Ctrl+Y', id: 'ctrl_y', hint: 'Redo' },
            { label: 'Ctrl+S', id: 'ctrl_s', hint: 'Save All' },
            { label: 'Ctrl+A', id: 'ctrl_a', hint: 'Select All' },
            { label: 'Tab', id: 'tab', hint: 'Indent / Next' },
            { label: 'Esc', id: 'esc', hint: 'Dismiss' },
            { label: 'Enter', id: 'enter', hint: 'Confirm' },
            { label: 'Ctrl+C', id: 'ctrl_c', hint: 'Abort / Break' },
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

        {/* Secondary Shortcuts & Arrow Keys */}
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5 pt-1 border-t border-emerald-950/80">
          {[
            { label: 'Ctrl+L', id: 'ctrl_l', hint: 'Composer / Chat' },
            { label: 'Ctrl+K', id: 'ctrl_k', hint: 'Inline Edit' },
            { label: 'Ctrl+`', id: 'ctrl_tilde', hint: 'Terminal' },
            { label: 'F5', id: 'f5', hint: 'Debug / Run' },
            { label: '▲ Up', id: 'up', hint: 'Cursor Up' },
            { label: '▼ Down', id: 'down', hint: 'Cursor Down' },
            { label: '◄ Left', id: 'left', hint: 'Cursor Left' },
            { label: '► Right', id: 'right', hint: 'Cursor Right' },
          ].map((key) => (
            <button
              key={key.id}
              onClick={() => sendHotkey(key.id)}
              className="py-2 px-1 rounded-xl bg-[#0d140f] border border-emerald-950 hover:border-amber-400 text-emerald-200 active:bg-amber-600 active:text-black transition-all text-center flex flex-col items-center justify-center hover:scale-[1.02]"
            >
              <span className="text-[11px] font-mono font-bold text-emerald-300">{key.label}</span>
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
