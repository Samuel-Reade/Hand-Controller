// Machine-gate verification for the neural port, slices P1-P4
// (ORB_NEURAL_PORT_SPEC §8). Run with the dev server up:
//   node scripts/verify-neural.mjs [baseURL] [outDir]
// Gates: shader compiles with no page errors; ≥55fps on GPU (pass
// --use-angle=metal so headless Chromium doesn't rasterize on SwiftShader);
// non-brain nodes ≤2 draw calls (actual 1; scene total 9); exactly one
// incoming trail per non-brain element; layout hash stable across reloads;
// center white-clip ≤ the prototype's own measure (make-screenshot-1 =
// 1.28% near-white in the center window - the port must not exceed it);
// and (visual pass) the background stays dark under a real 7x two-hand zoom -
// the backdrop planes and the sprite glow must not wash the frame when the
// camera closes in. Measured as the MEDIAN luminance over a 24x15 grid of the
// whole frame: robust to the few big discs and near-camera trails that a
// corner-point sample lands on by chance (six corner points read 40.9/255 on
// a frame whose median was 9.0). Before the pass the median at 7x was 88/255.
// page.evaluate bodies run in the browser; the monorepo's ESLint config
// gives scripts/ Node globals only.
/* global document, window */
import { chromium } from 'playwright'
import { pathToFileURL } from 'url'

const base = process.argv[2] ?? 'http://localhost:3300'
const outDir = process.argv[3] ?? 'shots'
const WHITE_BOUND = 0.0128 // prototype parity (PORT_LOG P4)
const ZOOM_BG_BOUND = 0.1  // median frame luminance at 7x zoom ≤ 10% (25.5/255): the typical pixel is still black

const browser = await chromium.launch({ args: ['--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(`${base}/?scene=neural&tune=0&chrome=0`)
await page.waitForTimeout(4500)
const info = await page.evaluate(() => window.__neuralInfo)
const shot = `${outDir}/neural-p4.png`
await page.screenshot({ path: shot })
await page.reload()
await page.waitForTimeout(2500)
const info2 = await page.evaluate(() => window.__neuralInfo)

// Real 7x zoom through the persistent-zoom base (DEV seam) - camera.z stays
// the rest distance, so the backdrop + glow-fade paths are the ones exercised.
await page.evaluate(() => window.__neuralDev.setZoom(7))
await page.waitForTimeout(800)
const zoomShot = `${outDir}/neural-zoom7.png`
await page.screenshot({ path: zoomShot })
const zoomInfo = await page.evaluate(() => window.__neuralInfo)

/** Load a shot and run a canvas measurement over it. */
const measure = async (path, fn) => {
  await page.goto(pathToFileURL(path).href)
  return page.evaluate(async (src) => {
    const img = document.querySelector('img')
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    return new Function('ctx', 'w', 'h', src)(ctx, img.naturalWidth, img.naturalHeight)
  }, fn)
}
const white = await measure(shot, `
  const size = Math.round((500 / 1440) * w)
  const x = Math.round(w / 2 - size / 2), y = Math.round(h / 2 - size / 2)
  const d = ctx.getImageData(x, y, size, size).data
  let n = 0
  for (let i = 0; i < d.length; i += 4) if (d[i] >= 250 && d[i + 1] >= 250 && d[i + 2] >= 250) n++
  return n / (size * size)
`)
// median luminance over a 24x15 grid of the whole frame (see header)
const bgLum = `
  const v = []
  for (let i = 0; i < 24; i++) for (let j = 0; j < 15; j++) {
    const p = ctx.getImageData(Math.round((i + 0.5) * w / 24), Math.round((j + 0.5) * h / 15), 1, 1).data
    v.push((0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255)
  }
  v.sort((a, b) => a - b)
  return v[Math.floor(v.length / 2)]
`
const bgRest = await measure(shot, bgLum)
const bgZoom = await measure(zoomShot, bgLum)

const checks = [
  ['no page errors', errors.length === 0],
  ['fps ≥ 55', info.fps >= 55],
  ['non-brain node draws ≤ 2 (1 instanced)', info.drawCalls <= 9],
  ['one incoming trail per non-brain node', info.trailCount === info.nodeCount - 1],
  ['layout hash stable across reloads', info.layoutHash === info2.layoutHash],
  [`center white-clip ${(white * 100).toFixed(2)}% ≤ prototype ${(WHITE_BOUND * 100).toFixed(2)}%`, white <= WHITE_BOUND],
  [
    `frame stays dark at real 7x zoom: median ${(bgZoom * 255).toFixed(1)}/255 (rest ${(bgRest * 255).toFixed(1)}) ≤ ${ZOOM_BG_BOUND * 255}`,
    zoomInfo.zoom > 6.5 && bgZoom <= ZOOM_BG_BOUND,
  ],
]
let ok = true
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (!pass) ok = false
}
console.log('info:', JSON.stringify(info))
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'))
await browser.close()
process.exit(ok ? 0 : 1)
