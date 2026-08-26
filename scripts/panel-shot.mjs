import { chromium } from 'playwright'
const base = process.argv[2] ?? 'http://localhost:5173'
const outDir = process.argv[3] ?? 'shots'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`${base}/?tune=0`)
await page.waitForTimeout(1500)
await page.keyboard.press('Enter')
await page.waitForTimeout(900)
await page.screenshot({ path: `${outDir}/panel-open.png` })
await browser.close()
