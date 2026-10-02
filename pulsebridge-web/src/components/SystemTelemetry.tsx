import { useState } from 'react'
import {
  Cpu,
  HardDrive,
  Battery,
  BatteryCharging,
  Wifi,
  Server,
  QrCode,
  ShieldCheck,
  Copy,
  Check,
} from 'lucide-react'
import type { SystemTelemetry as SystemTelemetryType } from '../types'
import { hapticLight, hapticSuccess } from '../utils/haptics'

interface SystemTelemetryProps {
  telemetry: SystemTelemetryType | null
  token: string | null
}

export function SystemTelemetry({ telemetry, token }: SystemTelemetryProps) {
  const [showQr, setShowQr] = useState(false)
  const [copied, setCopied] = useState(false)

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / (3600 * 24))
    const h = Math.floor((seconds % (3600 * 24)) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    if (d > 0) return `${d}d ${h}h ${m}m`
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }

  return (
    <div className="space-y-4 pb-28 p-4 max-w-2xl mx-auto select-none">
      {/* Host Summary Card */}
      <div className="rounded-2xl bg-[#0a0f0c] border border-amber-500/30 p-5 space-y-4 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-100">
                {telemetry?.hostname || 'Host PC'}
              </h2>
              <p className="text-[11px] text-emerald-400/80 font-mono">{telemetry?.os || 'Windows 11'}</p>
            </div>
          </div>

          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950/70 border border-emerald-600 text-emerald-300 flex items-center gap-1 font-semibold">
            <ShieldCheck className="w-3 h-3 text-emerald-400" /> Secure Host
          </span>
        </div>

        {/* Telemetry Stats Grid */}
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          {/* RAM in Amber */}
          <div className="p-3 rounded-xl bg-[#0d140f] border border-emerald-950 space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1 text-gray-400">
                <HardDrive className="w-3.5 h-3.5 text-amber-400" /> RAM Used
              </span>
              <span className="font-bold text-amber-400 font-mono">
                {telemetry?.memory_percent || 0}%
              </span>
            </div>
            <div className="text-xs font-bold text-emerald-200 font-mono">
              {((telemetry?.memory_used_mb || 0) / 1024).toFixed(1)} GB /{' '}
              {((telemetry?.memory_total_mb || 0) / 1024).toFixed(1)} GB
            </div>
            <div className="h-1.5 rounded-full bg-emerald-950 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-400 to-yellow-500 rounded-full shadow-[0_0_8px_rgba(234,179,8,0.5)]"
                style={{ width: `${telemetry?.memory_percent || 0}%` }}
              />
            </div>
          </div>

          {/* Battery in Emerald */}
          <div className="p-3 rounded-xl bg-[#0d140f] border border-emerald-950 space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1 text-gray-400">
                {telemetry?.is_charging ? (
                  <BatteryCharging className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Battery className="w-3.5 h-3.5 text-amber-400" />
                )}
                Power
              </span>
              <span className="font-bold text-emerald-400 font-mono">
                {telemetry?.battery_percent !== undefined
                  ? `${telemetry.battery_percent}%`
                  : 'A/C Power'}
              </span>
            </div>
            <div className="text-xs font-bold text-emerald-200">
              {telemetry?.is_charging ? 'Plugged In (Charging)' : 'Running on Battery'}
            </div>
          </div>

          {/* Network IP in Gold */}
          <div className="p-3 rounded-xl bg-[#0d140f] border border-emerald-950 space-y-1">
            <div className="flex items-center gap-1 text-[11px] text-gray-400">
              <Wifi className="w-3.5 h-3.5 text-amber-400" /> Host LAN IP
            </div>
            <div className="text-xs font-mono font-bold text-amber-300 truncate">
              {telemetry?.lan_ip || '127.0.0.1'}:{telemetry?.server_port || 8080}
            </div>
          </div>

          {/* Server Uptime in Emerald */}
          <div className="p-3 rounded-xl bg-[#0d140f] border border-emerald-950 space-y-1">
            <div className="flex items-center gap-1 text-[11px] text-gray-400">
              <Cpu className="w-3.5 h-3.5 text-emerald-400" /> Server Uptime
            </div>
            <div className="text-xs font-mono font-bold text-emerald-300">
              {formatUptime(telemetry?.uptime_seconds || 0)}
            </div>
          </div>
        </div>
      </div>

      {/* QR Pairing & Direct Connection Link */}
      <div className="rounded-2xl bg-[#0a0f0c] border border-emerald-900/60 p-5 space-y-3 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <QrCode className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold text-gray-200">Phone Pairing QR Code</h3>
          </div>
          <button
            onClick={() => {
              hapticLight()
              setShowQr(!showQr)
            }}
            className="text-[11px] font-bold text-amber-400 hover:text-amber-300 font-mono active:scale-95 transition-all"
          >
            {showQr ? 'Hide' : 'Display QR'}
          </button>
        </div>

        {showQr && (
          <div className="flex flex-col items-center p-4 bg-white rounded-2xl animate-fadeIn">
            <img src="/api/auth/qr" alt="Scan to pair another phone" className="w-48 h-48" />
            <p className="text-[11px] text-gray-800 mt-2 font-medium text-center">
              Scan this QR code with another mobile camera to connect instantly.
            </p>
            {token && (
              <button
                onClick={() => {
                  hapticSuccess()
                  const directUrl = `${window.location.origin}/?token=${token}`
                  navigator.clipboard.writeText(directUrl)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
                className="mt-3 text-[10px] bg-[#060907] text-amber-400 border border-amber-500/40 px-3 py-1.5 rounded-xl flex items-center gap-1.5 font-bold shadow-sm active:scale-95 transition-all"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-amber-400" />}
                <span>{copied ? 'Link Copied!' : 'Copy Direct Pairing Link'}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
