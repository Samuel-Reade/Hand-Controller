// End-to-end interaction smoke test against the dev server: drag -> coast ->
// lock, arrow steps, orbit index click, tap flash. Reads the telemetry DOM.
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:3300'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

const telemetry = async () => (await page.locator('.telemetry').innerText()).replace(/\n/g, ' ')

// Globe-scene smoke test: coast -> lock, detent steps and the brass reticle's
// tap flash are the GLOBE's interaction model. The neural scene has free
// rotation and the crosshair sight instead (ORB_SELECT_SPEC), so this targets
// the globe explicitly.
await page.goto(`${base}/?scene=globe&tune=0`)
await page.waitForTimeout(1200)
console.log('start:      ', await telemetry())

// 1. Flick: fast horizontal drag, release -> should coast and lock on a new item
await page.mouse.move(720, 450)
await page.mouse.down()
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(720 - i * 30, 450)
  await page.waitForTimeout(12)
}
await page.mouse.up()
await page.waitForTimeout(300)
console.log('mid-coast:  ', await telemetry())
await page.waitForTimeout(2500)
console.log('after flick:', await telemetry())

// 2. ArrowRight: exactly one item step on the active orbit
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(1500)
console.log('arrow-right:', await telemetry())

// 3. ArrowUp: one orbit up
await page.keyboard.press('ArrowUp')
await page.waitForTimeout(1500)
console.log('arrow-up:   ', await telemetry())

// 4. Orbit index: click QUALITY (bottom orbit) -> multi-orbit jump
await page.getByRole('button', { name: /Quality/i }).click()
await page.waitForTimeout(2000)
console.log('index-jump: ', await telemetry())

// 5. Tap: click without travel -> reticle flash (data-flash present briefly)
const flashSeen = page
  .locator('.reticle[data-flash="1"]')
  .waitFor({ state: 'attached', timeout: 1500 })
  .then(() => true)
  .catch(() => false)
await page.mouse.click(720, 450)
console.log('tap flash:  ', (await flashSeen) ? 'seen' : 'NOT SEEN')

// 6. Focused report announced for a11y
console.log('announcer:  ', await page.locator('[role="status"]').textContent())

console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors')
await browser.close()
