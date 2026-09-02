// The neural star-network scene (ORB_NEURAL_PORT_SPEC) - slices P2-P5.
// Rendering: full population in one instanced draw, tapered depth-dimmed
// trails, beads, traveling pulses, §6 anchor dominance, environment planes.
// P5: the constellation quaternion is driven by the EXISTING physics
// integrator (untouched - same hook, same events, same detents), and
// selection gains the recursive two-level model:
//   level 0 - reticle over the hub shell; tap drills into the hub
//   level 1 - the hub holds the anchor ROLE (recentered, dominance
//             treatment handed off) and its category's reports re-shell
//             around it ON THE GLOBE GRID, so the frozen detents center
//             reports exactly; tap opens the focused report through the
//             frozen store path (byte-compatible payload); when no report
//             holds the reticle the anchor is the candidate and tap drills
//             back out (§6: the center anchor is the drill-out target).
// ORB_NEURAL_SPEC.md (authoritative for select.*) is missing - assumptions
// are flagged in PORT_LOG.md P5.

import { useFrame, useThree } from '@react-three/fiber'
import { useControls } from 'leva'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AdditiveBlending,
  Color,
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three'
import { FEEL } from '../config/feel'
import { ORBITS } from '../data/orbits'
import type { InputBus } from '../input/InputBus'
import {
  applyZoomEvent,
  commitZoomView,
  createZoomView,
  stepZoomView,
  zoomRuntime,
} from '../input/zoomView'
import { nearestOrbitIndex, rotateYawPitch } from '../orb/geometry'
import type { Vec3 } from '../orb/geometry'
import { orbRuntime, stepPhysics, useOrbPhysics } from '../orb/useOrbPhysics'
import { useStore } from '../store'
import { NCONF, generationTuple, tupleHash } from './config'
import { buildGraph, layoutHash, nodePosition } from './graph'
import type { NeuralNode } from './graph'
import { PAL } from './palette'
import { buildPulseMesh, syncPulseUniforms } from './pulses'
import { childShell, hubDirs, hubOrbitIndex, resolveLevel1, resolveReticle } from './selection'
import type { ChildShellItem } from './selection'
import { createStarMesh, syncStarUniforms } from './starField'
import type { StarInstance } from './starField'
import { buildTrailMeshes, buildTrailSpecs, syncTrailUniforms } from './trails'
import type { TrailSpec } from './trails'

// Same WebGL-context hygiene as Orb.tsx: full reload instead of HMR remount.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload()
  })
}

declare global {
  interface Window {
    __nconf?: typeof NCONF
    __neuralInfo?: {
      drawCalls: number
      fps: number
      nodeCount: number
      trailCount: number
      layoutHash: string
      seed: number
      tupleHash: string
      level: number
      target: number
      zoom: number
      handCount: number
      anchorHub: number | null
      candidate: string | null
    }
  }
}

// ── Environment (§4.4) ──────────────────────────────────────────────────────
const ENV_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const WASH_FRAG = /* glsl */ `
  varying vec2 vUv;
  void main() {
    float r = clamp(distance(vUv, vec2(0.5)) * 2.0, 0.0, 1.0);
    vec3 cIn = vec3(10.0, 24.0, 48.0) / 255.0;
    vec3 cMid = vec3(6.0, 14.0, 28.0) / 255.0;
    vec3 c;
    float a;
    if (r < 0.55) {
      float t = r / 0.55;
      c = mix(cIn, cMid, t);
      a = mix(0.88, 0.60, t);
    } else {
      float t = (r - 0.55) / 0.45;
      c = mix(cMid, vec3(0.0), t);
      a = mix(0.60, 0.0, t);
    }
    gl_FragColor = vec4(c, a);
    #include <colorspace_fragment>
  }
`
const WARM_FRAG = /* glsl */ `
  varying vec2 vUv;
  void main() {
    float r = clamp(distance(vUv, vec2(0.5)) * 2.0, 0.0, 1.0);
    vec3 cIn = vec3(60.0, 22.0, 8.0) / 255.0;
    vec3 cMid = vec3(30.0, 10.0, 4.0) / 255.0;
    vec3 c;
    float a;
    if (r < 0.5) {
      float t = r / 0.5;
      c = mix(cIn, cMid, t);
      a = mix(0.55, 0.22, t);
    } else {
      float t = (r - 0.5) / 0.5;
      c = mix(cMid, vec3(0.0), t);
      a = mix(0.22, 0.0, t);
    }
    gl_FragColor = vec4(c, a);
    #include <colorspace_fragment>
  }
`
const GRAIN_VERT = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`
const GRAIN_FRAG = /* glsl */ `
  uniform float uAmount;
  void main() {
    float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    gl_FragColor = vec4(vec3(n), uAmount);
  }
`

function envMesh(frag: string, w: number, h: number): Mesh {
  const mat = new ShaderMaterial({
    vertexShader: ENV_VERT,
    fragmentShader: frag,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  })
  return new Mesh(new PlaneGeometry(w, h), mat)
}

function slider(
  get: () => number,
  set: (v: number) => void,
  min: number,
  max: number,
  step: number,
) {
  return { value: get(), min, max, step, onChange: set }
}

function disposeMesh(mesh: Mesh): void {
  mesh.geometry.dispose()
  ;(mesh.material as ShaderMaterial).dispose()
}

const BEAD_DIAM = 6
const BEAD_OPA = [1, 1, 1] as const
const TAN_HALF_FOV = Math.tan((52 / 2) * (Math.PI / 180))
const UP = new Vector3(0, 1, 0)
const FALLBACK = new Vector3(1, 0, 0)

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

/** Trails from the drilled anchor to its re-shelled reports (§4.3 rules). */
function reportTrailSpecs(
  anchorLocal: Vector3,
  anchorHue: keyof typeof PAL,
  shell: readonly ChildShellItem[],
): TrailSpec[] {
  const specs: TrailSpec[] = []
  for (const item of shell) {
    const cPos = anchorLocal.clone().add(new Vector3(...item.local))
    const dir = cPos.clone().sub(anchorLocal).normalize()
    const pSurf = anchorLocal.clone().addScaledVector(dir, NCONF.render.tierDiam.hub / 2)
    const cSurf = cPos.clone().addScaledVector(dir, -NCONF.render.tierDiam.node / 2)
    const chord = cSurf.clone().sub(pSurf)
    const mid = pSurf.clone().add(cSurf).multiplyScalar(0.5)
    const perp = new Vector3().crossVectors(chord, UP).normalize()
    if (perp.lengthSq() < 0.01) perp.crossVectors(chord, FALLBACK).normalize()
    const sign = Math.sin(item.phi * 7.3 + item.theta) > 0 ? 1 : -1
    specs.push({
      pSurf,
      ctrl: mid.addScaledVector(perp, chord.length() * NCONF.trail.bendFraction * sign),
      cSurf,
      radius: NCONF.trail.radByTier.hub,
      parentTier: 'hub',
      parentBody: new Color(PAL[anchorHue].body),
      childBody: new Color(PAL[anchorHue].body),
      childName: `report_${item.orbitIndex}_${item.itemIndex}`,
    })
  }
  return specs
}

interface DrillState {
  level: 0 | 1
  hubNode: NeuralNode | null
  hubLocal: Vector3 | null
  orbitIndex: number | null
  shell: ChildShellItem[]
  /** recenter blend 0 (out) → 1 (in) */
  k: number
  target: 0 | 1
  reportMesh: Mesh | null
  reportTrails: { core: Mesh; glow: Mesh } | null
  roleMesh: Mesh | null
  candidateHubInstance: number
  focusedItem: number
}

export function NeuralScene({ bus }: { bus: InputBus }) {
  const physics = useOrbPhysics(bus) // frozen hook: bus events → pure physics
  const gl = useThree((s) => s.gl)
  const offsetRef = useRef<Group>(null)
  const tiltRef = useRef<Group>(null)
  const spinRef = useRef<Group>(null)
  const [genVersion, setGenVersion] = useState(0)
  const regenRef = useRef(() => setGenVersion((v) => v + 1))

  useEffect(() => {
    gl.setClearColor(0x000000, 1)
    if (import.meta.env.DEV) window.__nconf = NCONF
  }, [gl])

  const rebuildSlider = (
    get: () => number,
    set: (v: number) => void,
    min: number,
    max: number,
    step: number,
  ) => ({
    value: get(),
    min,
    max,
    step,
    onChange: (v: number) => {
      if (v === get()) return
      set(v)
      regenRef.current()
    },
  })

  useControls('neural render', {
    spriteScale: slider(() => NCONF.render.spriteScale, (v) => { NCONF.render.spriteScale = v }, 1, 8, 0.1),
    bokehScale: slider(() => NCONF.render.bokehScale, (v) => { NCONF.render.bokehScale = v }, 2, 20, 0.5),
    bokehOpacity: slider(() => NCONF.render.bokehOpacity, (v) => { NCONF.render.bokehOpacity = v }, 0, 1, 0.01),
    opacityFloor: slider(() => NCONF.depth.opacityFloor, (v) => { NCONF.depth.opacityFloor = v }, 0, 1, 0.01),
    desatStrength: slider(() => NCONF.depth.desatStrength, (v) => { NCONF.depth.desatStrength = v }, 0, 1, 0.01),
  })

  useControls('neural generation', {
    seed: rebuildSlider(() => NCONF.generation.seed, (v) => { NCONF.generation.seed = v }, 1, 99999999, 1),
    hubCount: rebuildSlider(() => NCONF.generation.hubCount, (v) => { NCONF.generation.hubCount = v }, 4, 40, 1),
    R: rebuildSlider(() => NCONF.generation.R, (v) => { NCONF.generation.R = v }, 400, 1800, 10),
    redProbability: rebuildSlider(() => NCONF.generation.redProbability, (v) => { NCONF.generation.redProbability = v }, 0, 1, 0.01),
  })

  useControls('neural trail', {
    coreOpacity: slider(() => NCONF.trail.coreOpacity, (v) => { NCONF.trail.coreOpacity = v }, 0, 1, 0.01),
    glowOpacity: slider(() => NCONF.trail.glowOpacity, (v) => { NCONF.trail.glowOpacity = v }, 0, 1, 0.01),
    taperBase: rebuildSlider(() => NCONF.trail.taperBase, (v) => { NCONF.trail.taperBase = v }, 0.2, 1, 0.01),
    taperExp: rebuildSlider(() => NCONF.trail.taperExp, (v) => { NCONF.trail.taperExp = v }, 0.5, 4, 0.05),
    bendFraction: rebuildSlider(() => NCONF.trail.bendFraction, (v) => { NCONF.trail.bendFraction = v }, 0, 0.3, 0.005),
    beadsEnabled: {
      value: NCONF.trail.beadsEnabled,
      onChange: (v: boolean) => { NCONF.trail.beadsEnabled = v },
    },
    pulseEnabled: {
      value: NCONF.trail.pulseEnabled,
      onChange: (v: boolean) => { NCONF.trail.pulseEnabled = v },
    },
  })

  useControls('neural anchor', {
    brainDiam: rebuildSlider(() => NCONF.anchor.brainDiam, (v) => { NCONF.anchor.brainDiam = v }, 85, 320, 5),
    coronaMult: slider(() => NCONF.anchor.coronaMult, (v) => { NCONF.anchor.coronaMult = v }, 1, 3, 0.05),
    spikeLength: slider(() => NCONF.anchor.spikeLength, (v) => { NCONF.anchor.spikeLength = v }, 0.05, 0.49, 0.01),
    pulseAmp: slider(() => NCONF.brainPulse.amp, (v) => { NCONF.brainPulse.amp = v }, 0, 0.2, 0.005),
  })

  useControls('neural select', {
    recenterDuration: slider(() => NCONF.select.recenterDuration, (v) => { NCONF.select.recenterDuration = v }, 150, 2000, 10),
    recenterPush: slider(() => NCONF.select.recenterPush, (v) => { NCONF.select.recenterPush = v }, 0, 1500, 10),
    childShellRadius: slider(() => NCONF.select.childShellRadius, (v) => { NCONF.select.childShellRadius = v }, 100, 600, 5),
    anchorWinsBelow: slider(() => NCONF.select.anchorWinsBelow, (v) => { NCONF.select.anchorWinsBelow = v }, 0.5, 0.99, 0.01),
    affordanceLift: slider(() => NCONF.select.affordanceLift, (v) => { NCONF.select.affordanceLift = v }, 0, 1, 0.01),
  })

  useControls('neural environment', {
    grainEnabled: {
      value: NCONF.render.grainEnabled,
      onChange: (v: boolean) => { NCONF.render.grainEnabled = v },
    },
    grainAmount: slider(() => NCONF.render.grainAmount, (v) => { NCONF.render.grainAmount = v }, 0, 0.1, 0.005),
  })

  const environment = useMemo(() => {
    const wash = envMesh(WASH_FRAG, 7000, 5000)
    wash.position.z = -1200
    wash.renderOrder = -10
    const warm = envMesh(WARM_FRAG, 2800, 2200)
    warm.position.set(-550, 350, -1100)
    warm.renderOrder = -9
    const grain = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        vertexShader: GRAIN_VERT,
        fragmentShader: GRAIN_FRAG,
        uniforms: { uAmount: { value: NCONF.render.grainAmount } },
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    )
    grain.renderOrder = 100
    grain.frustumCulled = false
    return { wash, warm, grain }
  }, [])

  const built = useMemo(() => {
    const nodes = buildGraph()
    const instances: StarInstance[] = []
    const hubInstanceIndices: number[] = []
    const hubNodes: NeuralNode[] = []
    for (const n of nodes) {
      if (n.tier === 'brain') continue
      if (n.tier === 'hub') {
        hubInstanceIndices.push(instances.length)
        hubNodes.push(n)
      }
      const [x, y, z] = nodePosition(n)
      instances.push({ pos: new Vector3(x, y, z), tier: n.tier, hue: n.hue, isBokeh: n.isBokeh })
    }
    const starMesh = createStarMesh(instances)
    starMesh.renderOrder = 1

    const brainMesh = createStarMesh([
      { pos: new Vector3(0, 0, 0), tier: 'brain', hue: 'violet', diam: NCONF.anchor.brainDiam },
    ])
    const brainMat = brainMesh.material as ShaderMaterial
    brainMat.uniforms.uTierMult.value = 1.0
    brainMat.uniforms.uAnchor.value = 1
    brainMesh.renderOrder = 10

    const specs = buildTrailSpecs(nodes)
    const trails = buildTrailMeshes(specs)

    const beadInstances: StarInstance[] = []
    for (const s of specs) {
      beadInstances.push(
        { pos: s.pSurf, tier: 'terminal', hue: 'blue', diam: BEAD_DIAM, opa: BEAD_OPA },
        { pos: s.cSurf, tier: 'terminal', hue: 'blue', diam: BEAD_DIAM, opa: BEAD_OPA },
      )
    }
    const beadMesh = createStarMesh(beadInstances)
    ;(beadMesh.material as ShaderMaterial).uniforms.uPinOnly.value = 1
    beadMesh.renderOrder = 2

    const pulseMesh = buildPulseMesh(specs)
    pulseMesh.renderOrder = 3

    const hd = hubDirs(nodes)

    return {
      starMesh,
      brainMesh,
      trails,
      beadMesh,
      pulseMesh,
      hubNodes,
      hubInstanceIndices,
      hubDirList: hd.dirs,
      nodeCount: nodes.length,
      trailCount: specs.length,
      layoutHash: layoutHash(nodes),
      tupleHash: tupleHash(generationTuple()),
      seed: NCONF.generation.seed,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genVersion])

  const drill = useRef<DrillState>({
    level: 0,
    hubNode: null,
    hubLocal: null,
    orbitIndex: null,
    shell: [],
    k: 0,
    target: 0,
    reportMesh: null,
    reportTrails: null,
    roleMesh: null,
    candidateHubInstance: -1,
    focusedItem: -1,
  })

  // Two-hand zoom view (ORB_ZOOM_SPEC): pure model, stepped in useFrame.
  const zoomView = useRef(createZoomView()).current

  // Drill transitions. Two entry points share ONE path:
  //  - tap reuses the existing gesture vocabulary only: the frozen App
  //    listener opens the focused report on the same event; at level 0 (and
  //    when the anchor holds the reticle) the store focus is null so that
  //    path no-ops and the tap drives navigation instead;
  //  - the two-hand zoom commit (ORB_ZOOM_SPEC section 3) fires the SAME
  //    transition on the reticle-focused hub (in) or the anchor (out). It
  //    never opens a report and never drills past the two levels.
  // Continuous zoom events feed the pure zoom view; useFrame does the dolly.
  useEffect(() => {
    const d = drill.current
    const progressNow = () => {
      const k = easeInOutCubic(d.k)
      return d.target === 1 ? k : 1 - k
    }
    const drillIn = (hubIndex: number) => {
      const hubNode = built.hubNodes[hubIndex]
      const orbitIndex = hubOrbitIndex(hubIndex)
      const [x, y, z] = nodePosition(hubNode)
      const hubLocal = new Vector3(x, y, z)
      d.hubNode = hubNode
      d.hubLocal = hubLocal
      d.orbitIndex = orbitIndex
      d.shell = childShell(orbitIndex)
      d.target = 1
      d.level = 1

      // Build the child-shell meshes (report stars + anchor trails + role).
      const reportInstances: StarInstance[] = d.shell.map((item) => ({
        pos: hubLocal.clone().add(new Vector3(...(item.local as Vec3))),
        tier: 'node',
        hue: hubNode.hue,
      }))
      const reportMesh = createStarMesh(reportInstances)
      reportMesh.renderOrder = 5
      const rSpecs = reportTrailSpecs(hubLocal, hubNode.hue, d.shell)
      const reportTrails = buildTrailMeshes(rSpecs)
      reportTrails.core.renderOrder = 4
      reportTrails.glow.renderOrder = 4
      const roleMesh = createStarMesh([{ pos: hubLocal.clone(), tier: 'hub', hue: hubNode.hue }])
      const roleMat = roleMesh.material as ShaderMaterial
      roleMat.uniforms.uTierMult.value = 1.0
      roleMat.uniforms.uAnchor.value = 1
      roleMesh.renderOrder = 11
      d.reportMesh = reportMesh
      d.reportTrails = reportTrails
      d.roleMesh = roleMesh
      spinRef.current?.add(reportMesh, reportTrails.core, reportTrails.glow, roleMesh)

      // Walk the pitch detent ladder to the category latitude - the same
      // `step` vocabulary OrbitIndex uses; physics untouched.
      const p = orbRuntime.physics
      const lats = [...ORBITS.map((o) => o.latitude)].sort((a, b) => a - b)
      const rank = (lat: number) => lats.indexOf(lat)
      const current = ORBITS[nearestOrbitIndex(ORBITS, p.forcedPitch ?? p.pitch)].latitude
      const delta = rank(ORBITS[orbitIndex].latitude) - rank(current)
      for (let i = 0; i < Math.abs(delta); i++) {
        bus.emit({ type: 'step', axis: 'pitch', dir: delta > 0 ? 1 : -1 })
      }
    }
    const reticleHub = () =>
      resolveReticle(built.hubDirList, orbRuntime.physics.yaw, orbRuntime.physics.pitch)

    return bus.on((e) => {
      if (e.type === 'zoom') {
        applyZoomEvent(zoomView, e)
        return
      }
      if (e.type !== 'tap' && e.type !== 'zoomCommit') return
      if (useStore.getState().openReport) return // input suspended while open
      if (e.type === 'zoomCommit') {
        if (e.dir === 'in') {
          if (d.level === 0) {
            const r = reticleHub()
            if (r.index < 0) return
            drillIn(r.index)
          } else if (d.target === 0) {
            d.target = 1 // commit reversed a drill-out in flight: re-drill the same hub
          } else {
            return // level 1: zoom-in dollies to zoomMax and stops - tap owns report-open
          }
        } else {
          if (d.level !== 1 || d.target !== 1) return // level 0: dolly to zoomMin and stop
          d.target = 0
        }
        commitZoomView(zoomView, progressNow())
        return
      }
      if (d.level === 0) {
        const r = reticleHub()
        if (r.index < 0) return
        drillIn(r.index)
      } else {
        // Level 1: the anchor is the drill-out target (§6). When a report
        // holds the reticle the frozen path opens it; when the anchor holds
        // it (focus null), tap flies back out.
        const r = resolveLevel1(d.shell, orbRuntime.physics.yaw, orbRuntime.physics.pitch)
        if (r.anchorWins) d.target = 0
      }
    })
  }, [bus, built, zoomView])

  useEffect(
    () => () => {
      disposeMesh(built.starMesh)
      disposeMesh(built.brainMesh)
      disposeMesh(built.trails.core)
      disposeMesh(built.trails.glow)
      disposeMesh(built.beadMesh)
      disposeMesh(built.pulseMesh)
    },
    [built],
  )

  useControls(
    'neural generation',
    {
      layout: {
        value: `seed ${built.seed} · tuple ${built.tupleHash} · layout ${built.layoutHash} · ${built.nodeCount} nodes`,
        editable: false,
      },
    },
    [built],
  )

  const fpsState = useRef({ frames: 0, windowStart: 0 })
  const scratch = useRef(new Vector3()).current

  useFrame((state, delta) => {
    const d = drill.current
    stepPhysics(physics, delta)
    if (tiltRef.current) tiltRef.current.rotation.x = physics.pitch
    if (spinRef.current) spinRef.current.rotation.y = physics.yaw

    // Recenter blend: the anchor hub flies to the origin (plus a zoom-in
    // push) over select.recenterDuration; drill-out reverses it.
    const dur = NCONF.select.recenterDuration / 1000
    d.k += ((d.target === 1 ? 1 : -1) * delta) / Math.max(0.05, dur)
    d.k = Math.min(1, Math.max(0, d.k))
    const k = easeInOutCubic(d.k)
    if (d.k === 0 && d.level === 1 && d.target === 0) {
      // drill-out complete - tear down the child shell
      d.level = 0
      if (d.reportMesh) disposeMesh(d.reportMesh)
      if (d.reportTrails) {
        disposeMesh(d.reportTrails.core)
        disposeMesh(d.reportTrails.glow)
      }
      if (d.roleMesh) disposeMesh(d.roleMesh)
      d.reportMesh?.removeFromParent()
      d.reportTrails?.core.removeFromParent()
      d.reportTrails?.glow.removeFromParent()
      d.roleMesh?.removeFromParent()
      d.reportMesh = null
      d.reportTrails = null
      d.roleMesh = null
      d.hubNode = null
      d.hubLocal = null
      d.orbitIndex = null
      d.shell = []
    }
    const push = d.hubLocal ? k * NCONF.select.recenterPush : 0
    if (offsetRef.current) {
      if (d.hubLocal) {
        const hw = rotateYawPitch(
          [d.hubLocal.x, d.hubLocal.y, d.hubLocal.z],
          physics.yaw,
          physics.pitch,
        )
        offsetRef.current.position.set(-k * hw[0], -k * hw[1], -k * hw[2] + push)
      } else {
        offsetRef.current.position.set(0, 0, 0)
      }
    }

    // Two-hand zoom (ORB_ZOOM_SPEC section 3): the continuous factor dollies
    // the SCENE CAMERA only - physics and rotation are untouched. The rest
    // distance is measured to the CURRENT anchor (camera.z at level 0; minus
    // the recenter push once drilled), so zoomMin/zoomMax mean the same thing
    // at both levels and zoom-in at level 1 cannot fly inside the anchor. A
    // commit hands its factor to the recenter above (carry), so the camera
    // never jumps when the arbiter re-latches to 1.0. A panel open springs back.
    const store = useStore.getState()
    if (store.openReport && zoomView.live) zoomView.live = false
    const zf = stepZoomView(zoomView, delta, d.target === 1 ? k : 1 - k)
    state.camera.position.z = push + (NCONF.camera.z - push) / zf
    zoomRuntime.displayed = zf
    zoomRuntime.level = d.target

    // Uniform sync (O(1) - no per-node JS).
    syncStarUniforms(built.starMesh.material as ShaderMaterial)
    syncStarUniforms(built.beadMesh.material as ShaderMaterial)
    syncTrailUniforms(
      built.trails.core.material as ShaderMaterial,
      built.trails.glow.material as ShaderMaterial,
    )
    syncPulseUniforms(built.pulseMesh.material as ShaderMaterial, state.clock.elapsedTime)

    // Anchor ROLE: brain holds it at level 0; the drilled hub inherits it
    // (spikes + corona boost + pulse) while it is the anchor (§6.4).
    const pulseT = state.clock.elapsedTime * 60 * NCONF.brainPulse.rate
    const pulse = 1 + NCONF.brainPulse.amp * (0.5 + 0.5 * Math.sin(pulseT))
    const brainMat = built.brainMesh.material as ShaderMaterial
    syncStarUniforms(brainMat)
    const brainHolds = d.level === 0
    brainMat.uniforms.uAnchor.value = brainHolds ? 1 : 0
    brainMat.uniforms.uCoronaMult.value = brainHolds ? NCONF.anchor.coronaMult : 1
    brainMat.uniforms.uSpikeLen.value = NCONF.anchor.spikeLength
    brainMat.uniforms.uScaleMult.value = brainHolds ? pulse : 1
    if (d.roleMesh) {
      const roleMat = d.roleMesh.material as ShaderMaterial
      syncStarUniforms(roleMat)
      roleMat.uniforms.uCoronaMult.value = NCONF.anchor.coronaMult
      roleMat.uniforms.uSpikeLen.value = NCONF.anchor.spikeLength
      roleMat.uniforms.uScaleMult.value = pulse
    }
    if (d.reportMesh) syncStarUniforms(d.reportMesh.material as ShaderMaterial)
    if (d.reportTrails) {
      syncTrailUniforms(
        d.reportTrails.core.material as ShaderMaterial,
        d.reportTrails.glow.material as ShaderMaterial,
      )
    }

    built.beadMesh.visible = NCONF.trail.beadsEnabled
    built.pulseMesh.visible = NCONF.trail.pulseEnabled
    environment.grain.visible = NCONF.render.grainEnabled
    ;(environment.grain.material as ShaderMaterial).uniforms.uAmount.value = NCONF.render.grainAmount

    // ── Selection ─────────────────────────────────────────────────────────
    let candidate: string | null = null
    if (d.level === 0) {
      // Reticle over the hub shell; affordance rides iState (§7).
      const r = resolveReticle(built.hubDirList, physics.yaw, physics.pitch)
      const inst = r.index >= 0 ? built.hubInstanceIndices[r.index] : -1
      if (inst !== d.candidateHubInstance) {
        const attr = built.starMesh.geometry.getAttribute('iState')
        if (d.candidateHubInstance >= 0) attr.setX(d.candidateHubInstance, 0)
        if (inst >= 0) attr.setX(inst, 1)
        attr.needsUpdate = true
        d.candidateHubInstance = inst
      }
      candidate = r.index >= 0 ? `hub:${r.index}(${ORBITS[hubOrbitIndex(r.index)].name})` : null
      zoomRuntime.hubFocused = r.index >= 0
      if (store.focus !== null) useStore.setState({ focus: null })
      if (d.focusedItem !== -1) d.focusedItem = -1
      // hide any report labels left over
    } else {
      const r = resolveLevel1(d.shell, physics.yaw, physics.pitch)
      const idx = r.item ? r.item.itemIndex : -1
      zoomRuntime.hubFocused = d.target === 0 // mid drill-out: zoom-in re-drills the same hub
      if (d.reportMesh && idx !== d.focusedItem) {
        const attr = d.reportMesh.geometry.getAttribute('iState')
        if (d.focusedItem >= 0) attr.setX(d.focusedItem, 0)
        if (idx >= 0) attr.setX(idx, 1)
        attr.needsUpdate = true
        d.focusedItem = idx
      }
      if (r.item) {
        candidate = `report:${ORBITS[r.item.orbitIndex].reports[r.item.itemIndex].id}`
        const f = store.focus
        if (!f || f.orbitIndex !== r.item.orbitIndex || f.itemIndex !== r.item.itemIndex) {
          store.setFocus({ orbitIndex: r.item.orbitIndex, itemIndex: r.item.itemIndex })
          orbRuntime.focus = { orbitIndex: r.item.orbitIndex, itemIndex: r.item.itemIndex }
        }
      } else {
        candidate = 'anchor'
        if (store.focus !== null) useStore.setState({ focus: null })
      }
    }

    // ── Labels (frozen DOM overlay, positioned like Orb.tsx) ─────────────
    const width = state.size.width
    const height = state.size.height
    for (const [id, label] of orbRuntime.labelEls) {
      let show = false
      if (d.level === 1 && d.orbitIndex !== null && d.hubLocal) {
        const orbit = ORBITS[d.orbitIndex]
        const itemIndex = orbit.reports.findIndex((rep) => rep.id === id)
        if (itemIndex >= 0) {
          const item = d.shell[itemIndex]
          const w =
            Math.sin(item.phi) * Math.sin(physics.pitch) +
            Math.cos(item.phi) * Math.cos(physics.pitch) * Math.cos(item.theta + physics.yaw)
          const visible = Math.max(0, (w - 0.1) / 0.9) * k
          const labelOpacity = visible ** FEEL.falloff
          if (labelOpacity >= 0.02) {
            show = true
            const local = d.hubLocal
              .clone()
              .add(new Vector3(...(item.local as Vec3)))
            const [wx, wy, wz] = rotateYawPitch([local.x, local.y, local.z], physics.yaw, physics.pitch)
            const off = offsetRef.current?.position ?? scratch.set(0, 0, 0)
            scratch.set(wx + off.x, wy + off.y, wz + off.z).project(state.camera)
            const sx = (scratch.x * 0.5 + 0.5) * width
            const sy = (-scratch.y * 0.5 + 0.5) * height
            if (label.style.display !== 'block') label.style.display = 'block'
            let side = label.dataset.side === 'l' ? -1 : 1
            if (sx > width / 2 + 8) side = 1
            else if (sx < width / 2 - 8) side = -1
            label.dataset.side = side === 1 ? 'r' : 'l'
            const camZ = state.camera.position.z
            const dist = Math.sqrt(
              (wx + off.x) ** 2 + (wy + off.y) ** 2 + (camZ - (wz + off.z)) ** 2,
            )
            const discRadiusWu = NCONF.render.tierDiam.node * NCONF.render.spriteScale * 0.15
            const radiusPx = (discRadiusWu / (dist * TAN_HALF_FOV)) * (height / 2)
            const offsetPx = radiusPx + 9
            label.style.transform =
              `translate3d(${sx + side * offsetPx}px, ${sy}px, 0) ` +
              `translate(${side === 1 ? '0' : '-100%'}, -50%)`
            label.style.opacity = labelOpacity.toFixed(3)
            if (d.focusedItem === itemIndex) label.dataset.focused = '1'
            else delete label.dataset.focused
          }
        }
      }
      if (!show && label.style.display !== 'none') {
        label.style.display = 'none'
        delete label.dataset.focused
      }
    }

    // fps + gate instrumentation
    const fs = fpsState.current
    fs.frames++
    const now = state.clock.elapsedTime
    if (now - fs.windowStart >= 1) {
      orbRuntime.fps = Math.round(fs.frames / (now - fs.windowStart))
      fs.frames = 0
      fs.windowStart = now
    }
    window.__neuralInfo = {
      drawCalls: state.gl.info.render.calls,
      fps: orbRuntime.fps,
      nodeCount: built.nodeCount,
      trailCount: built.trailCount,
      layoutHash: built.layoutHash,
      seed: built.seed,
      tupleHash: built.tupleHash,
      level: d.level,
      target: d.target,
      zoom: zf,
      handCount: zoomRuntime.handCount,
      anchorHub: d.hubNode ? built.hubNodes.indexOf(d.hubNode) : null,
      candidate,
    }
  })

  return (
    <>
      <primitive object={environment.wash} />
      <primitive object={environment.warm} />
      <primitive object={environment.grain} />
      <group ref={offsetRef}>
        <group ref={tiltRef}>
          <group ref={spinRef}>
            <primitive object={built.trails.core} />
            <primitive object={built.trails.glow} />
            <primitive object={built.beadMesh} />
            <primitive object={built.pulseMesh} />
            <primitive object={built.starMesh} />
            <primitive object={built.brainMesh} />
          </group>
        </group>
      </group>
    </>
  )
}
