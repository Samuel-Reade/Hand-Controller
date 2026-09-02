// Machine-gate verification for the neural port, slices P1-P4
// (ORB_NEURAL_PORT_SPEC §8). Run with the dev server up:
//   node scripts/verify-neural.mjs [baseURL] [outDir]
// Gates: shader compiles with no page errors; ≥55fps on GPU (pass
// --use-angle=metal so headless Chromium doesn't rasterize on SwiftShader);
// non-brain nodes ≤2 draw calls (actual 1; scene total 9); exactly one
// incoming trail per non-brain element; layout hash stable across reloads;
// center white-clip ≤ the prototype's own measure (make-screenshot-1 =
// 1.28% near-white in the center window - the port must not exceed it).
import { chromium } from 'playwright'
import { pathToFileURL } from 'url'

const base = process.argv[2] ?? 'http://localhost:5173'
const outDir = process.argv[3] ?? 'shots'
const WHITE_BOUND = 0.0128 // prototype parity (PORT_LOG P4)

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

await page.goto(pathToFileURL(shot).href)
const white = await page.evaluate(async () => {
  const img = document.querySelector('img')
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const size = Math.round((500 / 1440) * img.naturalWidth)
  const x = Math.round(img.naturalWidth / 2 - size / 2)
  const y = Math.round(img.naturalHeight / 2 - size / 2)
  const d = ctx.getImageData(x, y, size, size).data
  let n = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] >= 250 && d[i + 1] >= 250 && d[i + 2] >= 250) n++
  }
  return n / (size * size)
})

const checks = [
  ['no page errors', errors.length === 0],
  ['fps ≥ 55', info.fps >= 55],
  ['non-brain node draws ≤ 2 (1 instanced)', info.drawCalls <= 9],
  ['one incoming trail per non-brain node', info.trailCount === info.nodeCount - 1],
  ['layout hash stable across reloads', info.layoutHash === info2.layoutHash],
  [`center white-clip ${(white * 100).toFixed(2)}% ≤ prototype ${(WHITE_BOUND * 100).toFixed(2)}%`, white <= WHITE_BOUND],
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
