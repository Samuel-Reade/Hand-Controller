// Machine gate for scroll zoom, end to end against the dev server:
//   node scripts/verify-scroll-zoom.mjs [baseURL] [outDir]
// Real wheel events on the stage: scroll up zooms in, scroll down zooms out,
// by the same ratio both ways; the zoom glides (never one step); a trackpad
// pinch (ctrl + wheel) zooms the field and never the page; the page never
// scrolls; the open shell suspends it; zero page errors.
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5173'
const outDir = process.argv[3] ?? 'shots'

const browser = await chromium.launch({ args: ['--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

const zoom = () => page.evaluate(() => window.__neuralInfo.zoom)
const settleAt = (z) => page.waitForFunction((t) => Math.abs(window.__neuralInfo.zoom - t) / t < 0.005, z, { timeout: 5000, polling: 16 })
const pageState = () => page.evaluate(() => ({ scrollY: window.scrollY, scale: window.visualViewport?.scale ?? 1 }))
const checks = []
const check = (name, pass, detail = '') => checks.push([name, pass, detail])

await page.goto(`${base}/?tune=0`)
await page.waitForFunction(() => window.__neuralInfo?.fps > 0, null, { timeout: 20000 })
await page.mouse.move(720, 450)
const z0 = await zoom()
check('rest zoom is 1', Math.abs(z0 - 1) < 1e-6, z0.toFixed(4))

// Scroll up: five 100 px notches = x e^1. Sample the glide.
await page.evaluate(() => {
  window.__zs = []
  window.__zsTimer = setInterval(() => window.__zs.push(window.__neuralInfo.zoom), 16)
})
for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -100)
await settleAt(Math.E)
const glide = await page.evaluate(() => { clearInterval(window.__zsTimer); return window.__zs })
const zIn = await zoom()
await page.screenshot({ path: `${outDir}/scroll-zoom-in.png` })
check('scroll up zooms in (5 notches = x2.72)', Math.abs(zIn - Math.E) / Math.E < 0.005, zIn.toFixed(3))
const rising = glide.filter((z) => z > 1 + 1e-6)
check('the zoom glides - monotonic, several frames, no overshoot',
  rising.length >= 5 && rising.every((z, i) => i === 0 || z >= rising[i - 1] - 1e-9) && Math.max(...rising) <= Math.E * 1.001,
  `${rising.length} frames rising`)

// Scroll down the same amount: back to exactly where it started.
for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 100)
await settleAt(1)
const zBack = await zoom()
check('scroll down the same amount returns to 1', Math.abs(zBack - 1) < 0.005, zBack.toFixed(4))
for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 100)
await settleAt(Math.exp(-0.6))
const zOut = await zoom()
await page.screenshot({ path: `${outDir}/scroll-zoom-out.png` })
check('scroll down zooms out past rest', zOut < 0.56, zOut.toFixed(3))

// Trackpad pinch: Chrome delivers it as a wheel with ctrlKey.
await page.keyboard.down('Control')
await page.mouse.wheel(0, -20)
await page.keyboard.up('Control')
await settleAt(zOut * Math.exp(0.2))
const zPinch = await zoom()
const ps = await pageState()
check('pinch (ctrl + wheel) zooms the field', Math.abs(zPinch / zOut - Math.exp(0.2)) < 0.01, `x${(zPinch / zOut).toFixed(3)}`)
check('the page itself never scrolls or zooms', ps.scrollY === 0 && ps.scale === 1, JSON.stringify(ps))

// The shell open: orb input suspended - the wheel does nothing.
const name = await page.evaluate(() => window.__neuralDev.pickClickable({ minDist: 60, maxX: 600, maxY: 350 }))
const pos = async () => {
  const p = await page.evaluate((n) => window.__neuralDev.projectNode(n), name)
  return { x: 720 + p.x, y: 450 + p.y }
}
let p = await pos()
await page.mouse.click(p.x, p.y)
await page.waitForFunction(() => window.__neuralInfo.centerK >= 1, null, { timeout: 5000 })
p = await pos()
await page.mouse.click(p.x, p.y)
await page.waitForSelector('.report-panel', { timeout: 5000 })
const zShell = await zoom()
await page.mouse.move(720, 450)
for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -100)
await page.waitForTimeout(400)
const zShellAfter = await zoom()
check('the open shell suspends scroll zoom', Math.abs(zShellAfter - zShell) < 1e-6, `${zShell.toFixed(4)} -> ${zShellAfter.toFixed(4)}`)
await page.keyboard.press('Escape')

check('zero page errors', errors.length === 0, errors.join(' | '))
await browser.close()

let ok = true
for (const [n, pass, detail] of checks) {
  ok &&= pass
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${detail ? `  (${detail})` : ''}`)
}
console.log(ok ? `\nALL ${checks.length} PASS` : '\nFAILED')
process.exit(ok ? 0 : 1)
