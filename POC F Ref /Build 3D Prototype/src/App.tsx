import { useEffect, useRef } from "react"
import * as THREE from "three"

// ─── Color tokens ────────────────────────────────────────────────────────────
type Hue = "blue" | "red" | "violet"
type Tier = "brain" | "hub" | "node" | "sub" | "terminal"

const PAL: Record<Hue, Record<string, string>> = {
  blue:   { core: "#EAF7FF", body: "#4DA8FF", mid: "#1E6BD6", deep: "#0A2F63", halo: "#2E8BFF" },
  red:    { core: "#FFF0E8", body: "#FF6B4D", mid: "#C43A24", deep: "#5E1409", halo: "#FF4A2E" },
  violet: { core: "#F5EAFF", body: "#A66BFF", mid: "#6B2ED6", deep: "#26094F", halo: "#8B3BFF" },
}

// shell diameter in world units (= spec pixel values, 1 unit ≈ 1 px at z=0)
const TIER_DIAM: Record<Tier, number> = {
  brain: 85, hub: 104, node: 56, sub: 30, terminal: 13,
}

// [haloOpa, bloomOpa, coreOpa]
const TIER_OPA: Record<Tier, [number, number, number]> = {
  brain:    [1.00, 0.90, 1.00],
  hub:      [0.85, 0.80, 0.95],
  node:     [0.60, 0.62, 0.80],
  sub:      [0.38, 0.45, 0.65],
  terminal: [0.20, 0.30, 0.45],
}

// trail core stroke radius for each parent → child tier pair
const TRAIL_RAD: Partial<Record<Tier, number>> = {
  brain: 1.8, hub: 1.1, node: 0.65, sub: 0.35,
}

const R = 1100  // sphere shell radius (world units)
const D = 2000  // camera distance

// ─── Seeded RNG ───────────────────────────────────────────────────────────────
function makeRng(seed: number) {
  let s = seed >>> 0
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
  return {
    rng:  (a: number, b: number) => a + rnd() * (b - a),
    pick: (p: number) => rnd() < p,
  }
}

// ─── Node graph ───────────────────────────────────────────────────────────────
interface NodeData {
  name: string; tier: Tier; hue: Hue
  phi: number; theta: number; r: number
  parentName: string | null; isBokeh?: boolean
}

function buildGraph(): NodeData[] {
  const { rng, pick } = makeRng(20260901)
  const nodes: NodeData[] = []

  function add(name: string, tier: Tier, phi: number, theta: number, r: number, parent: string | null): NodeData {
    const hue: Hue = tier === "brain" ? "violet" : pick(0.15) ? "red" : "blue"
    const n: NodeData = { name, tier, hue, phi, theta, r, parentName: parent }
    nodes.push(n)
    return n
  }

  add("brain", "brain", 0, 0, 0, null)

  const HUBS = 20
  for (let i = 0; i < HUBS; i++) {
    const phi   = Math.acos(1 - 2 * (i + 0.5) / HUBS) + rng(-0.20, 0.20)
    const theta = Math.PI * (1 + Math.sqrt(5)) * i    + rng(-0.30, 0.30)
    const h = add(`n_h${i}`, "hub", phi, theta, R * rng(0.90, 1.10), "brain")

    for (let j = 0; j < Math.round(rng(2, 5)); j++) {
      const nd = add(`${h.name}_n${j}`, "node",
        phi + rng(-0.22, 0.22), theta + rng(-0.22, 0.22),
        h.r * rng(1.10, 1.28), h.name)

      for (let k = 0; k < Math.round(rng(1, 4)); k++) {
        const sb = add(`${nd.name}_s${k}`, "sub",
          nd.phi + rng(-0.28, 0.28), nd.theta + rng(-0.28, 0.28),
          nd.r * rng(1.06, 1.18), nd.name)

        for (let m = 0; m < Math.round(rng(0, 3)); m++) {
          add(`${sb.name}_t${m}`, "terminal",
            sb.phi + rng(-0.38, 0.38), sb.theta + rng(-0.38, 0.38),
            sb.r * rng(1.04, 1.12), sb.name)
        }
      }
    }
  }

  // Mark 10 deep terminals as bokeh blobs
  const terms = nodes.filter(n => n.tier === "terminal")
  const step = Math.max(1, Math.floor(terms.length / 10))
  for (let i = 0; i < terms.length && i < 10 * step; i += step) terms[i].isBokeh = true

  return nodes
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function rgba(hex: string, a: number): string {
  const v = parseInt(hex.slice(1), 16)
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`
}

function hexColor(hex: string): THREE.Color {
  return new THREE.Color(parseInt(hex.slice(1), 16))
}

// ─── Orb canvas texture ───────────────────────────────────────────────────────
const texCache = new Map<string, THREE.CanvasTexture>()

function getOrbTexture(hue: Hue, tier: Tier): THREE.CanvasTexture {
  const key = `${hue}:${tier}`
  if (texCache.has(key)) return texCache.get(key)!

  // Larger canvases for bigger tiers so the halo has room
  const SIZE = tier === "brain" ? 512 : tier === "hub" ? 256 : tier === "node" ? 128 : 64
  const cv = document.createElement("canvas")
  cv.width = SIZE; cv.height = SIZE
  const ctx = cv.getContext("2d")!
  const c = PAL[hue]
  const [haloOpa, bloomOpa, coreOpa] = TIER_OPA[tier]
  const cx = SIZE / 2, cy = SIZE / 2

  // Disc radius — the solid star body (15% of canvas so halo has plenty of room)
  const dr = SIZE * 0.15

  // ── 1. Outer halo: faint corona, scaled by tier brightness  ─────────────
  const hg = ctx.createRadialGradient(cx, cy, dr * 1.2, cx, cy, SIZE * 0.49)
  hg.addColorStop(0,   rgba(c.halo, haloOpa * 0.28))
  hg.addColorStop(0.4, rgba(c.halo, haloOpa * 0.10))
  hg.addColorStop(1,   rgba(c.halo, 0))
  ctx.fillStyle = hg
  ctx.beginPath(); ctx.arc(cx, cy, SIZE * 0.49, 0, Math.PI * 2); ctx.fill()

  // ── 2. Bloom: tight inner glow just around the disc  ─────────────────────
  const bg = ctx.createRadialGradient(cx, cy, dr * 0.8, cx, cy, dr * 2.8)
  bg.addColorStop(0,   rgba(c.body, bloomOpa * 0.50))
  bg.addColorStop(0.5, rgba(c.body, bloomOpa * 0.18))
  bg.addColorStop(1,   rgba(c.body, 0))
  ctx.fillStyle = bg
  ctx.beginPath(); ctx.arc(cx, cy, dr * 2.8, 0, Math.PI * 2); ctx.fill()

  // ── 3. Solid disc: pure flat body color, no gradients  ───────────────────
  ctx.beginPath(); ctx.arc(cx, cy, dr, 0, Math.PI * 2)
  ctx.fillStyle = rgba(c.body, coreOpa)
  ctx.fill()

  // ── 4. Tiny white pinpoint — 1–2 px equivalent, not a large gradient  ────
  const pinR = Math.max(1, dr * 0.22)
  ctx.beginPath(); ctx.arc(cx, cy, pinR, 0, Math.PI * 2)
  ctx.fillStyle = `rgba(255,255,255,${Math.min(1, coreOpa * 0.85)})`
  ctx.fill()

  const tex = new THREE.CanvasTexture(cv)
  texCache.set(key, tex)
  return tex
}

// ─── Field wash texture ───────────────────────────────────────────────────────
function makeFieldTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas"); cv.width = 512; cv.height = 512
  const ctx = cv.getContext("2d")!
  const g = ctx.createRadialGradient(256, 256, 0, 256, 256, 256)
  g.addColorStop(0,   "rgba(10,24,48,0.88)")
  g.addColorStop(0.55,"rgba(6,14,28,0.60)")
  g.addColorStop(1,   "rgba(0,0,0,0)")
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 512)
  return new THREE.CanvasTexture(cv)
}

// ─── Trail tube geometry ──────────────────────────────────────────────────────
function buildTrailGeometry(
  pPos: THREE.Vector3, cPos: THREE.Vector3,
  nodePhi: number, nodeTheta: number,
  radius: number, segments = 18
): THREE.TubeGeometry {
  const mid = pPos.clone().add(cPos).multiplyScalar(0.5)
  const chord = cPos.clone().sub(pPos)
  const chordLen = chord.length()

  // Perpendicular offset for the Bézier control point
  let perp = new THREE.Vector3()
  perp.crossVectors(chord, new THREE.Vector3(0, 1, 0)).normalize()
  if (perp.lengthSq() < 0.01) perp.crossVectors(chord, new THREE.Vector3(1, 0, 0)).normalize()
  const sign = Math.sin(nodePhi * 7.3 + nodeTheta) > 0 ? 1 : -1
  const ctrl = mid.clone().addScaledVector(perp, chordLen * 0.10 * sign)

  const curve = new THREE.QuadraticBezierCurve3(pPos, ctrl, cPos)
  return new THREE.TubeGeometry(curve, segments, radius, 5, false)
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!

    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000)

    const scene = new THREE.Scene()

    // Camera — stationary, wide FOV so the full globe fits in view.
    const camera = new THREE.PerspectiveCamera(52, 1, 1, 20000)
    camera.position.set(0, 0, 2000)
    camera.lookAt(0, 0, 0)

    // The single group that rotates — camera never moves
    const sceneGroup = new THREE.Group()
    sceneGroup.rotation.x = -0.18  // slight initial downward tilt
    scene.add(sceneGroup)

    // Background field wash (behind scene group, not part of rotation)
    const fieldMat = new THREE.MeshBasicMaterial({
      map: makeFieldTexture(), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
    const fieldMesh = new THREE.Mesh(new THREE.PlaneGeometry(7000, 5000), fieldMat)
    fieldMesh.position.z = -1200
    scene.add(fieldMesh)

    // Warm contamination (Appendix C) — amber/rust ellipse off-center
    const wCv = document.createElement("canvas"); wCv.width = 256; wCv.height = 256
    const wCtx = wCv.getContext("2d")!
    const wg = wCtx.createRadialGradient(128, 128, 0, 128, 128, 128)
    wg.addColorStop(0,   "rgba(60,22,8,0.55)")
    wg.addColorStop(0.5, "rgba(30,10,4,0.22)")
    wg.addColorStop(1,   "rgba(0,0,0,0)")
    wCtx.fillStyle = wg; wCtx.fillRect(0, 0, 256, 256)
    const warmMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2800, 2200),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(wCv), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    )
    warmMesh.position.set(-550, 350, -1100)
    scene.add(warmMesh)

    // ── Build scene ───────────────────────────────────────────────────────────
    const nodes = buildGraph()
    const nodeMap = new Map<string, NodeData>(nodes.map(n => [n.name, n]))

    // World positions in the sceneGroup
    function nodePos(n: NodeData): THREE.Vector3 {
      if (n.tier === "brain") return new THREE.Vector3()
      return new THREE.Vector3(
        n.r * Math.sin(n.phi) * Math.cos(n.theta),
        n.r * Math.cos(n.phi),
        n.r * Math.sin(n.phi) * Math.sin(n.theta),
      )
    }
    const positions = new Map<string, THREE.Vector3>(nodes.map(n => [n.name, nodePos(n)]))

    // Shared sprite materials (one per hue:tier, cloned per sprite for opacity control)
    function makeSpriteMat(hue: Hue, tier: Tier) {
      return new THREE.SpriteMaterial({
        map: getOrbTexture(hue, tier),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      })
    }

    // ── Sprites (orbs) ────────────────────────────────────────────────────────
    type SpriteEntry = { sprite: THREE.Sprite; node: NodeData; worldPos: THREE.Vector3 }
    const spriteEntries: SpriteEntry[] = []

    for (const n of nodes) {
      const mat = makeSpriteMat(n.hue, n.tier)
      const sprite = new THREE.Sprite(mat)

      const pos = positions.get(n.name)!
      sprite.position.copy(pos)

      // World-space size: shell diameter × 4.2 (includes halo area).
      // Bokeh terminals are much larger but very transparent.
      const diam = TIER_DIAM[n.tier]
      const sz = n.isBokeh ? diam * 10 : diam * 4.2
      sprite.scale.set(sz, sz, 1)

      // Brain renders on top
      sprite.renderOrder = n.tier === "brain" ? 10 : 1

      sceneGroup.add(sprite)
      spriteEntries.push({ sprite, node: n, worldPos: new THREE.Vector3() })
    }

    // ── Trails ────────────────────────────────────────────────────────────────
    // We collect geometries per layer, then merge for performance
    const coreGeos: THREE.TubeGeometry[]  = []
    const glowGeos: THREE.TubeGeometry[]  = []
    const coreColors: THREE.Color[][]     = []
    const glowColors: THREE.Color[][]     = []

    for (const n of nodes) {
      if (!n.parentName) continue
      const parent = nodeMap.get(n.parentName)!
      const pPos = positions.get(n.parentName)!
      const cPos = positions.get(n.name)!

      // Offset endpoints to each node's shell surface so trails connect visually
      const dir = cPos.clone().sub(pPos)
      const dist = dir.length()
      if (dist < 1) continue
      dir.divideScalar(dist)
      const pSurf = pPos.clone().addScaledVector(dir,  TIER_DIAM[parent.tier] / 2)
      const cSurf = cPos.clone().addScaledVector(dir, -TIER_DIAM[n.tier] / 2)

      const rad = TRAIL_RAD[parent.tier] ?? 0.3
      const coreGeo = buildTrailGeometry(pSurf, cSurf, n.phi, n.theta, rad)
      const glowGeo  = buildTrailGeometry(pSurf, cSurf, n.phi, n.theta, rad * 3.2, 12)

      // Vertex colors: gradient from parent body → trail/base → child body
      const pColor = hexColor(PAL[parent.hue].body)
      const cColor = hexColor(PAL[n.hue].body)
      const baseColor = new THREE.Color(0x2e6fb0)
      const hotColor  = new THREE.Color(0x9fd8ff)

      const count = coreGeo.attributes.position.count
      const cColors: THREE.Color[] = []
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1)
        const col = new THREE.Color()
        if (parent.tier === "brain" && t < 0.15) {
          col.lerpColors(hotColor, pColor, t / 0.15)
        } else if (t < 0.4) {
          col.lerpColors(pColor, baseColor, t / 0.4)
        } else {
          col.lerpColors(baseColor, cColor, (t - 0.4) / 0.6)
        }
        cColors.push(col)
      }
      coreColors.push(cColors)
      coreGeos.push(coreGeo)

      const gCount = glowGeo.attributes.position.count
      const gColors: THREE.Color[] = []
      for (let i = 0; i < gCount; i++) {
        const t = i / (gCount - 1)
        const col = new THREE.Color().lerpColors(pColor, cColor, t).multiplyScalar(0.55)
        gColors.push(col)
      }
      glowColors.push(gColors)
      glowGeos.push(glowGeo)
    }

    // Helper: apply vertex colors to a geometry
    function applyVertexColors(geo: THREE.TubeGeometry, colors: THREE.Color[]) {
      const pos = geo.attributes.position
      const colorArr = new Float32Array(pos.count * 3)
      // TubeGeometry has tubularSegments+1 rings × radialSegments+1 verts
      // We need to map from per-tube-point index back to original curve parameter
      const tubSegs = (geo.parameters as { tubularSegments?: number }).tubularSegments ?? 18
      const radSegs = (geo.parameters as { radialSegments?: number }).radialSegments ?? 5
      for (let i = 0; i <= tubSegs; i++) {
        const t = i / tubSegs
        const colorIdx = Math.min(Math.round(t * (colors.length - 1)), colors.length - 1)
        const col = colors[colorIdx]
        for (let j = 0; j <= radSegs; j++) {
          const vi = i * (radSegs + 1) + j
          if (vi * 3 + 2 < colorArr.length) {
            colorArr[vi * 3]     = col.r
            colorArr[vi * 3 + 1] = col.g
            colorArr[vi * 3 + 2] = col.b
          }
        }
      }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colorArr, 3))
    }

    // Merge and add core trail mesh
    if (coreGeos.length > 0) {
      coreGeos.forEach((g, i) => applyVertexColors(g, coreColors[i]))
      const merged = mergeBufferGeometries(coreGeos)
      if (merged) {
        const mat = new THREE.MeshBasicMaterial({
          vertexColors: true, transparent: true, opacity: 0.72,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
        sceneGroup.add(new THREE.Mesh(merged, mat))
        coreGeos.forEach(g => g.dispose())
      }
    }

    // Merge and add glow trail mesh
    if (glowGeos.length > 0) {
      glowGeos.forEach((g, i) => applyVertexColors(g, glowColors[i]))
      const merged = mergeBufferGeometries(glowGeos)
      if (merged) {
        const mat = new THREE.MeshBasicMaterial({
          vertexColors: true, transparent: true, opacity: 0.22,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
        sceneGroup.add(new THREE.Mesh(merged, mat))
        glowGeos.forEach(g => g.dispose())
      }
    }

    // ── Resize ────────────────────────────────────────────────────────────────
    function resize() {
      const w = canvas.clientWidth, h = canvas.clientHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    // ── Drag-to-orbit with momentum ───────────────────────────────────────────
    let dragging = false, lastX = 0, lastY = 0
    let velYaw = 0.0025, velPitch = 0.0004   // gentle initial motion
    const DAMP = 0.94

    function onDown(e: PointerEvent) {
      dragging = true; lastX = e.clientX; lastY = e.clientY
      velYaw = 0; velPitch = 0
      canvas.setPointerCapture(e.pointerId)
      canvas.style.cursor = "grabbing"
    }
    function onMove(e: PointerEvent) {
      if (!dragging) return
      const dx = e.clientX - lastX, dy = e.clientY - lastY
      velYaw = dx * 0.006; velPitch = dy * 0.006
      sceneGroup.rotation.y += velYaw
      sceneGroup.rotation.x = Math.max(-1.1, Math.min(1.1, sceneGroup.rotation.x + velPitch))
      lastX = e.clientX; lastY = e.clientY
    }
    function onUp() {
      dragging = false
      canvas.style.cursor = "grab"
    }

    canvas.addEventListener("pointerdown", onDown)
    canvas.addEventListener("pointermove", onMove)
    canvas.addEventListener("pointerup",   onUp)
    canvas.addEventListener("pointerleave", onUp)

    // ── Animation loop ────────────────────────────────────────────────────────
    const tmpPos = new THREE.Vector3()
    let raf = 0

    // Brain ambient pulse
    const brainEntry = spriteEntries.find(e => e.node.tier === "brain")!
    let pulseT = 0

    function animate() {
      raf = requestAnimationFrame(animate)
      pulseT += 0.003

      // Apply momentum (always damping, even during drag the vel resets each move)
      if (!dragging) {
        sceneGroup.rotation.y += velYaw
        sceneGroup.rotation.x = Math.max(-1.1, Math.min(1.1, sceneGroup.rotation.x + velPitch))
        velYaw *= DAMP
        velPitch *= DAMP
      }

      // Update each sprite: depth-based opacity from world-space Z
      for (const { sprite, node } of spriteEntries) {
        sprite.getWorldPosition(tmpPos)
        // zNorm: 0 = far back (z = -R*1.5), 1 = far front (z = +R*1.5)
        const zNorm = Math.max(0, Math.min(1, (tmpPos.z + R * 1.5) / (R * 3)))

        let depthOpa: number
        if (node.isBokeh) {
          depthOpa = 0.22
        } else {
          // Continuous falloff: front=1.0, back=0.30, smooth curve
          depthOpa = 0.30 + 0.70 * (zNorm * zNorm * (3 - 2 * zNorm))  // smoothstep
        }

        const [haloOpa] = TIER_OPA[node.tier]
        sprite.material.opacity = depthOpa * haloOpa * (node.tier === "brain" ? 1.0 : 0.95)
      }

      // Brain pulse: scale oscillates 100%→106%
      if (brainEntry) {
        const pulse = 1.0 + 0.06 * (0.5 + 0.5 * Math.sin(pulseT))
        const base  = TIER_DIAM.brain * 4.2 * pulse
        brainEntry.sprite.scale.set(base, base, 1)
      }

      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener("pointerdown", onDown)
      canvas.removeEventListener("pointermove", onMove)
      canvas.removeEventListener("pointerup",   onUp)
      canvas.removeEventListener("pointerleave", onUp)
      renderer.dispose()
      texCache.forEach(t => t.dispose())
      texCache.clear()
    }
  }, [])

  return (
    <div className="w-full h-full" style={{ background: "#000" }}>
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ cursor: "grab", touchAction: "none" }}
      />
    </div>
  )
}

// ─── Minimal geometry merge (no external dep) ─────────────────────────────────
function mergeBufferGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geos.length === 0) return null
  const attrs = Object.keys(geos[0].attributes)
  const merged = new THREE.BufferGeometry()

  for (const name of attrs) {
    const arrays: Float32Array[] = geos.map(g => {
      const a = g.attributes[name]
      return a.array as Float32Array
    })
    const total = arrays.reduce((s, a) => s + a.length, 0)
    const out = new Float32Array(total)
    let off = 0
    for (const a of arrays) { out.set(a, off); off += a.length }
    merged.setAttribute(name, new THREE.BufferAttribute(out, geos[0].attributes[name].itemSize))
  }

  // Merge index buffers
  const hasIndex = geos[0].index !== null
  if (hasIndex) {
    let offset = 0
    const idxArrays: number[] = []
    for (const g of geos) {
      const idx = g.index!
      const vCount = g.attributes.position.count
      for (let i = 0; i < idx.count; i++) idxArrays.push(idx.getX(i) + offset)
      offset += vCount
    }
    merged.setIndex(idxArrays)
  }

  return merged
}
