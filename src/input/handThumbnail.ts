// Shared thumbnail drawing for the hand HUD (S9: feedback is mandatory).
// The camera shell and the synthetic harness both draw through this, so a
// person - and a screenshot gate - can see why the app thinks it is
// pinching or zooming: ice = tracked, brass = that hand is pinched, ivory
// on both hands = the two-pinch zoom is engaged. Coordinates are
// image-normalized; callers set up the mirror transform.

import { TOKENS } from '../config/tokens'
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
