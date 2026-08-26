// Pure landmark math (S9): mirror, scale-normalize, pinch ratio. No
// MediaPipe imports - the whole gesture pipeline tests headless.

export interface Landmark {
  x: number
  y: number
  z?: number
}

// MediaPipe hand landmark indices we consume.
export const WRIST = 0
export const THUMB_TIP = 4
export const INDEX_TIP = 8
export const MIDDLE_MCP = 9 // the knuckle - hand position; fingertips are noisier

export function dist2d(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** The user-facing feed is mirrored; without this flip, right rotates left. */
export function mirrorX(p: Landmark): { x: number; y: number } {
  return { x: 1 - p.x, y: p.y }
}

/**
 * Apparent hand size: wrist to middle-finger knuckle. Deltas and pinch
 * distance divide by this, or gains and thresholds drift as the user leans.
 */
export function handScale(landmarks: readonly Landmark[]): number {
  return dist2d(landmarks[WRIST], landmarks[MIDDLE_MCP])
}

/** Thumb tip to index tip, in raw image units. */
export function pinchDistance(landmarks: readonly Landmark[]): number {
  return dist2d(landmarks[THUMB_TIP], landmarks[INDEX_TIP])
}

/** pinchRatio = |lm4 - lm8| / handScale - scale-invariant. */
export function pinchRatio(landmarks: readonly Landmark[]): number {
  return pinchDistance(landmarks) / handScale(landmarks)
}

/** Hand position: the mirrored knuckle (landmark 9), raw image coords. */
export function handPosition(landmarks: readonly Landmark[]): { x: number; y: number } {
  return mirrorX(landmarks[MIDDLE_MCP])
}
