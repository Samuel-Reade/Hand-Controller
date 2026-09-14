// Shared thumbnail drawing for the hand HUD (S9: feedback is mandatory).
// The camera shell and the synthetic harness both draw through this, so a
// person - and a screenshot gate - can see why the app thinks it is
// pinching or zooming: ice = tracked, brass = that hand is pinched, ivory
// on both hands = the two-pinch zoom is engaged. Coordinates are
// image-normalized; callers set up the mirror transform.

import { TOKENS } from '../config/tokens'
import type { EyeTelemetry } from './eye/channel'
import type { Landmark } from './landmarks'

/** MediaPipe's 21-point hand skeleton (HandLandmarker.HAND_CONNECTIONS). */
export const HAND_CONNECTIONS: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]

export interface ThumbHand {
  landmarks: readonly Landmark[]
  pinched: boolean
}

interface HandRuntime {
  /** HUD registers its thumbnail canvas here; the shell / harness draw into it. */
  thumbnail: HTMLCanvasElement | null
}

export const handRuntime: HandRuntime = { thumbnail: null }

/**
 * ORB_EYE_SPEC §7: the live-gaze indicator - a small INK iris glyph in the
 * thumbnail's corner, filled while the channel may act (idle / attending),
 * hollow while it may not (suspended / holding / decaying), with a second
 * ring when the channel is head-pose only. Ink, because it reports a state
 * - rendered with the HUD's ivory until Rally's ink token lands (never
 * violet: that is for pressable controls only). Drawn in canvas space (not
 * mirrored) after the hands. Absent when off.
 */
export function drawEyeIndicator(
  ctx: CanvasRenderingContext2D,
  w: number,
  _h: number,
  eye: EyeTelemetry,
): void {
  if (eye.state === 'off') return
  const cx = w - 12
  const cy = 12
  const live = eye.state === 'idle' || eye.state === 'attending'
  ctx.save()
  ctx.strokeStyle = TOKENS.ivory
  ctx.fillStyle = TOKENS.ivory
  ctx.lineWidth = 1.2
  // the eye outline
  ctx.beginPath()
  ctx.moveTo(cx - 7, cy)
  ctx.quadraticCurveTo(cx, cy - 6, cx + 7, cy)
  ctx.quadraticCurveTo(cx, cy + 6, cx - 7, cy)
  ctx.stroke()
  // the iris: filled = may act, hollow = may not
  ctx.beginPath()
  ctx.arc(cx, cy, 2.4, 0, Math.PI * 2)
  if (live) ctx.fill()
  else ctx.stroke()
  // head-only: a second ring
  if (eye.headOnly) {
    ctx.beginPath()
    ctx.arc(cx, cy, 4.2, 0, Math.PI * 2)
    ctx.stroke()
  }
  // attending: a short tick in the torque direction
  if (eye.state === 'attending' && eye.mag > 0) {
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + eye.dirX * 9, cy + eye.dirY * 9)
    ctx.stroke()
  }
  ctx.restore()
}

export function drawHands(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  hands: readonly ThumbHand[],
  zooming: boolean,
): void {
  for (const hand of hands) {
    const lm = hand.landmarks
    if (lm.length < 21) continue
    ctx.strokeStyle = zooming
      ? TOKENS.ivory
      : hand.pinched
        ? TOKENS.brass
        : 'rgba(127,178,217,0.8)'
    ctx.lineWidth = zooming || hand.pinched ? 1.4 : 1
    ctx.beginPath()
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.moveTo(lm[a].x * w, lm[a].y * h)
      ctx.lineTo(lm[b].x * w, lm[b].y * h)
    }
    ctx.stroke()
    ctx.fillStyle = TOKENS.brass
    for (const p of lm) {
      ctx.beginPath()
      ctx.arc(p.x * w, p.y * h, 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
