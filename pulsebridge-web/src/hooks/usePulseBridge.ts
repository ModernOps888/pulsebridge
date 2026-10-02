import { useState, useEffect, useRef, useCallback } from 'react'
import type { ChatStep, IdeWindowInfo, ServerAlert, SystemTelemetry, TaskProgress } from '../types'
import { pulseAudio } from '../utils/audio'

export function usePulseBridge() {
  const [token, setToken] = useState<string | null>(() => {
    // Check URL query param first
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get('token')
    if (urlToken) {
      localStorage.setItem('pulsebridge_token', urlToken)
      return urlToken
    }
    return localStorage.getItem('pulsebridge_token')
  })

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false)
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [isSoundEnabled, setIsSoundEnabled] = useState<boolean>(() => pulseAudio.isSoundEnabled())

  const [task, setTask] = useState<TaskProgress | null>(null)
  const [chatSteps, setChatSteps] = useState<ChatStep[]>([])
  const [telemetry, setTelemetry] = useState<SystemTelemetry | null>(null)
  const [windows, setWindows] = useState<IdeWindowInfo[]>([])
  const [latestFrame, setLatestFrame] = useState<string | null>(null)
  const [alerts, setAlerts] = useState<ServerAlert[]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)

  const toggleSound = () => {
    const next = pulseAudio.toggleSound()
    setIsSoundEnabled(next)
    return next
  }

  // Vibrate mobile device helper
  const triggerHaptic = (pattern: number | number[] = 40) => {
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(pattern)
      } catch (_) {}
    }
  }

  const connectWebSocket = useCallback((authToken: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return
    }

    const host = window.location.host
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${host}/ws?token=${encodeURIComponent(authToken)}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      setAuthError(null)
      // Send auth frame explicitly as well
      ws.send(JSON.stringify({ type: 'auth', payload: { token: authToken } }))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case 'auth_response':
            if (msg.payload.success) {
              setIsAuthenticated(true)
              setAuthError(null)
            } else {
              setIsAuthenticated(false)
              setAuthError(msg.payload.message || 'Authentication rejected')
              setToken(null)
              localStorage.removeItem('pulsebridge_token')
            }
            break

          case 'initial_state':
            setIsAuthenticated(true)
            setTask(msg.payload.task)
            setChatSteps(msg.payload.recent_steps || [])
            setTelemetry(msg.payload.telemetry)
            setWindows(msg.payload.windows || [])
            break

          case 'step_added':
            setChatSteps((prev) => {
              if (prev.some((s) => s.id === msg.payload.id || (s.id.startsWith('local-') && s.content === msg.payload.content))) {
                return prev.map((s) => (s.id.startsWith('local-') && s.content === msg.payload.content ? msg.payload : s))
              }
              return [...prev, msg.payload]
            })
            triggerHaptic(30)
            if (msg.payload?.source !== 'USER') {
              pulseAudio.playChime('milestone')
            }
            break

          case 'progress_update':
            setTask(msg.payload)
            break

          case 'telemetry_update':
            setTelemetry(msg.payload)
            break

          case 'screen_frame':
            setLatestFrame(`data:${msg.payload.format};base64,${msg.payload.data_base64}`)
            break

          case 'alert':
            setAlerts((prev) => [msg.payload, ...prev.slice(0, 9)])
            triggerHaptic([50, 80, 50])
            pulseAudio.playChime('action_required')
            break
        }
      } catch (err) {
        console.error('Failed to parse WebSocket frame', err)
      }
    }

    ws.onclose = () => {
      setIsConnected(false)
      wsRef.current = null
      // Auto-reconnect after 2 seconds
      reconnectTimeoutRef.current = window.setTimeout(() => {
        if (token) {
          connectWebSocket(token)
        }
      }, 2000)
    }

    ws.onerror = (err) => {
      console.warn('WebSocket error:', err)
      ws.close()
    }
  }, [token])

  // Login via 6-digit PIN
  const loginWithPin = async (pin: string): Promise<boolean> => {
    try {
      setAuthError(null)
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })

      const data = await res.json()
      if (res.ok && data.success && data.token) {
        setToken(data.token)
        localStorage.setItem('pulsebridge_token', data.token)
        setIsAuthenticated(true)
        connectWebSocket(data.token)
        triggerHaptic([40, 60])
        return true
      } else {
        setAuthError(data.message || 'Invalid PIN code')
        triggerHaptic([100, 50, 100])
        return false
      }
    } catch (err) {
      setAuthError('Connection error to bridge backend')
      return false
    }
  }

  const logout = () => {
    setToken(null)
    setIsAuthenticated(false)
    localStorage.removeItem('pulsebridge_token')
    if (wsRef.current) {
      wsRef.current.close()
    }
  }

  // Send message back to IDE from phone
  const sendPrompt = (message: string) => {
    const userStep: ChatStep = {
      id: `local-${Date.now()}`,
      step_index: chatSteps.length + 1,
      timestamp: new Date().toISOString(),
      source: 'USER',
      step_type: 'USER_INPUT',
      status: 'DONE',
      content: message,
      ide: task?.active_ide || 'antigravity',
    }
    setChatSteps((prev) => [...prev, userStep])
    pulseAudio.playChime('prompt_sent')

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      // Fallback to REST
      fetch('/api/action/prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message }),
      })
      triggerHaptic(40)
      return
    }

    wsRef.current.send(
      JSON.stringify({
        type: 'send_prompt',
        payload: { message },
      })
    )
    triggerHaptic(40)
  }

  // Remote mouse scroll helper
  const sendScroll = async (delta: number, xRatio?: number, yRatio?: number, windowId?: number) => {
    try {
      await fetch('/api/action/scroll', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          delta,
          x_ratio: xRatio,
          y_ratio: yRatio,
          window_id: windowId,
        }),
      })
      triggerHaptic(20)
    } catch (err) {
      console.error('Failed to trigger remote scroll', err)
    }
  }

  // Remote hotkey helper
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
      triggerHaptic(25)
    } catch (err) {
      console.error('Failed to send remote hotkey', err)
    }
  }

  // Request screen/window snapshot
  const requestSnapshot = (windowId?: number, quality = 65) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'request_snapshot',
          payload: { window_id: windowId, quality },
        })
      )
    }
  }

  const emergencyStop = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'emergency_stop', payload: {} }))
      triggerHaptic([200, 100, 200])
    }
  }

  const dismissAlert = (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id))
  }

  // Live round-trip latency measurement (RTT)
  useEffect(() => {
    if (!isAuthenticated || !isConnected) {
      setLatencyMs(null)
      return
    }

    let active = true
    const measureLatency = async () => {
      try {
        const start = performance.now()
        const res = await fetch('/api/telemetry', { cache: 'no-store' })
        if (res.ok && active) {
          const rtt = Math.round(performance.now() - start)
          setLatencyMs(rtt)
        }
      } catch (_) {}
    }

    measureLatency()
    const timer = setInterval(measureLatency, 4000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [isAuthenticated, isConnected])

  // Auto-connect if token is present
  useEffect(() => {
    // Check if URL has ?pin=...
    const params = new URLSearchParams(window.location.search)
    const urlPin = params.get('pin')
    if (urlPin && !isAuthenticated) {
      loginWithPin(urlPin)
      return
    }

    if (token) {
      connectWebSocket(token)
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [token, connectWebSocket])

  return {
    isAuthenticated,
    isConnected,
    authError,
    token,
    task,
    chatSteps,
    telemetry,
    windows,
    latestFrame,
    alerts,
    latencyMs,
    isSoundEnabled,
    toggleSound,
    loginWithPin,
    logout,
    sendPrompt,
    sendScroll,
    sendHotkey,
    requestSnapshot,
    emergencyStop,
    dismissAlert,
  }
}
