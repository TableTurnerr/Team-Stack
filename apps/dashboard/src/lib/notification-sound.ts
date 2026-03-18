/**
 * Notification sound utility for follow-up alerts.
 * Uses Web Audio API to generate a pleasant ding sound programmatically.
 */

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

/**
 * Plays a notification ding sound.
 * @param type - 'due' for the main notification, 'headsup' for a softer pre-notification
 */
export function playNotificationSound(type: 'due' | 'headsup' = 'due'): void {
  try {
    const ctx = getAudioContext();

    // Resume context if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    const now = ctx.currentTime;

    if (type === 'due') {
      // Main notification: two-tone ding (higher pitch, more prominent)
      oscillator.frequency.setValueAtTime(880, now); // A5
      oscillator.frequency.setValueAtTime(1100, now + 0.1); // C#6

      gainNode.gain.setValueAtTime(0.3, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

      oscillator.start(now);
      oscillator.stop(now + 0.4);
    } else {
      // Heads-up notification: softer, single tone
      oscillator.frequency.setValueAtTime(660, now); // E5

      gainNode.gain.setValueAtTime(0.15, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

      oscillator.start(now);
      oscillator.stop(now + 0.25);
    }
  } catch (err) {
    console.warn('Failed to play notification sound:', err);
  }
}

/**
 * Request permission to play sounds (call on user interaction).
 * This helps with browser autoplay policies.
 */
export function initializeAudioContext(): void {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
  } catch {
    // Ignore - audio will initialize on first sound play
  }
}
