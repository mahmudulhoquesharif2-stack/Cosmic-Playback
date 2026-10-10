'use client'
/* eslint-disable react-hooks/immutability, react-hooks/static-components */

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

/* ========================================================================== *
 * The Cosmic Playback — Apollo Lunar Rover (/play)
 * --------------------------------------------------------------------------
 * Velocity-vector physics (mass, forces, lateral grip).
 * 6-wheel spring-damper suspension. Wheel rotation from actual velocity.
 * 3 camera modes (chase / 360° orbit / first-person). Reset key.
 * Mission markers on the lunar surface. Earth in the sky.
 * ========================================================================== */

// ── Physical constants ────────────────────────────────────────────────────
const G_MOON = 1.62
const ROVER_MASS = 210
const ENGINE_FORCE = 350
const BRAKE_FORCE = 600
const ROLL_RESIST = 120
const LATERAL_GRIP = 8000
const WHEELBASE = 2.3
const TRACK_WIDTH = 1.4
const WHEEL_R = 0.45
const SUSP_TRAVEL = 0.08
const MAX_STEER = 0.4
const STEER_RATE = 3.0
const MAX_SPEED = 3.5
const SPECIAL_COOLDOWN = 3000

// ── Suspension tuning (spring-damper per wheel) ────────────────────────────
// REST_LENGTH: nominal distance from chassis mount to contact patch.
// STIFFNESS:  spring constant (N/m) — how hard the spring pushes back.
// DAMPING:    damping coefficient (N·s/m) — kills oscillation.
// We pick values that feel like a soft lunar-rover strut: low spring rate
// (1/6 Earth gravity lets us use a gentle k), enough damping to be near
// critically damped (no bouncing), and a small travel envelope so the
// wheels never visibly intersect the chassis.
const SUSP_REST = WHEEL_R + 0.05
const SUSP_STIFFNESS = 9000   // N/m
const SUSP_DAMPING = 380     // N·s/m  (≈ 2·√(m·k) / 6 wheels → near critical)
const SUSP_RESTITUTION = 0.05 // small bounce on full compression

const WHEEL_OFFSETS: [number, number][] = [
  [-WHEELBASE / 2, TRACK_WIDTH / 2],   // FL (steers)
  [-WHEELBASE / 2, -TRACK_WIDTH / 2],  // FR (steers)
  [0, TRACK_WIDTH / 2],                 // ML
  [0, -TRACK_WIDTH / 2],                // MR
  [WHEELBASE / 2, TRACK_WIDTH / 2],     // RL
  [WHEELBASE / 2, -TRACK_WIDTH / 2],    // RR
]

// ── Vehicle state ──────────────────────────────────────────────────────────
const V = {
  pos: new THREE.Vector3(0, 0, 0),
  vel: new THREE.Vector3(0, 0, 0),
  heading: 0,
  angularVel: 0,
  pitch: 0,
  roll: 0,
  steerAngle: 0,
  wheelSpin: [0, 0, 0, 0, 0, 0] as number[],
  wheelSusp: [0, 0, 0, 0, 0, 0] as number[],   // current suspension offset (m) — 0 = rest
  wheelSuspVel: [0, 0, 0, 0, 0, 0] as number[], // per-wheel suspension velocity (m/s)
  wheelContact: [true, true, true, true, true, true] as boolean[],
  airborne: false,
  specialCd: 0,
  battery: 82,
  speedDisplay: 0,
}
const keys: Record<string, boolean> = {}
const mobileInput = { x: 0, y: 0 }
let lastSpecial = 0

// ── Terrain height — INFINITE procedural function ──────────────────────────
function terrainHeight(x: number, z: number): number {
  let h = 0
  h += Math.sin(x * 0.003) * 0.4 + Math.cos(z * 0.004) * 0.35
  h += Math.sin(x * 0.008 + z * 0.006) * 0.2
  h += Math.sin(x * 0.015) * 0.1 + Math.cos(z * 0.012) * 0.08
  h += Math.sin(x * 0.05 + z * 0.04) * 0.02
  const cellSize = 80
  const cx = Math.floor(x / cellSize), cz = Math.floor(z / cellSize)
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const ccx = cx + dx, ccz = cz + dz
      const seed = (ccx * 73856093) ^ (ccz * 19349663)
      const r1 = ((seed & 0x7fffffff) % 1000) / 1000
      const r2 = (((seed >> 8) & 0x7fffffff) % 1000) / 1000
      const r3 = (((seed >> 16) & 0x7fffffff) % 1000) / 1000
      if (r1 > 0.6) {
        const craterX = ccx * cellSize + r2 * cellSize
        const craterZ = ccz * cellSize + r3 * cellSize
        const craterR = 8 + r1 * 25
        const craterD = 0.5 + r2 * 2.5
        const ddx = x - craterX, ddz = z - craterZ
        const d = Math.sqrt(ddx * ddx + ddz * ddz)
        if (d < craterR * 1.8) {
          const t = d / craterR
          if (t < 1) h -= craterD * (1 - t * t) * 0.8
          else if (t < 1.3) { const rimT = (t - 1) / 0.3; h += craterD * 0.3 * (1 - rimT * rimT) }
        }
      }
    }
  }
  return h
}

// ── Materials ─────────────────────────────────────────────────────────────
const MAT = {
  frame: '#b0b8c0', frameDark: '#8a9098', tire: '#2a2a28', hub: '#9aa0a8',
  fender: '#c8a838', seat: '#d8dce0', seatFrame: '#9098a0', equipment: '#c0c4c8',
  equipmentDark: '#707880', gold: '#c8a838', dark: '#3a3e42', console: '#808890',
}

// ── Rover model ───────────────────────────────────────────────────────────
function RoverModel() {
  const ref = useRef<THREE.Group>(null)
  const wheelRefs = useRef<(THREE.Group | null)[]>([null, null, null, null, null, null])
  const steerRefs = useRef<(THREE.Group | null)[]>([null, null])

  useFrame(() => {
    if (!ref.current) return
    ref.current.position.copy(V.pos)
    ref.current.rotation.set(V.pitch, V.heading, V.roll)
    for (let i = 0; i < 6; i++) { if (wheelRefs.current[i]) wheelRefs.current[i]!.rotation.x = V.wheelSpin[i] }
    for (let i = 0; i < 2; i++) { if (steerRefs.current[i]) steerRefs.current[i]!.rotation.y = V.steerAngle }
  })

  const Seat = ({ x }: { x: number }) => (
    <group position={[x, 0.1, 0]}>
      <mesh position={[0, 0, 0]}><boxGeometry args={[0.5, 0.06, 0.5]} /><meshStandardMaterial color={MAT.seatFrame} metalness={0.4} roughness={0.6} /></mesh>
      <mesh position={[0, 0.05, 0]}><boxGeometry args={[0.45, 0.05, 0.45]} /><meshStandardMaterial color={MAT.seat} roughness={0.8} /></mesh>
      <mesh position={[0, 0.3, -0.23]}><boxGeometry args={[0.5, 0.4, 0.05]} /><meshStandardMaterial color={MAT.seatFrame} metalness={0.4} /></mesh>
      <mesh position={[0, 0.3, -0.22]}><boxGeometry args={[0.45, 0.36, 0.04]} /><meshStandardMaterial color={MAT.seat} roughness={0.8} /></mesh>
      {[0.22, -0.22].map((dx) => [0.22, -0.22].map((dz) => (
        <mesh key={`${dx}${dz}`} position={[dx, -0.1, dz]}><boxGeometry args={[0.04, 0.18, 0.04]} /><meshStandardMaterial color={MAT.frameDark} /></mesh>
      )))}
    </group>
  )

  return (
    <group ref={ref}>
      {/* open tubular chassis */}
      <mesh position={[0, -0.1, TRACK_WIDTH / 2]} castShadow><boxGeometry args={[WHEELBASE, 0.08, 0.06]} /><meshStandardMaterial color={MAT.frame} metalness={0.5} roughness={0.5} /></mesh>
      <mesh position={[0, -0.1, -TRACK_WIDTH / 2]} castShadow><boxGeometry args={[WHEELBASE, 0.08, 0.06]} /><meshStandardMaterial color={MAT.frame} metalness={0.5} roughness={0.5} /></mesh>
      {[-0.6, 0, 0.6].map((x) => <mesh key={x} position={[x, -0.1, 0]}><boxGeometry args={[0.06, 0.06, TRACK_WIDTH]} /><meshStandardMaterial color={MAT.frame} metalness={0.5} /></mesh>)}
      <mesh position={[-0.5, -0.1, 0]} rotation={[0, 0.4, 0]}><boxGeometry args={[0.06, 0.06, TRACK_WIDTH * 1.1]} /><meshStandardMaterial color={MAT.frameDark} /></mesh>
      <mesh position={[0.5, -0.1, 0]} rotation={[0, -0.4, 0]}><boxGeometry args={[0.06, 0.06, TRACK_WIDTH * 1.1]} /><meshStandardMaterial color={MAT.frameDark} /></mesh>
      {[-0.4, -0.15, 0.1, 0.35].map((x) => <mesh key={x} position={[x, -0.13, 0]}><boxGeometry args={[0.1, 0.015, TRACK_WIDTH * 0.9]} /><meshStandardMaterial color={MAT.dark} roughness={0.9} /></mesh>)}

      {/* 6 wheels with steering on front 2 + suspension on all */}
      {(['FL', 'FR', 'ML', 'MR', 'RL', 'RR'] as const).map((p, i) => {
        const [lx, lz] = WHEEL_OFFSETS[i]
        const isFront = i < 2
        return (
          <group key={p} position={[lx, -WHEEL_R + V.wheelSusp[i], lz]}>
            <group ref={(el) => { steerRefs.current[i] = isFront ? el : null }}>
              <group ref={(el) => { wheelRefs.current[i] = el }}>
                <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
                  <torusGeometry args={[WHEEL_R, 0.16, 12, 24]} />
                  <meshStandardMaterial color={MAT.tire} roughness={0.85} metalness={0.15} />
                </mesh>
                {Array.from({ length: 20 }).map((_, j) => {
                  const a = (j / 20) * Math.PI * 2
                  return <mesh key={j} position={[Math.cos(a) * WHEEL_R, Math.sin(a) * WHEEL_R, 0]} rotation={[0, 0, a + Math.PI / 4]}><boxGeometry args={[0.08, 0.025, 0.1]} /><meshStandardMaterial color={MAT.tire} roughness={0.8} /></mesh>
                })}
                <mesh rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.18, 0.18, 0.12, 12]} /><meshStandardMaterial color={MAT.hub} metalness={0.6} roughness={0.4} /></mesh>
                {[0, 1, 2].map((j) => <mesh key={j} rotation={[0, 0, (j / 3) * Math.PI]}><boxGeometry args={[0.32, 0.02, 0.1]} /><meshStandardMaterial color={MAT.hub} metalness={0.5} /></mesh>)}
              </group>
              {/* gold fender */}
              <mesh position={[0, WHEEL_R + 0.12, 0]}><torusGeometry args={[WHEEL_R + 0.04, 0.05, 8, 16, Math.PI]} /><meshStandardMaterial color={MAT.fender} roughness={0.5} metalness={0.6} side={THREE.DoubleSide} /></mesh>
              <mesh position={[0.15, 0.36, 0]}><boxGeometry args={[0.02, 0.2, 0.02]} /><meshStandardMaterial color={MAT.frameDark} /></mesh>
              <mesh position={[-0.15, 0.36, 0]}><boxGeometry args={[0.02, 0.2, 0.02]} /><meshStandardMaterial color={MAT.frameDark} /></mesh>
            </group>
          </group>
        )
      })}

      {/* 2 seats */}
      <Seat x={0.25} /><Seat x={-0.25} />

      {/* console */}
      <mesh position={[0, -0.05, 0.25]}><boxGeometry args={[0.16, 0.08, 0.1]} /><meshStandardMaterial color={MAT.console} metalness={0.3} /></mesh>
      <mesh position={[0, 0.15, 0.25]}><cylinderGeometry args={[0.025, 0.035, 0.15, 8]} /><meshStandardMaterial color={MAT.dark} /></mesh>
      <mesh position={[0, 0.23, 0.25]}><boxGeometry args={[0.1, 0.03, 0.05]} /><meshStandardMaterial color={MAT.equipment} /></mesh>

      {/* rear equipment */}
      <mesh position={[0.8, 0, -0.35]} castShadow><boxGeometry args={[0.5, 0.35, 0.6]} /><meshStandardMaterial color={MAT.equipment} roughness={0.7} /></mesh>
      <mesh position={[0.8, 0, 0.35]} castShadow><boxGeometry args={[0.4, 0.3, 0.5]} /><meshStandardMaterial color={MAT.equipment} roughness={0.7} /></mesh>
      <mesh position={[1.0, 0.12, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.12, 0.12, 0.35, 12]} /><meshStandardMaterial color={MAT.equipmentDark} metalness={0.4} /></mesh>
      <mesh position={[1.05, 0.05, 0.35]}><boxGeometry args={[0.03, 0.2, 0.4]} /><meshStandardMaterial color={MAT.gold} metalness={0.7} /></mesh>
      <mesh position={[1.05, 0.05, -0.35]}><boxGeometry args={[0.03, 0.2, 0.44]} /><meshStandardMaterial color={MAT.gold} metalness={0.7} /></mesh>

      {/* front equipment */}
      <mesh position={[-0.85, 0.05, 0.4]}><boxGeometry args={[0.3, 0.2, 0.36]} /><meshStandardMaterial color={MAT.equipment} roughness={0.7} /></mesh>
      <mesh position={[-1.0, 0.05, 0.4]}><boxGeometry args={[0.02, 0.16, 0.32]} /><meshStandardMaterial color={MAT.gold} metalness={0.7} /></mesh>

      {/* parabolic dish antenna */}
      <mesh position={[-1.0, -0.05, 0.55]}><boxGeometry args={[0.12, 0.08, 0.12]} /><meshStandardMaterial color={MAT.frameDark} /></mesh>
      <mesh position={[-1.0, 0.4, 0.55]}><cylinderGeometry args={[0.025, 0.03, 0.8, 8]} /><meshStandardMaterial color={MAT.frameDark} metalness={0.5} /></mesh>
      <mesh position={[-1.0, 0.85, 0.55]} rotation={[0, 0, Math.PI]}>
        <coneGeometry args={[0.36, 0.12, 32, 1, true]} />
        <meshStandardMaterial color={MAT.gold} metalness={0.8} roughness={0.3} side={THREE.DoubleSide} transparent opacity={0.85} />
      </mesh>
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2
        return <mesh key={i} position={[-1.0, 0.85, 0.55]} rotation={[0, a, 0]}><boxGeometry args={[0.32, 0.01, 0.01]} /><meshStandardMaterial color={MAT.frameDark} /></mesh>
      })}
      <mesh position={[-1.0, 0.93, 0.55]}><cylinderGeometry args={[0.03, 0.04, 0.08, 8]} /><meshStandardMaterial color={MAT.equipmentDark} /></mesh>
      <mesh position={[-1.0, 0.76, 0.55]}><boxGeometry args={[0.08, 0.06, 0.08]} /><meshStandardMaterial color={MAT.gold} metalness={0.6} /></mesh>

      {/* shadow */}
      <mesh position={[0, -WHEEL_R - 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[1.4, 24]} /><meshBasicMaterial color="#000" transparent opacity={0.2} depthWrite={false} /></mesh>
    </group>
  )
}

// ── Moon terrain (follows rover, re-displaced every 0.2s) ──────────────────
function MoonTerrain({ roverPosRef }: { roverPosRef: React.MutableRefObject<THREE.Vector3> }) {
  const ref = useRef<THREE.Mesh>(null)
  const SIZE = 800, SEGS = 100
  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS)
    g.rotateX(-Math.PI / 2)
    return g
  }, [])

  const tex = useMemo(() => {
    if (typeof document === 'undefined') return null
    const W = 1024, H = 1024
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#9a958c'; ctx.fillRect(0, 0, W, H)
    let seed = 42
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 }
    for (let i = 0; i < 15; i++) {
      const x = rand() * W, y = rand() * H, r = 40 + rand() * 120
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, 'rgba(85,82,75,0.5)'); g.addColorStop(1, 'rgba(85,82,75,0)')
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    }
    for (let i = 0; i < 60; i++) {
      const x = rand() * W, y = rand() * H, r = 10 + rand() * 40
      const g = ctx.createRadialGradient(x, y, r * 0.3, x, y, r)
      g.addColorStop(0, 'rgba(70,67,60,0.3)'); g.addColorStop(0.8, 'rgba(120,115,105,0.2)'); g.addColorStop(1, 'rgba(140,135,125,0)')
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    }
    for (let i = 0; i < 200; i++) {
      const x = rand() * W, y = rand() * H, r = 2 + rand() * 8
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, 'rgba(60,57,50,0.4)'); g.addColorStop(1, 'rgba(60,57,50,0)')
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    }
    for (let i = 0; i < 6000; i++) {
      ctx.fillStyle = `rgba(${rand() > 0.5 ? 130 : 80},${rand() > 0.5 ? 125 : 75},${rand() > 0.5 ? 120 : 70},0.06)`
      ctx.fillRect(rand() * W, rand() * H, 2, 2)
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6)
    return t
  }, [])

  const lastSnap = useRef({ x: 0, z: 0 })
  const timer = useRef(0)

  useFrame((_, delta) => {
    if (!ref.current) return
    timer.current += delta
    if (timer.current < 0.2) return
    timer.current = 0
    const snappedX = Math.round(roverPosRef.current.x / 10) * 10
    const snappedZ = Math.round(roverPosRef.current.z / 10) * 10
    if (snappedX === lastSnap.current.x && snappedZ === lastSnap.current.z) return
    lastSnap.current = { x: snappedX, z: snappedZ }
    ref.current.position.x = snappedX
    ref.current.position.z = snappedZ
    const pos = geom.attributes.position
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, terrainHeight(pos.getX(i) + snappedX, pos.getZ(i) + snappedZ))
    }
    pos.needsUpdate = true
    geom.computeVertexNormals()
  })

  return (
    <mesh ref={ref} geometry={geom} receiveShadow>
      <meshStandardMaterial map={tex ?? undefined} color={tex ? '#ffffff' : '#9a958c'} roughness={0.95} metalness={0} />
    </mesh>
  )
}

// ── Rocks ─────────────────────────────────────────────────────────────────
// Rocks live at FIXED world positions within a 400 m radius of the origin.
// Unlike the terrain (which re-displaces its 800 m mesh centred on a snapped
// rover position) and the Earth sky-marker (which follows the rover), rocks
// must NOT snap with the rover — otherwise they recede as the rover
// approaches and the rover can never collide with them. Instead, rocks are
// placed once at fixed world coordinates and the collision check uses those
// world coordinates directly. Only rocks within the visible 800 m terrain
// patch are rendered (we cull by distance from the rover each frame).
type RockData = { wx: number; wz: number; s: number; r: number; r2: number }
const ROCKS: RockData[] = (() => {
  const arr: RockData[] = []
  let seed = 77
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 }
  for (let i = 0; i < 40; i++) {
    const ang = rand() * Math.PI * 2
    const dist = 8 + rand() * 60 // 8–68 m from origin — close enough to drive to
    arr.push({
      wx: Math.cos(ang) * dist,
      wz: Math.sin(ang) * dist,
      s: 0.3 + rand() * 1.5,
      r: rand() * Math.PI * 2,
      r2: rand() * Math.PI * 2,
    })
  }
  return arr
})()

function Rocks() {
  // We render ALL rocks at their fixed world positions. The terrain mesh is
  // 800 m wide, so rocks within 400 m of the snapped rover position are
  // visible. Rocks beyond ~400 m are still rendered but culled by the
  // camera frustum (far=2000) and the fog at 200–600 m. With only 80 rocks
  // this is cheap; no per-frame culling needed.
  // All rocks share a single material instance to avoid 80 separate
  // material compilations / draw-state changes on low-end GPUs.
  const rockMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5a534b', roughness: 0.95 }), [])
  return (
    <group>
      {ROCKS.map((r, i) => (
        <mesh key={i} position={[r.wx, terrainHeight(r.wx, r.wz) + r.s * 0.3, r.wz]} rotation={[r.r, r.r2, 0]} castShadow receiveShadow material={rockMat}>
          <dodecahedronGeometry args={[r.s, 0]} />
        </mesh>
      ))}
    </group>
  )
}

// ── Earth in the lunar sky ─────────────────────────────────────────────────
// Earth is treated as a "sky" element: it follows the rover on the XZ plane so
// it always sits at the same angular position in the sky no matter how far the
// rover drives across the infinite terrain. Y is fixed (sky height); only
// X/Z track the rover, which prevents Earth from being left behind once the
// rover has driven more than a couple of hundred metres from the origin.
function EarthSphere({ roverPosRef }: { roverPosRef: React.MutableRefObject<THREE.Vector3> }) {
  const ref = useRef<THREE.Mesh>(null)
  // Earth is positioned as a "sky" element: an angular offset from the rover
  // that stays at a fixed compass bearing no matter how far the rover drives.
  // The OFFSET is tuned for the initial chase-camera view (camera looks
  // ~24.5° downward with a 55° vertical FOV, so only the top ~3° above the
  // horizon is in frame). Placing Earth at (0, 12, 300) puts the bottom of
  // the 8 m sphere just at the horizon and the top comfortably inside the
  // frame — evoking the iconic Apollo 8 "Earthrise" photograph. We also
  // disable fog on the material so Earth stays bright against the dark sky.
  const OFFSET = useMemo(() => new THREE.Vector3(0, 12, 300), [])
  const tex = useMemo(() => {
    if (typeof document === 'undefined') return null
    const W = 512, H = 256
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#1a4a7a'; ctx.fillRect(0, 0, W, H)
    let seed = 33
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 }
    for (let i = 0; i < 12; i++) {
      const x = rand() * W, y = rand() * H, rw = 30 + rand() * 60, rh = 20 + rand() * 40
      ctx.globalAlpha = 0.8; ctx.fillStyle = '#3a7d3a'
      ctx.beginPath(); ctx.ellipse(x, y, rw, rh, rand() * Math.PI, 0, Math.PI * 2); ctx.fill()
    }
    for (let i = 0; i < 20; i++) {
      const x = rand() * W, y = rand() * H, rw = 40 + rand() * 60, rh = 8 + rand() * 12
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#ffffff'
      ctx.beginPath(); ctx.ellipse(x, y, rw, rh, 0, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])
  useFrame(() => {
    if (!ref.current) return
    const p = roverPosRef.current
    ref.current.position.set(p.x + OFFSET.x, OFFSET.y, p.z + OFFSET.z)
  })
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[8, 32, 32]} />
      <meshStandardMaterial map={tex ?? undefined} color={tex ? '#ffffff' : '#3a7dca'} roughness={0.7} emissive={new THREE.Color('#0a1830')} emissiveIntensity={0.25} fog={false} />
    </mesh>
  )
}

// ── Mission markers ───────────────────────────────────────────────────────
// Markers are placed in the rover's FORWARD hemisphere (positive Z side) from
// the spawn at origin, so a player who just landed can see all of them on the
// horizon from the initial chase-camera view. Distances (40–140 m) and bearings
// are tuned so the beacons are visible without crowding one another, while
// the ordering still roughly follows their real-life geographic relationship.
function MissionMarkers() {
  const markers = useMemo(() => [
    { x: 25, z: 35, label: 'Tranquility Base', mission: 'Apollo 11' },
    { x: -40, z: 60, label: 'Ocean of Storms', mission: 'Apollo 12' },
    { x: 55, z: 95, label: 'Fra Mauro', mission: 'Apollo 14' },
    { x: -75, z: 130, label: 'Taurus-Littrow', mission: 'Apollo 17' },
  ], [])
  const refs = useRef<(THREE.Group | null)[]>([])
  useFrame(() => {
    for (let i = 0; i < markers.length; i++) {
      const m = refs.current[i]
      if (m) {
        m.position.y = terrainHeight(markers[i].x, markers[i].z) + 2 + Math.sin(performance.now() * 0.002 + i) * 0.3
        m.rotation.y += 0.01
      }
    }
  })
  return (
    <group>
      {markers.map((m, i) => (
        <group key={i} ref={(el) => { refs.current[i] = el }} position={[m.x, terrainHeight(m.x, m.z) + 2, m.z]}>
          <mesh><cylinderGeometry args={[0.04, 0.04, 4, 8]} /><meshBasicMaterial color="#37c6ff" toneMapped={false} /></mesh>
          <mesh position={[0, 2, 0]}><sphereGeometry args={[0.15, 12, 12]} /><meshBasicMaterial color="#37c6ff" toneMapped={false} /></mesh>
          <mesh position={[0, -2, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[1, 1.2, 32]} /><meshBasicMaterial color="#37c6ff" transparent opacity={0.4} side={THREE.DoubleSide} /></mesh>
        </group>
      ))}
    </group>
  )
}

// ── Dust particles ────────────────────────────────────────────────────────
type DustP = { pos: THREE.Vector3; vel: THREE.Vector3; life: number; size: number }
function DustSystem({ dustRef }: { dustRef: React.MutableRefObject<DustP[]> }) {
  const meshRefs = useRef<THREE.Mesh[]>([])
  useFrame(() => {
    const ps = dustRef.current
    for (let i = 0; i < Math.min(ps.length, meshRefs.current.length); i++) {
      const m = meshRefs.current[i]
      if (m) {
        m.position.copy(ps[i].pos)
        m.scale.setScalar(Math.max(0.001, ps[i].life * ps[i].size))
        ;(m.material as THREE.MeshBasicMaterial).opacity = ps[i].life * 0.5
        m.visible = ps[i].life > 0
      }
    }
  })
  return (
    <group>
      {Array.from({ length: 60 }).map((_, i) => (
        <mesh key={i} ref={(el) => { if (el) meshRefs.current[i] = el }} visible={false}>
          <sphereGeometry args={[1, 6, 6]} />
          <meshBasicMaterial color="#b3aa9b" transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

// ── Wheel tracks ───────────────────────────────────────────────────────────
function WheelTracks({ tracksRef }: { tracksRef: React.MutableRefObject<{ pos: THREE.Vector3; rot: number; life: number }[]> }) {
  const meshRefs = useRef<THREE.Mesh[]>([])
  useFrame(() => {
    const ts = tracksRef.current
    for (let i = 0; i < Math.min(ts.length, meshRefs.current.length); i++) {
      const m = meshRefs.current[i]
      if (m) {
        m.position.copy(ts[i].pos)
        m.rotation.z = ts[i].rot
        ;(m.material as THREE.MeshBasicMaterial).opacity = ts[i].life * 0.3
        m.visible = ts[i].life > 0
      }
    }
  })
  return (
    <group>
      {Array.from({ length: 40 }).map((_, i) => (
        <mesh key={i} ref={(el) => { if (el) meshRefs.current[i] = el }} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.15, 0.5]} />
          <meshBasicMaterial color="#6a655d" transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

// ── Vehicle physics — velocity-vector wheel-force model ───────────────────
function VehiclePhysics({ dustRef, tracksRef, roverPosRef }: {
  dustRef: React.MutableRefObject<DustP[]>
  tracksRef: React.MutableRefObject<{ pos: THREE.Vector3; rot: number; life: number }[]>
  roverPosRef: React.MutableRefObject<THREE.Vector3>
}) {
  const trackTimer = useRef(0)

  useFrame((_, delta) => {
    // Clamp dt at 50 ms (20 fps min). The previous 33 ms clamp meant that on
    // slow devices the simulation
    // ran in slow motion because each frame advanced less wall-clock time
    // than actually elapsed. 50 ms keeps the spring-damper stable
    // (dt * ω = 0.05 * sqrt(9000/35) ≈ 0.8 < 2) while letting the rover
    // accelerate at roughly the right rate down to ~20 fps. Below that, the
    // simulation still slows gracefully instead of exploding.
    const dt = Math.min(delta, 0.05)
    const r = V

    // ── Input ──
    let throttle = 0
    if (keys.forward || mobileInput.y < -0.3) throttle = 1
    if (keys.back || mobileInput.y > 0.3) throttle = -1
    let steerInput = 0
    if (keys.left || mobileInput.x < -0.3) steerInput = 1
    if (keys.right || mobileInput.x > 0.3) steerInput = -1

    // ── Steering (smoothed, rate-limited) ──
    const targetSteer = steerInput * MAX_STEER
    r.steerAngle += (targetSteer - r.steerAngle) * STEER_RATE * dt
    if (steerInput === 0) r.steerAngle *= Math.pow(0.001, dt)

    // ── 6-wheel suspension + contact ──
    // Each wheel is a 1-D spring-damper along the chassis-local Y axis. The
    // spring's rest length is SUSP_REST, so when the chassis sits at
    // ground+WHEEL_R the spring is relaxed (wheelSusp=0). When terrain rises
    // under a wheel, the spring compresses (wheelSusp grows positive, wheel
    // is pushed up); when terrain drops, the spring extends (wheelSusp goes
    // negative, wheel drops). The damper kills oscillation so the rover
    // settles in ~1 bounce instead of jittering forever. The chassis Y itself
    // still follows the average ground height kinematically (the smallest
    // model change we can make without adding a full rigid-body solver).
    const cos = Math.cos(r.heading), sin = Math.sin(r.heading)
    let avgGroundH = 0
    let groundedCount = 0
    const heights: number[] = []
    const mCorner = ROVER_MASS / 6 // effective mass per wheel corner

    for (let i = 0; i < 6; i++) {
      const [lx, lz] = WHEEL_OFFSETS[i]
      const wx = r.pos.x + lx * cos - lz * sin
      const wz = r.pos.z + lx * sin + lz * cos
      const gh = terrainHeight(wx, wz)
      heights.push(gh)

      // Target suspension offset that would put the wheel centre on the
      // ground. gap = ground - (chassis_y - WHEEL_R).
      const wheelBottom = r.pos.y - WHEEL_R
      const gap = gh - wheelBottom

      // Spring-damper integration toward target = gap. The spring force is
      // -k*(wheelSusp - gap); damping is -c*wheelSuspVel.
      const disp = r.wheelSusp[i] - gap
      const force = -SUSP_STIFFNESS * disp - SUSP_DAMPING * r.wheelSuspVel[i]
      const a = force / mCorner
      r.wheelSuspVel[i] += a * dt
      r.wheelSusp[i] += r.wheelSuspVel[i] * dt

      // Clamp travel and apply small restitution at the bump stops.
      if (r.wheelSusp[i] > SUSP_TRAVEL) {
        r.wheelSusp[i] = SUSP_TRAVEL
        if (r.wheelSuspVel[i] > 0) r.wheelSuspVel[i] = -r.wheelSuspVel[i] * SUSP_RESTITUTION
      } else if (r.wheelSusp[i] < -SUSP_TRAVEL) {
        r.wheelSusp[i] = -SUSP_TRAVEL
        if (r.wheelSuspVel[i] < 0) r.wheelSuspVel[i] = -r.wheelSuspVel[i] * SUSP_RESTITUTION
      }

      // Contact: the spring is not fully extended (wheel still touches
      // ground). A small epsilon avoids flicker at the limit.
      r.wheelContact[i] = r.wheelSusp[i] > -SUSP_TRAVEL + 0.005
      if (r.wheelContact[i]) groundedCount++

      avgGroundH += gh
    }
    avgGroundH /= 6
    r.airborne = groundedCount < 2

    // ── Body Y: grounded → average ground + wheel radius ──
    if (!r.airborne) {
      const targetY = avgGroundH + WHEEL_R
      r.pos.y += (targetY - r.pos.y) * 10.0 * dt
    } else {
      r.pos.y -= G_MOON * dt
      r.vel.y -= G_MOON * dt
    }

    // ── Body pitch/roll from wheel heights ──
    const frontH = (heights[0] + heights[1]) / 2
    const rearH = (heights[4] + heights[5]) / 2
    const leftH = (heights[0] + heights[2] + heights[4]) / 3
    const rightH = (heights[1] + heights[3] + heights[5]) / 3
    const targetPitch = (rearH - frontH) / WHEELBASE * 0.5
    const targetRoll = (rightH - leftH) / TRACK_WIDTH * 0.5
    r.pitch += (targetPitch - r.pitch) * 5.0 * dt
    r.roll += (targetRoll - r.roll) * 5.0 * dt

    // ── Driving forces ──
    const fwd = new THREE.Vector3(Math.sin(r.heading), 0, Math.cos(r.heading))
    const right = new THREE.Vector3(Math.cos(r.heading), 0, -Math.sin(r.heading))
    const fwdSpeed = r.vel.dot(fwd)

    let driveForce = 0
    if (throttle > 0) driveForce = ENGINE_FORCE * throttle
    else if (throttle < 0) {
      if (fwdSpeed > 0.1) driveForce = -BRAKE_FORCE
      else driveForce = ENGINE_FORCE * throttle * 0.5
    }

    // rolling resistance (opposes motion, higher for faster stop)
    let resistForce = 0
    if (Math.abs(fwdSpeed) > 0.01) resistForce = -Math.sign(fwdSpeed) * ROLL_RESIST

    // brake (Space)
    if (keys.brake && !r.airborne) {
      if (Math.abs(fwdSpeed) > 0.01) {
        const brakeDecel = BRAKE_FORCE / ROVER_MASS
        r.vel.addScaledVector(fwd, -Math.sign(fwdSpeed) * brakeDecel * dt)
        const newFwd = r.vel.dot(fwd)
        if (Math.sign(newFwd) !== Math.sign(fwdSpeed) && Math.abs(fwdSpeed) < 0.3) {
          r.vel.addScaledVector(fwd, -newFwd)
        }
      }
    }

    // boost
    if (keys.boostUp) r.pos.y += 0.03 * dt
    if (keys.boostFwd) driveForce += ENGINE_FORCE * 0.5

    // apply forward force (only when grounded)
    if (!r.airborne) {
      const accel = (driveForce + resistForce) / ROVER_MASS
      r.vel.addScaledVector(fwd, accel * dt)
    }

    // ── Lateral grip (anti-slide) ──
    if (!r.airborne && groundedCount >= 4) {
      const lateralVel = r.vel.dot(right)
      const lateralForce = -lateralVel * LATERAL_GRIP / ROVER_MASS
      r.vel.addScaledVector(right, lateralForce * dt)
    }

    // clamp max speed
    const newFwdSpeed = r.vel.dot(fwd)
    if (Math.abs(newFwdSpeed) > MAX_SPEED) {
      r.vel.addScaledVector(fwd, -(newFwdSpeed - Math.sign(newFwdSpeed) * MAX_SPEED))
    }

    // ── Steering: Ackermann ──
    if (!r.airborne && Math.abs(fwdSpeed) > 0.05) {
      const turnRadius = WHEELBASE / Math.tan(Math.max(0.01, Math.abs(r.steerAngle)))
      const turnRate = fwdSpeed / turnRadius
      r.angularVel = turnRate * Math.sign(r.steerAngle)
      r.heading += r.angularVel * dt
    } else {
      r.angularVel *= 0.9
      r.heading += r.angularVel * dt
    }

    // ── Integrate position ──
    r.pos.x += r.vel.x * dt
    r.pos.z += r.vel.z * dt

    // ── Rock collisions (lightweight XZ circle-vs-circle) ───────────────
    // Rocks are at fixed world coordinates (wx, wz). We treat both bodies as
    // circles in the XZ plane: rover ≈ 1.2 m radius, rock ≈ s * 0.9 (slightly
    // inside the dodecahedron's outer vertices, so contact feels right). On
    // overlap we push the rover back along the contact normal and kill the
    // inward velocity component. No friction, no impulses on rocks (rocks
    // are static). This is O(80) per frame.
    {
      const ROVER_RADIUS = 1.2
      for (let i = 0; i < ROCKS.length; i++) {
        const rk = ROCKS[i]
        const rockRadius = rk.s * 0.9
        const dx = r.pos.x - rk.wx
        const dz = r.pos.z - rk.wz
        const minD = ROVER_RADIUS + rockRadius
        const d2 = dx * dx + dz * dz
        if (d2 < minD * minD && d2 > 1e-6) {
          const d = Math.sqrt(d2)
          const nx = dx / d
          const nz = dz / d
          // Positional correction: push rover just outside the rock.
          const push = minD - d
          r.pos.x += nx * push
          r.pos.z += nz * push
          // Remove inward velocity along the contact normal (no bounce,
          // keeps the rover from tunneling through clusters of rocks).
          const vDotN = r.vel.x * nx + r.vel.z * nz
          if (vDotN < 0) {
            r.vel.x -= vDotN * nx
            r.vel.z -= vDotN * nz
          }
        }
      }
    }

    // ── Wheel rotation from ACTUAL velocity ──
    const actualFwdSpeed = r.vel.dot(fwd)
    const wheelRot = (actualFwdSpeed * dt) / WHEEL_R
    for (let i = 0; i < 6; i++) r.wheelSpin[i] += wheelRot

    // ── Dust from wheels when moving on ground ──
    if (Math.abs(actualFwdSpeed) > 0.2 && !r.airborne && dustRef.current.length < 60) {
      const num = Math.min(8, Math.floor(Math.abs(actualFwdSpeed) * 3))
      for (let i = 0; i < num; i++) {
        const wi = Math.floor(Math.random() * 6)
        const [lx, lz] = WHEEL_OFFSETS[wi]
        const wx = r.pos.x + lx * cos - lz * sin - fwd.x * 0.2
        const wz = r.pos.z + lx * sin + lz * cos - fwd.z * 0.2
        dustRef.current.push({
          pos: new THREE.Vector3(wx + (Math.random() - 0.5) * 0.3, terrainHeight(wx, wz) + 0.05, wz + (Math.random() - 0.5) * 0.3),
          vel: new THREE.Vector3(-fwd.x * 0.02 + (Math.random() - 0.5) * 0.01, 0.01 + Math.random() * 0.01, -fwd.z * 0.02 + (Math.random() - 0.5) * 0.01),
          life: 1, size: 0.08 + Math.random() * 0.06,
        })
      }
    }
    for (const p of dustRef.current) { p.pos.add(p.vel); p.vel.y -= 0.001; p.life -= 0.012 }
    dustRef.current = dustRef.current.filter((p) => p.life > 0)

    // ── Wheel tracks ──
    trackTimer.current += delta
    if (Math.abs(actualFwdSpeed) > 0.15 && trackTimer.current > 0.15 && !r.airborne) {
      trackTimer.current = 0
      for (let i = 0; i < 6; i++) {
        const [lx, lz] = WHEEL_OFFSETS[i]
        const wx = r.pos.x + lx * cos - lz * sin, wz = r.pos.z + lx * sin + lz * cos
        tracksRef.current.push({ pos: new THREE.Vector3(wx, terrainHeight(wx, wz) + 0.02, wz), rot: r.heading, life: 1 })
      }
    }
    for (const t of tracksRef.current) t.life -= 0.003
    tracksRef.current = tracksRef.current.filter((t) => t.life > 0)

    // ── Update shared ref + HUD ──
    roverPosRef.current.copy(r.pos)
    r.speedDisplay = Math.abs(actualFwdSpeed) * 3.6
    r.specialCd = Math.max(0, 1 - (performance.now() - lastSpecial) / SPECIAL_COOLDOWN)
    r.battery = Math.max(0, r.battery - Math.abs(actualFwdSpeed) * 0.002 * dt)
  })
  return null
}

// ── Camera controller — 3 modes ────────────────────────────────────────────
function CameraController({ orbitRef, cameraModeRef }: {
  orbitRef: React.MutableRefObject<{ dist: number; angle: number; height: number }>
  cameraModeRef: React.MutableRefObject<number>
}) {
  const { camera } = useThree()
  const curPos = useRef(new THREE.Vector3(0, 5, 8))
  const smoothAngle = useRef(0)
  useFrame((_, delta) => {
    const dt = delta || 0.016
    const mode = cameraModeRef.current
    const o = orbitRef.current

    if (mode === 0) {
      // chase camera
      const targetAngle = V.heading + Math.PI + o.angle
      let da = targetAngle - smoothAngle.current
      while (da > Math.PI) da -= Math.PI * 2
      while (da < -Math.PI) da += Math.PI * 2
      smoothAngle.current += da * Math.min(1, 3.0 * dt)
      const a = smoothAngle.current
      const desired = new THREE.Vector3(
        V.pos.x + Math.sin(a) * o.dist,
        V.pos.y + o.height,
        V.pos.z + Math.cos(a) * o.dist,
      )
      const gh = terrainHeight(desired.x, desired.z)
      if (desired.y < gh + 0.5) desired.y = gh + 0.5
      curPos.current.lerp(desired, 0.08)
      camera.position.copy(curPos.current)
      camera.lookAt(V.pos.x, V.pos.y + 0.3, V.pos.z)
    } else if (mode === 1) {
      // 360° orbit
      const a = o.angle
      const desired = new THREE.Vector3(
        V.pos.x + Math.sin(a) * o.dist,
        V.pos.y + o.height,
        V.pos.z + Math.cos(a) * o.dist,
      )
      const gh = terrainHeight(desired.x, desired.z)
      if (desired.y < gh + 0.5) desired.y = gh + 0.5
      curPos.current.lerp(desired, 0.1)
      camera.position.copy(curPos.current)
      camera.lookAt(V.pos.x, V.pos.y + 0.2, V.pos.z)
    } else {
      // first-person
      const fwd = new THREE.Vector3(Math.sin(V.heading), 0, Math.cos(V.heading))
      const desired = new THREE.Vector3(
        V.pos.x - fwd.x * 0.8,
        V.pos.y + 0.5,
        V.pos.z - fwd.z * 0.8,
      )
      curPos.current.lerp(desired, 0.15)
      camera.position.copy(curPos.current)
      camera.lookAt(V.pos.x + fwd.x * 5, V.pos.y + 0.3, V.pos.z + fwd.z * 5)
    }
  })
  return null
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function PlayPage() {
  const [specialCd, setSpecialCd] = useState(0)
  const [speed, setSpeed] = useState(0)
  const [battery, setBattery] = useState(82)
  const [isMobile, setIsMobile] = useState(false)
  const [camMode, setCamMode] = useState(0)
  const dustRef = useRef<DustP[]>([])
  const tracksRef = useRef<{ pos: THREE.Vector3; rot: number; life: number }[]>([])
  const roverPosRef = useRef(new THREE.Vector3(0, 0, 0))
  const orbitRef = useRef({ dist: 7, angle: 0, height: 3.5 })
  const dragRef = useRef({ active: false, lastX: 0, lastY: 0 })
  const cameraModeRef = useRef(0)

  function resetRover() {
    V.pos.set(0, terrainHeight(0, 0) + WHEEL_R, 0)
    V.vel.set(0, 0, 0)
    V.heading = 0; V.pitch = 0; V.roll = 0; V.steerAngle = 0; V.angularVel = 0
    for (let i = 0; i < 6; i++) { V.wheelSpin[i] = 0; V.wheelSusp[i] = 0; V.wheelSuspVel[i] = 0 }
  }

  useEffect(() => { setIsMobile('ontouchstart' in window || navigator.maxTouchPoints > 0) }, [])

  useEffect(() => {
    const map: Record<string, string> = {
      ArrowUp: 'forward', w: 'forward', W: 'forward',
      ArrowDown: 'back', s: 'back', S: 'back',
      ArrowLeft: 'left', a: 'left', A: 'left',
      ArrowRight: 'right', d: 'right', D: 'right',
      ' ': 'brake', q: 'boostUp', Q: 'boostUp',
      Shift: 'boostFwd', e: 'boostFwd', E: 'boostFwd',
    }
    const dn = (e: KeyboardEvent) => {
      const k = map[e.key]
      if (k) { keys[k] = true; e.preventDefault() }
      if (e.key === 'Enter') triggerSpecial()
      if (e.key === 'c' || e.key === 'C') { cameraModeRef.current = (cameraModeRef.current + 1) % 3; setCamMode(cameraModeRef.current) }
      if (e.key === 'r' || e.key === 'R') resetRover()
    }
    const up = (e: KeyboardEvent) => { const k = map[e.key]; if (k) keys[k] = false }
    window.addEventListener('keydown', dn); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up) }
  }, [])

  useEffect(() => {
    const id = setInterval(() => { setSpecialCd(V.specialCd); setSpeed(V.speedDisplay); setBattery(Math.round(V.battery)) }, 100)
    return () => clearInterval(id)
  }, [])

  function triggerSpecial() {
    const now = performance.now()
    if (now - lastSpecial < SPECIAL_COOLDOWN) return
    lastSpecial = now
    V.pos.y += 1.2; V.vel.y = 2.0
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, sp = Math.random() * 0.04
      dustRef.current.push({ pos: new THREE.Vector3(V.pos.x + (Math.random() - 0.5) * 0.5, V.pos.y, V.pos.z + (Math.random() - 0.5) * 0.5), vel: new THREE.Vector3(Math.cos(a) * sp, 0.03 + Math.random() * 0.02, Math.sin(a) * sp), life: 1, size: 0.1 + Math.random() * 0.06 })
    }
  }

  const press = (k: string, v: boolean) => { keys[k] = v }
  const onPointerDown = (e: React.PointerEvent) => { if (!isMobile) dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY } }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active || isMobile) return
    const dx = e.clientX - dragRef.current.lastX, dy = e.clientY - dragRef.current.lastY
    orbitRef.current.angle -= dx * 0.01
    orbitRef.current.height = Math.max(2, Math.min(6, orbitRef.current.height - dy * 0.02))
    dragRef.current.lastX = e.clientX; dragRef.current.lastY = e.clientY
  }
  const onPointerUp = () => { dragRef.current.active = false }
  const onWheel = (e: React.WheelEvent) => { orbitRef.current.dist = Math.max(4, Math.min(12, orbitRef.current.dist + e.deltaY * 0.01)) }

  const camLabels = ['CHASE', '360° ORBIT', 'FIRST-PERSON']

  return (
    <main onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} onWheel={onWheel} style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden', touchAction: 'none' }}>
      <Canvas camera={{ position: [0, 5, 8], fov: 55, near: 0.1, far: 2000 }} dpr={[1, 1.5]} shadows>
        <color attach="background" args={['#000']} />
        <fog attach="fog" args={['#000', 200, 600]} />
        <Stars radius={800} depth={200} count={4000} factor={5} saturation={0} fade speed={0.3} />
        <ambientLight intensity={0.2} />
        <directionalLight position={[50, 80, 30]} intensity={2.0} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-far={200} shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={40} shadow-camera-bottom={-40} shadow-bias={-0.001} />
        <MoonTerrain roverPosRef={roverPosRef} />
        <Rocks />
        <EarthSphere roverPosRef={roverPosRef} />
        <MissionMarkers />
        <RoverModel />
        <VehiclePhysics dustRef={dustRef} tracksRef={tracksRef} roverPosRef={roverPosRef} />
        <DustSystem dustRef={dustRef} />
        <WheelTracks tracksRef={tracksRef} />
        <CameraController orbitRef={orbitRef} cameraModeRef={cameraModeRef} />
      </Canvas>

      {/* HUD */}
      <div style={{ position: 'absolute', top: 14, left: 16, color: '#9fb3d0', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: 1.5, textShadow: '0 0 6px rgba(0,0,0,0.8)', zIndex: 10, pointerEvents: 'none' }}>
        <div style={{ opacity: 0.6, fontSize: 9, letterSpacing: 2 }}>LUNAR ROVER</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#eaf0ff', margin: '2px 0 6px' }}>MISSION 01</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#c8a838' }}>{speed.toFixed(1)}</span>
          <span style={{ fontSize: 9, opacity: 0.6 }}>km/h</span>
        </div>
      </div>
      <div style={{ position: 'absolute', top: 14, right: 16, color: '#9fb3d0', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: 1.5, textShadow: '0 0 6px rgba(0,0,0,0.8)', zIndex: 10, textAlign: 'right', pointerEvents: 'none' }}>
        <div style={{ opacity: 0.6, fontSize: 9, letterSpacing: 2 }}>BATTERY</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#eaf0ff', margin: '2px 0 4px' }}>{battery}%</div>
        <div style={{ width: 80, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.1)', overflow: 'hidden', marginLeft: 'auto' }}>
          <div style={{ width: `${battery}%`, height: '100%', background: battery > 30 ? '#c8a838' : '#e74c3c', borderRadius: 3 }} />
        </div>
        <div style={{ marginTop: 6, fontSize: 9, color: '#37c6ff', letterSpacing: 1.5 }}>CAM: {camLabels[camMode]}</div>
      </div>
      <a href="/" style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', color: '#9fb3d0', textDecoration: 'none', padding: '4px 10px', border: '1px solid rgba(159,179,208,0.3)', borderRadius: 999, fontSize: 10, letterSpacing: 1.5, fontFamily: "'JetBrains Mono', monospace", opacity: 0.7, zIndex: 10 }}>← LANDING</a>

      {!isMobile && (
        <div style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: 170, zIndex: 10 }}>
          <CtrlBtn label="▲ FWD" sub="W" onDown={() => press('forward', true)} onUp={() => press('forward', false)} accent="#9fb3d0" />
          <CtrlBtn label="BACK ▼" sub="S" onDown={() => press('back', true)} onUp={() => press('back', false)} accent="#9fb3d0" />
          <CtrlBtn label="◀ LEFT" sub="A" onDown={() => press('left', true)} onUp={() => press('left', false)} accent="#9fb3d0" />
          <CtrlBtn label="RIGHT ▶" sub="D" onDown={() => press('right', true)} onUp={() => press('right', false)} accent="#9fb3d0" />
          <CtrlBtn label="BRAKE" sub="SPACE" onDown={() => press('brake', true)} onUp={() => press('brake', false)} accent="#e74c3c" hold />
          <CtrlBtn label="BOOST" sub="E" onDown={() => press('boostFwd', true)} onUp={() => press('boostFwd', false)} accent="#c8a838" hold />
          <div style={{ gridColumn: '1 / span 2' }}>
            <CtrlBtn label="SPECIAL" sub="ENTER" onClick={triggerSpecial} accent="#c8a838" cooldown={specialCd} full />
          </div>
        </div>
      )}

      {isMobile && (
        <>
          <div onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const r = e.currentTarget.getBoundingClientRect(); mobileInput.x = ((e.clientX - r.left - r.width / 2) / (r.width / 2)); mobileInput.y = ((e.clientY - r.top - r.height / 2) / (r.height / 2)); }}
            onPointerMove={(e) => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; const r = e.currentTarget.getBoundingClientRect(); mobileInput.x = Math.max(-1, Math.min(1, (e.clientX - r.left - r.width / 2) / (r.width / 2))); mobileInput.y = Math.max(-1, Math.min(1, (e.clientY - r.top - r.height / 2) / (r.height / 2))); }}
            onPointerUp={() => { mobileInput.x = 0; mobileInput.y = 0; }}
            style={{ position: 'absolute', bottom: 24, left: 24, width: 120, height: 120, borderRadius: '50%', background: 'rgba(10,12,24,0.5)', border: '1px solid rgba(159,179,208,0.25)', backdropFilter: 'blur(8px)', touchAction: 'none', zIndex: 10, display: 'flex', placeItems: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(159,179,208,0.3)', border: '1px solid rgba(159,179,208,0.4)' }} />
          </div>
          <div style={{ position: 'absolute', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 10, zIndex: 10 }}>
            <CtrlBtn label="BRAKE" sub="STOP" onDown={() => press('brake', true)} onUp={() => press('brake', false)} accent="#e74c3c" hold />
            <CtrlBtn label="BOOST" sub="⤴" onDown={() => press('boostFwd', true)} onUp={() => press('boostFwd', false)} accent="#c8a838" hold />
            <CtrlBtn label="SPECIAL" sub="BOOM" onClick={triggerSpecial} accent="#c8a838" cooldown={specialCd} />
          </div>
        </>
      )}

      <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', color: '#5d6b86', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 1.5, textAlign: 'center', zIndex: 10, pointerEvents: 'none' }}>
        {isMobile ? 'JOYSTICK TO DRIVE · TAP BRAKE/BOOST/SPECIAL' : 'W·A·S·D drive · SPACE brake · E boost · C camera · R reset · ENTER special · DRAG orbit · SCROLL zoom'}
      </div>
    </main>
  )
}

function CtrlBtn({ label, sub, onDown, onUp, onClick, accent, hold, cooldown = 0, full = false }: {
  label: string; sub: string; onDown?: () => void; onUp?: () => void; onClick?: () => void
  accent: string; hold?: boolean; cooldown?: number; full?: boolean
}) {
  const [pressed, setPressed] = useState(false)
  const fire = (v: boolean) => { setPressed(v); if (v) onDown?.(); else onUp?.(); if (v && onClick) onClick() }
  const cd = Math.max(0, Math.min(1, cooldown)); const active = pressed
  return (
    <button onPointerDown={(e) => { e.preventDefault(); fire(true) }} onPointerUp={(e) => { e.preventDefault(); if (hold) fire(false) }} onPointerLeave={() => { if (pressed && hold) fire(false) }} onPointerCancel={() => { if (pressed && hold) fire(false) }}
      style={{ position: 'relative', width: full ? '100%' : undefined, padding: '11px 8px 9px', borderRadius: 12, minWidth: 72, border: `1.5px solid ${active ? accent : 'rgba(255,255,255,0.16)'}`, background: active ? `radial-gradient(circle at 50% 30%, ${accent}33, rgba(10,12,20,0.85))` : 'rgba(10,12,20,0.62)', color: active ? '#fff' : accent, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 11, letterSpacing: 1, textAlign: 'center', cursor: cd > 0.02 ? 'not-allowed' : 'pointer', opacity: cd > 0.02 ? 0.85 : 1, backdropFilter: 'blur(6px)', boxShadow: active ? `0 0 18px ${accent}44, inset 0 0 12px ${accent}22` : '0 2px 8px rgba(0,0,0,0.4)', transition: 'transform 0.06s ease, box-shadow 0.12s ease, border-color 0.12s ease', transform: pressed ? 'scale(0.94)' : 'scale(1)', touchAction: 'none', overflow: 'hidden' }}>
      <div style={{ lineHeight: 1.1 }}>{label}</div>
      <div style={{ fontSize: 8, opacity: 0.62, letterSpacing: 1.2, marginTop: 2 }}>{sub}</div>
      {cd > 0.02 && (<div style={{ position: 'absolute', inset: 0, borderRadius: 12, background: `conic-gradient(rgba(200,168,56,0.45) ${cd * 360}deg, rgba(0,0,0,0.55) 0deg)`, pointerEvents: 'none' }} />)}
      {cd > 0.02 && (<div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#dab840', fontSize: 8, letterSpacing: 1.5, fontWeight: 700, textShadow: '0 0 4px rgba(0,0,0,0.8)', pointerEvents: 'none' }}>RECHARGING</div>)}
    </button>
  )
}
