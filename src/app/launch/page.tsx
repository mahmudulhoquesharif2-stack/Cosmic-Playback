'use client'
/* eslint-disable react-hooks/immutability */

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as THREE from 'three'

/* ========================================================================== *
 * The Cosmic Playback — Rocket Launch + Lunar Arrival Cinematic (/launch)
 * --------------------------------------------------------------------------
 * Fully automated Earth launch (idle → countdown → ignition →
 *   liftoff → ascent → max-Q → staging → space transition).
 * Translunar journey + lunar descent + rover deployment
 *   (tli → translunar_coast → loi → lunar_orbit → lm_separation →
 *   lm_descent → landing → rover_deploy → handoff).
 *
 * Mission architecture (Apollo-inspired, simplified for cinematic):
 *   Saturn V-style multi-stage rocket launches from Earth → S-IVB upper
 *   stage performs TLI → CSM + LM stack coasts to the Moon → CSM performs
 *   LOI to capture into lunar orbit → LM separates and descends → LM lands
 *   → LRV deploys from the LM descent stage → handoff to /play rover.
 *
 * Scientific simplifications (documented honestly):
 *   - No orbital mechanics; trajectories are linear cinematic animations.
 *   - TLI / LOI / descent burns are visual (plume + throttle), not delta-v.
 *   - The 3-day translunar coast is compressed to ~12 s.
 *   - CSM and S-IVB are not separately modeled — the upper stage IS the
 *     CSM for cinematic simplicity (the fairing opens to reveal the LM).
 *   - Earth→Moon distance is compressed from ~384,000 km to ~800 m visual.
 *   - LM descent is a single straight-line descent, not a powered-descent
 *     profile (braking + approach + terminal landing phases).
 *
 * The whole sequence is driven by a single explicit state machine (the
 * STAGES array below). One useFrame advances a `phaseTime` accumulator and
 * flips to the next stage when the current stage's duration elapses. Each
 * stage owns its own animation logic and reads only (kind, phaseTime,
 * globalTime, dt), so the timeline is fully deterministic and easy to skip,
 * replay, or extend with new chapters later.
 *
 * No player-controlled rocket movement. Skip + Replay + Pause controls.
 * Auto-navigates to /play (the existing LRV chapter) at the end of the
 * handoff stage so the player transitions smoothly into rover gameplay.
 * ========================================================================== */

// ── Rocket / pad dimensions (m, loosely Falcon-9-class) ─────────────────────
const STAGE1_H = 38
const STAGE1_R = 1.85
const STAGE2_H = 16
const STAGE2_R = 1.85
const FAIRING_H = 7
const FAIRING_R = 1.95
const ROCKET_TOTAL_H = STAGE1_H + STAGE2_H + FAIRING_H
const ROCKET_REST_Y = 1.5 // small gap so the engine sits above the pad

// ── Cinematic timeline ─────────────────────────────────────────────────────
// Each stage has a kind, a duration in seconds, and a status message shown
// on the HUD. The timeline totals ~46 s of real cinematic time before the
// (held) terminal state. Skipping advances by one stage; replay resets to
// stage 0.
type StageKind =
  | 'idle'
  | 'countdown'
  | 'ignition'
  | 'liftoff'
  | 'ascent'
  | 'max_q'
  | 'staging'
  | 'space_transition'
  // Translunar + lunar descent + rover deploy stages:
  | 'tli'                // S-IVB reignites for translunar injection
  | 'translunar_coast'  // 3-day cruise compressed to ~12s; Moon grows
  | 'loi'                // CSM fires engine for lunar orbit insertion
  | 'lunar_orbit'        // CSM (with LM) orbits the Moon; LM separates
  | 'lm_separation'      // LM detaches from CSM and backs away
  | 'lm_descent'         // LM descent engine fires; descends to surface
  | 'landing'            // LM touches down; dust settles
  | 'rover_deploy'       // LRV unfolds from LM and drops to surface
  | 'handoff'            // Brief hold, then auto-navigate to /play

type Stage = {
  kind: StageKind
  duration: number // seconds. Infinity for the terminal stage.
  status: string
}

const STAGES: Stage[] = [
  // Earth launch stages
  { kind: 'idle',             duration: 3,  status: 'On the pad · final systems check' },
  { kind: 'countdown',        duration: 10, status: 'T−10 … terminal count' },
  { kind: 'ignition',         duration: 3,  status: 'Engines lit · hold-down release' },
  { kind: 'liftoff',          duration: 5,  status: 'Liftoff · clearing the tower' },
  { kind: 'ascent',           duration: 8,  status: 'Ascending · pitch & throttle' },
  { kind: 'max_q',            duration: 4,  status: 'Max-Q · maximum dynamic pressure' },
  { kind: 'staging',          duration: 5,  status: 'MECO · stage separation' },
  { kind: 'space_transition', duration: 8,  status: 'Above the atmosphere · TLI prep' },
  // Translunar + lunar descent + rover deploy stages
  { kind: 'tli',              duration: 5,  status: 'TLI burn · S-IVB reignites' },
  { kind: 'translunar_coast', duration: 12, status: 'Translunar coast · 3 days compressed' },
  { kind: 'loi',              duration: 5,  status: 'Lunar orbit insertion · LOI burn' },
  { kind: 'lunar_orbit',      duration: 6,  status: 'Lunar orbit · CSM + LM stack' },
  { kind: 'lm_separation',    duration: 4,  status: 'LM separation · undocking' },
  { kind: 'lm_descent',       duration: 10, status: 'LM descent · powered approach' },
  { kind: 'landing',          duration: 5,  status: 'Touchdown · dust settling' },
  { kind: 'rover_deploy',     duration: 8,  status: 'LRV deployment · unfolding from LM' },
  { kind: 'handoff',          duration: Infinity, status: 'Ready to drive · handoff to LRV' },
]

// Mission clock: T−13 at start, T−10 at start of countdown, T+0 at ignition.
function missionClock(stageIdx: number, phaseTime: number): number {
  let t = 0
  for (let i = 0; i < stageIdx; i++) t += STAGES[i].duration
  return t + phaseTime - (STAGES[0].duration + STAGES[1].duration)
}

// ── Visual state shared between the timeline + R3F components ─────────────
type CinematicState = {
  stageIdx: number
  phaseTime: number   // seconds since the current stage started
  globalTime: number  // seconds since the cinematic started
  rocketY: number     // metres above rest (launch) or above lunar surface (descent)
  rocketPitch: number // radians (slight tilt during ascent for visual drama)
  throttle: number    // 0..1, engine glow + plume size
  shake: number       // 0..1, camera shake
  skyBlend: number    // 0 = ground/sky, 1 = pure space
  stage1Sep: number   // 0 = attached, 1 = fully separated & fallen (launch phase)
  // Translunar + descent fields:
  moonApproach: number  // 0..1 — 0 = far away, 1 = at the Moon (controls Moon scale/position)
  csmLmVisible: number  // 0..1 — opacity of the CSM+LM stack (fades in after fairing deploy)
  fairingOpen: number   // 0..1 — 0 = closed fairing, 1 = open (reveals LM)
  lmSep: number         // 0..1 — LM separation from CSM (0 = docked, 1 = fully separated)
  lmDescent: number     // 0..1 — LM descent progress (0 = in orbit, 1 = on surface)
  lmLanded: number     // 0..1 — 0 = flying, 1 = landed (settling + dust)
  roverDeploy: number   // 0..1 — 0 = stowed in LM, 1 = on surface ready to drive
  csmOrbit: number     // 0..∞ — CSM orbital angle (radians); CSM stays in orbit after LM separates
}

function makeInitialState(): CinematicState {
  return {
    stageIdx: 0,
    phaseTime: 0,
    globalTime: 0,
    rocketY: 0,
    rocketPitch: 0,
    throttle: 0,
    shake: 0,
    skyBlend: 0,
    stage1Sep: 0,
    moonApproach: 0,
    csmLmVisible: 0,
    fairingOpen: 0,
    lmSep: 0,
    lmDescent: 0,
    lmLanded: 0,
    roverDeploy: 0,
    csmOrbit: 0,
  }
}

// ── Timeline driver — advances the state machine and animates the rocket ───
function Timeline({ stateRef, pausedRef }: {
  stateRef: React.MutableRefObject<CinematicState>
  pausedRef: React.MutableRefObject<boolean>
}) {
  useFrame((_, delta) => {
    if (pausedRef.current) return
    const dt = Math.min(delta, 0.05)
    const s = stateRef.current
    const stage = STAGES[s.stageIdx]

    // Advance phase + global time
    s.phaseTime += dt
    s.globalTime += dt
    if (s.phaseTime >= stage.duration && stage.duration !== Infinity) {
      s.stageIdx = Math.min(s.stageIdx + 1, STAGES.length - 1)
      s.phaseTime = 0
    }

    // Per-stage animation. We animate rocketY / pitch / throttle / shake /
    // skyBlend / stage1Sep directly from phaseTime so the visuals are a pure
    // function of the timeline (deterministic, easy to skip or replay).
    const t = s.phaseTime
    switch (STAGES[s.stageIdx].kind) {
      case 'idle': {
        s.rocketY = 0; s.rocketPitch = 0; s.throttle = 0
        s.shake = 0; s.skyBlend = 0; s.stage1Sep = 0
        break
      }
      case 'countdown': {
        // Gentle pad vibration building up over T-10..T-0
        s.rocketY = 0; s.rocketPitch = 0; s.throttle = 0
        s.shake = (t / stage.duration) * 0.05
        s.skyBlend = 0; s.stage1Sep = 0
        break
      }
      case 'ignition': {
        const u = t / stage.duration
        s.throttle = THREE.MathUtils.clamp(u * 2, 0, 1)
        s.rocketY = THREE.MathUtils.lerp(0, 1.0, u)
        s.shake = 0.15 + 0.1 * Math.sin(t * 60)
        s.rocketPitch = 0; s.skyBlend = 0; s.stage1Sep = 0
        break
      }
      case 'liftoff': {
        const u = t / stage.duration
        s.throttle = 1
        s.rocketY = 1 + u * u * 14 // 1 → 15 m
        s.shake = 0.12 * (1 - u * 0.6)
        s.rocketPitch = 0; s.skyBlend = 0; s.stage1Sep = 0
        break
      }
      case 'ascent': {
        const u = t / stage.duration
        s.throttle = 1
        s.rocketY = 15 + u * 125 // 15 → 140 m
        s.shake = 0.06
        s.rocketPitch = u * 0.18 // ~10° pitch over
        s.skyBlend = u * 0.45; s.stage1Sep = 0
        break
      }
      case 'max_q': {
        const u = t / stage.duration
        s.throttle = 0.7 + 0.2 * Math.sin(u * Math.PI) // dip then recover
        s.rocketY = 140 + u * 80 // 140 → 220 m
        s.shake = 0.18
        s.rocketPitch = 0.18 + u * 0.04
        s.skyBlend = 0.45 + u * 0.15; s.stage1Sep = 0
        break
      }
      case 'staging': {
        const u = t / stage.duration
        s.throttle = 0 // stage 1 engines off; stage 2 hasn't lit yet
        s.rocketY = 220 + u * 60 // 220 → 280 m (continuing on momentum)
        s.shake = 0.1 * (1 - u) // brief shake at separation
        s.rocketPitch = 0.22
        s.skyBlend = 0.6 + u * 0.2
        s.stage1Sep = u // 0 → 1: stage 1 falls away visually
        break
      }
      case 'space_transition': {
        const u = t / stage.duration
        s.throttle = 0.85
        s.rocketY = 280 + u * 200 // 280 → 480 m
        s.shake = 0; s.rocketPitch = 0.25
        s.skyBlend = 0.8 + u * 0.2 // → 1.0 (pure space)
        s.stage1Sep = 1
        // Begin the Moon approach (still very far away)
        s.moonApproach = u * 0.05
        break
      }
      case 'tli': {
        // S-IVB upper stage reignites for translunar injection.
        const u = t / stage.duration
        s.throttle = 0.9
        s.rocketY = 480 + u * 60
        s.shake = 0.05; s.rocketPitch = 0.25
        s.skyBlend = 1; s.stage1Sep = 1
        // Fairing opens to reveal the LM (which is conceptually stowed
        // inside the fairing from launch through staging).
        s.fairingOpen = u
        s.csmLmVisible = u
        s.moonApproach = 0.05 + u * 0.1
        break
      }
      case 'translunar_coast': {
        // 3-day cruise compressed to ~12s. The spacecraft drifts toward
        // the Moon, which grows from a small disc to filling much of the
        // view. Engine off (coasting). Subtle attitude drift for life.
        const u = t / stage.duration
        s.throttle = 0
        s.rocketY = 540 + Math.sin(s.globalTime * 0.1) * 0.3
        s.shake = 0
        s.rocketPitch = 0.25 + Math.sin(s.globalTime * 0.15) * 0.03
        s.skyBlend = 1; s.stage1Sep = 1
        s.fairingOpen = 1; s.csmLmVisible = 1
        // Moon approach: 0.15 → 0.85 (gets large in frame)
        s.moonApproach = 0.15 + u * 0.7
        s.lmSep = 0; s.lmDescent = 0; s.lmLanded = 0; s.roverDeploy = 0
        s.csmOrbit = 0
        break
      }
      case 'loi': {
        // Lunar orbit insertion: the CSM fires its engine to capture into
        // lunar orbit. The spacecraft slows (visually: a brief burn) and
        // drops from the translunar trajectory altitude (540) to low lunar
        // orbit altitude (50).
        const u = t / stage.duration
        s.throttle = 0.7 + 0.2 * (1 - u) // burn then trail off
        s.rocketY = THREE.MathUtils.lerp(540, 50, u) // 540 → 50 (capture burn)
        s.shake = 0.03; s.rocketPitch = 0.25
        s.skyBlend = 1; s.stage1Sep = 1
        s.fairingOpen = 1; s.csmLmVisible = 1
        s.moonApproach = 0.85 + u * 0.1 // → 0.95 (very close)
        s.lmSep = 0; s.lmDescent = 0; s.lmLanded = 0; s.roverDeploy = 0
        s.csmOrbit = 0
        break
      }
      case 'lunar_orbit': {
        // CSM (with LM attached) orbits the Moon. The spacecraft is in a low
        // lunar orbit (Y ≈ 50, just above the surface at Y=0). The camera
        // sees the spacecraft arc around the lunar surface.
        const u = t / stage.duration
        s.throttle = 0
        s.rocketY = 50 // low lunar orbit altitude
        s.shake = 0; s.rocketPitch = 0.25
        s.skyBlend = 1; s.stage1Sep = 1
        s.fairingOpen = 1; s.csmLmVisible = 1
        s.moonApproach = 0.95
        s.lmSep = 0; s.lmDescent = 0; s.lmLanded = 0; s.roverDeploy = 0
        // Advance the CSM orbital angle (one orbit in this stage)
        s.csmOrbit = u * Math.PI * 2
        break
      }
      case 'lm_separation': {
        // LM detaches from the CSM and backs away. The CSM stays in orbit.
        const u = t / stage.duration
        s.throttle = 0
        s.rocketY = 50 // low lunar orbit
        s.shake = 0; s.rocketPitch = 0.25
        s.skyBlend = 1; s.stage1Sep = 1
        s.fairingOpen = 1; s.csmLmVisible = 1
        s.moonApproach = 0.95
        s.lmSep = u // 0 → 1: LM backs away from CSM
        s.lmDescent = 0; s.lmLanded = 0; s.roverDeploy = 0
        s.csmOrbit = Math.PI * 2 + u * 0.3 // CSM continues slowly
        break
      }
      case 'lm_descent': {
        // LM descent engine fires; the LM descends toward the surface.
        // rocketY here is altitude above the lunar surface: 50 (orbit) → 0 (land).
        // We use ease-out (u^2) for the first 70% of the descent (fast then
        // slowing), then a gentler linear approach for the last 30% — this
        // reads as a powered descent that brakes near the surface, rather
        // than a constant-velocity drop.
        const u = t / stage.duration
        s.throttle = 0.5 + 0.4 * Math.sin(u * Math.PI) // burn peaks mid-descent, eases off
        // Altitude profile: fast initial drop, then decelerate. Using
        //   u < 0.7: 50 * (1 - u/0.7 * 0.85)   → drops to ~7.5m at u=0.7
        //   u >= 0.7: 7.5 * (1 - (u-0.7)/0.3)  → gently settles to 0
        if (u < 0.7) {
          s.rocketY = 50 * (1 - (u / 0.7) * 0.85)
        } else {
          s.rocketY = 7.5 * (1 - (u - 0.7) / 0.3)
        }
        s.shake = 0.04 * (1 - u * 0.5) // slight shake during burn, calms near surface
        s.rocketPitch = 0.25 * (1 - u) // upright as it nears surface
        s.skyBlend = 1; s.stage1Sep = 1
        s.fairingOpen = 1; s.csmLmVisible = 1
        s.moonApproach = 0.95
        s.lmSep = 1
        s.lmDescent = u // 0 → 1
        s.lmLanded = 0; s.roverDeploy = 0
        s.csmOrbit = Math.PI * 2.3 + u * 0.5
        break
      }
      case 'landing': {
        // LM touches down; dust settles; engine off. A brief impact shake
        // (first 20% of the stage) followed by stillness. The engine cuts
        // off immediately on contact (throttle → 0 in the first 10%).
        const u = t / stage.duration
        s.throttle = Math.max(0, 0.3 * (1 - u * 8)) // engine cuts off very fast
        s.rocketY = 0
        // Impact shake: a short 2-frame jolt, then completely still
        s.shake = u < 0.2 ? 0.15 * (1 - u / 0.2) : 0
        s.rocketPitch = 0
        s.skyBlend = 1; s.stage1Sep = 1
        s.fairingOpen = 1; s.csmLmVisible = 1
        s.moonApproach = 0.95
        s.lmSep = 1
        s.lmDescent = 1
        s.lmLanded = u // 0 → 1: settling + dust
        s.roverDeploy = 0
        s.csmOrbit = Math.PI * 2.8 + u * 0.3
        break
      }
      case 'rover_deploy': {
        // LRV unfolds from the LM descent stage and drops to the surface.
        const u = t / stage.duration
        s.throttle = 0
        s.rocketY = 0
        s.shake = 0; s.rocketPitch = 0
        s.skyBlend = 1; s.stage1Sep = 1
        s.fairingOpen = 1; s.csmLmVisible = 1
        s.moonApproach = 0.95
        s.lmSep = 1
        s.lmDescent = 1
        s.lmLanded = 1
        s.roverDeploy = u // 0 → 1: rover unfolds and drops
        s.csmOrbit = Math.PI * 3.1 + u * 0.2
        break
      }
      case 'handoff': {
        // Hold on the landed LM with the rover deployed. The HUD shows
        // "Ready to drive · handoff to LRV". A countdown overlay appears
        // and after ~5s the page auto-navigates to /play.
        s.throttle = 0
        s.rocketY = 0
        s.shake = 0; s.rocketPitch = 0
        s.skyBlend = 1; s.stage1Sep = 1
        s.fairingOpen = 1; s.csmLmVisible = 1
        s.moonApproach = 0.95
        s.lmSep = 1
        s.lmDescent = 1
        s.lmLanded = 1
        s.roverDeploy = 1
        s.csmOrbit = Math.PI * 3.3 + s.globalTime * 0.05
        break
      }
    }
  })
  return null
}

// ── Rocket model ───────────────────────────────────────────────────────────
function RocketModel({ stateRef }: { stateRef: React.MutableRefObject<CinematicState> }) {
  const bodyRef = useRef<THREE.Group>(null)
  const stage1Ref = useRef<THREE.Group>(null)
  const glowRef = useRef<THREE.Mesh>(null)
  const plumeRef = useRef<THREE.Mesh>(null)
  const plumeLightRef = useRef<THREE.PointLight>(null)

  useFrame(() => {
    const s = stateRef.current
    if (!bodyRef.current) return
    bodyRef.current.position.y = ROCKET_REST_Y + s.rocketY
    bodyRef.current.rotation.z = s.rocketPitch

    if (stage1Ref.current) {
      if (s.stage1Sep > 0) {
        stage1Ref.current.position.y = -s.stage1Sep * 25
        stage1Ref.current.rotation.z = s.stage1Sep * 0.3
      } else {
        stage1Ref.current.position.y = 0
        stage1Ref.current.rotation.z = 0
      }
    }

    if (glowRef.current) {
      const m = glowRef.current.material as THREE.MeshBasicMaterial
      m.opacity = 0.6 * s.throttle + 0.05
      glowRef.current.scale.setScalar(0.6 + s.throttle * 0.6)
    }
    if (plumeRef.current) {
      const plumeH = 2 + s.throttle * 10
      plumeRef.current.scale.set(s.throttle * 0.9 + 0.1, plumeH, s.throttle * 0.9 + 0.1)
      plumeRef.current.position.y = -plumeH / 2
      const m = plumeRef.current.material as THREE.MeshBasicMaterial
      m.opacity = s.throttle * 0.85
    }
    if (plumeLightRef.current) {
      plumeLightRef.current.intensity = s.throttle * 25
    }
  })

  const whiteMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#eef1f4', metalness: 0.3, roughness: 0.5 }), [])
  const darkMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a2d33', metalness: 0.5, roughness: 0.5 }), [])
  const accentMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#c8a838', metalness: 0.7, roughness: 0.4 }), [])

  return (
    <group ref={bodyRef}>
      {/* Stage 1 (lower) — falls away on separation */}
      <group ref={stage1Ref}>
        <mesh castShadow material={whiteMat}>
          <cylinderGeometry args={[STAGE1_R, STAGE1_R, STAGE1_H, 24]} />
        </mesh>
        {/* interstage band */}
        <mesh position={[0, STAGE1_H / 2 - 0.5, 0]} material={darkMat}>
          <cylinderGeometry args={[STAGE1_R + 0.03, STAGE1_R + 0.03, 0.5, 24]} />
        </mesh>
        {/* logo band (gold accent) */}
        <mesh position={[0, STAGE1_H / 4, 0]} material={accentMat}>
          <cylinderGeometry args={[STAGE1_R + 0.02, STAGE1_R + 0.02, 1.2, 24]} />
        </mesh>
        {/* 4 grid fins at top of stage 1 */}
        {[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2
          return (
            <mesh key={i} position={[Math.cos(a) * (STAGE1_R + 0.2), STAGE1_H / 2 - 0.1, Math.sin(a) * (STAGE1_R + 0.2)]} rotation={[0, -a, 0]} material={darkMat} castShadow>
              <boxGeometry args={[0.08, 0.6, 0.5]} />
            </mesh>
          )
        })}
        {/* 4 landing legs (folded, decorative) */}
        {[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4
          return (
            <mesh key={i} position={[Math.cos(a) * (STAGE1_R + 0.05), -STAGE1_H / 2 + 1.5, Math.sin(a) * (STAGE1_R + 0.05)]} rotation={[0, -a, 0]} material={darkMat}>
              <cylinderGeometry args={[0.08, 0.08, 1.8, 6]} />
            </mesh>
          )
        })}
        {/* 9 engine bells (octaweb-style) */}
        {Array.from({ length: 9 }).map((_, i) => {
          const a = (i / 9) * Math.PI * 2
          const r = i === 0 ? 0 : (i <= 6 ? 0.9 : 1.3)
          return (
            <mesh key={i} position={[Math.cos(a) * r, -STAGE1_H / 2 - 0.4, Math.sin(a) * r]} rotation={[Math.PI, 0, 0]} material={darkMat}>
              <coneGeometry args={[0.45, 0.8, 12, 1, true]} />
            </mesh>
          )
        })}
      </group>

      {/* Stage 2 (upper) — remains attached after staging */}
      <group position={[0, STAGE1_H / 2 + STAGE2_H / 2, 0]}>
        <mesh castShadow material={whiteMat}>
          <cylinderGeometry args={[STAGE2_R, STAGE2_R, STAGE2_H, 24]} />
        </mesh>
        {/* interstage band */}
        <mesh position={[0, STAGE2_H / 2 - 0.4, 0]} material={darkMat}>
          <cylinderGeometry args={[STAGE2_R + 0.03, STAGE2_R + 0.03, 0.4, 24]} />
        </mesh>
        {/* single vacuum engine bell */}
        <mesh position={[0, -STAGE2_H / 2 - 0.4, 0]} rotation={[Math.PI, 0, 0]} material={darkMat}>
          <coneGeometry args={[0.55, 1.0, 12, 1, true]} />
        </mesh>
      </group>

      {/* Payload fairing (top cone) */}
      <mesh position={[0, STAGE1_H / 2 + STAGE2_H + FAIRING_H / 2, 0]} castShadow material={whiteMat}>
        <coneGeometry args={[FAIRING_R, FAIRING_H, 24]} />
      </mesh>
      {/* fairing band */}
      <mesh position={[0, STAGE1_H / 2 + STAGE2_H + 0.5, 0]} material={darkMat}>
        <cylinderGeometry args={[FAIRING_R + 0.03, FAIRING_R + 0.03, 0.3, 24]} />
      </mesh>

      {/* Engine plume (visual only, scaled by throttle) */}
      <mesh ref={plumeRef} position={[0, -1, 0]}>
        <coneGeometry args={[STAGE1_R * 0.8, 1, 16, 1, true]} />
        <meshBasicMaterial color="#ff9a3c" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* Engine glow disc */}
      <mesh ref={glowRef} position={[0, -STAGE1_H / 2 - 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[STAGE1_R * 0.9, 24]} />
        <meshBasicMaterial color="#ffd084" transparent opacity={0.05} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* Engine point light */}
      <pointLight ref={plumeLightRef} position={[0, -STAGE1_H / 2 - 1, 0]} color="#ffae5a" intensity={0} distance={40} decay={2} />
    </group>
  )
}

// ── Launch pad ──────────────────────────────────────────────────────────────
// The pad + ground plane are only visible during the Earth-launch stages.
// Once the rocket leaves the atmosphere (skyBlend > 0.5) we hide the entire
// group so the ground plane doesn't appear as a flat grey slab at the
// bottom of the frame during the space + lunar stages.
function LaunchPad({ stateRef }: { stateRef: React.MutableRefObject<CinematicState> }) {
  const ref = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!ref.current) return
    const s = stateRef.current
    // Hide the pad + ground once we're mostly in space
    ref.current.visible = s.skyBlend < 0.5
  })
  const concreteMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5a5853', roughness: 0.95 }), [])
  const metalMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7a7d82', metalness: 0.7, roughness: 0.4 }), [])
  const yellowMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#c8a838', metalness: 0.4, roughness: 0.6 }), [])

  const towerR = 6
  const towerH = 22

  return (
    <group ref={ref}>
      {/* concrete base */}
      <mesh position={[0, -0.4, 0]} receiveShadow material={concreteMat}>
        <cylinderGeometry args={[10, 11, 0.8, 24]} />
      </mesh>
      {/* flame trench (darker ring inside the pad) */}
      <mesh position={[0, -0.1, 0]} rotation={[-Math.PI / 2, 0, 0]} material={metalMat}>
        <ringGeometry args={[STAGE1_R + 0.5, STAGE1_R + 2.5, 24]} />
      </mesh>

      {/* 4 tower legs (lattice-style boxes) */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4
        const x = Math.cos(a) * towerR, z = Math.sin(a) * towerR
        return (
          <group key={i} position={[x, 0, z]}>
            <mesh position={[0, towerH / 2, 0]} castShadow material={metalMat}>
              <boxGeometry args={[0.35, towerH, 0.35]} />
            </mesh>
            {/* cross-brace levels */}
            {[0.15, 0.4, 0.65].map((h, j) => (
              <mesh key={j} position={[0, towerH * h, 0]} material={metalMat}>
                <boxGeometry args={[0.12, 0.12, 0.12]} />
              </mesh>
            ))}
            <mesh position={[0, towerH - 0.3, 0]} material={yellowMat}>
              <boxGeometry args={[0.4, 0.6, 0.4]} />
            </mesh>
          </group>
        )
      })}

      {/* horizontal walkway arm reaching toward the rocket */}
      <mesh position={[towerR - 0.5, 14, 0]} castShadow material={metalMat}>
        <boxGeometry args={[towerR, 0.4, 0.6]} />
      </mesh>
      <mesh position={[towerR - 0.5, 12.5, 0]} rotation={[0, 0, Math.PI / 6]} material={metalMat}>
        <boxGeometry args={[3.5, 0.15, 0.25]} />
      </mesh>

      {/* 4 hold-down clamps at the base of the rocket */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2
        return (
          <mesh key={i} position={[Math.cos(a) * (STAGE1_R + 0.3), 0.5, Math.sin(a) * (STAGE1_R + 0.3)]} rotation={[0, -a, 0]} material={metalMat} castShadow>
            <boxGeometry args={[0.4, 1.0, 0.25]} />
          </mesh>
        )
      })}

      {/* distant ground plane */}
      <mesh position={[0, -1, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={concreteMat}>
        <planeGeometry args={[2000, 2000]} />
      </mesh>
    </group>
  )
}

// ── Smoke particles (during ignition + liftoff) ────────────────────────────
const MAX_SMOKE = 220

function SmokeSystem({ stateRef }: { stateRef: React.MutableRefObject<CinematicState> }) {
  const meshRefs = useRef<THREE.Mesh[]>([])
  const particles = useRef<{ pos: THREE.Vector3; vel: THREE.Vector3; life: number; size: number; maxLife: number }[]>([])
  const emitTimer = useRef(0)

  useFrame((_, delta) => {
    const s = stateRef.current
    const stageKind = STAGES[s.stageIdx].kind
    const dt = Math.min(delta, 0.05)

    // Launch smoke (ignition + liftoff) at the pad (Z=0)
    if (stageKind === 'ignition' || stageKind === 'liftoff') {
      emitTimer.current += dt
      const rate = stageKind === 'ignition' ? 0.012 : 0.02
      while (emitTimer.current > rate && particles.current.length < MAX_SMOKE) {
        emitTimer.current -= rate
        const a = Math.random() * Math.PI * 2
        const r = Math.random() * STAGE1_R * 1.2
        const upwardBias = stageKind === 'ignition' ? 1.5 : 0.4
        particles.current.push({
          pos: new THREE.Vector3(Math.cos(a) * r, 0.3 + Math.random() * 0.3, Math.sin(a) * r),
          vel: new THREE.Vector3(
            Math.cos(a) * (1 + Math.random() * 2),
            upwardBias + Math.random() * 0.8,
            Math.sin(a) * (1 + Math.random() * 2),
          ),
          life: 1, maxLife: 2.5 + Math.random() * 1.5,
          size: 1.5 + Math.random() * 2.5,
        })
      }
    }

    // Lunar dust kick-up during LM descent (last 30%, when the engine plume
    // is near the surface) and landing (touchdown dust burst). The dust
    // emanates from the landing site at Z≈104.
    if ((stageKind === 'lm_descent' && s.lmDescent > 0.7) || (stageKind === 'landing' && s.lmLanded < 0.4)) {
      emitTimer.current += dt
      // Emit rate: high during the final approach + touchdown, then taper off
      const rate = stageKind === 'landing' ? 0.015 : 0.025
      while (emitTimer.current > rate && particles.current.length < MAX_SMOKE) {
        emitTimer.current -= rate
        const a = Math.random() * Math.PI * 2
        const r = Math.random() * 3 + 1 // 1–4m radius from the landing site
        const dustX = Math.cos(a) * r
        const dustZ = 104 + Math.sin(a) * r
        particles.current.push({
          pos: new THREE.Vector3(dustX, 0.2 + Math.random() * 0.3, dustZ),
          vel: new THREE.Vector3(
            Math.cos(a) * (2 + Math.random() * 3), // radial outward
            0.5 + Math.random() * 1.0, // gentle upward
            Math.sin(a) * (2 + Math.random() * 3),
          ),
          life: 1, maxLife: 1.5 + Math.random() * 1.0,
          size: 1.0 + Math.random() * 1.5,
        })
      }
    }

    // Update particles
    for (let i = particles.current.length - 1; i >= 0; i--) {
      const p = particles.current[i]
      p.pos.addScaledVector(p.vel, dt)
      p.vel.y -= 0.3 * dt
      p.vel.multiplyScalar(1 - 0.4 * dt)
      p.life -= dt / p.maxLife
      if (p.life <= 0) particles.current.splice(i, 1)
    }

    // Apply to meshes
    for (let i = 0; i < meshRefs.current.length; i++) {
      const m = meshRefs.current[i]
      if (!m) continue
      const p = particles.current[i]
      if (p) {
        m.visible = true
        m.position.copy(p.pos)
        const sz = p.size * (0.4 + (1 - p.life) * 1.6)
        m.scale.setScalar(sz)
        const mat = m.material as THREE.MeshBasicMaterial
        // Cool from white-hot to grey as the particle ages
        const heat = p.life
        const r = 0.95 * heat + 0.45 * (1 - heat)
        const g = 0.85 * heat + 0.42 * (1 - heat)
        const b = 0.65 * heat + 0.4 * (1 - heat)
        mat.color.setRGB(r, g, b)
        mat.opacity = Math.max(0, p.life * 0.6)
      } else {
        m.visible = false
      }
    }
  })

  return (
    <group>
      {Array.from({ length: MAX_SMOKE }).map((_, i) => (
        <mesh key={i} ref={(el) => { if (el) meshRefs.current[i] = el }} visible={false}>
          <sphereGeometry args={[1, 8, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

// ── Sky colour (transitions ground → space) ────────────────────────────────
function SkyDome({ stateRef }: { stateRef: React.MutableRefObject<CinematicState> }) {
  const ref = useRef<THREE.Mesh>(null)
  const tex = useMemo(() => {
    if (typeof document === 'undefined') return null
    const c = document.createElement('canvas'); c.width = 2; c.height = 256
    const ctx = c.getContext('2d')!
    const grad = ctx.createLinearGradient(0, 0, 0, 256)
    grad.addColorStop(0, '#000814')
    grad.addColorStop(0.45, '#0a1830')
    grad.addColorStop(0.7, '#1c3a6e')
    grad.addColorStop(0.85, '#5a7fa8')
    grad.addColorStop(1, '#9fb6d4')
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 2, 256)
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])
  useFrame(() => {
    const s = stateRef.current
    if (ref.current) {
      const m = ref.current.material as THREE.MeshBasicMaterial
      // Once we are essentially in space, hide the dome entirely so the drei
      // <Stars> behind it are not partially occluded by a low-opacity shell.
      const nearSpace = s.skyBlend > 0.92
      ref.current.visible = !nearSpace
      m.opacity = 1 - s.skyBlend
    }
  })
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[900, 32, 32]} />
      <meshBasicMaterial map={tex ?? undefined} side={THREE.BackSide} transparent opacity={1} depthWrite={false} fog={false} />
    </mesh>
  )
}

// ── Earth limb curve (visible during space_transition + complete) ──────────
function EarthLimb({ stateRef }: { stateRef: React.MutableRefObject<CinematicState> }) {
  const ref = useRef<THREE.Mesh>(null)
  const tex = useMemo(() => {
    if (typeof document === 'undefined') return null
    const W = 1024, H = 256
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const ctx = c.getContext('2d')!
    const sky = ctx.createLinearGradient(0, 0, 0, H)
    sky.addColorStop(0, '#000000'); sky.addColorStop(0.4, '#0a2a5a'); sky.addColorStop(0.6, '#1e5fb4'); sky.addColorStop(1, '#2a7dd4')
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H)
    let seed = 12
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 }
    for (let i = 0; i < 25; i++) {
      const x = rand() * W, y = H * 0.55 + rand() * H * 0.45, rw = 30 + rand() * 70, rh = 18 + rand() * 30
      ctx.globalAlpha = 0.92; ctx.fillStyle = '#3a7d3a'
      ctx.beginPath(); ctx.ellipse(x, y, rw, rh, rand() * Math.PI, 0, Math.PI * 2); ctx.fill()
    }
    for (let i = 0; i < 30; i++) {
      const x = rand() * W, y = H * 0.55 + rand() * H * 0.45, rw = 14 + rand() * 28, rh = 8 + rand() * 16
      ctx.globalAlpha = 0.5; ctx.fillStyle = '#8a7050'
      ctx.beginPath(); ctx.ellipse(x, y, rw, rh, 0, 0, Math.PI * 2); ctx.fill()
    }
    for (let i = 0; i < 50; i++) {
      const x = rand() * W, y = H * 0.5 + rand() * H * 0.5, rw = 30 + rand() * 60, rh = 4 + rand() * 10
      ctx.globalAlpha = 0.4; ctx.fillStyle = '#ffffff'
      ctx.beginPath(); ctx.ellipse(x, y, rw, rh, 0, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])

  useFrame(() => {
    const s = stateRef.current
    if (!ref.current) return
    const visibility = THREE.MathUtils.clamp((s.skyBlend - 0.5) * 2, 0, 1)
    const m = ref.current.material as THREE.MeshStandardMaterial
    m.opacity = visibility * 0.95
    ref.current.rotation.y += 0.0005
  })

  return (
    <mesh ref={ref} position={[0, -240, 0]} rotation={[Math.PI, 0, 0]}>
      <sphereGeometry args={[280, 64, 32, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
      <meshStandardMaterial map={tex ?? undefined} roughness={0.7} metalness={0} transparent opacity={0} emissive={new THREE.Color('#10264a')} emissiveIntensity={0.15} side={THREE.FrontSide} fog={false} />
    </mesh>
  )
}

// ── Custom starfield (Points) — guaranteed visible at any camera distance ──
// The drei <Stars> helper uses size attenuation, so when the camera moves
// very far from the star sphere (as it does in the `complete` stage, ~500 m
// from origin) the per-point size on screen drops below one pixel and the
// field effectively disappears. This custom field uses sizeAttenuation=false
// so each star is always rendered at a fixed pixel size, regardless of the
// camera's distance. Density is tuned so the field looks like a clear night
// sky from any of the cinematic's camera positions.
function Starfield() {
  const points = useMemo(() => {
    if (typeof window === 'undefined') return null
    const N = 3500
    const positions = new Float32Array(N * 3)
    const colors = new Float32Array(N * 3)
    const rand = (s: number) => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
    let seed = 1234
    for (let i = 0; i < N; i++) {
      // Distribute stars on the surface of a large sphere of radius 1500,
      // so they sit far from the action but always surround the scene.
      const u = rand(seed); seed = (seed * 9301 + 49297) % 233280
      const v = rand(seed); seed = (seed * 9301 + 49297) % 233280
      const theta = 2 * Math.PI * u
      const phi = Math.acos(2 * v - 1)
      const r = 1500
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = r * Math.cos(phi)
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
      // Star color: mostly white with some bluish and yellowish tints
      const tint = rand(seed); seed = (seed * 9301 + 49297) % 233280
      if (tint < 0.7) { colors[i * 3] = 1; colors[i * 3 + 1] = 1; colors[i * 3 + 2] = 1 }
      else if (tint < 0.85) { colors[i * 3] = 0.7; colors[i * 3 + 1] = 0.85; colors[i * 3 + 2] = 1 }
      else { colors[i * 3] = 1; colors[i * 3 + 1] = 0.85; colors[i * 3 + 2] = 0.65 }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return geo
  }, [])

  if (!points) return null
  return (
    <points geometry={points} frustumCulled={false}>
      <pointsMaterial size={2.5} sizeAttenuation={false} vertexColors transparent opacity={0.9} depthWrite={false} fog={false} />
    </points>
  )
}

// ── Custom starfield (Points) — END ────────────────────────────────────────

// ── Distant Earth (a small blue marble visible once we're in space) ────────
// The EarthLimb above is a huge curved horizon that works for the ascent
// stage when the camera is low. Once the camera reaches the rocket's altitude
// in the `complete` stage, that huge sphere is far below the view frustum and
// no longer visible. This small marble provides the "Earth in the distance"
// beat for the final stage. Each frame it is re-positioned along the
// camera's view direction, so the planet always sits behind the rocket
// no matter where the slow orbiting camera happens to be.
function DistantEarth({ stateRef }: { stateRef: React.MutableRefObject<CinematicState> }) {
  const ref = useRef<THREE.Mesh>(null)
  const { camera } = useThree()
  const tex = useMemo(() => {
    if (typeof document === 'undefined') return null
    const W = 512, H = 256
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#16558a'; ctx.fillRect(0, 0, W, H)
    let seed = 33
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 }
    for (let i = 0; i < 14; i++) {
      const x = rand() * W, y = rand() * H, rw = 30 + rand() * 70, rh = 20 + rand() * 50
      ctx.globalAlpha = 0.92; ctx.fillStyle = '#3a7d3a'
      ctx.beginPath(); ctx.ellipse(x, y, rw, rh, rand() * Math.PI, 0, Math.PI * 2); ctx.fill()
    }
    for (let i = 0; i < 30; i++) {
      const x = rand() * W, y = rand() * H, rw = 14 + rand() * 28, rh = 8 + rand() * 16
      ctx.globalAlpha = 0.5; ctx.fillStyle = '#8a7050'
      ctx.beginPath(); ctx.ellipse(x, y, rw, rh, 0, 0, Math.PI * 2); ctx.fill()
    }
    for (let i = 0; i < 40; i++) {
      const x = rand() * W, y = rand() * H, rw = 40 + rand() * 60, rh = 4 + rand() * 10
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#ffffff'
      ctx.beginPath(); ctx.ellipse(x, y, rw, rh, 0, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])

  const dir = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const s = stateRef.current
    if (!ref.current) return
    // Earth is visible during the Earth-launch space stages (skyBlend > 0.5)
    // and the early translunar coast. As the spacecraft approaches the Moon
    // (moonApproach > 0.3), Earth should fade out — we're flying away from it
    // toward the Moon, so Earth shrinks and is eventually hidden by the Moon
    // in the foreground.
    const earthVisible = THREE.MathUtils.clamp((s.skyBlend - 0.5) * 2, 0, 1)
    const moonHiding = THREE.MathUtils.clamp((s.moonApproach - 0.3) * 1.5, 0, 1)
    const visibility = earthVisible * (1 - moonHiding)
    const m = ref.current.material as THREE.MeshStandardMaterial
    m.opacity = visibility * 0.95
    ref.current.visible = visibility > 0.01
    // Place Earth OPPOSITE the Moon direction (behind the spacecraft, since
    // we're flying from Earth toward the Moon). The Moon is at +Z, so Earth
    // goes to -Z. We keep Earth at a fixed position relative to the camera
    // so it's visible as a small blue marble receding behind the spacecraft.
    // Use the camera's backward direction so Earth stays in frame.
    camera.getWorldDirection(dir)
    // Place Earth behind the camera (opposite view direction)
    ref.current.position.copy(camera.position).addScaledVector(dir, -600)
    ref.current.position.y -= 40
    ref.current.rotation.y += 0.0008
  })

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[28, 32, 32]} />
      <meshStandardMaterial map={tex ?? undefined} roughness={0.7} metalness={0} transparent opacity={0} emissive={new THREE.Color('#0a1830')} emissiveIntensity={0.2} fog={false} />
    </mesh>
  )
}

// ── Moon — large procedural sphere, grows as the spacecraft approaches ─────
// The Moon is positioned far along the +Z axis. Its scale grows from a tiny
// disc to filling much of the view as `moonApproach` goes 0 → 1. The Moon is
// the destination body for the lunar descent + landing stages. We use a
// procedural cratered texture similar to the explore page's moon.
function Moon({ stateRef }: { stateRef: React.MutableRefObject<CinematicState> }) {
  const ref = useRef<THREE.Mesh>(null)
  const tex = useMemo(() => {
    if (typeof document === 'undefined') return null
    const W = 1024, H = 512
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#9a958c'; ctx.fillRect(0, 0, W, H)
    // Maria (dark plains)
    const maria = [[5, -25, 90, 60], [10, 5, 70, 50], [-5, 40, 80, 55], [15, -60, 60, 40], [-10, -10, 50, 35]]
    for (const [la, lo, rw, rh] of maria) {
      const x = ((lo + 180) / 360) * W, y = ((90 - la) / 180) * H
      ctx.globalAlpha = 0.55; ctx.fillStyle = '#5a5750'
      ctx.beginPath(); ctx.ellipse(x, y, rw, rh, 0, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
    // Craters
    let seed = 7
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 }
    const crater = (x: number, y: number, r: number) => {
      const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r)
      g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.7, 'rgba(0,0,0,0.18)'); g.addColorStop(0.9, 'rgba(255,255,255,0.14)'); g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    }
    for (let i = 0; i < 80; i++) crater(rand() * W, rand() * H, 6 + rand() * 16)
    for (let i = 0; i < 300; i++) crater(rand() * W, rand() * H, 2 + rand() * 5)
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])

  useFrame(() => {
    const s = stateRef.current
    if (!ref.current) return
    const approach = s.moonApproach
    const moonX = 0
    const moonY = THREE.MathUtils.lerp(300, -300, approach)
    const moonZ = THREE.MathUtils.lerp(900, 100, approach)
    const moonScale = 60 + approach * 240 // 60 → 300
    ref.current.position.set(moonX, moonY, moonZ)
    ref.current.scale.setScalar(moonScale)
    ref.current.rotation.y += 0.0002
    // Fade in: invisible at approach=0, visible at approach>0.05. Once
    // fully opaque (approach > 0.15), disable transparency to avoid
    // three.js transparent-pass depth-sorting issues with the starfield.
    const m = ref.current.material as THREE.MeshStandardMaterial
    const opacity = THREE.MathUtils.clamp(approach * 8, 0, 1)
    if (opacity >= 0.999) {
      m.transparent = false
      m.opacity = 1
    } else {
      m.transparent = true
      m.opacity = opacity
    }
    ref.current.visible = opacity > 0.01
  })

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[1, 48, 48]} />
      <meshStandardMaterial map={tex ?? undefined} roughness={0.95} metalness={0} transparent opacity={0} fog={false} />
    </mesh>
  )
}

// ── CSM + LM stack (the spacecraft that coasts to the Moon) ──────────────
// This is a simplified Apollo CSM (Command/Service Module) + LM (Lunar
// Module) stack. It replaces the payload fairing once the fairing opens
// (during the `tli` stage). The CSM is the cone + cylinder at the top; the
// LM is the angular lander stowed below it. When the LM separates (during
// `lm_separation`), the LM detaches and backs away while the CSM stays in
// lunar orbit.
function CsmLmStack({ stateRef }: { stateRef: React.MutableRefObject<CinematicState> }) {
  const bodyRef = useRef<THREE.Group>(null)
  const lmRef = useRef<THREE.Group>(null)
  const fairingLeftRef = useRef<THREE.Mesh>(null)
  const fairingRightRef = useRef<THREE.Mesh>(null)
  const plumeRef = useRef<THREE.Mesh>(null)
  const plumeLightRef = useRef<THREE.PointLight>(null)

  useFrame(() => {
    const s = stateRef.current
    if (!bodyRef.current) return
    // The stack follows the same world position as the rocket's upper stage
    // (rocketY). After landing, the LM is on the surface (rocketY=0).
    // During the LM descent, the stack moves from the orbital position
    // (Z=0, Y=540) to the landing site (Z=100, Y=0). We interpolate the Z
    // based on lmDescent so the LM visibly travels to the landing site.
    bodyRef.current.position.y = ROCKET_REST_Y + s.rocketY
    bodyRef.current.position.z = THREE.MathUtils.lerp(0, 100, s.lmDescent)
    bodyRef.current.rotation.z = s.rocketPitch

    // Fairing open animation: two halves swing apart
    if (fairingLeftRef.current && fairingRightRef.current) {
      const open = s.fairingOpen * 0.6 // swing up to ~34°
      fairingLeftRef.current.rotation.z = open
      fairingRightRef.current.rotation.z = -open
      const fm = fairingLeftRef.current.material as THREE.MeshStandardMaterial
      fm.opacity = 1 - s.fairingOpen
      ;(fairingRightRef.current.material as THREE.MeshStandardMaterial).opacity = 1 - s.fairingOpen
    }

    // LM separation: detach and back away from the CSM. After the descent,
    // the LM settles on the surface. The LM group origin is at the descent
    // stage center; the footpads are at local Y ≈ -0.6, so for the footpads to
    // touch the ground (world Y=0) with the body at Y=1.5, the LM local Y
    // must be -0.9 when landed. In orbit (body at Y=540) the LM is stowed
    // below the CSM at local Y ≈ 15, and backs away by -8 during separation.
    // The back-away offset is blended out as the LM descends so the LM sits
    // cleanly on the surface by the time it lands.
    if (lmRef.current) {
      const sep = s.lmSep
      const descent = s.lmDescent
      // X/Z: LM backs away from the CSM during separation
      const lz = sep * 4
      // Y: stowed at +15, backs away by -8 during separation, then descends
      // to -0.9 (on surface). The back-away offset (sep * 8) is blended out
      // as the LM descends so it doesn't push the LM underground.
      const stowedY = 15
      const landedY = -0.9
      const backAway = (1 - descent) * sep * 8 // 0 once descent starts
      const ly = THREE.MathUtils.lerp(stowedY, landedY, descent) - backAway
      lmRef.current.position.set(0, ly, lz)
      lmRef.current.rotation.z = sep * 0.2 * (1 - descent) // level out as it descends
    }

    // CSM/LM stack opacity (fades in after fairing opens). We only set
    // `transparent = true` when opacity < 1 to avoid three.js transparent-pass
    // depth-sorting issues that can hide the meshes behind the opaque lunar
    // surface patch.
    const stackOpacity = s.csmLmVisible
    bodyRef.current.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const m = obj.material as THREE.MeshStandardMaterial
        // Only fade the CSM+LM+rover parts, not the fairing (which has its own opacity)
        if (obj !== fairingLeftRef.current && obj !== fairingRightRef.current) {
          if (stackOpacity >= 0.999) {
            m.transparent = false
            m.opacity = 1
          } else {
            m.transparent = true
            m.opacity = stackOpacity
          }
        }
      }
    })

    // Descent engine plume (LM) — visible during lm_descent
    if (plumeRef.current) {
      const plumeH = 1 + s.throttle * 6
      plumeRef.current.scale.set(s.throttle * 0.8 + 0.05, plumeH, s.throttle * 0.8 + 0.05)
      const m = plumeRef.current.material as THREE.MeshBasicMaterial
      m.opacity = s.throttle * 0.8
    }
    if (plumeLightRef.current) {
      plumeLightRef.current.intensity = s.throttle * 15
    }
  })

  const whiteMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#eef1f4', metalness: 0.4, roughness: 0.5 }), [])
  const fairingMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#eef1f4', metalness: 0.4, roughness: 0.5, transparent: true, opacity: 1 }), [])
  const goldMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#c8a838', metalness: 0.7, roughness: 0.4 }), [])
  const darkMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a2d33', metalness: 0.5, roughness: 0.5 }), [])
  const lmBodyMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d4c89a', metalness: 0.3, roughness: 0.7 }), [])
  const foilMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#a8a090', metalness: 0.6, roughness: 0.4 }), [])

  return (
    <group ref={bodyRef}>
      {/* CSM (Command/Service Module) — the cone + cylinder at top */}
      <group position={[0, STAGE1_H / 2 + STAGE2_H + 3, 0]}>
        {/* Command Module (cone) */}
        <mesh castShadow material={whiteMat}>
          <coneGeometry args={[1.2, 2.5, 16]} />
        </mesh>
        {/* Service Module (cylinder) */}
        <mesh position={[0, -2.5, 0]} castShadow material={whiteMat}>
          <cylinderGeometry args={[1.4, 1.4, 4, 16]} />
        </mesh>
        {/* CSM engine bell (bottom) */}
        <mesh position={[0, -5, 0]} rotation={[Math.PI, 0, 0]} material={darkMat}>
          <coneGeometry args={[0.7, 1.2, 12, 1, true]} />
        </mesh>
        {/* Gold thermal blanket band on SM */}
        <mesh position={[0, -2.5, 0]} material={goldMat}>
          <cylinderGeometry args={[1.42, 1.42, 1.5, 16]} />
        </mesh>
      </group>

      {/* LM (Lunar Module) — stowed below the CSM, inside the fairing */}
      <group ref={lmRef} position={[0, STAGE1_H / 2 + STAGE2_H - 2, 0]}>
        {/* Ascent stage (cabin) — angular shape approximated with boxes */}
        <mesh position={[0, 1.5, 0]} castShadow material={lmBodyMat}>
          <boxGeometry args={[2.2, 1.6, 2.2]} />
        </mesh>
        {/* Front face of ascent stage (crew hatch area) */}
        <mesh position={[0, 1.5, 1.15]} material={goldMat}>
          <boxGeometry args={[1.5, 0.8, 0.1]} />
        </mesh>
        {/* RCS thruster quads (4 small clusters) */}
        {[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4
          return (
            <mesh key={i} position={[Math.cos(a) * 1.3, 2.4, Math.sin(a) * 1.3]} material={darkMat}>
              <boxGeometry args={[0.3, 0.3, 0.3]} />
            </mesh>
          )
        })}

        {/* Descent stage (octagonal base with 4 landing legs) */}
        <mesh position={[0, 0.2, 0]} castShadow material={lmBodyMat}>
          <cylinderGeometry args={[2.2, 2.4, 0.8, 8]} />
        </mesh>
        {/* Gold foil wrap on descent stage sides */}
        <mesh position={[0, 0.2, 0]} material={foilMat}>
          <cylinderGeometry args={[2.42, 2.5, 0.6, 8]} />
        </mesh>
        {/* Descent engine bell (bottom) */}
        <mesh position={[0, -0.8, 0]} rotation={[Math.PI, 0, 0]} material={darkMat}>
          <coneGeometry args={[0.6, 1.0, 12, 1, true]} />
        </mesh>
        {/* Descent engine plume (visible during lm_descent) */}
        <mesh ref={plumeRef} position={[0, -1.5, 0]}>
          <coneGeometry args={[0.5, 1, 12, 1, true]} />
          <meshBasicMaterial color="#ff9a3c" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
        </mesh>
        <pointLight ref={plumeLightRef} position={[0, -2, 0]} color="#ffae5a" intensity={0} distance={20} decay={2} />

        {/* 4 landing legs (splayed out, with footpads) */}
        {[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 8
          const lx = Math.cos(a), lz = Math.sin(a)
          return (
            <group key={i} rotation={[0, -a, 0]}>
              {/* Primary strut */}
              <mesh position={[2.4, -0.2, 0]} castShadow material={darkMat}>
                <cylinderGeometry args={[0.06, 0.06, 2.6, 6]} />
              </mesh>
              {/* Secondary (angled) strut */}
              <mesh position={[1.5, -0.5, 0]} rotation={[0, 0, Math.PI / 4]} material={darkMat}>
                <cylinderGeometry args={[0.05, 0.05, 1.6, 6]} />
              </mesh>
              {/* Footpad */}
              <mesh position={[3.4, -0.6, 0]} material={darkMat}>
                <cylinderGeometry args={[0.3, 0.3, 0.1, 8]} />
              </mesh>
            </group>
          )
        })}

        {/* LRV (Lunar Roving Vehicle) — stowed on the side of the LM */}
        {/* This is a simplified version of the rover that will deploy. */}
        <group position={[2.6, 0.2, 0]} rotation={[0, 0, Math.PI / 2]}>
          {/* Folded chassis */}
          <mesh material={whiteMat}>
            <boxGeometry args={[1.2, 0.3, 1.0]} />
          </mesh>
          {/* 4 wheels (folded flat against the chassis) */}
          {[[-0.5, 0.5], [-0.5, -0.5], [0.5, 0.5], [0.5, -0.5]].map(([x, z], i) => (
            <mesh key={i} position={[x, -0.2, z]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.25, 0.25, 0.08, 12]} />
              <meshStandardMaterial color="#2a2a28" roughness={0.85} />
            </mesh>
          ))}
        </group>
      </group>

      {/* Payload fairing halves (visible before + during opening) */}
      <mesh ref={fairingLeftRef} position={[-1, STAGE1_H / 2 + STAGE2_H + 3, 0]} material={fairingMat}>
        <sphereGeometry args={[1.6, 16, 16, 0, Math.PI, Math.PI / 2, 1]} />
      </mesh>
      <mesh ref={fairingRightRef} position={[1, STAGE1_H / 2 + STAGE2_H + 3, 0]} material={fairingMat}>
        <sphereGeometry args={[1.6, 16, 16, Math.PI, Math.PI, Math.PI / 2, 1]} />
      </mesh>
    </group>
  )
}

// ── Lunar surface patch (appears during descent + landing + rover_deploy) ─
// A small lunar terrain patch centered on the landing site. This is separate
// from the launch page's Earth ground plane (which is the launch pad
// concrete). The patch uses a simple height function + texture similar to
// the /play rover page, but only ~80m across (enough to see the LM land and
// the rover deploy).
function lunarTerrainHeight(x: number, z: number): number {
  let h = 0
  h += Math.sin(x * 0.05) * 0.3 + Math.cos(z * 0.06) * 0.25
  h += Math.sin(x * 0.12 + z * 0.08) * 0.15
  return h
}

function LunarSurface({ stateRef }: { stateRef: React.MutableRefObject<CinematicState> }) {
  const ref = useRef<THREE.Mesh>(null)
  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(120, 120, 40, 40)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, lunarTerrainHeight(pos.getX(i), pos.getZ(i)))
    }
    g.computeVertexNormals()
    return g
  }, [])

  const tex = useMemo(() => {
    if (typeof document === 'undefined') return null
    const W = 512, H = 512
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#9a958c'; ctx.fillRect(0, 0, W, H)
    let seed = 11
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 }
    for (let i = 0; i < 30; i++) {
      const x = rand() * W, y = rand() * H, r = 30 + rand() * 80
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, 'rgba(85,82,75,0.5)'); g.addColorStop(1, 'rgba(85,82,75,0)')
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    }
    for (let i = 0; i < 1500; i++) {
      ctx.fillStyle = `rgba(${rand() > 0.5 ? 130 : 80},${rand() > 0.5 ? 125 : 75},${rand() > 0.5 ? 120 : 70},0.08)`
      ctx.fillRect(rand() * W, rand() * H, 2, 2)
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3)
    return t
  }, [])

  useFrame(() => {
    const s = stateRef.current
    if (!ref.current) return
    // Fade in during lm_descent (when lmDescent > 0.3) so the surface appears
    // as the LM approaches. The patch is positioned at the landing site,
    // which is below the spacecraft's starting position.
    const visibility = THREE.MathUtils.clamp((s.lmDescent - 0.3) * 1.5, 0, 1)
    const m = ref.current.material as THREE.MeshStandardMaterial
    m.opacity = visibility
    ref.current.visible = visibility > 0.01
  })

  return (
    <mesh ref={ref} geometry={geom} position={[0, 0, 100]} receiveShadow>
      <meshStandardMaterial map={tex ?? undefined} color={tex ? '#ffffff' : '#9a958c'} roughness={0.95} transparent opacity={0} />
    </mesh>
  )
}

// ── Deployed rover (visible during rover_deploy + handoff) ────────────────
// A simplified LRV that animates unfolding from the LM and dropping to the
// surface. The deployment has three phases keyed to roverDeploy (0→1):
//   0.0–0.3: unfold — the rover rotates from stowed (90°) to horizontal
//   0.3–0.8: lower — the rover descends from the LM's side to the surface
//   0.8–1.0: settle — a subtle bounce as the wheels touch the ground
// After deployment (roverDeploy = 1) the rover sits on the surface next to
// the LM, ready for the player to take over. The actual player-controllable
// rover is in /play; this is a visual placeholder for the deployment.
function DeployedRover({ stateRef }: { stateRef: React.MutableRefObject<CinematicState> }) {
  const ref = useRef<THREE.Group>(null)

  useFrame(() => {
    const s = stateRef.current
    if (!ref.current) return
    const u = s.roverDeploy
    ref.current.visible = u > 0.01

    // Phase 1: unfold — the rover rotates from stowed (90°) to
    // horizontal, staying at the stowed height next to the LM.
    // Phase 2: lower — the rover descends from the LM's side
    // to the surface, moving slightly outward.
    // Phase 3: settle — a subtle bounce as wheels touch
    let rotZ: number, posY: number, posX: number
    const stowedY = 1.5 // stowed height (on the LM's side)
    const landedY = 0.45 // on the surface (wheel radius)
    const stowedX = 2.6 // stowed position (against the LM)
    const landedX = 5.5 // deployed position (clear of the LM)

    if (u < 0.3) {
      // Unfold: rotate from 90° to 0°, stay at stowed height/position
      const p = u / 0.3
      rotZ = THREE.MathUtils.lerp(Math.PI / 2, 0, p)
      posY = stowedY
      posX = stowedX
    } else if (u < 0.8) {
      // Lower: descend to the surface, move outward
      const p = (u - 0.3) / 0.5
      rotZ = 0
      posY = THREE.MathUtils.lerp(stowedY, landedY, p)
      posX = THREE.MathUtils.lerp(stowedX, landedX, p)
    } else {
      // Settle: subtle bounce
      const p = (u - 0.8) / 0.2
      rotZ = 0
      posY = landedY
      posX = landedX
      // Bounce: sin wave decaying over the settle phase
      posY += Math.sin(p * Math.PI * 3) * 0.08 * (1 - p)
    }

    ref.current.position.set(posX, posY, 100)
    ref.current.rotation.z = rotZ
  })

  if (typeof document === 'undefined') return null

  return (
    <group ref={ref} visible={false}>
      {/* Simplified rover chassis */}
      <mesh castShadow>
        <boxGeometry args={[1.6, 0.3, 1.2]} />
        <meshStandardMaterial color="#eef1f4" metalness={0.4} roughness={0.5} />
      </mesh>
      {/* 4 wheels */}
      {[[-0.6, 0.6], [-0.6, -0.6], [0.6, 0.6], [0.6, -0.6]].map(([x, z], i) => (
        <mesh key={i} position={[x, -0.25, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.25, 0.25, 0.1, 12]} />
          <meshStandardMaterial color="#2a2a28" roughness={0.85} />
        </mesh>
      ))}
      {/* Gold antenna dish */}
      <mesh position={[0, 0.5, 0]} rotation={[Math.PI / 4, 0, 0]}>
        <coneGeometry args={[0.25, 0.15, 16, 1, true]} />
        <meshStandardMaterial color="#c8a838" metalness={0.8} roughness={0.3} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

// ── Lights ─────────────────────────────────────────────────────────────────
function StageLights() {
  return (
    <>
      <ambientLight intensity={0.3} />
      <directionalLight position={[40, 80, 30]} intensity={1.2} color="#c0d0e8" castShadow shadow-mapSize={[1024, 1024]} shadow-camera-far={300} shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={60} shadow-camera-bottom={-10} shadow-bias={-0.001} />
      <pointLight position={[0, 18, 8]} intensity={40} color="#ffe0b0" distance={80} decay={2} />
      <pointLight position={[0, 18, -8]} intensity={40} color="#ffe0b0" distance={80} decay={2} />
    </>
  )
}

// ── Camera controller — choreographed per stage ────────────────────────────
function CinematicCamera({ stateRef }: { stateRef: React.MutableRefObject<CinematicState> }) {
  const { camera } = useThree()
  const curPos = useRef(new THREE.Vector3(40, 25, 40))
  const curLook = useRef(new THREE.Vector3(0, 20, 0))

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const s = stateRef.current
    const kind = STAGES[s.stageIdx].kind
    const t = s.phaseTime

    const desiredPos = new THREE.Vector3()
    const desiredLook = new THREE.Vector3()
    const rocketWorldY = ROCKET_REST_Y + s.rocketY

    switch (kind) {
      case 'idle': {
        const a = (s.globalTime * 0.15) % (Math.PI * 2)
        desiredPos.set(Math.cos(a) * 35, 18, Math.sin(a) * 35)
        desiredLook.set(0, ROCKET_REST_Y + ROCKET_TOTAL_H * 0.45, 0)
        break
      }
      case 'countdown': {
        const u = t / STAGES[s.stageIdx].duration
        const a = Math.PI * 0.25 + u * 0.3
        desiredPos.set(Math.cos(a) * 18, 12 + u * 6, Math.sin(a) * 18)
        desiredLook.set(0, ROCKET_REST_Y + ROCKET_TOTAL_H * 0.4, 0)
        break
      }
      case 'ignition': {
        desiredPos.set(8, 1.5, 12)
        desiredLook.set(0, ROCKET_REST_Y - 2, 0)
        break
      }
      case 'liftoff': {
        const u = t / STAGES[s.stageIdx].duration
        desiredPos.set(25, 4 + u * 3, 25)
        desiredLook.set(0, Math.min(rocketWorldY + 5, 30), 0)
        break
      }
      case 'ascent': {
        const u = t / STAGES[s.stageIdx].duration
        desiredPos.set(20 - u * 5, 8 + u * 10, 25 - u * 5)
        desiredLook.set(0, rocketWorldY * 0.6, 0)
        break
      }
      case 'max_q': {
        const shake = (Math.random() - 0.5) * s.shake * 4
        desiredPos.set(15 + shake, 40, 18 + shake)
        desiredLook.set(0, rocketWorldY - 5, 0)
        break
      }
      case 'staging': {
        const u = t / STAGES[s.stageIdx].duration
        desiredPos.set(20 + u * 5, 60 + u * 10, 22 + u * 4)
        desiredLook.set(0, rocketWorldY - 8, 0)
        break
      }
      case 'space_transition': {
        const u = t / STAGES[s.stageIdx].duration
        desiredPos.set(28 + u * 8, 100 + u * 30, 30 + u * 8)
        desiredLook.set(0, rocketWorldY, 0)
        break
      }
      case 'tli': {
        // Close-up on the upper stage as it reignites for TLI
        const u = t / STAGES[s.stageIdx].duration
        desiredPos.set(20, rocketWorldY + 5, 35)
        desiredLook.set(0, rocketWorldY, 0)
        break
      }
      case 'translunar_coast': {
        // Slowly pull back; the Moon grows ahead. Camera drifts around the
        // spacecraft for a sense of motion through the void.
        const u = t / STAGES[s.stageIdx].duration
        const a = u * Math.PI * 0.5 // 90° arc
        desiredPos.set(Math.cos(a) * 30, rocketWorldY + 3, Math.sin(a) * 30 + 20)
        desiredLook.set(0, rocketWorldY, 60) // look toward the Moon (+Z)
        break
      }
      case 'loi': {
        // View from behind the CSM as it fires its engine for capture.
        // The camera follows the spacecraft as it drops from translunar
        // altitude to low lunar orbit.
        const u = t / STAGES[s.stageIdx].duration
        desiredPos.set(0, rocketWorldY + 2, -20)
        desiredLook.set(0, rocketWorldY, 60)
        break
      }
      case 'lunar_orbit': {
        // Camera follows the CSM as it orbits the Moon at low altitude
        // (body Y ≈ 50, CSM world Y ≈ 80). The Moon surface is at Y ≈ 0
        // (80m below). The camera orbits close to the CSM and looks at it,
        // with the Moon's curved horizon visible in the lower periphery.
        const a = s.csmOrbit
        const orbitR = 8
        const csmY = ROCKET_REST_Y + s.rocketY + 30
        desiredPos.set(Math.cos(a) * orbitR, csmY, Math.sin(a) * orbitR)
        // Look at the CSM directly; the Moon surface is far below and
        // appears as a curved horizon at the bottom of the frame.
        desiredLook.set(0, csmY, 0)
        break
      }
      case 'lm_separation': {
        // Close-up on the LM as it backs away from the CSM. The LM is at
        // body-local Y ≈ 15 (stowed) backing away to Y ≈ 7. The camera looks
        // at the LM's position between the CSM (above) and the surface (below).
        const u = t / STAGES[s.stageIdx].duration
        const lmLocalY = THREE.MathUtils.lerp(15, 7, u) // LM local Y during separation
        desiredPos.set(10, rocketWorldY + lmLocalY - 3, 18)
        desiredLook.set(0, rocketWorldY + lmLocalY, 5)
        break
      }
      case 'lm_descent': {
        // Camera tracks the LM as it descends. The LM is at body-local
        // (0, lerp(15, -0.9, lmDescent), sep*4). The body is at
        // (0, ROCKET_REST_Y + rocketY, lerp(0,100,lmDescent)).
        // We compute the LM world position and have the camera follow it.
        const u = t / STAGES[s.stageIdx].duration
        const lmLocalY = THREE.MathUtils.lerp(15, -0.9, s.lmDescent)
        const lmWorldY = ROCKET_REST_Y + s.rocketY + lmLocalY
        const lmWorldZ = THREE.MathUtils.lerp(0, 100, s.lmDescent) + 4 // sep*4
        // Camera follows at a fixed offset from the LM, looking at the LM
        desiredPos.set(lmWorldZ + 10, lmWorldY * 0.5 + 5, lmWorldZ - 6)
        desiredLook.set(0, lmWorldY, lmWorldZ)
        break
      }
      case 'landing': {
        // Close-up on the LM as it touches down at the landing site (Z≈104).
        // The LM descent stage base is at world Y≈0 and the ascent stage top
        // at world Y≈2.5. Camera looks at the LM from the side at eye level.
        const u = t / STAGES[s.stageIdx].duration
        desiredPos.set(112, 3 + (1 - u) * 2, 104)
        desiredLook.set(0, 1, 104)
        break
      }
      case 'rover_deploy': {
        // Camera circles the landed LM as the rover deploys. The LM is at
        // the landing site (0, 0.6, 104). The rover deploys from the LM's
        // side and drops to (5, 0.45, 100).
        const u = t / STAGES[s.stageIdx].duration
        const a = u * Math.PI * 0.6
        desiredPos.set(Math.cos(a) * 12 + 3, 3, Math.sin(a) * 12 + 102)
        desiredLook.set(2, 1, 102)
        break
      }
      case 'handoff': {
        // Settle the camera behind the deployed rover, ready for the
        // handoff to /play. The rover is deployed to (5, 0.45, 100).
        desiredPos.set(2, 2.5, 94)
        desiredLook.set(5, 1, 100)
        break
      }
    }

    // Apply camera shake
    if (s.shake > 0.01) {
      const sx = (Math.random() - 0.5) * s.shake * 2
      const sy = (Math.random() - 0.5) * s.shake * 2
      desiredPos.x += sx
      desiredPos.y += sy
    }

    const lerp = kind === 'idle' || kind === 'complete' || kind === 'handoff' ? 0.04 : 0.08
    curPos.current.lerp(desiredPos, 1 - Math.pow(1 - lerp, dt * 60))
    curLook.current.lerp(desiredLook, 1 - Math.pow(1 - lerp, dt * 60))
    camera.position.copy(curPos.current)
    camera.lookAt(curLook.current)
  })

  return null
}

// ── Fog controller (fade out as we leave atmosphere) ────────────────────────
function AtmosphereFog({ stateRef }: { stateRef: React.MutableRefObject<CinematicState> }) {
  const fogRef = useRef<THREE.FogExp2>(null)
  const { scene } = useThree()
  useEffect(() => {
    const fog = new THREE.FogExp2('#5a7fa8', 0.0015)
    scene.fog = fog
    fogRef.current = fog
    return () => { scene.fog = null }
  }, [scene])
  useFrame(() => {
    if (!fogRef.current) return
    const s = stateRef.current
    fogRef.current.density = 0.002 * (1 - s.skyBlend)
    const col = new THREE.Color('#5a7fa8').lerp(new THREE.Color('#000000'), s.skyBlend)
    fogRef.current.color.copy(col)
  })
  return null
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function LaunchPage() {
  const stateRef = useRef<CinematicState>(makeInitialState())
  const pausedRef = useRef(false)
  const router = useRouter()
  const [stageIdx, setStageIdx] = useState(0)
  const [phaseTime, setPhaseTime] = useState(0)
  const [rocketY, setRocketY] = useState(0)
  const [paused, setPaused] = useState(false)
  const [handoffCountdown, setHandoffCountdown] = useState(5)
  const [autoNavEnabled, setAutoNavEnabled] = useState(true)
  const [fadeOpacity, setFadeOpacity] = useState(0) // 0 = no fade, 1 = fully black

  useEffect(() => {
    const id = setInterval(() => {
      setStageIdx(stateRef.current.stageIdx)
      setPhaseTime(stateRef.current.phaseTime)
      setRocketY(stateRef.current.rocketY)
    }, 100)
    return () => clearInterval(id)
  }, [])

  // Auto-navigate to /play 5 seconds after entering the handoff stage.
  // The user can disable this by interacting with the overlay controls.
  // A fade-to-black transition (1s) smooths the visual discontinuity
  // between the cinematic's simplified lunar scene and the /play rover
  // scene (which has a different terrain, camera, and lighting).
  const inHandoff = STAGES[stageIdx]?.kind === 'handoff'
  useEffect(() => {
    if (!inHandoff || !autoNavEnabled) return
    // Count down from 5 to 0. At T=1s, start the fade-to-black. At T=0,
    // navigate. The fade covers the last 1s so the scene change is not
    // an abrupt cut.
    let remaining = 5
    const id = setInterval(() => {
      remaining -= 1
      if (remaining <= 1) setFadeOpacity(1) // begin fade in the final second
      if (remaining <= 0) {
        clearInterval(id)
        router.push('/play')
      } else {
        setHandoffCountdown(remaining)
      }
    }, 1000)
    return () => clearInterval(id)
  }, [inHandoff, autoNavEnabled, router])

  function skip() {
    const s = stateRef.current
    if (s.stageIdx < STAGES.length - 1) {
      s.stageIdx += 1
      s.phaseTime = 0
      setStageIdx(s.stageIdx)
      setPhaseTime(0)
    }
  }

  function replay() {
    stateRef.current = makeInitialState()
    setStageIdx(0)
    setPhaseTime(0)
    setRocketY(0)
    setPaused(false)
    pausedRef.current = false
    setAutoNavEnabled(true)
    setHandoffCountdown(5)
    setFadeOpacity(0)
  }

  function togglePause() {
    pausedRef.current = !pausedRef.current
    setPaused(pausedRef.current)
  }

  function driveNow() {
    // Fade out, then navigate. The fade covers the visual discontinuity
    // between the cinematic and the /play rover scene.
    setFadeOpacity(1)
    setTimeout(() => router.push('/play'), 600)
  }

  function cancelAutoNav() {
    setAutoNavEnabled(false)
    setFadeOpacity(0) // cancel any in-progress fade
  }

  const stage = STAGES[stageIdx]
  const clock = missionClock(stageIdx, phaseTime)
  const clockLabel = (clock < 0 ? 'T−' : 'T+') + Math.abs(clock).toFixed(1).padStart(4, '0') + 's'

  return (
    <main style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden', fontFamily: "'JetBrains Mono', 'Geist Mono', monospace" }}>
      <Canvas camera={{ position: [40, 25, 40], fov: 55, near: 0.1, far: 3000 }} dpr={[1, 1.5]} shadows>
        <color attach="background" args={['#000']} />
        <Starfield />
        <StageLights />
        <SkyDome stateRef={stateRef} />
        <EarthLimb stateRef={stateRef} />
        <DistantEarth stateRef={stateRef} />
        <Moon stateRef={stateRef} />
        <LaunchPad stateRef={stateRef} />
        <RocketModel stateRef={stateRef} />
        <CsmLmStack stateRef={stateRef} />
        <LunarSurface stateRef={stateRef} />
        <DeployedRover stateRef={stateRef} />
        <SmokeSystem stateRef={stateRef} />
        <Timeline stateRef={stateRef} pausedRef={pausedRef} />
        <CinematicCamera stateRef={stateRef} />
      </Canvas>

      {/* Top-left telemetry */}
      <div style={{ position: 'absolute', top: 14, left: 16, color: '#9fb3d0', fontSize: 11, letterSpacing: 1.5, textShadow: '0 0 6px rgba(0,0,0,0.8)', zIndex: 10, pointerEvents: 'none' }}>
        <div style={{ opacity: 0.6, fontSize: 9, letterSpacing: 2 }}>PHASE</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#eaf0ff', margin: '2px 0 4px' }}>{stage.kind.toUpperCase().replace(/_/g, ' ')}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#c8a838' }}>{clockLabel}</span>
        </div>
        <div style={{ marginTop: 4, fontSize: 10, opacity: 0.7, maxWidth: 240 }}>{stage.status}</div>
      </div>

      {/* Top-right altitude + progress dots */}
      <div style={{ position: 'absolute', top: 14, right: 16, color: '#9fb3d0', fontSize: 11, letterSpacing: 1.5, textShadow: '0 0 6px rgba(0,0,0,0.8)', zIndex: 10, textAlign: 'right', pointerEvents: 'none' }}>
        <div style={{ opacity: 0.6, fontSize: 9, letterSpacing: 2 }}>ALTITUDE</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#eaf0ff', margin: '2px 0 6px' }}>{rocketY.toFixed(0)} m</div>
        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
          {STAGES.map((s, i) => (
            <div key={i} style={{
              width: 8, height: 8, borderRadius: '50%',
              background: i < stageIdx ? '#c8a838' : i === stageIdx ? '#37c6ff' : 'rgba(255,255,255,0.18)',
              boxShadow: i === stageIdx ? '0 0 8px #37c6ff' : 'none',
              transition: 'background 0.3s',
            }} />
          ))}
        </div>
      </div>

      {/* Back-to-landing link */}
      <a href="/" style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', color: '#9fb3d0', textDecoration: 'none', padding: '4px 10px', border: '1px solid rgba(159,179,208,0.3)', borderRadius: 999, fontSize: 10, letterSpacing: 1.5, opacity: 0.7, zIndex: 10 }}>← LANDING</a>

      {/* Bottom controls */}
      <div style={{ position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 10, zIndex: 10 }}>
        <CtrlButton label={paused ? 'RESUME' : 'PAUSE'} onClick={togglePause} accent="#9fb3d0" />
        <CtrlButton label="SKIP STAGE" onClick={skip} accent="#c8a838" disabled={stageIdx >= STAGES.length - 1} />
        <CtrlButton label="REPLAY" onClick={replay} accent="#37c6ff" />
        <CtrlButton label="BACK" href="/" accent="#9fb3d0" />
      </div>

      {/* "Handoff" overlay once the rover is deployed — auto-navigates to /play */}
      {stage.kind === 'handoff' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', background: 'rgba(2,3,10,0.55)', backdropFilter: 'blur(2px)', zIndex: 20, pointerEvents: 'auto' }}>
          <div style={{ color: '#c8a838', fontSize: 11, letterSpacing: 4, opacity: 0.85 }}>LUNAR ROVER DEPLOYED</div>
          <h2 style={{ margin: '10px 0 6px', color: '#eaf0ff', fontSize: 28, fontWeight: 700, letterSpacing: 2 }}>Ready to drive</h2>
          <div style={{ color: '#9fb3d0', fontSize: 12, letterSpacing: 1.5, marginBottom: 16, opacity: 0.85 }}>
            {autoNavEnabled
              ? `Handing off to the LRV chapter in ${handoffCountdown}s …`
              : 'Take control of the Lunar Roving Vehicle.'}
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <CtrlButton label="DRIVE NOW →" onClick={driveNow} accent="#37c6ff" />
            {autoNavEnabled && <CtrlButton label="WAIT" onClick={cancelAutoNav} accent="#9fb3d0" />}
            <CtrlButton label="REPLAY" onClick={replay} accent="#c8a838" />
            <CtrlButton label="BACK TO LANDING" href="/" accent="#9fb3d0" />
          </div>
        </div>
      )}

      {/* Bottom helper text */}
      <div style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', color: '#5d6b86', fontSize: 9, letterSpacing: 1.5, textAlign: 'center', zIndex: 10, pointerEvents: 'none' }}>
        Fully automated cinematic · use SKIP / REPLAY controls
      </div>

      {/* Fade-to-black transition overlay. Covers the visual discontinuity
          between the cinematic's lunar scene and the /play rover scene
          (different terrain, camera, lighting, and rover model). The fade
          starts 1s before navigation (auto-nav) or immediately (DRIVE NOW). */}
      <div style={{
        position: 'absolute', inset: 0, background: '#000', zIndex: 30,
        opacity: fadeOpacity, transition: 'opacity 0.6s ease', pointerEvents: 'none',
      }} />
    </main>
  )
}

function CtrlButton({ label, onClick, href, accent, disabled }: {
  label: string; onClick?: () => void; href?: string; accent: string; disabled?: boolean
}) {
  const [hover, setHover] = useState(false)
  const base: React.CSSProperties = {
    padding: '10px 18px', borderRadius: 10, minWidth: 100,
    border: `1.5px solid ${hover && !disabled ? accent : 'rgba(255,255,255,0.16)'}`,
    background: hover && !disabled ? `radial-gradient(circle at 50% 30%, ${accent}22, rgba(10,12,20,0.85))` : 'rgba(10,12,20,0.62)',
    color: disabled ? '#5d6b86' : (hover ? '#fff' : accent),
    fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 11, letterSpacing: 1.5,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    backdropFilter: 'blur(6px)',
    boxShadow: hover && !disabled ? `0 0 18px ${accent}44` : '0 2px 8px rgba(0,0,0,0.4)',
    transition: 'transform 0.06s ease, box-shadow 0.12s ease, border-color 0.12s ease',
    transform: hover && !disabled ? 'translateY(-1px)' : 'translateY(0)',
    textDecoration: 'none',
  }
  if (href) {
    return (
      <a href={href} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} style={base}>
        {label}
      </a>
    )
  }
  return (
    <button onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} onClick={onClick} disabled={disabled} style={base}>
      {label}
    </button>
  )
}
