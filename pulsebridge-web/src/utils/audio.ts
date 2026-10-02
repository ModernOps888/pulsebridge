// ============================================================================
// PulseBridge Audio Engine (Permanently Silenced per User Request)
// ============================================================================

export type ChimeType = 'milestone' | 'action_required' | 'prompt_sent' | 'error'

class PulseAudioEngine {
  public isSoundEnabled(): boolean {
    return false
  }

  public toggleSound(): boolean {
    return false
  }

  public playChime(_type: ChimeType): void {
    // Sound permanently removed per user request
  }
}

export const pulseAudio = new PulseAudioEngine()
