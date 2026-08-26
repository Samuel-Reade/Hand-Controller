// Machine-gate verification for Slices B + C: open-panel screenshot,
// keyboard-only walkthrough, and the orb mid-coast under a synthetic flick.
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5173'
const outDir = process.argv[3] ?? 'shots'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

const telemetry = async () => (await page.locator('.telemetry').innerText()).replace(/\n/g, ' ')
const activeEl = () =>
  page.evaluate(() => {
    const el = document.activeElement
    return el ? `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}` : 'none'
  })

// --- Slice B: keyboard-only walkthrough -----------------------------------
await page.goto(`${base}/?tune=0`)
await page.waitForTimeout(1500)
await page.keyboard.press('ArrowRight') // prove stepping works pre-open
await page.waitForTimeout(1400)
await page.keyboard.press('Enter') // open the focused report
await page.waitForTimeout(900)
const dialogVisible = await page.locator('[role="dialog"]').isVisible()
console.log('panel opens on Enter:      ', dialogVisible)
console.log('focus after open:          ', await activeEl())
await page.screenshot({ path: `${outDir}/panel-open.png` })
// orb input must be suspended: arrows should not move the orb
const lonBefore = await telemetry()
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(800)
const lonAfter = await telemetry()
console.log('orb frozen while open:     ', lonBefore.split('LON')[1]?.trim().split(' ')[0] === lonAfter.split('LON')[1]?.trim().split(' ')[0])
// Tab stays inside the panel
await page.keyboard.press('Tab')
await page.keyboard.press('Tab')
const tabbedEl = await activeEl()
const insidePanel = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))
console.log('Tab stays in panel:        ', insidePanel, `(${tabbedEl})`)
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
console.log('Escape closes:             ', !(await page.locator('[role="dialog"]').isVisible()))
console.log('focus back on stage:       ', await activeEl())

// --- Slice C: synthetic flick drives the live app --------------------------
await page.goto(`${base}/?input=synthetic&scenario=flick&tune=0`)
await page.waitForTimeout(870) // engage ~530ms, release ~760ms -> mid-coast
const midCoast = await telemetry()
console.log('synthetic mid-coast:       ', midCoast)
await page.screenshot({ path: `${outDir}/synthetic-flick-coast.png` })
await page.waitForTimeout(2500)
console.log('synthetic settled:         ', await telemetry())

console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors')
await browser.close()
