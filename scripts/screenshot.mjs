// Dev-server screenshots for machine-gate verification (S0): three (yaw,
// pitch) states, one open-panel shot later (Slice B). Run with the dev
// server already up: node scripts/screenshot.mjs <baseURL> <outDir>
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:3300'
const outDir = process.argv[3] ?? 'shots'
const states = [
  { name: 'state-home', q: 'yaw=0&pitch=0' },
  { name: 'state-orbit-up', q: 'yaw=-15&pitch=23' },
  { name: 'state-spun', q: 'yaw=137&pitch=-46' },
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

for (const s of states) {
  await page.goto(`${base}/?${s.q}&tune=0`)
  await page.waitForTimeout(2500) // let physics settle onto detents + fps window fill
  const telemetry = await page.locator('.telemetry').innerText().catch(() => '(none)')
  await page.screenshot({ path: `${outDir}/${s.name}.png` })
  console.log(`${s.name}: telemetry = ${telemetry.replace(/\n/g, ' ')}`)
}
if (errors.length) {
  console.log('PAGE ERRORS:')
  for (const e of errors) console.log('  ' + e)
} else {
  console.log('no page errors')
}
await browser.close()
