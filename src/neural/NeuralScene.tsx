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
// are flagged in docs/PORT_LOG.md P5.

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
  applyScrollZoom,
  applyZoomEvent,
  commitZoomView,
  createZoomView,
  stepZoomView,
  zoomRuntime,
} from '../input/zoomView'
import { nearestOrbitIndex, rotateYawPitch } from '../orb/geometry'
import type { Vec3 } from '../orb/geometry'
import { applyInputEvent, orbRuntime, stepPhysics } from '../orb/useOrbPhysics'
import { useStore } from '../store'
import { DISC_FRACTION, NCONF, generationTuple, ringRadiusPx, tupleHash } from './config'
import { createLightPipeline } from './postfx'
import {
  centerRuntime,
  createCenterState,
  currentCenter,
  currentPushWeight,
  easeInOutCubic,
  hoverRuntime,
  pinPoint,
  setCenterTarget,
  stepCenter,
} from './centering'
import { cursorRuntime } from '../input/cursor'
import { eyeRuntime } from '../input/eye/channel'
import { EYE } from '../input/eye/config'
import { eyeLearn } from '../input/useEyeInput'
import { createGazeFocus, gazeRuntime, stepGazeFocus } from './gazeFocus'
import type { GazeCandidate } from './gazeFocus'
import { buildGraph, layoutHash, nodePosition } from './graph'
import type { NeuralNode } from './graph'
import { momentumFor } from './momentum'
import { PAL } from './palette'
import { computeRallies, diamFor, opaFor } from './rallies'
import {
  bindReports,
  candidatesFor,
  createHighlightState,
  hitTestNodes,
  pointRuntime,
  projectLocal,
  projectNode,
  stepHighlight,
  targetableNames,
} from './pointing'
import type { ViewSpec } from './pointing'
import { buildPulseMesh, syncPulseUniforms } from './pulses'
import { childShell, hubDirs, hubOrbitIndex, resolveLevel1, resolveReticle } from './selection'
import type { ChildShellItem } from './selection'
import { createDepthTwin, createStarMesh, starRuntime, syncStarUniforms } from './starField'
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
    /** DEV seam for gates: drive the persistent zoom base directly, the way a
     *  finished two-hand gesture would leave it. camera.z stays the rest
     *  distance, so this exercises the REAL dolly path (backdrop, glow fade). */
    __neuralDev?: {
      setZoom: (factor: number) => void
      /** click-to-centre gates: a node's projected px offset from centre, disc radius, depth */
      projectNode: (name: string) => { x: number; y: number; dist: number; w: number; r: number; visR: number; tier: string } | null
      /** a node of `tier` (default hub) on screen and at least minDist px from centre; `smallest` picks the least hit radius */
      pickClickable: (o: { minDist: number; maxX: number; maxY: number; tier?: string; smallest?: boolean }) => string | null
      /** a px offset from centre with no node disc within 40px */
      emptyPoint: (o: { W: number; H: number }) => { x: number; y: number } | null
      /** what a click at this px offset from centre would hit (the click's own resolver) */
      hitAt: (x: number, y: number) => { kind: string; name: string; x: number; y: number; w: number; r: number } | null
    }
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
      /** ORB_SELECT_SPEC PT1 */
      pointed: string | null
      pointedDist: number
      pointedTier: string
      targetable: number
      /** click-to-centre: the node holding the centre (null = origin), blend 0..1, camera push wu */
      centered: string | null
      centerK: number
      push: number
      hovered: string | null
      /** ORB_EYE point mode: the node under the eyes (null = none / pointer not live) */
      gazed: string | null
      gazeLive: boolean
      yaw: number
      pitch: number
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
// Grain moved to the light pipeline (postfx.ts): it has to ride AFTER tone
// mapping - in the linear target, 3% noise on black came out as sparkle.

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

// No rotational limit: the integrator's pitch clamp is Infinity here, so hand
// and pointer drag can carry the field through the poles and around. The
// globe scene keeps PITCH_CLAMP (data/orbits.ts) and its frozen tests.
const NO_PITCH_CLAMP = Infinity

const BEAD_DIAM = 6
const BEAD_OPA = [1, 1, 1] as const
// Backdrop plane depths at the REST view (world z with the camera at
// NCONF.camera.z). useFrame keeps them at this distance from the camera.
const WASH_Z = -1200
const WARM_Z = -1100
const TAN_HALF_FOV = Math.tan((52 / 2) * (Math.PI / 180))
const UP = new Vector3(0, 1, 0)
const FALLBACK = new Vector3(1, 0, 0)

/** A star's projected solid-disc radius in px at depth w. */
function discRadiusPx(diam: number, focal: number, w: number): number {
  return ((diam * NCONF.render.spriteScale * DISC_FRACTION) / 2) * (focal / w)
}

/**
 * The mouse hit radius (click-to-centre): the disc scaled to its glow,
 * floored so a minor post (disc < 2 px at rest) is as clickable as it looks.
 */
function hitRadiusPx(diam: number, focal: number, w: number): number {
  return Math.max(
    NCONF.select.clickMinRadiusPx,
    discRadiusPx(diam, focal, w) * NCONF.select.clickRadiusMult,
  )
}

/** What the cursor is over: a graph node, or a level-1 shell report. */
type CursorHit =
  | { kind: 'node'; node: NeuralNode; x: number; y: number; w: number; diam: number }
  | { kind: 'shell'; item: ChildShellItem; x: number; y: number; w: number; diam: number }

/**
 * The node under a screen point (px from centre), shared by the click and
 * the hover ring so they can never disagree. Level-1 shell reports compete
 * with the field on the same footing - the click goes to whichever it is
 * MOST CENTRED on (dist / hit radius), a shell report winning an exact tie
 * as the thing in front. Shell-first was greedy once the camera came in
 * close: a report's glow-scaled hit disc swallowed clicks aimed at field
 * posts behind it.
 */
function cursorHit(
  x: number,
  y: number,
  nodes: readonly NeuralNode[],
  byName: ReadonlyMap<string, NeuralNode>,
  diamByName: ReadonlyMap<string, number>,
  shell: { hub: Vector3; items: readonly ChildShellItem[] } | null,
  yaw: number,
  pitch: number,
  view: ViewSpec,
): CursorHit | null {
  const focal = view.viewportH / 2 / Math.tan((view.fovDeg * Math.PI) / 360)
  let shellHit: CursorHit | null = null
  let shellScore = Infinity
  if (shell) {
    for (const item of shell.items) {
      const local: Vec3 = [
        shell.hub.x + item.local[0], shell.hub.y + item.local[1], shell.hub.z + item.local[2],
      ]
      const p = projectLocal(local, yaw, pitch, view)
      if (p.w <= 0) continue
      const diam = NCONF.render.tierDiam.node
      const reach = hitRadiusPx(diam, focal, p.w)
      const dist = Math.hypot(p.x - x, p.y - y)
      if (dist <= reach && dist / reach < shellScore) {
        shellScore = dist / reach
        shellHit = { kind: 'shell', item, x: p.x, y: p.y, w: p.w, diam }
      }
    }
  }
  const diamOf = (n: NeuralNode) => diamByName.get(n.name) ?? NCONF.render.tierDiam[n.tier]
  const h = hitTestNodes(nodes, yaw, pitch, view, x, y, (n, w) => hitRadiusPx(diamOf(n), focal, w))
  if (!h) return shellHit
  if (shellHit && shellScore <= h.dist / h.r) return shellHit
  const node = byName.get(h.name)!
  const p = projectNode(node, yaw, pitch, view)
  return { kind: 'node', node, x: p.x, y: p.y, w: p.w, diam: diamOf(node) }
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
    const childName = `report_${item.orbitIndex}_${item.itemIndex}`
    specs.push({
      pSurf,
      ctrl: mid.addScaledVector(perp, chord.length() * NCONF.trail.bendFraction * sign),
      cSurf,
      radius: NCONF.trail.radByTier.hub,
      parentName: 'anchor',
      parentTier: 'hub',
      parentBody: new Color(PAL[anchorHue].body),
      childBody: new Color(PAL[anchorHue].body),
      childName,
      childMomentum: momentumFor(childName),
      weight: 1,
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
  /** the report nodes' depth twin (scoped occlusion): their lines hide behind them */
  reportDepth: Mesh | null
  candidateHubInstance: number
  focusedItem: number
}

export function NeuralScene({ bus }: { bus: InputBus }) {
  // The frozen integrator, subscribed the way useOrbPhysics does it, but with
  // the pitch clamp the pure core already takes as a parameter set to
  // Infinity: no rotational limit on either axis for hand or pointer drag
  // (user direction 2026-09-14, docs/DECISIONS.md). The globe keeps its
  // PITCH_CLAMP; nothing in useOrbPhysics.ts changes.
  const physics = orbRuntime.physics
  useEffect(
    () =>
      bus.on((e) => {
        orbRuntime.lastEvent = e.type
        applyInputEvent(orbRuntime.physics, e, ORBITS, NO_PITCH_CLAMP)
      }),
    [bus],
  )
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

  // The light pipeline (postfx.ts) owns the frame: a priority-1 subscriber
  // runs after the scene step below and takes rendering off R3F's hands.
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  const light = useMemo(() => createLightPipeline(gl, scene, camera), [gl, scene, camera])
  useEffect(() => () => light.dispose(), [light])
  useEffect(() => {
    light.setSize(size.width, size.height, dpr)
  }, [light, size, dpr])
  useFrame((_, delta) => light.render(delta), 1)

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
    // visual pass: zoom-invariant glow
    glowFadeStart: slider(() => NCONF.render.glowFadeStart, (v) => { NCONF.render.glowFadeStart = v }, 0.1, 1.5, 0.01),
    glowFadeEnd: slider(() => NCONF.render.glowFadeEnd, (v) => { NCONF.render.glowFadeEnd = v }, 0.2, 3, 0.01),
    // star cores (0 = ruling-7.1 flat disc)
    coreStrength: slider(() => NCONF.render.coreStrength, (v) => { NCONF.render.coreStrength = v }, 0, 1, 0.01),
    coreSize: slider(() => NCONF.render.coreSize, (v) => { NCONF.render.coreSize = v }, 0.15, 0.8, 0.01),
    discEdge: slider(() => NCONF.render.discEdge, (v) => { NCONF.render.discEdge = v }, 1.02, 2, 0.01),
    coreRim: slider(() => NCONF.render.coreRim, (v) => { NCONF.render.coreRim = v }, 0, 1, 0.01),
    // "powerful": rallies-driven blaze + spikes for the top posts
    blaze: slider(() => NCONF.render.blaze, (v) => { NCONF.render.blaze = v }, 0, 3, 0.05),
    blazeSpread: slider(() => NCONF.render.blazeSpread, (v) => { NCONF.render.blazeSpread = v }, 0, 1.5, 0.05),
    spikeAbove: slider(() => NCONF.render.spikeAbove, (v) => { NCONF.render.spikeAbove = v }, 0.3, 1.01, 0.01),
    spikeScale: slider(() => NCONF.render.spikeScale, (v) => { NCONF.render.spikeScale = v }, 0.1, 1, 0.01),
  })

  // RALLY §5 SIZE = cumulative rallies - PLACEHOLDER data (rallies.ts) until
  // shout analytics exist. All four change per-instance size -> rebuild.
  useControls('neural rallies (placeholder)', {
    popularFraction: rebuildSlider(() => NCONF.rallies.popularFraction, (v) => { NCONF.rallies.popularFraction = v }, 0, 0.5, 0.01),
    minorMax: rebuildSlider(() => NCONF.rallies.minorMax, (v) => { NCONF.rallies.minorMax = v }, 0.02, 0.5, 0.01),
    popularMin: rebuildSlider(() => NCONF.rallies.popularMin, (v) => { NCONF.rallies.popularMin = v }, 0.1, 0.9, 0.01),
    sizeGamma: rebuildSlider(() => NCONF.rallies.sizeGamma, (v) => { NCONF.rallies.sizeGamma = v }, 0.2, 1, 0.01),
    diamMin: rebuildSlider(() => NCONF.rallies.diamMin, (v) => { NCONF.rallies.diamMin = v }, 6, 40, 1),
    diamMax: rebuildSlider(() => NCONF.rallies.diamMax, (v) => { NCONF.rallies.diamMax = v }, 40, 160, 1),
  })

  // RALLY §5 momentum channel - PLACEHOLDER data (momentum.ts) until shout
  // analytics exist. movingFraction changes WHICH nodes move -> attribute rebuild.
  useControls('neural momentum (placeholder)', {
    movingFraction: rebuildSlider(() => NCONF.momentum.movingFraction, (v) => { NCONF.momentum.movingFraction = v }, 0, 1, 0.01),
    glow: slider(() => NCONF.momentum.glow, (v) => { NCONF.momentum.glow = v }, 0, 1.5, 0.01),
    pulsePeriod: slider(() => NCONF.momentum.pulsePeriod, (v) => { NCONF.momentum.pulsePeriod = v }, 1, 20, 0.1),
    pulseRateBoost: slider(() => NCONF.momentum.pulseRateBoost, (v) => { NCONF.momentum.pulseRateBoost = v }, 0, 4, 0.05),
  })

  useControls('neural generation', {
    seed: rebuildSlider(() => NCONF.generation.seed, (v) => { NCONF.generation.seed = v }, 1, 99999999, 1),
    hubCount: rebuildSlider(() => NCONF.generation.hubCount, (v) => { NCONF.generation.hubCount = v }, 4, 400, 1),
    R: rebuildSlider(() => NCONF.generation.R, (v) => { NCONF.generation.R = v }, 400, 1800, 10),
    redProbability: rebuildSlider(() => NCONF.generation.redProbability, (v) => { NCONF.generation.redProbability = v }, 0, 1, 0.01),
    // brain -> post distance limits (x R)
    hubRadialMin: rebuildSlider(() => NCONF.generation.hubRadialMin, (v) => { NCONF.generation.hubRadialMin = v }, 0.3, 1.2, 0.01),
    hubRadialMax: rebuildSlider(() => NCONF.generation.hubRadialMax, (v) => { NCONF.generation.hubRadialMax = v }, 0.8, 1.8, 0.01),
    // echoes by traction: popular posts become conversations
    echoesByTraction: {
      value: NCONF.generation.echoesByTraction,
      onChange: (v: boolean) => {
        if (v === NCONF.generation.echoesByTraction) return
        NCONF.generation.echoesByTraction = v
        regenRef.current()
      },
    },
    popularEchoMin: rebuildSlider(() => NCONF.generation.popularEchoMin, (v) => { NCONF.generation.popularEchoMin = v }, 0, 10, 1),
    popularEchoMax: rebuildSlider(() => NCONF.generation.popularEchoMax, (v) => { NCONF.generation.popularEchoMax = v }, 0, 12, 1),
  })

  // Cluster tightness: how far children scatter from their parent (angular
  // jitter, rad) and how far out they sit (radial x parent r). Generation
  // params, so each change rebuilds the layout (hash changes).
  useControls('neural cluster', {
    nodeJitter: rebuildSlider(() => NCONF.generation.nodeJitter, (v) => { NCONF.generation.nodeJitter = v }, 0.02, 0.5, 0.01),
    nodeRadialMin: rebuildSlider(() => NCONF.generation.nodeRadialMin, (v) => { NCONF.generation.nodeRadialMin = v }, 0.9, 1.3, 0.01),
    nodeRadialMax: rebuildSlider(() => NCONF.generation.nodeRadialMax, (v) => { NCONF.generation.nodeRadialMax = v }, 0.9, 1.4, 0.01),
    subJitter: rebuildSlider(() => NCONF.generation.subJitter, (v) => { NCONF.generation.subJitter = v }, 0.02, 0.5, 0.01),
    subRadialMin: rebuildSlider(() => NCONF.generation.subRadialMin, (v) => { NCONF.generation.subRadialMin = v }, 0.9, 1.3, 0.01),
    subRadialMax: rebuildSlider(() => NCONF.generation.subRadialMax, (v) => { NCONF.generation.subRadialMax = v }, 0.9, 1.4, 0.01),
    terminalJitter: rebuildSlider(() => NCONF.generation.terminalJitter, (v) => { NCONF.generation.terminalJitter = v }, 0.02, 0.6, 0.01),
    terminalRadialMin: rebuildSlider(() => NCONF.generation.terminalRadialMin, (v) => { NCONF.generation.terminalRadialMin = v }, 0.9, 1.3, 0.01),
    terminalRadialMax: rebuildSlider(() => NCONF.generation.terminalRadialMax, (v) => { NCONF.generation.terminalRadialMax = v }, 0.9, 1.4, 0.01),
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
    // visual pass: energy flow along every trail (+ the 7.10 hot dots' direction)
    flowEnabled: {
      value: NCONF.trail.flowEnabled,
      onChange: (v: boolean) => { NCONF.trail.flowEnabled = v },
    },
    flowInward: {
      value: NCONF.trail.flowInward,
      onChange: (v: boolean) => { NCONF.trail.flowInward = v },
    },
    flowGain: slider(() => NCONF.trail.flowGain, (v) => { NCONF.trail.flowGain = v }, 0, 3, 0.05),
    flowWidth: slider(() => NCONF.trail.flowWidth, (v) => { NCONF.trail.flowWidth = v }, 0.01, 0.3, 0.005),
    flowPeriod: slider(() => NCONF.trail.flowPeriod, (v) => { NCONF.trail.flowPeriod = v }, 1, 20, 0.1),
    spokeMinWeight: rebuildSlider(() => NCONF.trail.spokeMinWeight, (v) => { NCONF.trail.spokeMinWeight = v }, 0, 1, 0.01),
    endInset: rebuildSlider(() => NCONF.trail.endInset, (v) => { NCONF.trail.endInset = v }, 0, 1.5, 0.05),
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
    // click-to-centre (docs/DECISIONS.md)
    centerPush: slider(() => NCONF.select.centerPush, (v) => { NCONF.select.centerPush = v }, 0, 3600, 20),
    clickRadiusMult: slider(() => NCONF.select.clickRadiusMult, (v) => { NCONF.select.clickRadiusMult = v }, 1, 5, 0.1),
    clickMinRadiusPx: slider(() => NCONF.select.clickMinRadiusPx, (v) => { NCONF.select.clickMinRadiusPx = v }, 4, 40, 1),
    markGapPx: slider(() => NCONF.select.markGapPx, (v) => { NCONF.select.markGapPx = v }, 0, 10, 0.5),
    markMinPx: slider(() => NCONF.select.markMinPx, (v) => { NCONF.select.markMinPx = v }, 2, 20, 1),
    markScale: slider(() => NCONF.select.markScale, (v) => { NCONF.select.markScale = v }, 0.1, 1, 0.05),
  })

  // ORB_SELECT_SPEC §5: every pointing constant on a slider - these are the
  // ones the PT1 human gate tunes. acquireRadius' range runs well past the
  // spec default because this field is sparser than 46px assumes (the
  // nearest targetable node is a median ~75px away at 900px viewport
  // height); see the PT1 note in docs/PORT_LOG.md.
  useControls('neural point (PT1)', {
    crosshairSize: slider(() => NCONF.point.crosshairSize, (v) => { NCONF.point.crosshairSize = v }, 2, 40, 1),
    acquireRadius: slider(() => NCONF.point.acquireRadius, (v) => { NCONF.point.acquireRadius = v }, 10, 220, 1),
    releaseRadius: slider(() => NCONF.point.releaseRadius, (v) => { NCONF.point.releaseRadius = v }, 20, 320, 1),
    switchMargin: slider(() => NCONF.point.switchMargin, (v) => { NCONF.point.switchMargin = v }, 0, 80, 1),
    tieBandPx: slider(() => NCONF.point.tieBandPx, (v) => { NCONF.point.tieBandPx = v }, 0, 60, 1),
    highlightSwell: slider(() => NCONF.point.highlightSwell, (v) => { NCONF.point.highlightSwell = v }, 1, 4, 0.05),
    ringOpacity: slider(() => NCONF.point.ringOpacity, (v) => { NCONF.point.ringOpacity = v }, 0, 1, 0.01),
  })

  useControls('neural environment', {
    grainEnabled: {
      value: NCONF.render.grainEnabled,
      onChange: (v: boolean) => { NCONF.render.grainEnabled = v },
    },
    grainAmount: slider(() => NCONF.render.grainAmount, (v) => { NCONF.render.grainAmount = v }, 0, 0.1, 0.005),
  })

  // Lighting pass: the pipeline, the glare profile and the body fade (the
  // fade is baked into the trail geometry, so its slider rebuilds).
  useControls('neural light', {
    bloomEnabled: {
      value: NCONF.render.bloomEnabled,
      onChange: (v: boolean) => { NCONF.render.bloomEnabled = v },
    },
    bloomStrength: slider(() => NCONF.render.bloomStrength, (v) => { NCONF.render.bloomStrength = v }, 0, 2, 0.05),
    bloomRadius: slider(() => NCONF.render.bloomRadius, (v) => { NCONF.render.bloomRadius = v }, 0, 1, 0.05),
    bloomThreshold: slider(() => NCONF.render.bloomThreshold, (v) => { NCONF.render.bloomThreshold = v }, 0, 2, 0.05),
    bloomKnee: slider(() => NCONF.render.bloomKnee, (v) => { NCONF.render.bloomKnee = v }, 0.01, 1, 0.01),
    exposure: slider(() => NCONF.render.exposure, (v) => { NCONF.render.exposure = v }, 0.2, 3, 0.05),
    glareTight: slider(() => NCONF.render.glareTight, (v) => { NCONF.render.glareTight = v }, 0, 1, 0.01),
    glareSigma: slider(() => NCONF.render.glareSigma, (v) => { NCONF.render.glareSigma = v }, 0.1, 3, 0.05),
    glareTail: slider(() => NCONF.render.glareTail, (v) => { NCONF.render.glareTail = v }, 0, 0.5, 0.01),
    glareTailRadius: slider(() => NCONF.render.glareTailRadius, (v) => { NCONF.render.glareTailRadius = v }, 0.2, 6, 0.1),
    bodyFade: rebuildSlider(() => NCONF.trail.bodyFade, (v) => { NCONF.trail.bodyFade = v }, 0, 3, 0.1),
  })

  // Node bodies: limb darkening and the close-up surface mottle.
  useControls('neural body', {
    limbDarkening: slider(() => NCONF.render.limbDarkening, (v) => { NCONF.render.limbDarkening = v }, 0, 1, 0.01),
    surfaceAmp: slider(() => NCONF.render.surfaceAmp, (v) => { NCONF.render.surfaceAmp = v }, 0, 1, 0.01),
    surfaceScale: slider(() => NCONF.render.surfaceScale, (v) => { NCONF.render.surfaceScale = v }, 0.5, 12, 0.1),
    surfaceDrift: slider(() => NCONF.render.surfaceDrift, (v) => { NCONF.render.surfaceDrift = v }, 0, 0.5, 0.005),
    detailStart: slider(() => NCONF.render.detailStart, (v) => { NCONF.render.detailStart = v }, 0, 0.5, 0.005),
    detailEnd: slider(() => NCONF.render.detailEnd, (v) => { NCONF.render.detailEnd = v }, 0.01, 1, 0.01),
    pinMaxPx: slider(() => NCONF.render.pinMaxPx, (v) => { NCONF.render.pinMaxPx = v }, 1, 30, 0.5),
    // scoped occlusion: bodies hide the lines behind them, the brain hides all
    occlusion: {
      value: NCONF.render.occlusion,
      onChange: (v: boolean) => { NCONF.render.occlusion = v },
    },
    occludeEdge: slider(() => NCONF.render.occludeEdge, (v) => { NCONF.render.occludeEdge = v }, 0.3, 1.3, 0.01),
    // fog pass: the limb up close, and the glow's on-screen cap
    discEdgeNear: slider(() => NCONF.render.discEdgeNear, (v) => { NCONF.render.discEdgeNear = v }, 1.01, 1.6, 0.01),
    glowCapPx: slider(() => NCONF.render.glowCapPx, (v) => { NCONF.render.glowCapPx = v }, 4, 200, 1),
    // depth of field: stops from the focus plane where defocus starts / is full
    defocusStart: slider(() => NCONF.render.defocusStart, (v) => { NCONF.render.defocusStart = v }, 0.1, 3, 0.05),
    defocusEnd: slider(() => NCONF.render.defocusEnd, (v) => { NCONF.render.defocusEnd = v }, 0.2, 4, 0.05),
  })

  // Lines: the hairline floor, the width cap and the filament profile.
  useControls('neural line', {
    minRadiusPx: slider(() => NCONF.trail.minRadiusPx, (v) => { NCONF.trail.minRadiusPx = v }, 0.2, 3, 0.05),
    maxRadiusPx: slider(() => NCONF.trail.maxRadiusPx, (v) => { NCONF.trail.maxRadiusPx = v }, 1, 40, 0.5),
    filamentPow: slider(() => NCONF.trail.filamentPow, (v) => { NCONF.trail.filamentPow = v }, 0.5, 4, 0.05),
    filamentGain: slider(() => NCONF.trail.filamentGain, (v) => { NCONF.trail.filamentGain = v }, 0.5, 3, 0.05),
    filamentFromPx: slider(() => NCONF.trail.filamentFromPx, (v) => { NCONF.trail.filamentFromPx = v }, 0.5, 10, 0.25),
    // trunk grouping is baked into the geometry: these rebuild
    bundleStrength: rebuildSlider(() => NCONF.trail.bundleStrength, (v) => { NCONF.trail.bundleStrength = v }, 0, 1, 0.05),
    bundleCone: rebuildSlider(() => NCONF.trail.bundleCone, (v) => { NCONF.trail.bundleCone = v }, 5, 90, 1),
    bundleBranch: rebuildSlider(() => NCONF.trail.bundleBranch, (v) => { NCONF.trail.bundleBranch = v }, 0.1, 0.9, 0.05),
  })

  const environment = useMemo(() => {
    const wash = envMesh(WASH_FRAG, 7000, 5000)
    wash.position.z = WASH_Z
    wash.renderOrder = -10
    const warm = envMesh(WARM_FRAG, 2800, 2200)
    warm.position.set(-550, 350, WARM_Z)
    warm.renderOrder = -9
    return { wash, warm }
  }, [])

  const built = useMemo(() => {
    const nodes = buildGraph()
    // RALLY §5: SIZE = cumulative rallies (placeholder source, rallies.ts).
    // Tier is structure only from here on; the brain keeps anchor.brainDiam.
    const rallies = computeRallies(nodes)
    const diamByName = new Map(
      nodes.map((n) => [n.name, n.tier === 'brain' ? NCONF.anchor.brainDiam : diamFor(rallies.get(n.name) ?? 0)]),
    )
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
      const r = rallies.get(n.name) ?? 0
      instances.push({
        pos: new Vector3(x, y, z),
        tier: n.tier,
        hue: n.hue,
        isBokeh: n.isBokeh,
        diam: diamByName.get(n.name),
        opa: opaFor(r),
        rallies: r,
        momentum: momentumFor(n.name), // RALLY §5 motion channel (placeholder data)
      })
    }
    const starMesh = createStarMesh(instances)
    // Scoped occlusion, in draw order: the brain's depth twin (-3), then the
    // stars testing against it (-2: the brain hides the nodes behind it),
    // then the nodes' twin (-1), then the lines, beads and pulses testing
    // against both (0..3: bodies hide the lines behind them). Bodies never
    // hide bodies - the nodes' twin draws after them. All additive, so the
    // order changes nothing else.
    starMesh.renderOrder = -2
    const starDepth = createDepthTwin(starMesh)
    starDepth.renderOrder = -1

    const brainMesh = createStarMesh([
      { pos: new Vector3(0, 0, 0), tier: 'brain', hue: 'violet', diam: NCONF.anchor.brainDiam, rallies: 1 },
    ])
    const brainMat = brainMesh.material as ShaderMaterial
    brainMat.uniforms.uTierMult.value = 1.0
    brainMat.uniforms.uAnchor.value = 1
    // the anchor's dominance is §6's (coronaMult + spikes); blaze is for posts
    brainMat.uniforms.uBlaze.value = 0
    brainMat.uniforms.uBlazeSpread.value = 0
    brainMesh.renderOrder = 10
    const brainDepth = createDepthTwin(brainMesh)
    brainDepth.renderOrder = -3

    const specs = buildTrailSpecs(nodes, NCONF, (n) => diamByName.get(n.name)!, (n) => rallies.get(n.name) ?? 0)
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
    // ORB_SELECT_SPEC §2: the crosshair only acquires report-bound nodes and
    // their ancestors. Computed once per graph build, never per frame.
    // ORB_SELECT_SPEC §2 binding: the shell opens a bound node on its report
    // (the identity the globe and the level-1 reticle use) and any other
    // node on itself. Computed once per graph build.
    const binding = bindReports(nodes)
    const targetable = targetableNames(nodes, binding)
    const nodesByName = new Map(nodes.map((n) => [n.name, n]))

    return {
      nodes,
      binding,
      targetable,
      nodesByName,
      diamByName,
      starMesh,
      brainMesh,
      trails,
      beadMesh,
      pulseMesh,
      starDepth,
      brainDepth,
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
    reportDepth: null,
    candidateHubInstance: -1,
    focusedItem: -1,
  })

  // Click-to-centre (docs/DECISIONS.md): the constellation-local point the
  // offset group pins to the camera axis. The drill composes on top of it
  // (pinPoint), so the drill path is unchanged while the centre is at the
  // origin. `viewRef` is the projection the last frame drew with - a click
  // hit-tests against what the user actually saw.
  const center = useRef(createCenterState())
  const viewRef = useRef<ViewSpec | null>(null)
  /** ORB_EYE point mode: the node the eyes are on (neural/gazeFocus.ts) */
  const gazeFocus = useRef(createGazeFocus())

  // Two-hand zoom view (ORB_ZOOM_SPEC): pure model, stepped in useFrame.
  const zoomView = useRef(createZoomView()).current
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const project = (name: string) => {
      const view = viewRef.current
      const node = built.nodesByName.get(name)
      if (!view || !node) return null
      const p = projectNode(node, orbRuntime.physics.yaw, orbRuntime.physics.pitch, view)
      const focal = view.viewportH / 2 / Math.tan((view.fovDeg * Math.PI) / 360)
      const diam = built.diamByName.get(name) ?? NCONF.render.tierDiam[node.tier]
      const r = p.w > 0 ? hitRadiusPx(diam, focal, p.w) : 0
      const visR = p.w > 0 ? discRadiusPx(diam, focal, p.w) * NCONF.render.discEdge : 0
      return { x: p.x, y: p.y, dist: p.dist, w: p.w, r, visR, tier: node.tier }
    }
    window.__neuralDev = {
      setZoom: (factor) => {
        zoomView.base = Math.max(FEEL.zoomMin, Math.min(FEEL.zoomMax, factor))
        zoomView.baseTarget = zoomView.base
        zoomView.hand = 1
      },
      projectNode: project,
      pickClickable: ({ minDist, maxX, maxY, tier = 'hub', smallest = false }) => {
        let best: string | null = null
        let bestR = smallest ? Infinity : 0
        for (const n of built.nodes) {
          if (n.tier !== tier) continue
          const p = project(n.name)
          if (!p || p.w <= 0 || p.dist < minDist) continue
          if (Math.abs(p.x) + p.r > maxX || Math.abs(p.y) + p.r > maxY) continue
          if (smallest ? p.r < bestR : p.r > bestR) {
            bestR = p.r
            best = n.name
          }
        }
        return best
      },
      hitAt: (x, y) => {
        const view = viewRef.current
        if (!view) return null
        const d = drill.current
        const shell = d.level === 1 && d.target === 1 && d.hubLocal ? { hub: d.hubLocal, items: d.shell } : null
        const h = cursorHit(x, y, built.nodes, built.nodesByName, built.diamByName, shell, orbRuntime.physics.yaw, orbRuntime.physics.pitch, view)
        if (!h) return null
        const focal = view.viewportH / 2 / Math.tan((view.fovDeg * Math.PI) / 360)
        return {
          kind: h.kind,
          name: h.kind === 'node' ? h.node.name : `report:${h.item.orbitIndex}/${h.item.itemIndex}`,
          x: h.x, y: h.y, w: h.w, r: hitRadiusPx(h.diam, focal, h.w),
        }
      },
      emptyPoint: ({ W, H }) => {
        const pts: { x: number; y: number; r: number }[] = []
        for (const n of built.nodes) {
          const p = project(n.name)
          if (p && p.w > 0) pts.push({ x: p.x, y: p.y, r: p.r })
        }
        for (let y = -H / 2 + 60; y < H / 2 - 60; y += 37) {
          for (let x = -W / 2 + 60; x < W / 2 - 60; x += 41) {
            if (pts.every((p) => Math.hypot(p.x - x, p.y - y) > p.r + 40)) return { x, y }
          }
        }
        return null
      },
    }
    return () => {
      delete window.__neuralDev
    }
  }, [zoomView, built])

  // Crosshair highlight (ORB_SELECT_SPEC PT1). Read-only: the state is
  // published for the overlay and telemetry and drives NOTHING else - the
  // reticle/detent selection below is untouched until PT2/PT3.
  const highlight = useRef(createHighlightState())

  // §3 "confirming" is a pinch-down over an acquired node. Purely visual
  // here: PT1 never selects, so no bus event is consumed or suppressed.
  useEffect(() => {
    const off = bus.on((e) => {
      // A gaze-sourced engage is the eye channel opening its steering
      // engagement (ORB_EYE_SPEC), not a pinch: never "confirming".
      if (e.type === 'engage' && e.source !== 'gaze') pointRuntime.confirming = true
      else if (e.type === 'release' || e.type === 'tap' || e.type === 'lost') {
        pointRuntime.confirming = false
      }
    })
    return () => {
      off()
      pointRuntime.confirming = false
    }
  }, [bus])

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
        rallies: 0.5, // shell placeholder: a lit, medium core
        momentum: momentumFor(`report_${item.orbitIndex}_${item.itemIndex}`),
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
      roleMat.uniforms.uBlaze.value = 0
      roleMat.uniforms.uBlazeSpread.value = 0
      roleMesh.renderOrder = 11
      d.reportMesh = reportMesh
      d.reportTrails = reportTrails
      d.roleMesh = roleMesh
      // the reports' lines hide behind the reports (twin at 3, lines at 4);
      // the reports themselves never test depth - no body hides a body
      const reportDepth = createDepthTwin(reportMesh)
      reportDepth.renderOrder = 3
      d.reportDepth = reportDepth
      spinRef.current?.add(reportDepth, reportMesh, reportTrails.core, reportTrails.glow, roleMesh)

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

    // Mouse click (a POSITIONED tap, docs/DECISIONS.md click-to-centre,
    // two-click navigation). The cursor, not the sight, says which node was
    // meant: hit-test the node under it against the last drawn projection,
    // then
    //   - a node -> it flies to the centre and becomes the pivot (SELECT);
    //   - the selected node again -> ENTER: the shell opens on it (on its
    //     report when it carries one, else on the node itself);
    //   - at level 1 (reached by Enter / pinch, the sight model): a shell
    //     report opens; the anchor drills out; any other node drills out
    //     and centres;
    //   - empty space -> nothing. A blind confirm at the sight is what a
    //     cursor user reads as "I clicked X and got Y".
    // Hand pinch-taps and Enter stay unpositioned and keep the sight model.
    const click = (x: number, y: number, learn = false): void => {
      const view = viewRef.current
      if (!view) return
      const { yaw, pitch } = orbRuntime.physics
      const shell = d.level === 1 && d.target === 1 && d.hubLocal ? { hub: d.hubLocal, items: d.shell } : null
      const hit = cursorHit(x, y, built.nodes, built.nodesByName, built.diamByName, shell, yaw, pitch, view)
      if (!hit) return
      if (hit.kind === 'shell') {
        const ref = { orbitIndex: hit.item.orbitIndex, itemIndex: hit.item.itemIndex }
        const store = useStore.getState()
        store.setFocus(ref)
        orbRuntime.focus = ref
        store.openFocused()
        return
      }
      const node = hit.node
      // ORB_EYE: a POSITIONED click on a node is a verified gaze sample - the
      // user looks where they click - and the only truth that can pull a
      // biased map back (Enter can only confirm the ringed node).
      if (learn) eyeLearn(hit.x + window.innerWidth / 2, hit.y + window.innerHeight / 2, 'click')
      const local = nodePosition(node)
      const already = center.current.name === node.name && center.current.k >= 1

      if (d.level === 1) {
        if (d.hubNode === node) {
          // The anchor is the drill-out target (§4); it keeps the centre.
          center.current = setCenterTarget(center.current, node.name, local)
          d.target = 0
          return
        }
        // Any other node: leave the drill and centre on it. The pin blends
        // from the hub to the new centre over the same duration.
        d.target = 0
        center.current = setCenterTarget(center.current, node.tier === 'brain' ? null : node.name, local)
        return
      }
      if (already && d.target === 0) {
        // Second click: enter. The shell is the 2D view; the field's job
        // ends at selection (RALLY.md §5).
        const bound = built.binding.get(node.name)
        const store = useStore.getState()
        if (bound) {
          store.setFocus(bound)
          orbRuntime.focus = bound
          store.openFocused()
        } else {
          store.openNode(node.name, node.tier)
        }
        return
      }
      center.current = setCenterTarget(center.current, node.tier === 'brain' ? null : node.name, local)
    }

    // Escape: back to the centre node. Any drill flies out and the centre
    // returns to the brain; the pin blends hub -> origin over one duration.
    const home = (): void => {
      if (d.level === 1) d.target = 0
      center.current = setCenterTarget(center.current, null, [0, 0, 0])
    }

    return bus.on((e) => {
      if (e.type === 'zoom') {
        applyZoomEvent(zoomView, e)
        return
      }
      // Scroll zoom: the same dolly as the two-hand zoom, toward whatever
      // holds the centre (the brain, or a clicked node). Never drills.
      if (e.type === 'scrollZoom') {
        applyScrollZoom(zoomView, e.logFactor)
        return
      }
      if (e.type === 'home') {
        if (!useStore.getState().openReport) home()
        return
      }
      if (e.type !== 'tap' && e.type !== 'zoomCommit') return
      if (useStore.getState().openReport) return // input suspended while open
      if (e.type === 'tap' && e.x !== undefined && e.y !== undefined) {
        click(e.x, e.y, true)
        return
      }
      // ORB_EYE point mode: an UNPOSITIONED confirm (Enter, pinch-tap) with a
      // node under the eyes acts on that node exactly as a click would -
      // select, then enter. The sight model below is the fallback.
      if (e.type === 'tap' && gazeRuntime.live && gazeRuntime.name) {
        // A verified sample: the ring was on the node they wanted.
        eyeLearn(gazeRuntime.nodeX + window.innerWidth / 2, gazeRuntime.nodeY + window.innerHeight / 2)
        click(gazeRuntime.nodeX, gazeRuntime.nodeY)
        return
      }
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
      // the twins share geometry and uniforms with the meshes above: material only
      ;(built.starDepth.material as ShaderMaterial).dispose()
      ;(built.brainDepth.material as ShaderMaterial).dispose()
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
    stepPhysics(physics, delta, FEEL, ORBITS, NO_PITCH_CLAMP)
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
      if (d.reportDepth) (d.reportDepth.material as ShaderMaterial).dispose() // shares the reports' geometry
      d.reportDepth?.removeFromParent()
      d.reportDepth = null
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
    // The camera push: the greater of the centred node's (orbit radius,
    // select.centerPush) and the drill's own as it blends in - not their
    // sum, which at 3000 + 900 landed the camera 700 wu from a blown-out
    // hub. A drill from a selected post keeps its distance; a drill from
    // home (Enter / pinch) pushes by recenterPush as it always did. Zero
    // with the centre at the origin and no drill - the rest view is untouched.
    center.current = stepCenter(center.current, delta, dur)
    const push = Math.max(
      currentPushWeight(center.current) * NCONF.select.centerPush,
      d.hubLocal ? k * NCONF.select.recenterPush : 0,
    )
    // The pin: the clicked centre, overridden by the drilled hub as the
    // drill blends in (pinPoint). Re-derived from the LIVE rotation every
    // frame, so the pinned node stays on the camera axis while the field
    // rotates about it.
    if (offsetRef.current) {
      const pin = pinPoint(
        currentCenter(center.current),
        d.hubLocal ? [d.hubLocal.x, d.hubLocal.y, d.hubLocal.z] : null,
        k,
      )
      const pw = rotateYawPitch(pin, physics.yaw, physics.pitch)
      offsetRef.current.position.set(-pw[0], -pw[1], -pw[2] + push)
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

    // The backdrop planes ride with the camera at their rest-view distance:
    // they are a backdrop, not a wall. Fixed in world space, the dolly flew
    // INTO them and the black went blue-grey (background luminance 4 -> 69
    // /255 between 1x and 7x). At zoom 1 this is exactly where they always were.
    const camZ = state.camera.position.z
    environment.wash.position.z = camZ - NCONF.camera.z + WASH_Z
    environment.warm.position.z = camZ - NCONF.camera.z + WARM_Z

    // Uniform sync (O(1) - no per-node JS). The clock drives the momentum
    // pulse and the trail energy bands in the shaders; beads stay still.
    const tSec = state.clock.elapsedTime
    // Scoped occlusion: the twins write depth, these test against it. Off,
    // nothing writes and nothing tests - the all-additive scene as it was.
    const occ = NCONF.render.occlusion
    built.starDepth.visible = occ
    built.brainDepth.visible = occ
    ;(built.starMesh.material as ShaderMaterial).depthTest = occ
    for (const m of [built.trails.core, built.trails.glow, built.beadMesh, built.pulseMesh]) {
      ;(m.material as ShaderMaterial).depthTest = occ
    }
    // Per-frame scale for the star shaders: the drawing buffer (the glow
    // cap, the trails' hairline) and the focus distance (depth of field) -
    // the pin sits at world z = push (the offset above), the camera at
    // push + (rest - push) / zoom, so the pivot's depth is camera.z - push.
    // (Focus at the origin defocused the clicked node itself at 6x: its
    // depth was 133 against a camera at 3133.)
    const viewportH = state.size.height * state.viewport.dpr
    starRuntime.viewportH = viewportH
    starRuntime.focusZ = state.camera.position.z - push
    syncStarUniforms(built.starMesh.material as ShaderMaterial, tSec)
    syncStarUniforms(built.beadMesh.material as ShaderMaterial)
    syncTrailUniforms(
      built.trails.core.material as ShaderMaterial,
      built.trails.glow.material as ShaderMaterial,
      tSec,
      viewportH,
    )
    syncPulseUniforms(built.pulseMesh.material as ShaderMaterial, tSec)

    // Anchor ROLE: brain holds it at level 0; the drilled hub inherits it
    // (spikes + corona boost + pulse) while it is the anchor (§6.4).
    const pulseT = state.clock.elapsedTime * 60 * NCONF.brainPulse.rate
    const pulse = 1 + NCONF.brainPulse.amp * (0.5 + 0.5 * Math.sin(pulseT))
    const brainMat = built.brainMesh.material as ShaderMaterial
    syncStarUniforms(brainMat, tSec)
    const brainHolds = d.level === 0
    brainMat.uniforms.uAnchor.value = brainHolds ? 1 : 0
    brainMat.uniforms.uCoronaMult.value = brainHolds ? NCONF.anchor.coronaMult : 1
    brainMat.uniforms.uSpikeLen.value = NCONF.anchor.spikeLength
    brainMat.uniforms.uScaleMult.value = brainHolds ? pulse : 1
    if (d.roleMesh) {
      const roleMat = d.roleMesh.material as ShaderMaterial
      syncStarUniforms(roleMat, tSec)
      roleMat.uniforms.uCoronaMult.value = NCONF.anchor.coronaMult
      roleMat.uniforms.uSpikeLen.value = NCONF.anchor.spikeLength
      roleMat.uniforms.uScaleMult.value = pulse
    }
    if (d.reportMesh) syncStarUniforms(d.reportMesh.material as ShaderMaterial, tSec)
    if (d.reportTrails) {
      syncTrailUniforms(
        d.reportTrails.core.material as ShaderMaterial,
        d.reportTrails.glow.material as ShaderMaterial,
        tSec,
        viewportH,
      )
      ;(d.reportTrails.core.material as ShaderMaterial).depthTest = occ
      ;(d.reportTrails.glow.material as ShaderMaterial).depthTest = occ
      if (d.reportDepth) d.reportDepth.visible = occ
    }

    built.beadMesh.visible = NCONF.trail.beadsEnabled
    built.pulseMesh.visible = NCONF.trail.pulseEnabled

    // ── Crosshair pointing (ORB_SELECT_SPEC §3, PT1) ─────────────────────
    // Projection -> nearest targetable within tolerance -> hysteresis. The
    // camera z is the LIVE one (it dollies with zoom) and the offset is the
    // recenter translation, so the sight stays honest at any zoom or depth.
    {
      const off = offsetRef.current
      const view = {
        camZ: state.camera.position.z,
        fovDeg: NCONF.camera.fov,
        viewportH: state.size.height,
        offset: off ? ([off.position.x, off.position.y, off.position.z] as Vec3) : undefined,
      }
      viewRef.current = view
      const cands = candidatesFor(
        built.nodes,
        built.targetable,
        physics.yaw,
        physics.pitch,
        view,
      )
      const h = stepHighlight(highlight.current, cands)
      highlight.current = h
      pointRuntime.name = h.name
      pointRuntime.dist = h.dist
      pointRuntime.depth = d.level
      pointRuntime.targetableCount = built.targetable.size
      if (h.name) {
        const node = built.nodesByName.get(h.name)!
        const p = projectNode(node, physics.yaw, physics.pitch, view)
        pointRuntime.x = p.x
        pointRuntime.y = p.y
        pointRuntime.tier = node.tier
        pointRuntime.hue = PAL[node.hue].body
        // The star is a view-space billboard of world size diam x spriteScale;
        // its solid disc is DISC_FRACTION of that. The ring hugs the DISC
        // through the same focal term the projection uses, and there is no
        // ring for the anchor fallback (ringRadiusPx).
        const focal = view.viewportH / 2 / Math.tan((view.fovDeg * Math.PI) / 360)
        const diam = built.diamByName.get(node.name) ?? NCONF.render.tierDiam[node.tier]
        pointRuntime.ringR = ringRadiusPx(
          node.tier, diam, NCONF.render.spriteScale, focal, p.w, NCONF.point.highlightSwell,
        )
      } else {
        pointRuntime.tier = ''
        pointRuntime.ringR = 0
      }

      // Selection marker (click-to-centre): the centred node's projection,
      // tracked through its flight so the click reads the instant it lands.
      const c = center.current
      const sel = c.name ? built.nodesByName.get(c.name) : undefined
      if (sel) {
        const p = projectNode(sel, physics.yaw, physics.pitch, view)
        const focal = view.viewportH / 2 / Math.tan((view.fovDeg * Math.PI) / 360)
        const diam = built.diamByName.get(sel.name) ?? NCONF.render.tierDiam[sel.tier]
        centerRuntime.name = sel.name
        centerRuntime.x = p.x
        centerRuntime.y = p.y
        centerRuntime.r = p.w > 0 ? discRadiusPx(diam, focal, p.w) * NCONF.render.discEdge : 0
        centerRuntime.hue = PAL[sel.hue].body
        centerRuntime.k = c.k
      } else {
        centerRuntime.name = null
        centerRuntime.k = c.k
      }

      // Hover ring (mouse only): the node the cursor is over, by the SAME
      // hit-test a click uses. Hidden while a button is down (a drag is not
      // a hover), while a report is open, and in hand mode.
      const cur = cursorRuntime
      let hover: CursorHit | null = null
      if (store.inputMode === 'pointer' && cur.inside && !cur.down && !store.openReport) {
        const shell = d.level === 1 && d.target === 1 && d.hubLocal ? { hub: d.hubLocal, items: d.shell } : null
        hover = cursorHit(
          cur.x, cur.y, built.nodes, built.nodesByName, built.diamByName, shell,
          physics.yaw, physics.pitch, view,
        )
      }
      const focalH = view.viewportH / 2 / Math.tan((view.fovDeg * Math.PI) / 360)
      if (hover) {
        hoverRuntime.source = 'mouse'
        hoverRuntime.name =
          hover.kind === 'node'
            ? hover.node.name
            : `report:${ORBITS[hover.item.orbitIndex].reports[hover.item.itemIndex].id}`
        hoverRuntime.x = hover.x
        hoverRuntime.y = hover.y
        hoverRuntime.r = discRadiusPx(hover.diam, focalH, hover.w) * NCONF.render.discEdge
      } else {
        hoverRuntime.name = null
      }

      // ── Gaze pointer (ORB_EYE 'point' mode) ────────────────────────────
      // The channel publishes a gaze point; here it becomes a node: a soft
      // cone over the field with the same glow-scaled sizing the mouse uses
      // (x pointRadiusMult), held with hysteresis (gazeFocus.ts). It shows
      // as the violet ring - the hover ring - unless the mouse holds it.
      const gazeLive =
        EYE.enabled && EYE.mode === 'point' && eyeRuntime.state === 'idle' && eyeRuntime.facePresent &&
        !store.eyeCalibrating && !store.openReport
      const nowMs = performance.now()
      if (gazeLive) {
        // the channel's point is already the fixation mean (+ freeze)
        const gx = eyeRuntime.gazeX - window.innerWidth / 2
        const gy = eyeRuntime.gazeY - window.innerHeight / 2
        gazeRuntime.fixationN = eyeRuntime.fixationN
        const cands: GazeCandidate[] = []
        for (const n of built.nodes) {
          const p = projectNode(n, physics.yaw, physics.pitch, view)
          if (p.w <= 0) continue
          const diam = built.diamByName.get(n.name) ?? NCONF.render.tierDiam[n.tier]
          const visR = discRadiusPx(diam, focalH, p.w) * NCONF.render.discEdge
          const r = Math.max(EYE.pointMinRadiusPx, visR * EYE.pointRadiusMult)
          const dist = Math.hypot(p.x - gx, p.y - gy)
          if (dist <= r * EYE.pointReleaseFactor) cands.push({ name: n.name, dist, r })
        }
        gazeFocus.current = stepGazeFocus(gazeFocus.current, cands, nowMs, {
          holdMs: EYE.pointHoldMs, releaseFactor: EYE.pointReleaseFactor, switchMargin: EYE.pointSwitchMargin,
        })
        gazeRuntime.live = true
        gazeRuntime.x = gx
        gazeRuntime.y = gy
        const g = gazeFocus.current
        if (g.name) {
          const node = built.nodesByName.get(g.name)!
          const p = projectNode(node, physics.yaw, physics.pitch, view)
          const diam = built.diamByName.get(node.name) ?? NCONF.render.tierDiam[node.tier]
          gazeRuntime.name = g.name
          gazeRuntime.nodeX = p.x
          gazeRuntime.nodeY = p.y
          gazeRuntime.nodeR = discRadiusPx(diam, focalH, p.w) * NCONF.render.discEdge
          gazeRuntime.heldMs = nowMs - g.since
          if (!hover) {
            hoverRuntime.source = 'gaze'
            hoverRuntime.name = g.name
            hoverRuntime.x = p.x
            hoverRuntime.y = p.y
            hoverRuntime.r = gazeRuntime.nodeR
          }
          // Dwell confirm (opt-in, pointDwellMs > 0): once per focus.
          if (EYE.pointDwellMs > 0 && !g.dwelled && nowMs - g.since >= EYE.pointDwellMs) {
            gazeFocus.current = { ...g, dwelled: true }
            bus.emit({ type: 'tap' }) // an unpositioned confirm: routed to the gazed node above
          }
        } else {
          gazeRuntime.name = null
          gazeRuntime.heldMs = 0
        }
      } else {
        if (gazeFocus.current.name !== null || gazeRuntime.live) gazeFocus.current = createGazeFocus()
        gazeRuntime.live = false
        gazeRuntime.name = null
        gazeRuntime.heldMs = 0
      }
    }

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
      drawCalls: light.sceneDrawCalls, // the scene's own, last frame (postfx.ts)
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
      pointed: pointRuntime.name,
      pointedDist: Math.round(pointRuntime.dist),
      centered: center.current.name,
      centerK: center.current.k,
      push,
      hovered: hoverRuntime.name,
      gazed: gazeRuntime.live ? gazeRuntime.name : null,
      gazeLive: gazeRuntime.live,
      pointedTier: pointRuntime.tier,
      targetable: pointRuntime.targetableCount,
      yaw: physics.yaw,
      pitch: physics.pitch,
    }
  })

  return (
    <>
      <primitive object={environment.wash} />
      <primitive object={environment.warm} />
      <group ref={offsetRef}>
        <group ref={tiltRef}>
          <group ref={spinRef}>
            <primitive object={built.brainDepth} />
            <primitive object={built.starMesh} />
            <primitive object={built.starDepth} />
            <primitive object={built.trails.core} />
            <primitive object={built.trails.glow} />
            <primitive object={built.beadMesh} />
            <primitive object={built.pulseMesh} />
            <primitive object={built.brainMesh} />
          </group>
        </group>
      </group>
    </>
  )
}
