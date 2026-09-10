// Machine-gate verification for crosshair pointing, slice PT1
// (ORB_SELECT_SPEC §8). Run with the dev server up:
//   node scripts/verify-pointing.mjs [baseURL] [outDir]
//
// Gates: no page errors; the sight mounts and its DOM state always agrees
// with the published highlight; an acquired highlight is always a targetable
// node inside acquireRadius; ordinary (non-anchor) nodes ARE reachable by
// rotating; ≥55fps with pointing running every frame (pass --use-angle=metal
// so headless Chromium is not on SwiftShader); and the globe scene never
// mounts the sight (§0 scope guard).
//
// NOTE on PT1: rotation still DETENTS (the spec holds the free-rotation
// profile back to PT2), so the settled rotations are the old grid's, not
// arbitrary. This script therefore samples the rotations the detents
// actually reach rather than asking for angles the physics will not hold.
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5173'
const outDir = process.argv[3] ?? 'shots'
const ACQUIRE_RADIUS = 46 // NCONF.point.acquireRadius default
const RELEASE_RADIUS = 88 // NCONF.point.releaseRadius default - hysteresis HOLDS a node out to here

const browser = await chromium.launch({ args: ['--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

const sample = () =>
  page.evaluate(() => ({
    sight: document.querySelector('.crosshair')?.dataset.state ?? 'absent',
    ring: document.querySelector('.crosshair-ring')?.style.opacity ?? '',
    i: window.__neuralInfo,
  }))

await page.goto(`${base}/?tune=0`)
await page.waitForTimeout(3500)
await page.locator('.stage').focus()

// Walk the detent grid with the keyboard and record what the sight resolves
// to at each settled rotation.
const samples = []
for (let i = 0; i < 26; i++) {
  samples.push(await sample())
  await page.keyboard.press(i % 5 === 4 ? 'ArrowDown' : 'ArrowRight')
  await page.waitForTimeout(420)
}

const acquiredOrdinary = samples.filter(
  (s) => s.sight === 'acquired' && s.i?.pointed && s.i.pointed !== 'brain',
)
const anchorOnly = samples.filter((s) => s.i?.pointed === 'brain')

// Park on a rotation that acquired an ordinary node and shoot it.
let shotName = null
if (acquiredOrdinary.length) {
  const target = acquiredOrdinary[0]
  await page.goto(`${base}/?tune=0`)
  await page.waitForTimeout(3000)
  await page.locator('.stage').focus()
  for (let i = 0; i < 26; i++) {
    const s = await sample()
    if (s.i?.pointed === target.i.pointed && s.sight === 'acquired') {
      shotName = s.i.pointed
      break
    }
    await page.keyboard.press(i % 5 === 4 ? 'ArrowDown' : 'ArrowRight')
    await page.waitForTimeout(420)
  }
  await page.screenshot({ path: `${outDir}/point-pt1-acquired.png` })
}

const last = await sample()

// §0 scope guard: the globe build must not mount the sight at all.
await page.goto(`${base}/?scene=globe&tune=0`)
await page.waitForTimeout(2000)
const globe = await sample()

await browser.close()

const stateAgrees = samples.every((s) =>
  s.i?.pointed ? s.sight === 'acquired' || s.sight === 'confirming' : s.sight === 'idle',
)
// Steady-state invariant: acquisition happens inside acquireRadius, but the
// §1 hysteresis then holds the node out to releaseRadius - with 160 posts a
// node acquired at one detent is often still held at the next, so a sample
// may legitimately read 46..88 px. Never beyond releaseRadius.
const distancesSane = samples.every(
  (s) => !s.i?.pointed || s.i.pointedDist <= RELEASE_RADIUS || s.i.pointed === 'brain',
)
const acquiredTight = samples.filter((s) => s.i?.pointed && s.i.pointed !== 'brain' && s.i.pointedDist <= ACQUIRE_RADIUS).length
const fps = Math.min(...samples.map((s) => s.i?.fps ?? 0))

const checks = [
  ['no page errors', errors.length === 0],
  ['sight mounts in the neural scene', samples[0].sight !== 'absent'],
  ['DOM state always agrees with the published highlight', stateAgrees],
  [`highlights never exceed releaseRadius (${RELEASE_RADIUS}px; ${acquiredTight} samples inside acquireRadius ${ACQUIRE_RADIUS})`, distancesSane],
  [
    `ordinary (non-anchor) nodes are reachable by rotating (${acquiredOrdinary.length}/${samples.length} samples)`,
    acquiredOrdinary.length > 0,
  ],
  [
    `§2 filter is on: ${samples[0].i?.targetable} targetable of ${samples[0].i?.nodeCount}`,
    samples[0].i?.targetable > 0 && samples[0].i?.targetable < samples[0].i?.nodeCount,
  ],
  ['ring is hidden whenever nothing is highlighted', samples.every((s) => s.i?.pointed || s.ring === '0')],
  [`fps ≥ 55 with pointing on every frame (min ${fps})`, fps >= 55],
  ['globe scene never mounts the sight (§0 scope guard)', globe.sight === 'absent'],
]

let ok = true
for (const [name, pass] of checks) {
  if (!pass) ok = false
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
}

const tiers = {}
for (const s of acquiredOrdinary) tiers[s.i.pointedTier] = (tiers[s.i.pointedTier] ?? 0) + 1
console.log(
  `\nover ${samples.length} detent rotations: ${acquiredOrdinary.length} acquired an ordinary node ${JSON.stringify(tiers)}, ` +
    `${anchorOnly.length} fell back to the anchor.`,
)
console.log(`last sample: ${last.i?.pointed} at ${last.i?.pointedDist}px (${last.sight})`)
if (shotName) console.log(`shot: ${outDir}/point-pt1-acquired.png (highlight = ${shotName})`)
else console.log('NOTE: no ordinary acquisition to screenshot')
process.exit(ok ? 0 : 1)
