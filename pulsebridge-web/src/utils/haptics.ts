/**
 * Native Haptic Feedback Utility for PulseBridge Mobile PWA
 * Exploits Android & iOS Web Vibration API to deliver tactile hardware clicks
 */

export function triggerHaptic(pattern: number | number[] = 18): void {
  if (typeof window !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern)
    } catch (_) {}
  }
}

/** Crisp 12ms micro-click for tab switches, chips, and buttons */
export function hapticLight(): void {
  triggerHaptic(12)
}

/** 22ms firm tap for project selections, conversation switches, and modal toggles */
export function hapticMedium(): void {
  triggerHaptic(22)
}

/** Double-pulse burst for prompt dispatch, clipboard pushes, and successful saves */
export function hapticSuccess(): void {
  triggerHaptic([15, 30, 20])
}

/** Alert pulse for emergency stops and warnings */
export function hapticWarning(): void {
  triggerHaptic([35, 50, 35])
}
