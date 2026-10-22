import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Monitor,
  RefreshCw,
  Maximize2,
  Minimize2,
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
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUp,
  ChevronsDown,
  Compass,
  Crosshair,
} from 'lucide-react'
import type { IdeWindowInfo } from '../types'

interface IdePreviewProps {
  windows: IdeWindowInfo[]
  token: string | null
  onRequestSnapshot: (windowId?: number, quality?: number) => void
  onRefreshWindows?: () => void
  latestFrame: string | null
  onScroll?: (delta: number, xRatio?: number, yRatio?: number, windowId?: number) => void
  onHotkey?: (key: string, windowId?: number | null) => void
  onTypeText?: (text: string, windowId?: number | null, pressEnter?: boolean) => Promise<boolean>
}

export function IdePreview({
  windows,
  token,
  onRequestSnapshot,
  onRefreshWindows,
  latestFrame,
  onScroll,
  onHotkey,
  onTypeText,
}: IdePreviewProps) {
  const [selectedWindowId, setSelectedWindowId] = useState<number | undefined>(undefined)
  const [refreshInterval, setRefreshInterval] = useState<number>(3000)
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true)
  const [zoomLevel, setZoomLevel] = useState<number>(1)
  const [streamQuality, setStreamQuality] = useState<number>(70)
  const [loading, setLoading] = useState<boolean>(false)
  const [directImageUrl, setDirectImageUrl] = useState<string>('')
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>('')

  // Interaction Mode: 'click' = Tap to trigger remote click; 'pan' = Touch-drag to scroll canvas
  const [interactionMode, setInteractionMode] = useState<'click' | 'pan'>('click')
  const [clickType, setClickType] = useState<'left' | 'double' | 'right'>('left')
  const [scrollSpeedMultiplier, setScrollSpeedMultiplier] = useState<number>(1) // 1x = 120, 3x = 360

  // Fullscreen / Theater Mode
  const [theaterMode, setTheaterMode] = useState<boolean>(false)
  // Mini-map radar overlay visibility
  const [showMinimap, setShowMinimap] = useState<boolean>(true)

  // Touch-to-click ripple, touch-drag remote scroll indicator & action feedback toast
  const [clickIndicator, setClickIndicator] = useState<{ x: number; y: number } | null>(null)
  const [scrollIndicator, setScrollIndicator] = useState<{ dir: 'up' | 'down' } | null>(null)
  const [actionToast, setActionToast] = useState<string | null>(null)
  const scrollIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const actionToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [quickTypeText, setQuickTypeText] = useState('')
  const [customHotkey, setCustomHotkey] = useState('')
  const [autoEnterOnType, setAutoEnterOnType] = useState<boolean>(true)

  const showFeedback = useCallback((msg: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(14)
      }
    } catch (_) {}
    setActionToast(msg)
    if (actionToastTimerRef.current) clearTimeout(actionToastTimerRef.current)
    actionToastTimerRef.current = setTimeout(() => setActionToast(null), 1800)
  }, [])

  // Viewport scroll metrics for high-contrast on-screen scrollbars & radar
  const [scrollMetrics, setScrollMetrics] = useState({
    scrollLeft: 0,
    scrollTop: 0,
    scrollWidth: 1,
    scrollHeight: 1,
    clientWidth: 1,
    clientHeight: 1,
    ratioX: 0,
    ratioY: 0,
    viewRatioX: 1,
    viewRatioY: 1,
    hasHScroll: false,
    hasVScroll: false,
  })

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const hTrackRef = useRef<HTMLDivElement | null>(null)
  const vTrackRef = useRef<HTMLDivElement | null>(null)
  const minimapRef = useRef<HTMLDivElement | null>(null)

  // Smart gesture tracking: differentiates between a quick tap (click) and touch drag/swipe (remote wheel scroll / pan)
  const pointerStateRef = useRef<{
    isDown: boolean
    startX: number
    startY: number
    lastX: number
    lastY: number
    startScrollLeft: number
    startScrollTop: number
    startTime: number
    hasMoved: boolean
    accumulatedDeltaY: number
    lastScrollTime: number
  }>({
    isDown: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    startScrollLeft: 0,
    startScrollTop: 0,
    startTime: 0,
    hasMoved: false,
    accumulatedDeltaY: 0,
    lastScrollTime: 0,
  })

  const fetchSnapshot = useCallback(() => {
    setLoading(true)
    const timestamp = Date.now()
    const winParam = selectedWindowId ? `&window_id=${selectedWindowId}` : ''
    const tokParam = token ? `?token=${encodeURIComponent(token)}` : '?token='
    const url = `/api/preview/frame${tokParam}${winParam}&quality=${streamQuality}&_t=${timestamp}`
    setDirectImageUrl(url)
    setLastRefreshedAt(new Date().toLocaleTimeString())
    setTimeout(() => setLoading(false), 250)
  }, [selectedWindowId, streamQuality, token])

  useEffect(() => {
    fetchSnapshot()
    if (!autoRefresh || refreshInterval === 0) return

    const timer = setInterval(() => {
      fetchSnapshot()
    }, refreshInterval)

    return () => clearInterval(timer)
  }, [fetchSnapshot, autoRefresh, refreshInterval])

  // Update dynamic scroll metrics whenever canvas scrolls or changes geometry
  const updateScrollMetrics = useCallback(() => {
    if (!viewportRef.current) return
    const el = viewportRef.current
    const maxScrollX = Math.max(0, el.scrollWidth - el.clientWidth)
    const maxScrollY = Math.max(0, el.scrollHeight - el.clientHeight)

    setScrollMetrics({
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      scrollWidth: el.scrollWidth || 1,
      scrollHeight: el.scrollHeight || 1,
      clientWidth: el.clientWidth || 1,
      clientHeight: el.clientHeight || 1,
      ratioX: maxScrollX > 0 ? Math.min(1, Math.max(0, el.scrollLeft / maxScrollX)) : 0,
      ratioY: maxScrollY > 0 ? Math.min(1, Math.max(0, el.scrollTop / maxScrollY)) : 0,
      viewRatioX: el.scrollWidth > 0 ? Math.min(1, el.clientWidth / el.scrollWidth) : 1,
      viewRatioY: el.scrollHeight > 0 ? Math.min(1, el.clientHeight / el.scrollHeight) : 1,
      hasHScroll: maxScrollX > 4,
      hasVScroll: maxScrollY > 4,
    })
  }, [])

  // Listen for viewport resizes (e.g. mobile rotation, zooming, frame updates)
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const resizeObserver = new ResizeObserver(() => {
      updateScrollMetrics()
    })
    resizeObserver.observe(el)
    window.addEventListener('resize', updateScrollMetrics)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateScrollMetrics)
    }
  }, [updateScrollMetrics])

  useEffect(() => {
    updateScrollMetrics()
    const timer = setTimeout(updateScrollMetrics, 120)
    return () => clearTimeout(timer)
  }, [latestFrame, directImageUrl, zoomLevel, theaterMode, updateScrollMetrics])

  // Smooth programmatic scrolling to specified ratio (0.0 to 1.0)
  const scrollToRatio = useCallback((xRatio?: number, yRatio?: number, smooth = true) => {
    if (!viewportRef.current) return
    const el = viewportRef.current
    const maxScrollX = Math.max(0, el.scrollWidth - el.clientWidth)
    const maxScrollY = Math.max(0, el.scrollHeight - el.clientHeight)

    const targetLeft =
      xRatio !== undefined && maxScrollX > 0
        ? Math.max(0, Math.min(maxScrollX, xRatio * maxScrollX))
        : el.scrollLeft
    const targetTop =
      yRatio !== undefined && maxScrollY > 0
        ? Math.max(0, Math.min(maxScrollY, yRatio * maxScrollY))
        : el.scrollTop

    el.scrollTo({
      left: targetLeft,
      top: targetTop,
      behavior: smooth ? 'smooth' : 'auto',
    })
    setTimeout(updateScrollMetrics, 80)
  }, [updateScrollMetrics])

  // Quick Anchor Jumps
  const jumpToLeft = () => scrollToRatio(0, undefined, true)
  const jumpToCenter = () => scrollToRatio(0.5, 0.5, true)
  const jumpToRight = () => scrollToRatio(1, undefined, true)
  const jumpToTop = () => scrollToRatio(undefined, 0, true)
  const jumpToBottom = () => scrollToRatio(undefined, 1, true)

  // Multi-touch pinch-to-zoom state
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchStateRef = useRef<{ initialDistance: number; initialZoom: number } | null>(null)

  // Zoom Handler with accurate focal preservation
  const handleZoomChange = useCallback(
    (rawZoom: number) => {
      const clampedZoom = Math.max(1, Math.min(3, Number(rawZoom.toFixed(2))))
      const el = viewportRef.current
      const normX = el
        ? (el.scrollLeft + el.clientWidth / 2) / Math.max(1, el.scrollWidth)
        : 0.5
      const normY = el
        ? (el.scrollTop + el.clientHeight / 2) / Math.max(1, el.scrollHeight)
        : 0.5

      setZoomLevel(clampedZoom)

      requestAnimationFrame(() => {
        if (!viewportRef.current) return
        const vp = viewportRef.current
        const targetScrollX = Math.max(0, normX * vp.scrollWidth - vp.clientWidth / 2)
        const targetScrollY = Math.max(0, normY * vp.scrollHeight - vp.clientHeight / 2)
        vp.scrollLeft = targetScrollX
        vp.scrollTop = targetScrollY
        updateScrollMetrics()
      })
    },
    [updateScrollMetrics]
  )

  // Remote click execution with precision coordinate mapping
  const executeRemoteClick = async (clientX: number, clientY: number) => {
    if (!imgRef.current) return

    const img = imgRef.current
    const rect = img.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return

    const clickX = clientX - rect.left
    const clickY = clientY - rect.top

    if (clickX < 0 || clickX > rect.width || clickY < 0 || clickY > rect.height) {
      return
    }

    const xRatio = Math.max(0, Math.min(1, clickX / rect.width))
    const yRatio = Math.max(0, Math.min(1, clickY / rect.height))

    setClickIndicator({ x: clickX, y: clickY })
    setTimeout(() => setClickIndicator(null), 650)
    const label =
      clickType === 'right' ? 'Right-Click' : clickType === 'double' ? '2x Click' : 'Click'
    showFeedback(`✓ ${label} (${Math.round(xRatio * 100)}%, ${Math.round(yRatio * 100)}%)`)

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
          is_right: clickType === 'right',
          is_double: clickType === 'double',
        }),
      })
      setTimeout(fetchSnapshot, 250)
    } catch (err) {
      console.error('Failed to trigger remote click', err)
    }
  }

  // Pointer event handlers for the viewport: Smart gesture & 2-finger pinch-to-zoom detection
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!viewportRef.current) return
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values())
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
      pinchStateRef.current = {
        initialDistance: Math.max(20, dist),
        initialZoom: zoomLevel,
      }
      pointerStateRef.current.hasMoved = true
      return
    }

    pointerStateRef.current = {
      isDown: true,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      startScrollLeft: viewportRef.current.scrollLeft,
      startScrollTop: viewportRef.current.scrollTop,
      startTime: Date.now(),
      hasMoved: false,
      accumulatedDeltaY: 0,
      lastScrollTime: 0,
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch (_) {}
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }

    // 2-finger pinch-to-zoom
    if (activePointersRef.current.size === 2 && pinchStateRef.current) {
      const pts = Array.from(activePointersRef.current.values())
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
      const scale = dist / pinchStateRef.current.initialDistance
      handleZoomChange(pinchStateRef.current.initialZoom * scale)
      return
    }

    if (!pointerStateRef.current.isDown || !viewportRef.current) return
    const state = pointerStateRef.current
    const dx = e.clientX - state.startX
    const dy = e.clientY - state.startY
    const stepDy = e.clientY - state.lastY
    state.lastX = e.clientX
    state.lastY = e.clientY

    // In pan mode: pan local zoomed canvas
    if (interactionMode === 'pan') {
      if (Math.hypot(dx, dy) > 6) {
        state.hasMoved = true
        viewportRef.current.scrollLeft = state.startScrollLeft - dx
        viewportRef.current.scrollTop = state.startScrollTop - dy
        updateScrollMetrics()
      }
      return
    }

    // In interactive/click mode: touch drag/swipe streams remote mouse wheel scroll
    if (Math.hypot(dx, dy) > 8) {
      state.hasMoved = true
    }

    if (state.hasMoved) {
      state.accumulatedDeltaY += stepDy
      const now = Date.now()
      const threshold = 22 // 22px touch travel per scroll event

      if (Math.abs(state.accumulatedDeltaY) >= threshold && now - state.lastScrollTime > 50) {
        let xRatio: number | undefined
        let yRatio: number | undefined
        if (imgRef.current) {
          const rect = imgRef.current.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) {
            xRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
            yRatio = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
          }
        }

        // Swiping UP (finger moves negative Y) => scroll DOWN (-120)
        // Swiping DOWN (finger moves positive Y) => scroll UP (120)
        const scrollDelta = state.accumulatedDeltaY < 0 ? -120 : 120
        triggerRemoteScroll(scrollDelta, xRatio, yRatio)

        setScrollIndicator({ dir: scrollDelta > 0 ? 'up' : 'down' })
        if (scrollIndicatorTimerRef.current) clearTimeout(scrollIndicatorTimerRef.current)
        scrollIndicatorTimerRef.current = setTimeout(() => setScrollIndicator(null), 500)

        state.accumulatedDeltaY = 0
        state.lastScrollTime = now
      }
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(e.pointerId)
    if (activePointersRef.current.size < 2) {
      pinchStateRef.current = null
    }

    if (!pointerStateRef.current.isDown) return
    const { hasMoved, startTime } = pointerStateRef.current
    pointerStateRef.current.isDown = false

    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch (_) {}

    // Tap detection: short duration (< 350ms) & minimal movement registers as a click
    if (!hasMoved && Date.now() - startTime < 350 && interactionMode === 'click') {
      executeRemoteClick(e.clientX, e.clientY)
    } else if (hasMoved) {
      // Swiping/scrolling finished: refresh frame snapshot
      setTimeout(fetchSnapshot, 200)
    }
  }

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(e.pointerId)
    pinchStateRef.current = null
    pointerStateRef.current.isDown = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch (_) {}
  }

  // Interactive Horizontal Gilded Scroll Track Pointer Drag
  const handleHTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hTrackRef.current || !viewportRef.current) return
    const rect = hTrackRef.current.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const ratio = Math.max(0, Math.min(1, clickX / rect.width))
    scrollToRatio(ratio, undefined, false)

    const onPointerMove = (moveEvent: PointerEvent) => {
      const moveX = moveEvent.clientX - rect.left
      const moveRatio = Math.max(0, Math.min(1, moveX / rect.width))
      scrollToRatio(moveRatio, undefined, false)
    }

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  // Interactive Vertical Gilded Scroll Track Pointer Drag
  const handleVTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!vTrackRef.current || !viewportRef.current) return
    const rect = vTrackRef.current.getBoundingClientRect()
    const clickY = e.clientY - rect.top
    const ratio = Math.max(0, Math.min(1, clickY / rect.height))
    scrollToRatio(undefined, ratio, false)

    const onPointerMove = (moveEvent: PointerEvent) => {
      const moveY = moveEvent.clientY - rect.top
      const moveRatio = Math.max(0, Math.min(1, moveY / rect.height))
      scrollToRatio(undefined, moveRatio, false)
    }

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  // Interactive Mini-Map Spatial Radar Pointer Drag
  const handleMinimapPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!minimapRef.current || !viewportRef.current) return
    const rect = minimapRef.current.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top
    const ratioX = Math.max(0, Math.min(1, clickX / rect.width))
    const ratioY = Math.max(0, Math.min(1, clickY / rect.height))
    scrollToRatio(ratioX, ratioY, false)

    const onPointerMove = (moveEvent: PointerEvent) => {
      const moveX = moveEvent.clientX - rect.left
      const moveY = moveEvent.clientY - rect.top
      const moveRatioX = Math.max(0, Math.min(1, moveX / rect.width))
      const moveRatioY = Math.max(0, Math.min(1, moveY / rect.height))
      scrollToRatio(moveRatioX, moveRatioY, false)
    }

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  // Remote IDE Scroll Trigger (Win32 simulate_scroll)
  const triggerRemoteScroll = async (deltaBase: number, xRatio?: number, yRatio?: number) => {
    const delta = deltaBase * scrollSpeedMultiplier
    const targetX = xRatio ?? 0.5
    const targetY = yRatio ?? 0.5
    showFeedback(`✓ Scrolled ${delta > 0 ? '▲ Up' : '▼ Down'} (${Math.abs(delta)})`)
    if (onScroll) {
      onScroll(delta, targetX, targetY, selectedWindowId)
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
            x_ratio: targetX,
            y_ratio: targetY,
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
      let xRatio: number | undefined
      let yRatio: number | undefined
      if (imgRef.current) {
        const rect = imgRef.current.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          xRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
          yRatio = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
        }
      }
      const delta = e.deltaY < 0 ? 120 : -120
      triggerRemoteScroll(delta, xRatio, yRatio)
    }
  }

  // Send hotkey
  const sendHotkey = async (key: string) => {
    const cleanKey = key.trim().toLowerCase()
    if (!cleanKey) return
    showFeedback(`✓ Key: ${cleanKey.replace(/_/g, '+').toUpperCase()}`)
    if (onHotkey) {
      onHotkey(cleanKey, selectedWindowId)
    } else {
      try {
        await fetch('/api/action/hotkey', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ key: cleanKey, window_id: selectedWindowId }),
        })
      } catch (err) {
        console.error('Failed to send hotkey', err)
      }
    }
    setTimeout(fetchSnapshot, 300)
  }

  const handleQuickType = async () => {
    if (!quickTypeText.trim()) return
    const text = quickTypeText
    let ok = false
    if (onTypeText) {
      ok = await onTypeText(text, selectedWindowId, autoEnterOnType)
    } else {
      try {
        const res = await fetch('/api/action/type', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            text,
            window_id: selectedWindowId,
            press_enter: autoEnterOnType,
          }),
        })
        ok = res.ok
      } catch (err) {
        console.error('Failed to type text', err)
      }
    }
    if (ok) {
      setQuickTypeText('')
      showFeedback(`✓ Typed ${text.length} chars${autoEnterOnType ? ' + Enter' : ''}`)
    } else {
      showFeedback('⚠ Failed to send text')
    }
    setTimeout(fetchSnapshot, 400)
  }

  const selectedWindow = windows.find((w) => w.hwnd === selectedWindowId)

  // Calculate thumb metrics for horizontal and vertical scrollbars
  const thumbWidthPercent = Math.max(16, scrollMetrics.viewRatioX * 100)
  const thumbLeftPercent = scrollMetrics.ratioX * (100 - thumbWidthPercent)

  const thumbHeightPercent = Math.max(16, scrollMetrics.viewRatioY * 100)
  const thumbTopPercent = scrollMetrics.ratioY * (100 - thumbHeightPercent)

  return (
    <div
      className={`space-y-4 select-none transition-all ${
        theaterMode
          ? 'fixed inset-0 z-50 bg-[#060907] p-2 sm:p-4 overflow-y-auto flex flex-col justify-between'
          : 'pb-28 p-2 sm:p-4 max-w-4xl mx-auto'
      }`}
    >
      {/* Top Remote Control Header Card */}
      <div className="rounded-2xl bg-[#0a0f0c] border border-amber-500/30 p-3 sm:p-4 space-y-3 shadow-md shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Monitor className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold text-amber-200">Remote IDE Control (Precision View)</h3>
                {zoomLevel > 1 && (
                  <span className="text-[9px] font-mono font-bold bg-amber-950/80 border border-amber-500/60 text-amber-300 px-1.5 py-0.2 rounded-md">
                    Zoom {Math.round(zoomLevel * 100)}%
                  </span>
                )}
              </div>
              <p className="text-[10px] text-emerald-400/80 font-mono">
                {lastRefreshedAt ? `Last frame: ${lastRefreshedAt}` : 'Capturing live preview...'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {/* Click Type Selector (Left / Double / Right) */}
            {interactionMode === 'click' && (
              <div className="flex items-center bg-[#0d140f] border border-amber-500/40 rounded-xl p-0.5">
                {([
                  { id: 'left', label: 'Left' },
                  { id: 'double', label: '2x Dbl' },
                  { id: 'right', label: 'Right' },
                ] as const).map((ct) => (
                  <button
                    key={ct.id}
                    onClick={() => setClickType(ct.id)}
                    className={`px-2 py-1 rounded-lg text-[9px] font-mono font-bold transition-all ${
                      clickType === ct.id
                        ? 'bg-amber-500 text-black shadow-sm'
                        : 'text-amber-300/70 hover:text-amber-200'
                    }`}
                    title={`Tap performs ${ct.label} Click`}
                  >
                    {ct.label}
                  </button>
                ))}
              </div>
            )}

            {/* Interaction Mode Toggle */}
            <button
              onClick={() => setInteractionMode(interactionMode === 'click' ? 'pan' : 'click')}
              className={`p-2 rounded-xl text-xs font-semibold border flex items-center gap-1 transition-all ${
                interactionMode === 'click'
                  ? 'bg-amber-950/80 border-amber-500 text-amber-300'
                  : 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
              }`}
              title={
                interactionMode === 'click'
                  ? 'Click Mode: Tap sends click (Swipe pans)'
                  : 'Pan Mode: Drag exclusively scrolls canvas'
              }
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

            {/* Auto Refresh Toggle */}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`p-2 rounded-xl text-xs font-semibold border flex items-center gap-1 transition-all ${
                autoRefresh
                  ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                  : 'bg-[#0d140f] border-emerald-950 text-gray-500'
              }`}
            >
              {autoRefresh ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span className="text-[10px] hidden sm:inline">{autoRefresh ? 'Live' : 'Paused'}</span>
            </button>

            {/* Refresh Snapshot */}
            <button
              onClick={fetchSnapshot}
              disabled={loading}
              className="p-2 rounded-xl bg-gradient-to-tr from-amber-600 to-yellow-500 active:from-amber-500 active:to-yellow-400 text-black font-bold border border-amber-300/40 shadow-sm"
              title="Refresh Frame"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {/* Theater Mode Toggle */}
            <button
              onClick={() => setTheaterMode(!theaterMode)}
              className={`p-2 rounded-xl border transition-all ${
                theaterMode
                  ? 'bg-amber-500 text-black border-amber-300'
                  : 'bg-[#0d140f] text-emerald-300 border-emerald-950 hover:border-amber-500'
              }`}
              title={theaterMode ? 'Exit Theater View' : 'Theater / Edge-to-Edge View'}
            >
              {theaterMode ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
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
              className="w-full bg-[#0d140f] border border-emerald-900/80 rounded-xl px-3 py-1.5 text-xs text-emerald-100 focus:outline-none focus:border-amber-400"
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

      {/* Screen Frame Viewport Card */}
      <div className="relative rounded-2xl bg-black border border-emerald-950 overflow-hidden shadow-2xl flex flex-col shrink-0">
        {latestFrame || directImageUrl ? (
          <div className="relative w-full flex flex-col">
            {/* Viewport Scroll Canvas */}
            <div
              ref={viewportRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onWheel={handleWheel}
              onScroll={updateScrollMetrics}
              className={`viewport-zoom-scroll relative w-full overflow-auto p-2 select-none touch-none ${
                theaterMode ? 'max-h-[75vh]' : 'max-h-[62vh] sm:max-h-[72vh]'
              } ${
                zoomLevel > 1
                  ? 'block text-left'
                  : 'flex items-center justify-center min-h-[240px]'
              }`}
            >
              {/* Scaled Canvas Wrapper: No CSS width transition lag so focal preservation is instant */}
              <div
                className="relative inline-block"
                style={{
                  width: zoomLevel > 1 ? `${zoomLevel * 100}%` : '100%',
                  minWidth: zoomLevel > 1 ? `${zoomLevel * 100}%` : '100%',
                  transformOrigin: 'top left',
                }}
              >
                <img
                  ref={imgRef}
                  src={directImageUrl || latestFrame || ''}
                  alt="Remote IDE Live Screen"
                  draggable={false}
                  onError={() => onRequestSnapshot(selectedWindowId, streamQuality)}
                  className={`w-full h-auto rounded-lg object-contain shadow-md transition-opacity duration-200 select-none ${
                    interactionMode === 'click' ? 'cursor-crosshair' : 'cursor-grab'
                  }`}
                />

                {/* Click Indicator Ripple in Radiant Gold */}
                {clickIndicator && (
                  <div
                    className="absolute w-7 h-7 rounded-full border-2 border-amber-400 bg-amber-400/50 -translate-x-1/2 -translate-y-1/2 animate-ping pointer-events-none z-20"
                    style={{ left: `${clickIndicator.x}px`, top: `${clickIndicator.y}px` }}
                  />
                )}

                {/* Tactile Touch Drag / Wheel Scroll Badge */}
                {scrollIndicator && (
                  <div className="absolute top-4 right-4 z-30 pointer-events-none bg-amber-500 text-black text-[11px] font-mono font-bold px-3 py-1.5 rounded-full shadow-2xl flex items-center gap-1.5 animate-fadeIn border border-white/40">
                    {scrollIndicator.dir === 'up' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    <span>{scrollIndicator.dir === 'up' ? 'Scroll ▲' : 'Scroll ▼'}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Live Action Feedback Toast Pill */}
            {actionToast && (
              <div className="absolute top-3 right-3 z-40 pointer-events-none bg-[#060907]/95 border border-amber-400 text-amber-300 text-[10px] font-mono font-bold px-2.5 py-1 rounded-xl shadow-[0_0_15px_rgba(234,179,8,0.5)] animate-fadeIn">
                {actionToast}
              </div>
            )}

            {/* Vertical Gilded Scrollbar (Right Edge) */}
            {scrollMetrics.hasVScroll && (
              <div
                className={`absolute right-0 top-0 ${
                  scrollMetrics.hasHScroll ? 'bottom-20' : 'bottom-10'
                } w-6 bg-[#050806]/85 border-l border-amber-500/40 flex flex-col items-center justify-between p-1 z-30 select-none backdrop-blur-sm`}
              >
                <button
                  onClick={jumpToTop}
                  className="p-1 rounded bg-[#0d140f] hover:bg-amber-950 text-amber-300 text-[9px]"
                  title="Scroll to Top"
                >
                  <ChevronUp className="w-3 h-3" />
                </button>

                <div
                  ref={vTrackRef}
                  onPointerDown={handleVTrackPointerDown}
                  className="relative flex-1 w-full my-1 bg-[#0a0f0c] border border-amber-500/40 rounded-full cursor-pointer touch-none flex flex-col justify-start py-0.5 overflow-hidden"
                >
                  <div
                    className="w-full rounded-full bg-gradient-to-b from-amber-400 to-yellow-300 shadow-[0_0_12px_rgba(234,179,8,0.85)] border border-white/60 cursor-grab active:cursor-grabbing"
                    style={{
                      height: `${thumbHeightPercent}%`,
                      marginTop: `${thumbTopPercent}%`,
                    }}
                  />
                </div>

                <button
                  onClick={jumpToBottom}
                  className="p-1 rounded bg-[#0d140f] hover:bg-amber-950 text-amber-300 text-[9px]"
                  title="Scroll to Bottom"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* High-Visibility Horizontal Gilded Scrollbar & Fast Jump Anchors */}
            {scrollMetrics.hasHScroll && (
              <div className="bg-[#050806] border-t border-amber-500/40 p-2 flex items-center gap-2 select-none z-30 shrink-0">
                {/* Left (Explorer) Jump Button */}
                <button
                  onClick={jumpToLeft}
                  className="px-2 py-1 rounded-lg bg-[#0d140f] hover:bg-amber-950 border border-emerald-950 hover:border-amber-400 text-amber-300 text-[10px] font-mono font-bold flex items-center gap-1 shrink-0"
                  title="Jump to Left Edge (File Explorer / Line Numbers)"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">0% Left</span>
                </button>

                {/* Gilded Interactive Touch Track */}
                <div
                  ref={hTrackRef}
                  onPointerDown={handleHTrackPointerDown}
                  className="relative flex-1 h-6 bg-[#0a0f0c] border border-amber-500/40 rounded-full cursor-pointer touch-none flex items-center px-1 overflow-hidden"
                >
                  {/* Background Scale Markers */}
                  <div className="absolute inset-0 flex justify-between px-3 items-center opacity-30 pointer-events-none">
                    <span className="text-[8px] font-mono text-amber-400">0%</span>
                    <span className="text-[8px] font-mono text-amber-400">25%</span>
                    <span className="text-[8px] font-mono text-amber-400">50%</span>
                    <span className="text-[8px] font-mono text-amber-400">75%</span>
                    <span className="text-[8px] font-mono text-amber-400">100%</span>
                  </div>

                  {/* Radiant Gold Draggable Slider Thumb */}
                  <div
                    className="h-4 rounded-full bg-gradient-to-r from-amber-400 to-yellow-300 shadow-[0_0_14px_rgba(234,179,8,0.9)] border border-white/70 cursor-grab active:cursor-grabbing transition-all"
                    style={{
                      width: `${thumbWidthPercent}%`,
                      marginLeft: `${thumbLeftPercent}%`,
                    }}
                  />
                </div>

                {/* Center Viewport Button */}
                <button
                  onClick={jumpToCenter}
                  className="p-1.5 rounded-lg bg-[#0d140f] hover:bg-amber-950 border border-emerald-950 hover:border-amber-400 text-amber-400 text-[10px] font-mono font-bold shrink-0"
                  title="Center Viewport (Horizontally & Vertically)"
                >
                  <Compass className="w-3.5 h-3.5" />
                </button>

                {/* Right (Terminal / Minimap) Jump Button */}
                <button
                  onClick={jumpToRight}
                  className="px-2 py-1 rounded-lg bg-[#0d140f] hover:bg-amber-950 border border-emerald-950 hover:border-amber-400 text-amber-300 text-[10px] font-mono font-bold flex items-center gap-1 shrink-0"
                  title="Jump to Right Edge (Minimap / Terminal / Side Panels)"
                >
                  <span className="hidden sm:inline">100% Right</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>

                {/* Live Position Tag */}
                <span className="text-[9px] font-mono font-bold text-amber-300 bg-amber-950/80 border border-amber-500/50 px-1.5 py-0.5 rounded shrink-0">
                  X: {Math.round(scrollMetrics.ratioX * 100)}%
                </span>
              </div>
            )}

            {/* Docked Precision Zoom & Preset Bar (Never overlaps IDE canvas) */}
            <div className="bg-[#060907] border-t border-emerald-950/90 px-2.5 py-1.5 flex items-center justify-between gap-1.5 z-30 shrink-0 overflow-x-auto">
              <span className="text-[9px] font-mono text-emerald-500 hidden sm:inline shrink-0">
                Pinch or Select Zoom:
              </span>
              <div className="flex items-center gap-1 ml-auto">
                <button
                  onClick={() => handleZoomChange(Math.max(1, Number((zoomLevel - 0.25).toFixed(2))))}
                  className="p-1.5 rounded-lg bg-[#0d140f] hover:bg-emerald-950 text-emerald-300"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>

                {/* Presets: Fit (100%), 125%, 150%, 175%, 200%, 250%, 300% */}
                {[1, 1.25, 1.5, 1.75, 2, 2.5, 3].map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => handleZoomChange(lvl)}
                    className={`px-1.5 py-1 rounded-lg text-[9px] font-mono font-bold transition-all ${
                      Math.abs(zoomLevel - lvl) < 0.05
                        ? 'bg-amber-950 border border-amber-500 text-amber-300 shadow-[0_0_8px_rgba(234,179,8,0.5)]'
                        : 'bg-[#0d140f] text-emerald-500 hover:text-emerald-300'
                    }`}
                  >
                    {lvl === 1 ? 'Fit' : `${Math.round(lvl * 100)}%`}
                  </button>
                ))}

                <button
                  onClick={() => handleZoomChange(Math.min(3, Number((zoomLevel + 0.25).toFixed(2))))}
                  className="p-1.5 rounded-lg bg-[#0d140f] hover:bg-emerald-950 text-emerald-300"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => {
                    handleZoomChange(1)
                    jumpToCenter()
                  }}
                  className="p-1.5 rounded-lg bg-[#0d140f] hover:bg-emerald-950 text-amber-400"
                  title="Reset to 100% Fit"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center p-8 text-xs text-emerald-600/70 space-y-2 font-mono flex flex-col items-center justify-center min-h-[220px]">
            <Camera className="w-8 h-8 text-emerald-500 mx-auto animate-pulse" />
            <p>Streaming IDE workspace canvas...</p>
          </div>
        )}

        {/* Picture-in-Picture Mini-Map Spatial Radar */}
        {zoomLevel > 1 && showMinimap && (
          <div className="absolute top-3 left-3 bg-[#060907]/95 border-2 border-amber-400/80 rounded-xl p-1.5 shadow-2xl z-30 flex flex-col gap-1 backdrop-blur-md">
            <div className="flex items-center justify-between px-1">
              <span className="text-[8px] font-mono font-bold text-amber-400 uppercase flex items-center gap-1">
                <Crosshair className="w-2.5 h-2.5 text-amber-400" /> Spatial Radar
              </span>
              <button
                onClick={() => setShowMinimap(false)}
                className="text-[8px] text-gray-400 hover:text-white"
                title="Hide Radar"
              >
                ✕
              </button>
            </div>

            {/* Thumbnail Canvas & Viewfinder Box */}
            <div
              ref={minimapRef}
              onPointerDown={handleMinimapPointerDown}
              className="relative w-28 h-16 bg-black rounded-lg border border-emerald-950 overflow-hidden cursor-crosshair touch-none"
            >
              <img
                src={latestFrame || directImageUrl || ''}
                alt="Radar Thumbnail"
                className="w-full h-full object-contain opacity-60 pointer-events-none"
              />
              {/* Glowing Viewfinder Box */}
              <div
                className="absolute border-2 border-amber-400 bg-amber-400/20 shadow-[0_0_10px_rgba(234,179,8,0.8)] pointer-events-none transition-all duration-75"
                style={{
                  width: `${thumbWidthPercent}%`,
                  height: `${thumbHeightPercent}%`,
                  left: `${thumbLeftPercent}%`,
                  top: `${thumbTopPercent}%`,
                }}
              />
            </div>
            <div className="text-[7.5px] font-mono text-emerald-400 text-center font-bold">
              X: {Math.round(scrollMetrics.ratioX * 100)}% | Y: {Math.round(scrollMetrics.ratioY * 100)}%
            </div>
          </div>
        )}

        {/* Bring Radar Back Button if Hidden */}
        {zoomLevel > 1 && !showMinimap && (
          <button
            onClick={() => setShowMinimap(true)}
            className="absolute top-3 left-3 bg-[#060907]/90 border border-amber-500/50 p-1.5 rounded-xl text-[9px] font-mono text-amber-300 z-30 flex items-center gap-1 shadow-lg"
            title="Open Spatial Radar"
          >
            <Crosshair className="w-3 h-3 text-amber-400" />
            <span>Radar</span>
          </button>
        )}

        {selectedWindow && !showMinimap && (
          <div className="absolute top-3 left-3 bg-[#060907]/80 backdrop-blur-md px-2.5 py-1 rounded-xl border border-emerald-900/60 text-[10px] text-amber-300 font-mono truncate max-w-[60%] z-20">
            {selectedWindow.title}
          </div>
        )}
      </div>

      {/* Remote IDE Mouse Wheel Scroll Bar */}
      <div className="rounded-2xl bg-[#0a0f0c] border border-emerald-900/60 p-3 space-y-2 shadow-md shrink-0">
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

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            onClick={() => triggerRemoteScroll(120)}
            className="py-2 px-2 rounded-xl bg-[#0d140f] border border-emerald-950 hover:border-amber-400 text-emerald-200 active:bg-amber-600 active:text-black transition-all flex items-center justify-center gap-1.5 min-w-0"
          >
            <ChevronUp className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[10px] font-bold truncate">Scroll Up</span>
          </button>

          <button
            onClick={() => triggerRemoteScroll(-120)}
            className="py-2 px-2 rounded-xl bg-[#0d140f] border border-emerald-950 hover:border-amber-400 text-emerald-200 active:bg-amber-600 active:text-black transition-all flex items-center justify-center gap-1.5 min-w-0"
          >
            <ChevronDown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[10px] font-bold truncate">Scroll Down</span>
          </button>

          <button
            onClick={() => sendHotkey('pageup')}
            className="py-2 px-2 rounded-xl bg-[#0d140f] border border-emerald-950 hover:border-amber-400 text-emerald-200 active:bg-amber-600 active:text-black transition-all flex items-center justify-center gap-1.5 min-w-0"
          >
            <ChevronsUp className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[10px] font-bold truncate">Page Up</span>
          </button>

          <button
            onClick={() => sendHotkey('pagedown')}
            className="py-2 px-2 rounded-xl bg-[#0d140f] border border-emerald-950 hover:border-amber-400 text-emerald-200 active:bg-amber-600 active:text-black transition-all flex items-center justify-center gap-1.5 min-w-0"
          >
            <ChevronsDown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[10px] font-bold truncate">Page Down</span>
          </button>
        </div>
      </div>

      {/* Expanded Dev Keyboard Bar */}
      <div className="rounded-2xl bg-[#0a0f0c] border border-amber-500/30 p-3 space-y-2 shadow-md shrink-0">
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
              className="py-1.5 sm:py-2 px-1 rounded-xl bg-[#0d140f] border border-emerald-950 hover:border-amber-400 text-emerald-200 active:bg-amber-600 active:text-black transition-all text-center flex flex-col items-center justify-center hover:scale-[1.02] min-w-0 overflow-hidden"
            >
              <span className="text-[10px] sm:text-[11px] font-mono font-bold text-amber-400 truncate max-w-full">{key.label}</span>
              <span className="text-[7.5px] sm:text-[8px] text-emerald-500/80 truncate max-w-full">{key.hint}</span>
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
              className="py-1.5 sm:py-2 px-1 rounded-xl bg-[#0d140f] border border-emerald-950 hover:border-amber-400 text-emerald-200 active:bg-amber-600 active:text-black transition-all text-center flex flex-col items-center justify-center hover:scale-[1.02] min-w-0 overflow-hidden"
            >
              <span className="text-[10px] sm:text-[11px] font-mono font-bold text-emerald-300 truncate max-w-full">{key.label}</span>
              <span className="text-[7.5px] sm:text-[8px] text-emerald-500/80 truncate max-w-full">{key.hint}</span>
            </button>
          ))}
        </div>

        {/* Tertiary Shortcuts: Command Palette, Quick Open, Editing Keys */}
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5 pt-1 border-t border-emerald-950/80">
          {[
            { label: 'Ctrl+P', id: 'ctrl_p', hint: 'Quick Open' },
            { label: 'Cmd Pal', id: 'ctrl_shift_p', hint: 'Ctrl+Shift+P' },
            { label: 'Ctrl+V', id: 'ctrl_v', hint: 'Paste' },
            { label: 'Ctrl+↵', id: 'ctrl_enter', hint: 'Accept / Send' },
            { label: 'Bksp', id: 'backspace', hint: 'Backspace' },
            { label: 'Del', id: 'delete', hint: 'Delete' },
            { label: 'Home', id: 'home', hint: 'Line Start' },
            { label: 'End', id: 'end', hint: 'Line End' },
          ].map((key) => (
            <button
              key={key.id}
              onClick={() => sendHotkey(key.id)}
              className="py-1.5 sm:py-2 px-1 rounded-xl bg-[#0d140f] border border-emerald-950 hover:border-amber-400 text-emerald-200 active:bg-amber-600 active:text-black transition-all text-center flex flex-col items-center justify-center hover:scale-[1.02] min-w-0 overflow-hidden"
            >
              <span className="text-[10px] sm:text-[11px] font-mono font-bold text-amber-200 truncate max-w-full">{key.label}</span>
              <span className="text-[7.5px] sm:text-[8px] text-emerald-500/80 truncate max-w-full">{key.hint}</span>
            </button>
          ))}
        </div>

        {/* Quaternary Shortcuts: Layout, Search, Comment & Custom Key Chord */}
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5 pt-1 border-t border-emerald-950/80">
          {[
            { label: 'Ctrl+/', id: 'ctrl_slash', hint: 'Comment' },
            { label: 'Space', id: 'space', hint: 'Spacebar' },
            { label: 'Ctrl+B', id: 'ctrl_b', hint: 'Sidebar' },
            { label: 'Ctrl+J', id: 'ctrl_j', hint: 'Panel' },
            { label: 'Ctrl+F', id: 'ctrl_f', hint: 'Find' },
            { label: 'Ctrl+W', id: 'ctrl_w', hint: 'Close Tab' },
            { label: '⇧+Tab', id: 'shift_tab', hint: 'Outdent' },
            { label: 'Alt+Z', id: 'alt_z', hint: 'Word Wrap' },
          ].map((key) => (
            <button
              key={key.id}
              onClick={() => sendHotkey(key.id)}
              className="py-1.5 sm:py-2 px-1 rounded-xl bg-[#0d140f] border border-emerald-950 hover:border-amber-400 text-emerald-200 active:bg-amber-600 active:text-black transition-all text-center flex flex-col items-center justify-center hover:scale-[1.02] min-w-0 overflow-hidden"
            >
              <span className="text-[10px] sm:text-[11px] font-mono font-bold text-emerald-300 truncate max-w-full">{key.label}</span>
              <span className="text-[7.5px] sm:text-[8px] text-emerald-500/80 truncate max-w-full">{key.hint}</span>
            </button>
          ))}
        </div>

        {/* Custom Key / Chord Input */}
        <div className="flex items-center gap-2 pt-1.5 border-t border-emerald-950/80">
          <input
            type="text"
            value={customHotkey}
            onChange={(e) => setCustomHotkey(e.target.value)}
            placeholder="Custom hotkey (e.g. ctrl_shift_f, f12, alt_up)..."
            className="flex-1 bg-[#0d140f] border border-emerald-900/80 rounded-xl px-2.5 py-1.5 text-[11px] text-amber-100 placeholder-emerald-600/60 focus:outline-none focus:border-amber-400 font-mono"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customHotkey.trim()) {
                sendHotkey(customHotkey)
                setCustomHotkey('')
              }
            }}
          />
          <button
            onClick={() => {
              if (customHotkey.trim()) {
                sendHotkey(customHotkey)
                setCustomHotkey('')
              }
            }}
            disabled={!customHotkey.trim()}
            className="px-3 py-1.5 rounded-xl bg-[#0d140f] border border-amber-500/40 hover:border-amber-400 disabled:opacity-40 text-amber-300 text-[10px] font-mono font-bold shrink-0"
          >
            Send Key
          </button>
        </div>
      </div>

      {/* Remote Quick Type Input (Types directly at active cursor focus) */}
      <div className="rounded-2xl bg-[#0a0f0c] border border-emerald-900/60 p-3 flex items-center gap-2 shrink-0">
        <input
          type="text"
          value={quickTypeText}
          onChange={(e) => setQuickTypeText(e.target.value)}
          placeholder="Type text directly at active cursor focus..."
          className="flex-1 bg-[#0d140f] border border-emerald-900/80 rounded-xl px-3 py-2 text-xs text-amber-100 placeholder-emerald-600/60 focus:outline-none focus:border-amber-400 font-mono"
          onKeyDown={(e) => e.key === 'Enter' && handleQuickType()}
        />
        <button
          type="button"
          onClick={() => setAutoEnterOnType(!autoEnterOnType)}
          className={`px-2.5 py-2 rounded-xl text-[10px] font-mono font-bold border transition-all shrink-0 ${
            autoEnterOnType
              ? 'bg-emerald-950/90 border-emerald-500 text-emerald-300'
              : 'bg-[#0d140f] border-emerald-950 text-gray-500'
          }`}
          title={autoEnterOnType ? 'Press Enter after typing (Enabled)' : 'Type without pressing Enter'}
        >
          ↵ Enter
        </button>
        <button
          onClick={handleQuickType}
          disabled={!quickTypeText.trim()}
          className="py-2 px-3 rounded-xl bg-gradient-to-r from-amber-600 to-yellow-500 disabled:opacity-40 text-black text-xs font-bold flex items-center gap-1.5 shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Type</span>
        </button>
      </div>

      {/* Discovered Windows List */}
      <div className="rounded-2xl bg-[#0a0f0c] border border-emerald-950 p-4 space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-amber-400" />
            Discovered Open IDE Windows ({windows.length})
          </h4>
          {onRefreshWindows && (
            <button
              onClick={() => {
                onRefreshWindows()
                showFeedback('✓ Refreshed IDE windows')
              }}
              className="px-2 py-1 rounded-lg bg-[#0d140f] border border-emerald-900/80 hover:border-amber-400 text-[10px] font-mono text-amber-300 flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Rescan</span>
            </button>
          )}
        </div>
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
