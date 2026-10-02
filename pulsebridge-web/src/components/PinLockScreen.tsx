import { useState, useEffect } from 'react'
import { Shield, Lock, Delete, ArrowRight, Sparkles } from 'lucide-react'
import { hapticLight, hapticSuccess, hapticWarning } from '../utils/haptics'

interface PinLockScreenProps {
  onUnlock: (pin: string) => Promise<boolean>
  error: string | null
}

export function PinLockScreen({ onUnlock, error }: PinLockScreenProps) {
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [dismissedError, setDismissedError] = useState(false)

  // Reset dismissal if a new error arrives from backend
  useEffect(() => {
    setDismissedError(false)
  }, [error])

  const handleDigit = (digit: string) => {
    setDismissedError(true)
    if (pin.length < 6) {
      hapticLight()
      const nextPin = pin + digit
      setPin(nextPin)
      if (nextPin.length === 6) {
        submitPin(nextPin)
      }
    }
  }

  const handleDelete = () => {
    setDismissedError(true)
    hapticLight()
    setPin((prev) => prev.slice(0, -1))
  }

  const submitPin = async (codeToSubmit = pin) => {
    if (codeToSubmit.length === 0 || loading) return
    setLoading(true)
    const success = await onUnlock(codeToSubmit)
    setLoading(false)
    if (success) {
      hapticSuccess()
    } else {
      hapticWarning()
      setPin('')
    }
  }

  return (
    <div className="min-h-screen bg-[#060907] text-gray-100 flex flex-col justify-between p-6 max-w-md mx-auto select-none">
      {/* Header */}
      <div className="flex flex-col items-center pt-8">
        <div className="relative mb-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-500/20 via-emerald-500/20 to-yellow-500/10 border border-amber-500/50 flex items-center justify-center auric-glow">
            <Shield className="w-8 h-8 text-amber-400" />
          </div>
          <div className="absolute -bottom-1 -right-1 bg-emerald-500 rounded-full p-1 border-2 border-[#060907]">
            <Lock className="w-3 h-3 text-black" />
          </div>
        </div>
        <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-amber-300 via-yellow-400 to-emerald-400 bg-clip-text text-transparent font-serif">
          PulseBridge
        </h1>
        <p className="text-xs text-emerald-400/90 mt-1 flex items-center gap-1 font-mono tracking-wide">
          <Sparkles className="w-3 h-3 text-amber-400" /> AURIC & EMERALD AI COMPANION
        </p>
        <p className="text-xs text-gray-400 mt-6 text-center leading-relaxed">
          Enter your 6-digit session PIN from your host computer terminal or scan the pairing QR code.
        </p>
      </div>

      {/* PIN Indicators */}
      <div className="my-6">
        <div className="flex justify-center gap-4 my-4">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className={`w-3.5 h-3.5 rounded-full transition-all duration-200 ${
                i < pin.length
                  ? 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.9)] scale-110'
                  : 'bg-emerald-950/40 border border-emerald-900/60'
              }`}
            />
          ))}
        </div>

        {error && !dismissedError && (
          <p className="text-xs text-rose-400 text-center animate-bounce font-medium mt-3">
            {error}
          </p>
        )}
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-3 pb-8">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <button
            key={digit}
            onClick={() => handleDigit(digit)}
            disabled={loading}
            className="h-16 rounded-2xl bg-[#0d140f] active:bg-amber-950/60 border border-emerald-950 hover:border-amber-500/40 active:border-amber-400 text-2xl font-semibold flex items-center justify-center transition-all duration-100 touch-manipulation hover:text-amber-300"
          >
            {digit}
          </button>
        ))}
        <button
          onClick={handleDelete}
          disabled={loading || pin.length === 0}
          className="h-16 rounded-2xl bg-[#0d140f]/60 active:bg-emerald-950/60 border border-emerald-950/60 flex items-center justify-center transition-all text-gray-400 active:text-amber-400"
        >
          <Delete className="w-6 h-6" />
        </button>
        <button
          onClick={() => handleDigit('0')}
          disabled={loading}
          className="h-16 rounded-2xl bg-[#0d140f] active:bg-amber-950/60 border border-emerald-950 hover:border-amber-500/40 text-2xl font-semibold flex items-center justify-center transition-all hover:text-amber-300"
        >
          0
        </button>
        <button
          onClick={() => submitPin()}
          disabled={loading || pin.length === 0}
          className="h-16 rounded-2xl bg-gradient-to-tr from-amber-600 to-emerald-600 active:from-amber-500 active:to-emerald-500 border border-amber-400/40 flex items-center justify-center transition-all text-black font-bold shadow-[0_0_15px_rgba(245,158,11,0.35)]"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
          ) : (
            <ArrowRight className="w-6 h-6 text-black" />
          )}
        </button>
      </div>

      {/* Footer Info */}
      <div className="text-center text-[11px] text-emerald-500/60 pb-2 font-mono">
        SecOps Protected • Zero Trust Local Mutex
      </div>
    </div>
  )
}
