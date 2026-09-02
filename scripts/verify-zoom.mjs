// Machine-gate verification for the two-hand zoom (ORB_ZOOM_SPEC section 7),
// end to end against the dev server through the synthetic pair harness:
//   node scripts/verify-zoom.mjs [baseURL] [outDir]
// Z1: two hands tracked, the HUD reads ZOOM with both engaged (screenshot).
// Z2: the field dollies in (pure dolly, ?zoomDrill=0) and springs back.
// Z3: zoomIn commits level 0 -> 1, zoomOut commits 1 -> 0 (screenshots);
//     the camera is continuous at each commit; 60fps; zero page errors;
//     frozen diffs empty on physics + the single-hand gesture machine.
import { execSync } from 'child_process'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5173'
const outDir = process.argv[3] ?? 'shots'

const browser = await chromium.launch({ args: ['--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

const info = () => page.evaluate(() => window.__neuralInfo)
const hud = () => page.locator('.hand-state').first().textContent().catch(() => null)
const waitFor = (fn, timeout = 20000) => page.waitForFunction(fn, null, { timeout, polling: 16 })

// Sample the scene 25x/s into the page so the whole run can be summarized.
async function startSampling() {
  await page.evaluate(() => {
    window.__zoomSamples = []
    window.__zoomSampler = setInterval(() => {
      const i = window.__neuralInfo
      if (!i) return
      window.__zoomSamples.push({
        t: performance.now(), zoom: i.zoom, level: i.level, target: i.target, hands: i.handCount,
        hud: document.querySelector('.hand-state')?.textContent ?? null,
      })
    }, 40)
  })
}
const samples = () => page.evaluate(() => { clearInterval(window.__zoomSampler); return window.__zoomSamples })

const checks = []
const check = (name, pass, detail = '') => checks.push([name, pass, detail])

// ── Z1 + Z2: pure dolly (zoomCommitsDrill=false) ─────────────────────────
await page.goto(`${base}/?input=synthetic&scenario=zoomIn&tune=0&zoomDrill=0`)
await page.waitForFunction(() => window.__neuralInfo?.handCount === 2, null, { timeout: 20000 })
await startSampling()
await waitFor(() => window.__neuralInfo.zoom > 1.9)
const hudDuring = await hud()
const during = await info()
await page.locator('.hand-hud').screenshot({ path: `${outDir}/zoom-z1-hud.png` })
await page.screenshot({ path: `${outDir}/zoom-z2-dollied.png` })
await waitFor(() => window.__neuralInfo.handCount === 0 && Math.abs(window.__neuralInfo.zoom - 1) < 0.02)
await page.screenshot({ path: `${outDir}/zoom-z2-rest.png` })
const s1 = await samples()
const maxZoomDolly = Math.max(...s1.map((s) => s.zoom))
check('Z1 two hands tracked + HUD reads ZOOM while both pinched', during.handCount === 2 && hudDuring === 'ZOOM', `hands=${during.handCount} hud=${hudDuring}`)
check('Z2 field dollies in (zoom ≥ 1.9, pure dolly)', maxZoomDolly >= 1.9, `max ${maxZoomDolly.toFixed(3)}`)
check('Z2 springs back to 1.0 on release', s1.some((s) => s.hands === 0 && Math.abs(s.zoom - 1) < 0.02), '')
check('Z2 pure dolly never drills (level stays 0)', s1.every((s) => s.level === 0 && s.target === 0), '')

// ── Z3: commits drive the P5 drill in and out ────────────────────────────
await page.goto(`${base}/?input=synthetic&scenario=zoomIn,zoomOut&tune=0`)
await page.waitForFunction(() => window.__neuralInfo?.handCount === 2, null, { timeout: 20000 })
await startSampling()
await waitFor(() => window.__neuralInfo.target === 1)
const atCommit = await info()
await page.waitForTimeout(1100) // let the recenter run
await page.screenshot({ path: `${outDir}/zoom-z3-drilled.png` })
const drilled = await info()
await waitFor(() => window.__neuralInfo.target === 0)
await waitFor(() => window.__neuralInfo.level === 0)
await page.waitForTimeout(600)
await page.screenshot({ path: `${outDir}/zoom-z3-out.png` })
const out = await info()
const s2 = await samples()
const zoomInPhase = s2.filter((s) => s.target === 0 && s.level === 0 && s.hands === 2)
const maxBeforeCommit = zoomInPhase.length ? Math.max(...zoomInPhase.map((s) => s.zoom)) : 0
// Continuity through the commits: at each sample where the drill target
// flips, the displayed factor must not jump - the arbiter re-latches to 1.0
// there and the carry must absorb it. (The spring-back after release is
// deliberately fast - springBack - and fast hand motion mid-zoom is not a
// discontinuity; the max in-zoom step is printed for information.)
let commitJump = 0
let maxStep = 0
for (let i = 1; i < s2.length; i++) {
  const step = Math.abs(s2[i].zoom - s2[i - 1].zoom)
  if (s2[i].target !== s2[i - 1].target) commitJump = Math.max(commitJump, step)
  if (s2[i].hud === 'ZOOM' && s2[i - 1].hud === 'ZOOM') maxStep = Math.max(maxStep, step)
}
check('Z3 zoomIn commits: level 0 -> 1 on the reticle hub', atCommit.target === 1 && drilled.level === 1 && drilled.anchorHub !== null, `anchorHub=${drilled.anchorHub}`)
check('Z3 commit fired at/after zoomInCommit (1.6)', maxBeforeCommit >= 1.5, `max pre-commit ${maxBeforeCommit.toFixed(3)}`)
check('Z3 zoomOut commits: level 1 -> 0', out.level === 0 && out.target === 0 && out.anchorHub === null, '')
check('Z3 camera continuous at the commits (factor jump < 0.1 where the target flips)', commitJump < 0.1, `commit jump ${commitJump.toFixed(3)}, max in-zoom step ${maxStep.toFixed(3)}/40ms`)
check('Z3 zoom back at rest after drill-out', Math.abs(out.zoom - 1) < 0.05, `zoom ${out.zoom.toFixed(3)}`)
check('fps ≥ 55', out.fps >= 55, `fps ${out.fps}`)
check('no page errors', errors.length === 0, '')

let frozenClean = false
try {
  execSync('git diff --quiet -- src/input/gestureMachine.ts src/orb/useOrbPhysics.ts src/orb/Orb.tsx', { stdio: 'ignore' })
  frozenClean = true
} catch {}
check('frozen diffs empty: gestureMachine.ts, useOrbPhysics.ts, Orb.tsx', frozenClean, '')

let ok = true
for (const [name, pass, detail] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  if (!pass) ok = false
}
console.log('drilled info:', JSON.stringify(drilled))
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'))
await browser.close()
process.exit(ok ? 0 : 1)
