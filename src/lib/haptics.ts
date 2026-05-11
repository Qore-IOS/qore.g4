const SINGLE_HAPTIC_PATTERN: VibratePattern = 8;
const DOUBLE_HAPTIC_PATTERN: VibratePattern = [10, 35, 10];
const HAPTIC_THROTTLE_MS = 80;

let lastHapticAt = 0;

function canVibrate() {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export function haptic(force = false) {
  if (!canVibrate()) return;

  const now = Date.now();
  if (!force && now - lastHapticAt < HAPTIC_THROTTLE_MS) return;

  lastHapticAt = now;
  navigator.vibrate(SINGLE_HAPTIC_PATTERN);
}

export function hapticDouble() {
  if (!canVibrate()) return;

  lastHapticAt = Date.now();
  navigator.vibrate(DOUBLE_HAPTIC_PATTERN);
}
