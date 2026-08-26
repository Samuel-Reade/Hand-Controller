// Slice D verification with a fake webcam: consent affordance -> camera
// starts -> wasm + landmarker load -> HUD thumbnail live -> no hand found
// -> SEARCHING. Also: disable returns to the affordance.
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5173'
const outDir = process.argv[3] ?? 'shots'
const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.grantPermissions(['camera'])
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(`${base}/?tune=0`)
await page.waitForTimeout(1200)
const cta = page.locator('.hand-cta')
console.log('consent affordance shown:  ', await cta.isVisible())
await page.screenshot({ path: `${outDir}/consent-off.png` })
await cta.click()
// wasm + model load can take a few seconds the first time
let state = ''
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(500)
  if (await page.locator('.hand-hud').isVisible()) {
    state = await page.locator('.hand-state').innerText()
    break
  }
  const note = await page.locator('.hand-note').innerText().catch(() => '')
  if (/unavailable|declined/i.test(note)) {
    state = `FAILED: ${note}`
    break
  }
}
console.log('camera pipeline state:     ', state || 'timed out')
await page.waitForTimeout(1000)
await page.screenshot({ path: `${outDir}/hand-hud.png` })
// thumbnail actually drawing? (canvas not blank)
const drawn = await page.evaluate(() => {
  const c = document.querySelector('.hand-thumb')
  if (!c) return false
  const ctx = c.getContext('2d')
  const px = ctx.getImageData(0, 0, c.width, c.height).data
  let sum = 0
  for (let i = 0; i < px.length; i += 400) sum += px[i]
  return sum > 0
})
console.log('thumbnail drawing frames:  ', drawn)
await page.locator('.hand-link', { hasText: 'DISABLE' }).click()
await page.waitForTimeout(500)
console.log('disable returns affordance:', await page.locator('.hand-cta').isVisible())
console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors')
await browser.close()
