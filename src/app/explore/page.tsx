'use client'

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { PLANETS, SITES, type Site } from '@/data/sites'

/* ========================================================================== *
 * The Cosmic Playback — Explore (3D Solar System) — /explore
 * --------------------------------------------------------------------------
 * Immersive 3D solar system: Sun + 8 planets on continuous orbits, the Moon
 * orbiting Earth, a starfield. Drag to rotate, scroll/pinch to zoom.
 * Top-corner nav: Overview · Moon · Mars. Click a planet to fly to it.
 * Moon & Mars carry real mission markers at their actual landing sites;
 * clicking a marker opens a storytelling popup. Focused Exploration Mode:
 * when zoomed in, the focused body stops auto-rotating and the user can
 * drag-rotate it manually (orientation persists). A Mission List Card beside
 * the focused body synchronizes hover/click with the 3D markers.
 * ========================================================================== */

type View = 'overview' | 'earth' | 'moon' | 'mars'

// Focused Exploration shared state
type FocusState = { approach: number; yaw: number; pitch: number; body: string; zoom: number }
function makeFocus(): FocusState { return { approach: 1, yaw: 0, pitch: 0, body: '', zoom: 1 } }

function latLonToVec3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = lon * (Math.PI / 180)
  return new THREE.Vector3(radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta))
}

// ── procedural body textures ─────────────────────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
function makeBodyTexture(id: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const W = 1024, H = 512
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d')!
  const rand = mulberry32(id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0) * 9973)
  const fill = (col: string) => { ctx.fillStyle = col; ctx.fillRect(0, 0, W, H) }
  const blob = (lat: number, lon: number, rw: number, rh: number, col: string, alpha = 1) => {
    const x = ((lon + 180) / 360) * W, y = ((90 - lat) / 180) * H
    ctx.globalAlpha = alpha; ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, rw, rh, rand() * Math.PI, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1
  }
  const crater = (lat: number, lon: number, r: number) => {
    const x = ((lon + 180) / 360) * W, y = ((90 - lat) / 180) * H
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r)
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.7, 'rgba(0,0,0,0.18)'); g.addColorStop(0.9, 'rgba(255,255,255,0.14)'); g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
  }
  switch (id) {
    case 'moon': {
      fill('#9a958c')
      const maria = [[5, -25, 90, 60], [10, 5, 70, 50], [-5, 40, 80, 55], [15, -60, 60, 40], [-10, -10, 50, 35]]
      for (const [la, lo, rw, rh] of maria) blob(la, lo, rw, rh, '#5a5750', 0.55)
      for (let i = 0; i < 60; i++) crater(rand() * 180 - 90, rand() * 360 - 180, 6 + rand() * 16)
      for (let i = 0; i < 220; i++) crater(rand() * 180 - 90, rand() * 360 - 180, 2 + rand() * 5)
      break
    }
    case 'earth': {
      fill('#16558a')
      const lands = [[20, -100, 110, 70], [10, -60, 60, 70], [50, 20, 90, 50], [30, 90, 80, 55], [-10, 20, 70, 60], [25, 25, 50, 40], [-25, 135, 60, 35], [-80, 0, 220, 40]]
      for (const [la, lo, rw, rh] of lands) { blob(la, lo, rw, rh, '#3f7d3a', 0.95); blob(la + 5, lo + 8, rw * 0.7, rh * 0.6, '#8a7050', 0.4) }
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(0, 0, W, H * 0.06); ctx.fillRect(0, H * 0.94, W, H * 0.06)
      for (let i = 0; i < 40; i++) blob(rand() * 160 - 80, rand() * 360 - 180, 40 + rand() * 60, 12 + rand() * 10, '#ffffff', 0.3)
      break
    }
    case 'mars': {
      fill('#b5512c')
      for (let i = 0; i < 14; i++) blob(rand() * 160 - 80, rand() * 360 - 180, 50 + rand() * 80, 30 + rand() * 40, '#7a3a22', 0.4)
      for (let i = 0; i < 20; i++) blob(rand() * 160 - 80, rand() * 360 - 180, 40 + rand() * 60, 20 + rand() * 30, '#d98a5a', 0.35)
      for (let i = 0; i < 80; i++) crater(rand() * 180 - 90, rand() * 360 - 180, 4 + rand() * 12)
      ctx.fillStyle = 'rgba(255,250,245,0.9)'; ctx.fillRect(0, 0, W, H * 0.05); ctx.fillRect(0, H * 0.95, W, H * 0.05)
      break
    }
    case 'mercury': { fill('#8a847a'); for (let i = 0; i < 100; i++) crater(rand() * 180 - 90, rand() * 360 - 180, 5 + rand() * 18); for (let i = 0; i < 300; i++) crater(rand() * 180 - 90, rand() * 360 - 180, 2 + rand() * 5); break }
    case 'venus': { fill('#d9b382'); for (let i = 0; i < 30; i++) blob(rand() * 160 - 80, rand() * 360 - 180, 80 + rand() * 120, 20 + rand() * 30, '#c79a5a', 0.4); break }
    case 'jupiter': {
      const bands = ['#c9a07a', '#a87a4a', '#d8b88a', '#9c6a3a', '#e0c89a', '#b88858', '#c9a07a']; const bh = H / bands.length
      for (let i = 0; i < bands.length; i++) { ctx.fillStyle = bands[i]; ctx.fillRect(0, i * bh, W, bh + 1) }
      for (let i = 0; i < 120; i++) { ctx.fillStyle = `rgba(${rand() > 0.5 ? 255 : 80},${rand() * 80 + 60},40,0.18)`; ctx.fillRect(0, rand() * H, W, 2 + rand() * 6) }
      blob(-22, -90, 70, 40, '#a8523a', 0.85); break
    }
    case 'saturn': { const bands = ['#e0c896', '#d4ba84', '#ecdcb0', '#cbb878', '#e8d09a', '#d8c08a']; const bh = H / bands.length; for (let i = 0; i < bands.length; i++) { ctx.fillStyle = bands[i]; ctx.fillRect(0, i * bh, W, bh + 1) } break }
    case 'uranus': { fill('#9fd8e0'); for (let i = 0; i < 30; i++) blob(rand() * 160 - 80, rand() * 360 - 180, 120, 10 + rand() * 14, '#bde8ee', 0.18); break }
    case 'neptune': { fill('#3f5fd0'); for (let i = 0; i < 30; i++) blob(rand() * 160 - 80, rand() * 360 - 180, 120, 8 + rand() * 12, '#5a78e0', 0.25); blob(-20, -50, 50, 30, '#2a3fa0', 0.6); break }
    case 'sun': { fill('#ffb04a'); for (let i = 0; i < 600; i++) { const x = rand() * W, y = rand() * H, r = 4 + rand() * 14; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(255,240,180,0.9)'); g.addColorStop(1, 'rgba(255,160,60,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill() } for (let i = 0; i < 8; i++) blob(rand() * 160 - 80, rand() * 360 - 180, 16 + rand() * 20, 10 + rand() * 14, '#9a4a1a', 0.6); break }
    default: fill('#888')
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; return tex
}
const TEX_CACHE: Record<string, THREE.CanvasTexture | null> = {}
function bodyTexture(id: string): THREE.CanvasTexture | null { if (!(id in TEX_CACHE)) TEX_CACHE[id] = makeBodyTexture(id); return TEX_CACHE[id] }

// ── Planet ────────────────────────────────────────────────────────────────
function Planet({ planet, t, onClick, selected, positionsRef, onClickMarker, selectedSite, focusRef, focusedId }: {
  planet: (typeof PLANETS)[number]; t: React.MutableRefObject<number>
  onClick: (id: string, worldPos: THREE.Vector3) => void; selected: boolean
  positionsRef: React.MutableRefObject<Record<string, THREE.Vector3>>
  onClickMarker?: (site: Site, worldPos: THREE.Vector3) => void; selectedSite?: string | null
  focusRef: React.MutableRefObject<FocusState>; focusedId: string
}) {
  const ref = useRef<THREE.Group>(null)
  const orbitAngle = useRef(Math.random() * Math.PI * 2)
  const [hovered, setHovered] = useState(false)
  const tex = useMemo(() => bodyTexture(planet.id), [planet.id])
  useFrame((_, delta) => {
    if (!ref.current) return
    // Focused Exploration: when focused, BOTH orbital motion and self-spin slow
    // to zero. Earth also freezes when the Moon is focused (the Moon orbits it).
    const isFocused = planet.id === 'earth' ? (focusedId === 'earth' || focusedId === 'moon') : planet.id === focusedId
    const factor = isFocused ? focusRef.current.approach : 1
    orbitAngle.current += planet.speed * delta * factor
    const a = orbitAngle.current
    ref.current.position.set(Math.cos(a) * planet.orbit, 0, Math.sin(a) * planet.orbit)
    ref.current.rotation.y += planet.rotSpeed * 0.01 * factor
    if (isFocused && focusRef.current.body === planet.id) {
      ref.current.rotation.y += focusRef.current.yaw
      ref.current.rotation.x = Math.max(-1.2, Math.min(1.2, ref.current.rotation.x + focusRef.current.pitch))
      focusRef.current.yaw = 0; focusRef.current.pitch = 0
    }
    if (positionsRef.current) positionsRef.current[planet.id] = ref.current.position.clone()
  })
  return (
    <group ref={ref}>
      <mesh onClick={(e) => { e.stopPropagation(); onClick(planet.id, ref.current!.position.clone()) }}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = 'default' }}>
        <sphereGeometry args={[planet.size, 48, 48]} />
        <meshStandardMaterial map={tex ?? undefined} color={tex ? '#ffffff' : planet.color} emissive={selected ? planet.color : '#000000'} emissiveIntensity={selected ? 0.3 : 0} roughness={0.9} metalness={0.05} />
      </mesh>
      {planet.id === 'earth' && (<mesh><sphereGeometry args={[planet.size * 1.04, 32, 32]} /><meshBasicMaterial color="#6fb4ff" transparent opacity={0.12} depthWrite={false} side={THREE.BackSide} /></mesh>)}
      {planet.rings && (<mesh rotation={[Math.PI / 2.2, 0, 0]}><ringGeometry args={[planet.size * planet.rings.inner, planet.size * planet.rings.outer, 64]} /><meshBasicMaterial color={planet.rings.color} side={THREE.DoubleSide} transparent opacity={0.55} /></mesh>)}
      {/* The Moon is rendered at the Scene level (not as a child of Earth) so
          Earth's self-rotation doesn't drag the Moon's orientation. Do NOT add
          a second Moon here — it would create a duplicate. */}
      {(hovered || selected) && (<mesh><sphereGeometry args={[planet.size * 1.35, 16, 16]} /><meshBasicMaterial color={planet.color} transparent opacity={0.08} depthWrite={false} /></mesh>)}
    </group>
  )
}

// ── Moon (orbits Earth's world position; carries lunar markers) ───────────
function MoonWithMarkers({ t, positionsRef, onClickMarker, selectedSite, focusRef, focusedId }: {
  t: React.MutableRefObject<number>; positionsRef: React.MutableRefObject<Record<string, THREE.Vector3>>
  onClickMarker: (site: Site, worldPos: THREE.Vector3) => void; selectedSite: string | null
  focusRef: React.MutableRefObject<FocusState>; focusedId: string
}) {
  const MOON_SIZE = 0.34, ORBIT_R = 2.0, ORBIT_SPEED = 0.10
  const ref = useRef<THREE.Group>(null)
  const orbitAngle = useRef(Math.random() * Math.PI * 2)
  const tex = useMemo(() => bodyTexture('moon'), [])
  const sites = SITES.filter((s) => s.body === 'moon')
  const worldPos = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, delta) => {
    if (!ref.current) return
    const earth = positionsRef.current.earth ?? new THREE.Vector3(14, 0, 0)
    const isFocused = focusedId === 'moon'
    const factor = isFocused ? focusRef.current.approach : 1
    orbitAngle.current += ORBIT_SPEED * delta * factor
    const a = orbitAngle.current
    ref.current.position.set(earth.x + Math.cos(a) * ORBIT_R, earth.y + Math.sin(a) * ORBIT_R * 0.25, earth.z + Math.sin(a) * ORBIT_R)
    ref.current.rotation.y += 0.006 * factor
    if (isFocused && focusRef.current.body === 'moon') {
      ref.current.rotation.y += focusRef.current.yaw
      ref.current.rotation.x = Math.max(-1.2, Math.min(1.2, ref.current.rotation.x + focusRef.current.pitch))
      focusRef.current.yaw = 0; focusRef.current.pitch = 0
    }
    ref.current.getWorldPosition(worldPos); if (positionsRef.current) positionsRef.current.moon = worldPos.clone()
  })
  return (
    <group ref={ref}>
      <mesh><sphereGeometry args={[MOON_SIZE, 48, 48]} /><meshStandardMaterial map={tex ?? undefined} color={tex ? '#ffffff' : '#c8c8c0'} roughness={1} /></mesh>
      {sites.map((s) => (<MissionMarker key={s.id} site={s} hostSize={MOON_SIZE} planetWorldRef={ref} selected={selectedSite === s.id} hovered={false} onClick={onClickMarker} onHover={() => {}} />))}
    </group>
  )
}

// ── Sun ──────────────────────────────────────────────────────────────────
function Sun({ t }: { t: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.Mesh>(null)
  const tex = useMemo(() => bodyTexture('sun'), [])
  useFrame(() => { if (ref.current) ref.current.rotation.y += 0.0015 })
  return (
    <group>
      <mesh ref={ref}><sphereGeometry args={[2.6, 64, 64]} /><meshBasicMaterial map={tex ?? undefined} color={tex ? '#fff4d0' : '#ffd27a'} toneMapped={false} /></mesh>
      <mesh><sphereGeometry args={[2.95, 32, 32]} /><meshBasicMaterial color="#ffce6a" transparent opacity={0.35} depthWrite={false} toneMapped={false} /></mesh>
      <mesh><sphereGeometry args={[3.8, 32, 32]} /><meshBasicMaterial color="#ffa84a" transparent opacity={0.18} depthWrite={false} toneMapped={false} /></mesh>
      <mesh><sphereGeometry args={[5.6, 32, 32]} /><meshBasicMaterial color="#ff7a2b" transparent opacity={0.09} depthWrite={false} toneMapped={false} /></mesh>
      <pointLight position={[0, 0, 0]} intensity={2.6} distance={140} decay={0.55} color="#fff2d8" />
    </group>
  )
}

// ── orbit ring ────────────────────────────────────────────────────────────
function Orbit({ radius }: { radius: number }) {
  const geom = useMemo(() => { const pts: THREE.Vector3[] = []; for (let i = 0; i <= 128; i++) { const a = (i / 128) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius)) } return new THREE.BufferGeometry().setFromPoints(pts) }, [radius])
  return (<line geometry={geom}><lineBasicMaterial color="#3a4a6a" transparent opacity={0.4} /></line>)
}

// ── Mission marker (small precise pin) ────────────────────────────────────
function MissionMarker({ site, hostSize, planetWorldRef, selected, hovered, onClick, onHover }: {
  site: Site; hostSize: number; planetWorldRef: React.RefObject<THREE.Group | null>
  selected: boolean; hovered: boolean
  onClick: (site: Site, worldPos: THREE.Vector3) => void; onHover: (site: Site | null) => void
}) {
  const localOffset = useMemo(() => latLonToVec3(site.lat, site.lon, hostSize * 1.01), [site, hostSize])
  const groupRef = useRef<THREE.Group>(null)
  const active = hovered || selected
  const pin = hostSize * 0.055, halo = hostSize * 0.13, hit = hostSize * 0.28, stem = hostSize * 0.12
  const col = active ? '#ffd27a' : '#37c6ff'
  useFrame(() => { if (groupRef.current) { const base = active ? 1.18 : 1; groupRef.current.scale.setScalar(base + Math.sin(performance.now() * 0.004) * 0.08) } })
  return (
    <group ref={groupRef} position={localOffset}>
      <mesh onClick={(e) => { e.stopPropagation(); onClick(site, planetWorldRef.current ? planetWorldRef.current.position.clone() : new THREE.Vector3()) }}
        onPointerOver={(e) => { e.stopPropagation(); onHover(site); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { onHover(null); document.body.style.cursor = 'default' }}>
        <sphereGeometry args={[hit, 8, 8]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh><sphereGeometry args={[pin, 12, 12]} /><meshBasicMaterial color={col} toneMapped={false} /></mesh>
      <mesh><sphereGeometry args={[halo, 12, 12]} /><meshBasicMaterial color={col} transparent opacity={active ? 0.34 : 0.16} depthWrite={false} toneMapped={false} /></mesh>
      <mesh position={[0, -stem * 0.5, 0]}><cylinderGeometry args={[pin * 0.22, pin * 0.22, stem, 6]} /><meshBasicMaterial color={col} toneMapped={false} /></mesh>
    </group>
  )
}

// ── Mars (planet with its own markers) ─────────────────────────────────────
function PlanetWithMarkers({ planet, t, onClickPlanet, onClickMarker, onHoverMarker, selectedPlanet, selectedSite, hoveredSiteId, positionsRef, focusRef, focusedId }: {
  planet: (typeof PLANETS)[number]; t: React.MutableRefObject<number>
  onClickPlanet: (id: string, pos: THREE.Vector3) => void; onClickMarker: (site: Site, worldPos: THREE.Vector3) => void
  onHoverMarker: (site: Site | null) => void; selectedPlanet: boolean; selectedSite: string | null; hoveredSiteId: string | null
  positionsRef: React.MutableRefObject<Record<string, THREE.Vector3>>; focusRef: React.MutableRefObject<FocusState>; focusedId: string
}) {
  const ref = useRef<THREE.Group>(null)
  const orbitAngle = useRef(Math.random() * Math.PI * 2)
  const [hovered, setHovered] = useState(false)
  const tex = useMemo(() => bodyTexture(planet.id), [planet.id])
  const sites = SITES.filter((s) => s.body === planet.id)
  useFrame((_, delta) => {
    if (!ref.current) return
    const isFocused = planet.id === focusedId
    const factor = isFocused ? focusRef.current.approach : 1
    orbitAngle.current += planet.speed * delta * factor
    const a = orbitAngle.current
    ref.current.position.set(Math.cos(a) * planet.orbit, 0, Math.sin(a) * planet.orbit)
    ref.current.rotation.y += planet.rotSpeed * 0.01 * factor
    if (isFocused && focusRef.current.body === planet.id) {
      ref.current.rotation.y += focusRef.current.yaw
      ref.current.rotation.x = Math.max(-1.2, Math.min(1.2, ref.current.rotation.x + focusRef.current.pitch))
      focusRef.current.yaw = 0; focusRef.current.pitch = 0
    }
    if (positionsRef.current) positionsRef.current[planet.id] = ref.current.position.clone()
  })
  return (
    <group ref={ref}>
      <mesh onClick={(e) => { e.stopPropagation(); onClickPlanet(planet.id, ref.current!.position.clone()) }}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = 'default' }}>
        <sphereGeometry args={[planet.size, 48, 48]} />
        <meshStandardMaterial map={tex ?? undefined} color={tex ? '#ffffff' : planet.color} emissive={selectedPlanet ? planet.color : '#000000'} emissiveIntensity={selectedPlanet ? 0.3 : 0} roughness={0.9} metalness={0.05} />
      </mesh>
      {sites.map((s) => (<MissionMarker key={s.id} site={s} hostSize={planet.size} planetWorldRef={ref} selected={selectedSite === s.id} hovered={hoveredSiteId === s.id} onClick={onClickMarker} onHover={onHoverMarker} />))}
      {(hovered || selectedPlanet) && (<mesh><sphereGeometry args={[planet.size * 1.35, 16, 16]} /><meshBasicMaterial color={planet.color} transparent opacity={0.08} depthWrite={false} /></mesh>)}
    </group>
  )
}

// ── CameraRig (live follow + approach factor + manual zoom) ───────────────
function CameraRig({ view, planetPositionsRef, focusRef }: {
  view: View; planetPositionsRef: React.MutableRefObject<Record<string, THREE.Vector3>>; focusRef: React.MutableRefObject<FocusState>
}) {
  const { camera } = useThree()
  const targetPos = useRef(new THREE.Vector3(0, 22, 52))
  const targetLook = useRef(new THREE.Vector3(0, 0, 0))
  const currentLook = useRef(new THREE.Vector3(0, 0, 0))
  const baseOffset = useRef(new THREE.Vector3())
  const tmp = useRef(new THREE.Vector3())
  useFrame(() => {
    const P = planetPositionsRef.current
    let bodyPos: THREE.Vector3 | null = null
    switch (view) {
      case 'overview': targetPos.current.set(0, 22, 52); targetLook.current.set(0, 0, 0); break
      case 'earth': { const p = P.earth ?? new THREE.Vector3(14, 0, 0); baseOffset.current.set(3.2, 1.4, 3.2); targetPos.current.copy(p).add(baseOffset.current); targetLook.current.copy(p); bodyPos = p; break }
      case 'moon': { const m = P.moon ?? new THREE.Vector3(15.4, 0, 1.2); baseOffset.current.set(0.9, 0.6, 0.9); targetPos.current.copy(m).add(baseOffset.current); targetLook.current.copy(m); bodyPos = m; break }
      case 'mars': { const p = P.mars ?? new THREE.Vector3(18, 0, 0); baseOffset.current.set(1.3, 0.8, 1.3); targetPos.current.copy(p).add(baseOffset.current); targetLook.current.copy(p); bodyPos = p; break }
    }
    if (view !== 'overview' && bodyPos) {
      tmp.current.copy(baseOffset.current).multiplyScalar(focusRef.current.zoom)
      targetPos.current.copy(bodyPos).add(tmp.current)
      const dist = camera.position.distanceTo(bodyPos)
      focusRef.current.approach = Math.max(0, Math.min(1, (dist - 2.2) / 6.8))
    } else { focusRef.current.approach = 1; focusRef.current.zoom = 1 }
    if (view !== 'overview') { camera.position.lerp(targetPos.current, 0.06); currentLook.current.lerp(targetLook.current, 0.08); camera.lookAt(currentLook.current) }
  })
  return null
}

// ── Scene ─────────────────────────────────────────────────────────────────
function Scene({ view, setView, setSelectedSite, selectedSite, focusRef, hoveredSiteId, setHoveredSiteId }: {
  view: View; setView: (v: View) => void; setSelectedSite: (s: Site | null) => void; selectedSite: string | null
  focusRef: React.MutableRefObject<FocusState>; hoveredSiteId: string | null; setHoveredSiteId: (id: string | null) => void
}) {
  const t = useRef(0)
  const planetPositions = useRef<Record<string, THREE.Vector3>>({})
  const controlsRef = useRef<{ enabled: boolean } | null>(null)
  const focusedId = view === 'overview' ? '' : view
  useFrame((_, delta) => { t.current += delta })
  const handlePlanetClick = (id: string) => { if (id === 'earth') setView('earth'); else if (id === 'moon') setView('moon'); else if (id === 'mars') setView('mars'); else setView('overview') }
  const handleMarkerClick = (site: Site) => setSelectedSite(site)
  const handleMarkerHover = (site: Site | null) => setHoveredSiteId(site ? site.id : null)
  return (
    <>
      <CameraRig view={view} planetPositionsRef={planetPositions} focusRef={focusRef} />
      <Stars radius={300} depth={80} count={6000} factor={5} saturation={0} fade speed={0.6} />
      <ambientLight intensity={0.22} />
      <Sun t={t} />
      {PLANETS.map((p) => p.id === 'mars' ? null : (
        <Planet key={p.id} planet={p} t={t} onClick={handlePlanetClick} selected={view === p.id} positionsRef={planetPositions} onClickMarker={handleMarkerClick} selectedSite={selectedSite} focusRef={focusRef} focusedId={focusedId} />
      ))}
      {PLANETS.filter((p) => p.id === 'mars').map((p) => (
        <PlanetWithMarkers key={p.id} planet={p} t={t} onClickPlanet={handlePlanetClick} onClickMarker={handleMarkerClick} onHoverMarker={handleMarkerHover} selectedPlanet={view === 'mars'} selectedSite={selectedSite} hoveredSiteId={hoveredSiteId} positionsRef={planetPositions} focusRef={focusRef} focusedId={focusedId} />
      ))}
      <MoonWithMarkers t={t} positionsRef={planetPositions} onClickMarker={handleMarkerClick} selectedSite={selectedSite} focusRef={focusRef} focusedId={focusedId} />
      {PLANETS.map((p) => <Orbit key={p.id} radius={p.orbit} />)}
      <OrbitControls ref={controlsRef as never} enabled={view === 'overview'} enablePan={false} minDistance={6} maxDistance={90} enableDamping dampingFactor={0.08} rotateSpeed={0.6} zoomSpeed={0.7} />
    </>
  )
}

// ── Mission popup ─────────────────────────────────────────────────────────
function StorySidebar({ site, onClose }: { site: Site; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(2,4,10,0.72)', backdropFilter: 'blur(6px)', display: 'grid', placeItems: 'center', padding: 24, animation: 'cpFade 0.2s ease' }}>
      <style>{`@keyframes cpFade { from { opacity: 0 } to { opacity: 1 } } @keyframes cpPop { from { transform: translateY(16px) scale(0.97); opacity: 0 } to { transform: translateY(0) scale(1); opacity: 1 } }`}</style>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${site.name} mission details`} style={{ position: 'relative', width: 'min(560px, 100%)', maxHeight: '88vh', overflow: 'auto', background: 'linear-gradient(180deg, rgba(8,12,22,0.97), rgba(4,6,14,0.99))', border: '1px solid rgba(120,150,200,0.28)', borderRadius: 16, boxShadow: '0 30px 80px rgba(0,0,0,0.65), 0 0 40px rgba(55,140,220,0.18)', color: '#d8e2f4', fontFamily: "'JetBrains Mono', monospace", animation: 'cpPop 0.28s cubic-bezier(0.2,0.8,0.2,1)' }}>
        <button onClick={onClose} aria-label="close" style={{ position: 'absolute', top: 12, right: 14, zIndex: 2, width: 32, height: 32, borderRadius: 999, display: 'grid', placeItems: 'center', background: 'rgba(8,12,22,0.7)', border: '1px solid rgba(159,179,208,0.3)', color: '#cfe0ff', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        {site.image && (
          <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', overflow: 'hidden', borderRadius: '16px 16px 0 0', background: '#050810' }}>
            <img src={site.image} alt={`${site.name} — ${site.imageCredit ?? 'image'}`} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', filter: 'saturate(1.05)' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 50%, rgba(4,6,14,0.85))', pointerEvents: 'none' }} />
            {site.imageCredit && (<div style={{ position: 'absolute', left: 12, bottom: 8, color: '#a8b8d4', fontSize: 9, letterSpacing: 1.5, textShadow: '0 0 6px rgba(0,0,0,0.9)' }}>CREDIT: {site.imageCredit}</div>)}
          </div>
        )}
        <div style={{ padding: '22px 24px 24px' }}>
          <div style={{ color: '#7e8db0', fontSize: 10, letterSpacing: 3, marginBottom: 10 }}>{site.body === 'moon' ? '☾ LUNAR MISSION' : '♂ MARS MISSION'} · {site.agency}</div>
          <h2 style={{ margin: '0 0 6px', fontSize: 26, fontWeight: 700, letterSpacing: 1.5, color: '#eef4ff' }}>{site.name}</h2>
          <div style={{ color: '#37c6ff', fontSize: 11, letterSpacing: 1.5, marginBottom: 18, opacity: 0.9 }}>{site.status} · {site.lat.toFixed(2)}°, {site.lon.toFixed(2)}°</div>
          {site.storyDescription && (<p style={{ margin: '0 0 20px', fontSize: 13.5, lineHeight: 1.75, letterSpacing: 0.3, color: '#c8d4ea' }}>{site.storyDescription}</p>)}
          <div style={{ padding: '14px 16px', borderRadius: 10, background: 'rgba(55,198,255,0.08)', border: '1px solid rgba(55,198,255,0.3)' }}>
            <div style={{ color: '#37c6ff', fontSize: 9, letterSpacing: 2.5, marginBottom: 6, fontWeight: 700 }}>◆ REAL DATA</div>
            <div style={{ fontSize: 12, lineHeight: 1.6, color: '#dfeaf8' }}>{site.realData}</div>
            <div style={{ marginTop: 10, color: '#6f8099', fontSize: 9.5, letterSpacing: 1 }}>SOURCES: {site.sources.join(' · ')}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Nav ──────────────────────────────────────────────────────────────────
function Nav({ view, setView }: { view: View; setView: (v: View) => void }) {
  const items: { id: View; label: string; icon: string }[] = [
    { id: 'overview', label: 'OVERVIEW', icon: '◎' }, { id: 'moon', label: 'MOON', icon: '☾' }, { id: 'mars', label: 'MARS', icon: '♂' },
  ]
  return (
    <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8, zIndex: 20, padding: 6, borderRadius: 999, background: 'rgba(8,12,24,0.6)', border: '1px solid rgba(120,150,200,0.2)', backdropFilter: 'blur(10px)' }}>
      <a href="/" style={{ color: '#8aa0c8', textDecoration: 'none', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 1.5, padding: '8px 14px', borderRadius: 999, border: '1px solid rgba(159,179,208,0.3)', opacity: 0.85 }} aria-label="back to landing">←</a>
      {items.map((it) => (
        <button key={it.id} onClick={() => setView(it.id)} style={{ background: view === it.id ? 'rgba(55,198,255,0.18)' : 'transparent', border: view === it.id ? '1px solid rgba(55,198,255,0.5)' : '1px solid transparent', color: view === it.id ? '#fff' : '#9fb3d0', cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: 2, padding: '8px 16px', borderRadius: 999, transition: 'all 0.15s ease' }}>
          <span style={{ marginRight: 6, opacity: 0.8 }}>{it.icon}</span>{it.label}
        </button>
      ))}
      <span style={{ color: '#6f8099', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 1.5, padding: '8px 14px', alignSelf: 'center' }}>EXPLORE</span>
    </div>
  )
}

// ── Mission List Card (bidirectional sync) ────────────────────────────────
function MissionListCard({ bodyId, selectedSiteId, hoveredSiteId, onHover, onSelect }: {
  bodyId: string; selectedSiteId: string | null; hoveredSiteId: string | null
  onHover: (id: string | null) => void; onSelect: (site: Site) => void
}) {
  const sites = SITES.filter((s) => s.body === bodyId)
  if (sites.length === 0) return null
  const active = hoveredSiteId ?? selectedSiteId
  return (
    <div style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', width: 'min(220px, 30vw)', maxHeight: '72vh', overflowY: 'auto', zIndex: 20, padding: '12px 12px 10px', borderRadius: 14, background: 'rgba(8,12,24,0.62)', border: '1px solid rgba(120,150,200,0.22)', backdropFilter: 'blur(10px)', boxShadow: '0 8px 30px rgba(0,0,0,0.45)', fontFamily: "'JetBrains Mono', monospace", color: '#c8d4ea' }}>
      <div style={{ color: '#7e8db0', fontSize: 9, letterSpacing: 3, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ color: '#37c6ff' }}>◆</span> MISSIONS</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {sites.map((s) => {
          const isActive = active === s.id, isSelected = selectedSiteId === s.id, dim = active != null && !isActive
          return (
            <button key={s.id} onClick={() => onSelect(s)} onPointerEnter={() => onHover(s.id)} onPointerLeave={() => onHover(null)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, textAlign: 'left', cursor: 'pointer',
                background: isSelected ? 'rgba(55,198,255,0.16)' : isActive ? 'rgba(255,210,122,0.10)' : 'transparent',
                border: isSelected ? '1px solid rgba(55,198,255,0.4)' : '1px solid transparent',
                color: isActive ? '#fff' : '#c8d4ea', opacity: dim ? 0.38 : 1,
                transition: 'opacity 0.18s ease, background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
                fontFamily: 'inherit', fontSize: 11.5, letterSpacing: 0.6, fontWeight: 600, lineHeight: 1.2 }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, flex: '0 0 auto', background: isSelected ? '#37c6ff' : isActive ? '#ffd27a' : '#46546f', boxShadow: isActive ? '0 0 6px rgba(255,210,122,0.7)' : 'none' }} />
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
              <span style={{ marginLeft: 'auto', fontSize: 9, opacity: 0.6, color: '#8aa0c8' }}>{s.year}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── the page ──────────────────────────────────────────────────────────────
export default function ExplorePage() {
  const [view, setView] = useState<View>('overview')
  const [selectedSite, setSelectedSite] = useState<Site | null>(null)
  const [hoveredSiteId, setHoveredSiteId] = useState<string | null>(null)
  const focusRef = useRef<FocusState>(makeFocus())
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef({ active: false, dist: 0 })
  const drag = useRef({ active: false, dragging: false, startX: 0, startY: 0, lastX: 0, lastY: 0, pointerId: -1 })

  useEffect(() => { focusRef.current.zoom = 1; focusRef.current.body = '' }, [view])

  const onPointerDown = (e: React.PointerEvent) => {
    if (view === 'overview') return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) { const pts = [...pointers.current.values()]; pinch.current = { active: true, dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) }; drag.current.active = false; return }
    if (pointers.current.size === 1) drag.current = { active: true, dragging: false, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, pointerId: e.pointerId }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (view === 'overview') return
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current.active && pointers.current.size >= 2) {
      const pts = [...pointers.current.values()]; const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const ratio = d / pinch.current.dist
      if (Number.isFinite(ratio) && ratio > 0) focusRef.current.zoom = Math.max(0.42, Math.min(2.6, focusRef.current.zoom / ratio))
      pinch.current.dist = d; return
    }
    if (!drag.current.active || drag.current.pointerId !== e.pointerId) return
    const dx = e.clientX - drag.current.lastX, dy = e.clientY - drag.current.lastY
    if (!drag.current.dragging) { const moved = Math.hypot(e.clientX - drag.current.startX, e.clientY - drag.current.startY); if (moved > 6) drag.current.dragging = true }
    if (drag.current.dragging) { focusRef.current.body = view; focusRef.current.yaw += dx * 0.01; focusRef.current.pitch += dy * 0.01; drag.current.lastX = e.clientX; drag.current.lastY = e.clientY }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current.active = false
    if (drag.current.pointerId === e.pointerId) { drag.current.active = false; drag.current.dragging = false }
  }
  const onWheel = (e: React.WheelEvent) => { if (view === 'overview') return; const factor = e.deltaY > 0 ? 1.08 : 0.92; focusRef.current.zoom = Math.max(0.42, Math.min(2.6, focusRef.current.zoom * factor)) }

  return (
    <main onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel} style={{ position: 'fixed', inset: 0, background: '#02030a', overflow: 'hidden', touchAction: 'none' }}>
      <Canvas camera={{ position: [0, 22, 52], fov: 55, near: 0.1, far: 2000 }} dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: 'high-performance' }}>
        <Scene view={view} setView={setView} setSelectedSite={setSelectedSite} selectedSite={selectedSite?.id ?? null} focusRef={focusRef} hoveredSiteId={hoveredSiteId} setHoveredSiteId={setHoveredSiteId} />
      </Canvas>
      <Nav view={view} setView={setView} />
      {view !== 'overview' && (<MissionListCard bodyId={view === 'earth' ? 'moon' : view} selectedSiteId={selectedSite?.id ?? null} hoveredSiteId={hoveredSiteId} onHover={setHoveredSiteId} onSelect={(site) => setSelectedSite(site)} />)}
      <div style={{ position: 'absolute', bottom: 14, left: 16, color: '#6f8099', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 1.5, textShadow: '0 0 6px rgba(0,0,0,0.8)', pointerEvents: 'none', zIndex: 20 }}>
        {view === 'overview' ? 'DRAG TO LOOK AROUND · SCROLL TO ZOOM · CLICK A PLANET' : 'DRAG TO ROTATE · SCROLL/PINCH TO ZOOM · CLICK A MARKER'}
      </div>
      {selectedSite && <StorySidebar site={selectedSite} onClose={() => setSelectedSite(null)} />}
    </main>
  )
}
