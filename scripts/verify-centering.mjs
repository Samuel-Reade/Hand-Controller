// Machine-gate verification for click-to-centre (docs/DECISIONS.md). Run
// with the dev server up:
//   node scripts/verify-centering.mjs [baseURL] [outDir]
//
// Gates: no page errors; clicking a node's projected disc makes it the
// centred node and, once the blend lands, it projects to screen centre
// (the sight acquires it when targetable); the SMALLEST post on screen is
// clickable too (all nodes); clicking empty space changes nothing; a second
// click on the selected node ENTERS it - the shell opens on it, an empty
// container with a header and no analytics - and Escape closes the shell
// with the selection kept; a drill (Enter, the sight model) still works and
// clicking a field node at level 1 drills out and centres it; Escape
// returns to the centre node from a selected post AND from a drill; the
// globe scene's tap still opens the focused report.
// page.evaluate bodies run in the browser; the monorepo's ESLint config
// gives scripts/ Node globals only.
/* global document, getComputedStyle, window */
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:3300'
const outDir = process.argv[3] ?? 'shots'
const W = 1440
const H = 900

const browser = await chromium.launch({ args: ['--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: W, height: H } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

const info = () => page.evaluate(() => window.__neuralInfo)

// Project every node with the scene's own maths (exposed for gates) and
// return the screen position of a named one.
await page.goto(`${base}/?tune=0`)
await page.waitForTimeout(3000)
await page.locator('.stage').focus()

const nodeScreen = (name) =>
  page.evaluate(
    ({ name, W, H }) => {
      const d = window.__neuralDev
      const p = d.projectNode(name)
      return p ? { x: W / 2 + p.x, y: H / 2 + p.y, dist: p.dist, w: p.w, tier: p.tier, r: p.r, visR: p.visR } : null
    },
    { name, W, H },
  )

const results = {}
const fail = (k, why) => {
  results[k] = { ok: false, why }
}
const pass = (k, extra = {}) => {
  results[k] = { ok: true, ...extra }
}

// 1. pick an on-screen post away from centre, click it, wait, check.
const pick = await page.evaluate(({ W, H }) => {
  const d = window.__neuralDev
  return d.pickClickable({ minDist: 180, maxX: W / 2 - 220, maxY: H / 2 - 120 })
}, { W, H })
if (!pick) fail('click-centres', 'no clickable post away from centre')
else {
  const before = await nodeScreen(pick)
  await page.mouse.click(before.x, before.y)
  await page.waitForTimeout(1000)
  const after = await nodeScreen(pick)
  const i = await info()
  if (i.centered !== pick) fail('click-centres', `centered=${i.centered}, wanted ${pick}`)
  else if (after.dist > 1) fail('click-centres', `dist after blend ${after.dist.toFixed(2)}px`)
  else pass('click-centres', { node: pick, before: Math.round(before.dist), after: +after.dist.toFixed(3), sight: i.pointed })
  await page.screenshot({ path: `${outDir}/centering-clicked.png` })

  // 1a. orbit radius: the camera came in by centerPush; the marker is on the node.
  const push = await page.evaluate(() => window.__nconf.select.centerPush)
  const mark = await page.evaluate(() => {
    const m = document.querySelector('.crosshair-mark')
    const root = document.querySelector('.crosshair')
    return m
      ? {
          opacity: m.style.opacity,
          landed: m.dataset.landed,
          transform: m.style.transform,
          extent: parseFloat(m.style.getPropertyValue('--gap')) + parseFloat(m.style.getPropertyValue('--mark-arm')),
          sightArmOpacity: getComputedStyle(root.querySelector('.crosshair-arm.n')).opacity,
          color: getComputedStyle(m.querySelector('.crosshair-mark-arm.n')).backgroundColor,
        }
      : null
  })
  const { minPx, scale } = await page.evaluate(() => ({ minPx: window.__nconf.select.markMinPx, scale: window.__nconf.select.markScale }))
  const bound = Math.max(minPx, after.visR * scale)
  if (Math.abs(i.push - push) > 1) fail('orbit-radius', `push ${i.push}, wanted ${push}`)
  else if (!mark || mark.opacity !== '1' || mark.landed !== '1') fail('orbit-radius', `marker ${JSON.stringify(mark)}`)
  else if (!/translate\(-?0\.\d+px, -?0\.\d+px\)|translate\(0px, 0px\)/.test(mark.transform) && !/translate\((-?0\.0|0)px/.test(mark.transform)) fail('orbit-radius', `marker not at centre: ${mark.transform}`)
  else if (Math.abs(mark.extent - bound) > 0.2) fail('orbit-radius', `marker extent ${mark.extent}px, wanted ${bound.toFixed(1)}px (half the node's ${after.visR.toFixed(1)}px)`)
  else if (mark.color !== 'rgb(166, 107, 255)') fail('orbit-radius', `marker colour ${mark.color}, wanted the ring's violet`)
  else if (mark.sightArmOpacity !== '0') fail('orbit-radius', `sight arms still shown under the landed marker (${mark.sightArmOpacity})`)
  else pass('orbit-radius', { push: i.push, marker: mark.transform, markerExtentPx: mark.extent, nodeVisiblePx: +after.visR.toFixed(1), color: mark.color })

  // 1a'. and the node is the centre of ROTATION: a drag leaves it at 0 px.
  await page.mouse.move(W / 2 + 120, H / 2 + 80)
  await page.mouse.down()
  let maxDist = 0
  for (let k = 1; k <= 8; k++) {
    await page.mouse.move(W / 2 + 120 + k * 15, H / 2 + 80 + k * 5, { steps: 2 })
    await page.waitForTimeout(30)
    maxDist = Math.max(maxDist, (await nodeScreen(pick)).dist)
  }
  await page.mouse.up()
  await page.waitForTimeout(700)
  const settled = await nodeScreen(pick)
  if (maxDist > 1 || settled.dist > 1) fail('pivot-is-node', `max ${maxDist.toFixed(2)} settled ${settled.dist.toFixed(2)}`)
  else pass('pivot-is-node', { maxDistDuringDrag: +maxDist.toFixed(3) })
  await page.screenshot({ path: `${outDir}/centering-rotated.png` })
}

// 1e. hover: the violet ring follows the cursor onto a node, by the click's
// own hit-test; the sight's (hue-tinted) ring never shows in pointer mode.
{
  const target = await page.evaluate(({ W, H }) => window.__neuralDev.pickClickable({ minDist: 200, maxX: W / 2 - 220, maxY: H / 2 - 120 }), { W, H })
  const sp = await nodeScreen(target)
  await page.mouse.move(sp.x + 2, sp.y - 1)
  await page.waitForTimeout(150)
  const h = await page.evaluate(() => {
    const el = document.querySelector('.crosshair-hover')
    const ring = document.querySelector('.crosshair-ring')
    return {
      hovered: window.__neuralInfo.hovered,
      opacity: el.style.opacity,
      w: parseFloat(el.style.width),
      transform: el.style.transform,
      sightRing: ring.style.opacity,
      cursor: document.querySelector('.stage').style.cursor,
      color: getComputedStyle(el).borderColor,
    }
  })
  const empty = await page.evaluate(({ W, H }) => window.__neuralDev.emptyPoint({ W, H }), { W, H })
  await page.mouse.move(W / 2 + empty.x, H / 2 + empty.y)
  await page.waitForTimeout(150)
  const off = await page.evaluate(() => ({ hovered: window.__neuralInfo.hovered, opacity: document.querySelector('.crosshair-hover').style.opacity, cursor: document.querySelector('.stage').style.cursor }))
  // press (on empty space, so nothing is confirmed): the sight ring must
  // not fill on mouse-down in pointer mode
  await page.mouse.down()
  await page.waitForTimeout(120)
  const pressed = await page.evaluate(() => document.querySelector('.crosshair-ring').style.opacity)
  await page.mouse.up()
  await page.waitForTimeout(300)
  if (h.hovered !== target) fail('hover-ring', `hovered ${h.hovered}, wanted ${target}`)
  else if (h.opacity !== '1' || !(h.w / 2 >= sp.visR)) fail('hover-ring', `ring ${JSON.stringify(h)}`)
  else if (h.sightRing !== '0' && h.sightRing !== '') fail('hover-ring', `sight ring shown in pointer mode (${h.sightRing})`)
  else if (h.cursor !== 'pointer') fail('hover-ring', `cursor ${h.cursor}`)
  else if (off.hovered !== null || off.opacity !== '0' || off.cursor !== '') fail('hover-ring', `did not clear: ${JSON.stringify(off)}`)
  else if (pressed !== '0' && pressed !== '') fail('hover-ring', `sight ring filled on mouse-down (${pressed})`)
  else pass('hover-ring', { node: target, ringDiameterPx: h.w, color: h.color })
  await page.mouse.move(sp.x, sp.y)
  await page.waitForTimeout(150)
  await page.screenshot({ path: `${outDir}/centering-hover.png` })
  await page.mouse.move(W / 2 + empty.x, H / 2 + empty.y)
}

// 1b. the smallest post on screen (a minor echo or post) is clickable.
{
  const small = await page.evaluate(({ W, H }) => {
    const d = window.__neuralDev
    return d.pickClickable({ minDist: 120, maxX: W / 2 - 220, maxY: H / 2 - 120, tier: 'node', smallest: true })
      ?? d.pickClickable({ minDist: 120, maxX: W / 2 - 220, maxY: H / 2 - 120, tier: 'hub', smallest: true })
  }, { W, H })
  if (!small) fail('smallest-clickable', 'no small node on screen')
  else {
    const before = await nodeScreen(small)
    const wouldHit = await page.evaluate(({ x, y }) => window.__neuralDev.hitAt(x, y), { x: before.x - W / 2, y: before.y - H / 2 })
    await page.mouse.click(before.x, before.y)
    await page.waitForTimeout(1000)
    const after = await nodeScreen(small)
    const i = await info()
    if (i.centered !== small) fail('smallest-clickable', `centered=${i.centered}, wanted ${small} (hit r ${before.r.toFixed(1)}px; resolver says ${JSON.stringify(wouldHit)}; level ${i.level} open ${await page.evaluate(() => !!document.querySelector('.report-panel'))})`)
    else if (after.dist > 1) fail('smallest-clickable', `dist ${after.dist.toFixed(2)}`)
    else pass('smallest-clickable', { node: small, tier: before.tier, hitRadiusPx: +before.r.toFixed(1), before: Math.round(before.dist) })
  }
}

// 1c. Escape returns to the centre node (the brain at the origin).
{
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1000)
  const i = await info()
  const brain = await nodeScreen('brain')
  const markOpacity = await page.evaluate(() => document.querySelector('.crosshair-mark')?.style.opacity)
  if (i.centered !== null || i.centerK < 1) fail('escape-home', `centered ${i.centered} k ${i.centerK}`)
  else if (brain.dist > 1) fail('escape-home', `brain dist ${brain.dist.toFixed(2)}`)
  else if (Math.abs(i.push) > 1) fail('escape-home', `camera push still ${i.push}`)
  else if (markOpacity !== '0') fail('escape-home', `marker still shown (${markOpacity})`)
  else pass('escape-home')
}

// 1d. re-centre a post for the steps below.
if (pick) {
  const s = await nodeScreen(pick)
  await page.mouse.click(s.x, s.y)
  await page.waitForTimeout(1000)
}

// 2. empty space: nothing changes.
{
  const b = await info()
  const empty = await page.evaluate(({ W, H }) => window.__neuralDev.emptyPoint({ W, H }), { W, H })
  if (!empty) fail('empty-miss', 'no empty point found')
  else {
    await page.mouse.click(W / 2 + empty.x, H / 2 + empty.y)
    await page.waitForTimeout(300)
    const a = await info()
    if (a.centered !== b.centered || a.level !== b.level) fail('empty-miss', `centered ${b.centered}->${a.centered} level ${b.level}->${a.level}`)
    else pass('empty-miss')
  }
}

// 3. two-click navigation: the second click on the selected node ENTERS it -
// the shell opens on it, as an empty container (header, body, no charts).
{
  const i0 = await info()
  await page.mouse.click(W / 2, H / 2)
  await page.waitForTimeout(400)
  const shell = await page.evaluate(() => {
    const p = document.querySelector('.report-panel')
    return p
      ? {
          on: p.dataset.shell,
          title: p.querySelector('.panel-title')?.textContent,
          eyebrow: p.querySelector('.panel-orbit')?.textContent,
          body: !!p.querySelector('.panel-body'),
          bodyChildren: p.querySelector('.panel-body')?.children.length,
          charts: p.querySelectorAll('.recharts-wrapper, svg, .kpi-row, .chart-block').length,
        }
      : null
  })
  const i1 = await info()
  if (i0.level !== 0 || i0.centered !== pick) fail('second-click-enters', `precondition: level ${i0.level} centered ${i0.centered}`)
  else if (!shell) fail('second-click-enters', 'no shell opened')
  else if (i1.level !== 0) fail('second-click-enters', `drilled instead (level ${i1.level})`)
  else if (!shell.body || shell.bodyChildren !== 0 || shell.charts !== 0) fail('second-click-enters', `shell not an empty container: ${JSON.stringify(shell)}`)
  else pass('second-click-enters', { on: shell.on, eyebrow: shell.eyebrow, title: shell.title })
  await page.screenshot({ path: `${outDir}/centering-shell.png` })

  // 3a. Escape closes the shell; the selection is kept.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const closed = await page.evaluate(() => !document.querySelector('.report-panel'))
  const i2 = await info()
  if (!closed) fail('escape-closes-shell', 'shell still open')
  else if (i2.centered !== pick) fail('escape-closes-shell', `selection lost: ${i2.centered}`)
  else pass('escape-closes-shell')
}

// 3b. Escape from a drill (Enter, the sight model): flies out AND returns
// the brain to the centre.
{
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  const drilled = await info()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1200)
  const i = await info()
  const brain = await nodeScreen('brain')
  if (drilled.level !== 1) fail('escape-from-drill', `Enter did not drill (level ${drilled.level})`)
  else if (i.level !== 0 || i.centered !== null) fail('escape-from-drill', `level ${i.level} centered ${i.centered}`)
  else if (brain.dist > 1) fail('escape-from-drill', `brain dist ${brain.dist.toFixed(2)}`)
  else pass('escape-from-drill')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  const j = await info()
  if (j.level !== 1) fail('escape-from-drill', `could not re-drill for the next step: level ${j.level}`)
  await page.screenshot({ path: `${outDir}/centering-drilled.png` })
}

// 4. at level 1, clicking another field node drills out and centres it.
{
  const other = await page.evaluate(({ W, H }) => {
    const d = window.__neuralDev
    return d.pickClickable({ minDist: 260, maxX: W / 2 - 220, maxY: H / 2 - 120 })
  }, { W, H })
  if (!other) fail('level1-click-recentres', 'no other post on screen')
  else {
    const s = await nodeScreen(other)
    await page.mouse.click(s.x, s.y)
    await page.waitForTimeout(1000)
    const i = await info()
    const after = await nodeScreen(other)
    if (i.level !== 0) fail('level1-click-recentres', `level ${i.level}`)
    else if (i.centered !== other) fail('level1-click-recentres', `centered ${i.centered}`)
    else if (after.dist > 1) fail('level1-click-recentres', `dist ${after.dist.toFixed(2)}`)
    else pass('level1-click-recentres', { node: other })
  }
}

// 5. keyboard Enter is unpositioned: it still drills the reticle hub.
{
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1000)
  const i0 = await info()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  const i1 = await info()
  if (i0.level !== 0 || i1.level !== 1) fail('enter-keeps-sight-model', `level ${i0.level}->${i1.level}`)
  else pass('enter-keeps-sight-model')
  await page.keyboard.press('Enter') // anchor holds the level-1 reticle at first: drill out
  await page.waitForTimeout(900)
}

// 6. globe: a click still opens the focused report (frozen S9 path).
{
  await page.goto(`${base}/?scene=globe&tune=0`)
  await page.waitForTimeout(2500)
  await page.mouse.click(W / 2, H / 2)
  await page.waitForTimeout(500)
  const open = await page.evaluate(() => !!document.querySelector(".report-panel"))
  const anyDialog = await page.evaluate(() => !!document.querySelector('[role="dialog"]'))
  if (!open && !anyDialog) fail('globe-tap-opens', 'no panel after click')
  else pass('globe-tap-opens')
}

await browser.close()
const allOk = Object.values(results).every((r) => r.ok) && errors.length === 0
console.log(JSON.stringify({ ok: allOk, results, errors }, null, 2))
process.exit(allOk ? 0 : 1)
