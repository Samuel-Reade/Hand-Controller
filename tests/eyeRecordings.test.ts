// Replays every recordings/*.json (the dev recorder's clips) through the
// pure pipeline and prints the plan's numbers. No assertions beyond "it
// parses": the numbers are for the human gate and the tuning passes.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EYE_DEFAULTS } from '../src/input/eye/config'
import { formatMetrics, replayRecording } from '../src/input/eye/replay'
import type { EyeRecording } from '../src/input/eye/replay'

const dir = join(process.cwd(), 'recordings')
const files = (() => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
})()

describe('recordings', () => {
  if (files.length === 0) {
    it.skip('no recordings/*.json yet - record clips from the leva "record 10 s" button', () => {})
    return
  }
  for (const f of files) {
    it(f, () => {
      const rec = JSON.parse(readFileSync(join(dir, f), 'utf8')) as EyeRecording
      expect(rec.frames.length).toBeGreaterThan(0)
      const m = replayRecording(rec, { ...EYE_DEFAULTS, enabled: true, mode: 'point' })
      console.info(`${f} (${rec.label ?? '-'}): ${formatMetrics(m)}`)
      // A drill recorded after a calibration carries that calibration's
      // samples: how each ring read then vs how the same ring reads now.
      if (rec.calSamples?.length && rec.truth?.length) {
        for (const s of rec.calSamples) {
          const near = rec.truth.filter((t) => Math.hypot(t.x - s.target.x, t.y - s.target.y) < 2)
          if (!near.length) continue
          const t0 = near[0].t
          const t1 = rec.truth.find((t) => t.t > t0)?.t ?? Infinity
          const seg = rec.frames.filter((fr) => fr.t >= t0 + 700 && fr.t < t1)
          if (!seg.length) continue
          const mean = (k: 'irisX' | 'irisY' | 'blendX' | 'blendY' | 'headPitch') => seg.reduce((a, fr) => a + fr.raw[k], 0) / seg.length
          console.info(`  ring (${s.target.x.toFixed(0)},${s.target.y.toFixed(0)}) cal irisY ${s.features.irisY.toFixed(3)} blendY ${s.features.blendY.toFixed(3)} pitch ${s.features.headPitch.toFixed(2)} | clip irisY ${mean('irisY').toFixed(3)} blendY ${mean('blendY').toFixed(3)} pitch ${mean('headPitch').toFixed(2)}`)
        }
      }
    })
  }
})
