// Where the pointer is (S7 pattern: a per-frame runtime, never React state).
// Written by usePointerInput on every pointer event, read by the neural
// scene each frame to hit-test the node under the cursor for the hover ring
// (docs/DECISIONS.md, click-to-centre). px from the stage centre, +x right
// / +y down - the projection's frame.

export const cursorRuntime = {
  x: 0,
  y: 0,
  /** the pointer is over the stage */
  inside: false,
  /** a button is down (dragging or about to tap) */
  down: false,
  /** performance.now() of the last pointer event; 0 = none yet (gaze arbitration) */
  lastEventAt: 0,
}
