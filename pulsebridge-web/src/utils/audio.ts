// ============================================================================
// PulseBridge Synthesized Harmonic Audio Engine
// Zero-Asset Web Audio API Chimes (528Hz Love Frequency & 792Hz Crown Harmonics)
// ============================================================================

export type ChimeType = 'milestone' | 'action_required' | 'prompt_sent' | 'error'

class PulseAudioEngine {
  private ctx: AudioContext | null = null
  private enabled: boolean = true

  constructor() {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('pulsebridge_sound_enabled')
      this.enabled = stored !== 'false'
    }
  }

  public isSoundEnabled(): boolean {
    return this.enabled
  }

  public toggleSound(): boolean {
    this.enabled = !this.enabled
    if (typeof window !== 'undefined') {
      localStorage.setItem('pulsebridge_sound_enabled', String(this.enabled))
    }
    if (this.enabled) {
      this.playChime('milestone')
    }
    return this.enabled
  }

  private initContext() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (AudioCtx) {
        this.ctx = new AudioCtx()
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume()
    }
  }

  public playChime(type: ChimeType) {
    if (!this.enabled) return

    try {
      this.initContext()
      if (!this.ctx) return

      const now = this.ctx.currentTime

      switch (type) {
        case 'milestone': {
          // Radiant Gold Triad: 528Hz (Solar Solfeggio) -> 660Hz -> 792Hz
          const freqs = [528, 660, 792]
          freqs.forEach((freq, idx) => {
            const osc = this.ctx!.createOscillator()
            const gain = this.ctx!.createGain()

            osc.type = 'sine'
            osc.frequency.setValueAtTime(freq, now + idx * 0.08)

            gain.gain.setValueAtTime(0.001, now + idx * 0.08)
            gain.gain.linearRampToValueAtTime(0.12, now + idx * 0.08 + 0.02)
            gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 0.38)

            osc.connect(gain)
            gain.connect(this.ctx!.destination)

            osc.start(now + idx * 0.08)
            osc.stop(now + idx * 0.08 + 0.42)
          })
          break
        }

        case 'action_required': {
          // Cyber Emerald Dual-Ping: 440Hz -> 880Hz octave ping
          const freqs = [440, 880]
          freqs.forEach((freq, idx) => {
            const osc = this.ctx!.createOscillator()
            const gain = this.ctx!.createGain()

            osc.type = 'triangle'
            osc.frequency.setValueAtTime(freq, now + idx * 0.1)

            gain.gain.setValueAtTime(0.001, now + idx * 0.1)
            gain.gain.linearRampToValueAtTime(0.15, now + idx * 0.1 + 0.02)
            gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.1 + 0.4)

            osc.connect(gain)
            gain.connect(this.ctx!.destination)

            osc.start(now + idx * 0.1)
            osc.stop(now + idx * 0.1 + 0.45)
          })
          break
        }

        case 'prompt_sent': {
          // Subtle ascending pop (600Hz -> 900Hz chirp)
          const osc = this.ctx.createOscillator()
          const gain = this.ctx.createGain()

          osc.type = 'sine'
          osc.frequency.setValueAtTime(580, now)
          osc.frequency.exponentialRampToValueAtTime(920, now + 0.1)

          gain.gain.setValueAtTime(0.001, now)
          gain.gain.linearRampToValueAtTime(0.08, now + 0.015)
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14)

          osc.connect(gain)
          gain.connect(this.ctx.destination)

          osc.start(now)
          osc.stop(now + 0.15)
          break
        }

        case 'error': {
          // Low resonant alert drop
          const osc = this.ctx.createOscillator()
          const gain = this.ctx.createGain()

          osc.type = 'sawtooth'
          osc.frequency.setValueAtTime(280, now)
          osc.frequency.exponentialRampToValueAtTime(140, now + 0.25)

          gain.gain.setValueAtTime(0.08, now)
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)

          osc.connect(gain)
          gain.connect(this.ctx.destination)

          osc.start(now)
          osc.stop(now + 0.32)
          break
        }
      }
    } catch (_) {
      // Audio playback silently suppressed if browser policy blocks autoplay
    }
  }
}

export const pulseAudio = new PulseAudioEngine()
