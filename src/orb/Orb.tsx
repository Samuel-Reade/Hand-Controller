// <Canvas> contents: opaque body, graticule, item meshes - plus the single
// useFrame that runs the whole 60fps world: physics step, group rotations,
// item scale/opacity, DOM label projection, focus detection, fps meter.
// Nothing in here sets React state per frame.

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import type { Group, Mesh } from 'three'
import { FEEL } from '../config/feel'
import { TOKENS } from '../config/tokens'
import { ORBITS } from '../data/orbits'
import type { InputBus } from '../input/InputBus'
import { useStore } from '../store'
import {
  SPHERE_RADIUS,
  analyticFocusWeight,
  nearestOrbitIndex,
  rotateYawPitch,
} from './geometry'
import { ORB_ITEMS } from './items'
import { orbRuntime, stepPhysics, useOrbPhysics } from './useOrbPhysics'

// HMR-remounting a <Canvas> leaks WebGL contexts until the browser kills the
// page. Changes to this module reload the page instead - one context, always.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload()
  })
}

const ITEM_RADIUS = 0.032
const MERIDIAN_COUNT = 8
const TAN_HALF_FOV = Math.tan((40 / 2) * (Math.PI / 180))
const RING_SEGMENTS = 160

function circleGeometry(points: Vector3[]): BufferGeometry {
  const g = new BufferGeometry()
  const arr: number[] = []
  for (const p of points) arr.push(p.x, p.y, p.z)
  g.setAttribute('position', new Float32BufferAttribute(arr, 3))
  return g
}

/** Latitude ring at phi, sitting exactly at R (the body is undersized 0.985R). */
function latitudeRing(phi: number): BufferGeometry {
  const r = SPHERE_RADIUS * Math.cos(phi)
  const y = SPHERE_RADIUS * Math.sin(phi)
  const pts: Vector3[] = []
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const t = (i / RING_SEGMENTS) * Math.PI * 2
    pts.push(new Vector3(r * Math.sin(t), y, r * Math.cos(t)))
  }
  return circleGeometry(pts)
}

/** Great circle through the poles, in the XY plane; meridians rotate it about Y. */
function meridianGeometry(): BufferGeometry {
  const pts: Vector3[] = []
  const r = SPHERE_RADIUS * 0.998
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const t = (i / RING_SEGMENTS) * Math.PI * 2
    pts.push(new Vector3(r * Math.cos(t), r * Math.sin(t), 0))
  }
  return circleGeometry(pts)
}

const scratch = new Vector3()

export function OrbScene({ bus }: { bus: InputBus }) {
  const physics = useOrbPhysics(bus)
  const tiltRef = useRef<Group>(null)
  const spinRef = useRef<Group>(null)
  const itemRefs = useRef<(Mesh | null)[]>([])

  const itemGeometry = useMemo(() => new SphereGeometry(ITEM_RADIUS, 16, 12), [])
  const itemMaterials = useMemo(
    () =>
      ORB_ITEMS.map(
        () =>
          new MeshBasicMaterial({
            color: TOKENS.ivory,
            transparent: true,
            opacity: 0.15,
          }),
      ),
    [],
  )
  const ringGeometries = useMemo(() => ORBITS.map((o) => latitudeRing(o.latitude)), [])
  const ringMaterials = useMemo(
    () =>
      ORBITS.map(
        () =>
          new LineBasicMaterial({ color: TOKENS.graticule, transparent: true, opacity: 0.55 }),
      ),
    [],
  )
  const meridianGeo = useMemo(() => meridianGeometry(), [])
  const meridianMaterial = useMemo(
    () => new LineBasicMaterial({ color: TOKENS.graticule, transparent: true, opacity: 0.22 }),
    [],
  )

  // Per-frame working state - refs only, never React state.
  const frameState = useRef({
    activeOrbit: -1,
    focusedFlat: -1,
    frames: 0,
    fpsWindowStart: 0,
    brass: new Color(TOKENS.brass),
    ivory: new Color(TOKENS.ivory),
    graticule: new Color(TOKENS.graticule),
  })

  useFrame((state, delta) => {
    const fs = frameState.current
    stepPhysics(physics, delta)

    if (tiltRef.current) tiltRef.current.rotation.x = physics.pitch
    if (spinRef.current) spinRef.current.rotation.y = physics.yaw

    // Responsive camera distance (S5): 8.2, or 9.6 under 820px width.
    const targetZ = state.size.width < 820 ? 9.6 : 8.2
    if (state.camera.position.z !== targetZ) {
      state.camera.position.z = targetZ
      state.camera.updateMatrixWorld()
    }

    // Active orbit ring highlight.
    const active = nearestOrbitIndex(ORBITS, physics.pitch)
    if (active !== fs.activeOrbit) {
      fs.activeOrbit = active
      for (let i = 0; i < ringMaterials.length; i++) {
        const m = ringMaterials[i]
        if (i === active) {
          m.color.copy(fs.brass)
          m.opacity = 0.95
        } else {
          m.color.copy(fs.graticule)
          m.opacity = 0.55
        }
      }
    }

    // Items, labels, focus - all from the one scalar w.
    const { yaw, pitch } = physics
    const width = state.size.width
    const height = state.size.height
    let bestW = -Infinity
    let bestFlat = -1
    for (let i = 0; i < ORB_ITEMS.length; i++) {
      const item = ORB_ITEMS[i]
      const w = analyticFocusWeight(item.phi, item.theta, yaw, pitch)
      if (w > bestW) {
        bestW = w
        bestFlat = i
      }
      const visible = Math.max(0, (w - 0.1) / 0.9)
      const mesh = itemRefs.current[i]
      if (mesh) {
        const scale = 1 + FEEL.itemGrow * visible ** 6
        mesh.scale.setScalar(scale)
        itemMaterials[i].opacity = 0.15 + 0.85 * visible ** FEEL.falloff
      }
      const label = orbRuntime.labelEls.get(item.id)
      if (label) {
        const labelOpacity = visible ** FEEL.falloff
        if (labelOpacity < 0.02) {
          if (label.style.display !== 'none') label.style.display = 'none'
        } else {
          const [wx, wy, wz] = rotateYawPitch(
            item.local as [number, number, number],
            yaw,
            pitch,
          )
          scratch.set(wx, wy, wz).project(state.camera)
          const sx = (scratch.x * 0.5 + 0.5) * width
          const sy = (-scratch.y * 0.5 + 0.5) * height
          if (label.style.display !== 'block') label.style.display = 'block'
          // Flip sides only past a deadband so a dead-centre item's label
          // doesn't flicker left/right during detent wobble.
          let side = label.dataset.side === 'l' ? -1 : 1
          if (sx > width / 2 + 8) side = 1
          else if (sx < width / 2 - 8) side = -1
          label.dataset.side = side === 1 ? 'r' : 'l'
          // Clear the ball: offset by its projected radius plus a gap.
          const scale = 1 + FEEL.itemGrow * visible ** 6
          const cam = state.camera.position
          const dist = Math.sqrt(wx * wx + wy * wy + (cam.z - wz) * (cam.z - wz))
          const radiusPx = ((ITEM_RADIUS * scale) / (dist * TAN_HALF_FOV)) * (height / 2)
          const offset = radiusPx + 9
          label.style.transform =
            `translate3d(${sx + side * offset}px, ${sy}px, 0) ` +
            `translate(${side === 1 ? '0' : '-100%'}, -50%)`
          label.style.opacity = labelOpacity.toFixed(3)
        }
      }
    }

    // Focus changed - the one low-frequency store write.
    if (bestFlat !== fs.focusedFlat) {
      const prev = fs.focusedFlat
      fs.focusedFlat = bestFlat
      if (prev >= 0) {
        itemMaterials[prev].color.copy(fs.ivory)
        const prevLabel = orbRuntime.labelEls.get(ORB_ITEMS[prev].id)
        if (prevLabel) delete prevLabel.dataset.focused
      }
      if (bestFlat >= 0) {
        itemMaterials[bestFlat].color.copy(fs.brass)
        const label = orbRuntime.labelEls.get(ORB_ITEMS[bestFlat].id)
        if (label) label.dataset.focused = '1'
        const item = ORB_ITEMS[bestFlat]
        orbRuntime.focus = { orbitIndex: item.orbitIndex, itemIndex: item.itemIndex }
        useStore.getState().setFocus({ orbitIndex: item.orbitIndex, itemIndex: item.itemIndex })
      }
    }

    // fps meter (dev telemetry reads orbRuntime.fps).
    fs.frames++
    const now = state.clock.elapsedTime
    if (now - fs.fpsWindowStart >= 1) {
      orbRuntime.fps = Math.round(fs.frames / (now - fs.fpsWindowStart))
      fs.frames = 0
      fs.fpsWindowStart = now
    }
  })

  return (
    <>
      <directionalLight position={[4.5, 5, 6.5]} intensity={1.15} color="#f4eddc" />
      <ambientLight intensity={0.42} color="#3a4a74" />
      <group ref={tiltRef}>
        <group ref={spinRef}>
          {/* Opaque body - depth buffer occludes the far hemisphere for free */}
          <mesh>
            <sphereGeometry args={[SPHERE_RADIUS * 0.985, 64, 48]} />
            <meshPhongMaterial color={TOKENS.deep} specular="#1c2a4a" shininess={9} />
          </mesh>
          {ringGeometries.map((g, i) => (
            <lineLoop key={ORBITS[i].id} geometry={g} material={ringMaterials[i]} />
          ))}
          {Array.from({ length: MERIDIAN_COUNT }, (_, i) => (
            <lineLoop
              key={`meridian-${i}`}
              geometry={meridianGeo}
              material={meridianMaterial}
              rotation-y={(i * Math.PI) / MERIDIAN_COUNT}
            />
          ))}
          {ORB_ITEMS.map((item, i) => (
            <mesh
              key={item.id}
              position={item.local as [number, number, number]}
              geometry={itemGeometry}
              material={itemMaterials[i]}
              ref={(m) => {
                itemRefs.current[i] = m
              }}
            />
          ))}
        </group>
      </group>
    </>
  )
}
