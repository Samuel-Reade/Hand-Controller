import { chromium } from 'playwright'
const base = process.argv[2] ?? 'http://localhost:3300'
const outDir = process.argv[3] ?? 'shots'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`${base}/?input=synthetic&scenario=flick&tune=0`)
// Poll until the coast phase of a flick loop, then capture.
let t = ''
for (let i = 0; i < 100; i++) {
  await page.waitForTimeout(60)
  t = (await page.locator('.telemetry').innerText()).replace(/\n/g, ' ')
  const omega = parseFloat(t.split('ω')[1])
  if (t.includes('COAST') && omega > 2) break
}
console.log('captured at:', t)
await page.screenshot({ path: `${outDir}/synthetic-flick-coast.png` })
await browser.close()
