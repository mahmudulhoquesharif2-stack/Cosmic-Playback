'use client'

import { useEffect, useRef, useState } from 'react'

/* ========================================================================== *
 * The Cosmic Playback — Landing page
 * --------------------------------------------------------------------------
 * A dark, cinematic deep-space BACKGROUND (canvas starfield + drifting
 * asteroids + rare supernovae + mouse-reactive parallax). Above it sit the
 * Cosmic Playback branding + two functional buttons:
 *   PLAY    → /play    (the Moon rover experience)
 *   EXPLORE → /explore (the 3D Solar System)
 *
 * The background is purely a visual layer (pointerEvents:none). The UI stays
 * fixed; only the stars react to the mouse.
 * ========================================================================== */

type Star = { x: number; y: number; z: number; r: number; base: number; tw: number; phase: number }
type Meteor = { x: number; y: number; vx: number; vy: number; life: number; max: number; len: number }
type Asteroid = {
  x: number; y: number; vx: number; vy: number
  r: number; rot: number; rotSpeed: number
  verts: number[]; shade: string; bright: number
}
type Supernova = { x: number; y: number; age: number; maxR: number; dur: number; hue: string }

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let w = 0, h = 0, dpr = 1
    let stars: Star[] = []
    let meteors: Meteor[] = []
    let asteroids: Asteroid[] = []
    let supernovas: Supernova[] = []
    let nextMeteor = 0
    let nextSupernova = 0
    let raf = 0

    // Mouse parallax (ONLY the background stars move; UI stays fixed). On
    // touch devices we never set targetMouse, so ambient animation continues.
    const targetMouse = { x: 0, y: 0 }
    const curMouse = { x: 0, y: 0 }
    const onMouseMove = (e: MouseEvent) => {
      targetMouse.x = (e.clientX / window.innerWidth) * 2 - 1
      targetMouse.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    const onMouseLeave = () => { targetMouse.x = 0; targetMouse.y = 0 }
    window.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseleave', onMouseLeave)

    function makeAsteroidVerts(n: number, jitter: number): number[] {
      const v: number[] = []
      for (let i = 0; i < n; i++) v.push(1 - jitter + Math.random() * jitter * 2, (i / n) * Math.PI * 2)
      return v
    }

    function fit() {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = window.innerWidth; h = window.innerHeight
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr)
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px'
      // dense starfield across 3 parallax layers
      const count = Math.min(1400, Math.floor((w * h) / 1600))
      const pickR = (z: number) => 0.3 + z * z * 2.2
      stars = Array.from({ length: count }, () => {
        const z = Math.random()
        const cx = w * 0.5, cy = h * 0.5
        let x = Math.random() * w, y = Math.random() * h
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
        const maxDist = Math.sqrt(cx * cx + cy * cy)
        if (dist < maxDist * 0.14) {
          const ang = Math.atan2(y - cy, x - cx)
          const nd = maxDist * (0.18 + Math.random() * 0.28)
          x = cx + Math.cos(ang) * nd; y = cy + Math.sin(ang) * nd
        }
        return { x, y, z, r: pickR(z), base: 0.18 + Math.random() * 0.42, tw: 0.2 + Math.random() * 0.6, phase: Math.random() * Math.PI * 2 }
      })
      // a small belt of drifting asteroids, away from center
      asteroids = []
      const shades = ['#6b6258', '#7a7066', '#5a534b', '#8a7d6e', '#605750']
      for (let i = 0; i < 7; i++) {
        const ang = Math.random() * Math.PI * 2
        const ringR = Math.min(w, h) * (0.32 + Math.random() * 0.28)
        const x = w * 0.5 + Math.cos(ang) * ringR, y = h * 0.5 + Math.sin(ang) * ringR
        const vang = Math.atan2(y - h * 0.5, x - w * 0.5) + Math.PI / 2
        const sp = 0.05 + Math.random() * 0.08
        asteroids.push({
          x, y, vx: Math.cos(vang) * sp + (Math.random() - 0.5) * 0.04, vy: Math.sin(vang) * sp + (Math.random() - 0.5) * 0.04,
          r: 4 + Math.random() * 6, rot: Math.random() * Math.PI * 2, rotSpeed: (Math.random() - 0.5) * 0.006,
          verts: makeAsteroidVerts(8 + Math.floor(Math.random() * 4), 0.28),
          shade: shades[Math.floor(Math.random() * shades.length)], bright: 0.5 + Math.random() * 0.3,
        })
      }
      nextSupernova = 60 * 8
    }
    fit()
    window.addEventListener('resize', fit)

    let t = 0
    function frame() {
      t += 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#070b12'; ctx.fillRect(0, 0, w, h)

      // faint cool nebula washes for depth
      const neb = ctx.createRadialGradient(w * 0.22, h * 0.74, 0, w * 0.22, h * 0.74, Math.max(w, h) * 0.5)
      neb.addColorStop(0, 'rgba(40, 70, 120, 0.14)'); neb.addColorStop(0.4, 'rgba(30, 50, 90, 0.06)'); neb.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = neb; ctx.fillRect(0, 0, w, h)
      const neb2 = ctx.createRadialGradient(w * 0.16, h * 0.18, 0, w * 0.16, h * 0.18, Math.max(w, h) * 0.4)
      neb2.addColorStop(0, 'rgba(30, 80, 90, 0.10)'); neb2.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = neb2; ctx.fillRect(0, 0, w, h)

      // stars — smooth mouse parallax (near stars move more), twinkle + drift
      curMouse.x += (targetMouse.x - curMouse.x) * 0.05
      curMouse.y += (targetMouse.y - curMouse.y) * 0.05
      const maxPX = Math.min(w, h) * 0.03
      const drift = t * 0.012
      for (const s of stars) {
        const tw = 0.5 + 0.5 * Math.sin(t * 0.0008 * s.tw + s.phase)
        const a = Math.max(0.08, Math.min(0.85, s.base * (0.6 + 0.4 * tw)))
        const par = 0.15 + s.z * 0.85
        let sx = s.x + drift * (0.2 + s.z * 0.8) + curMouse.x * maxPX * par
        const sy = s.y + curMouse.y * maxPX * par
        sx = ((sx % w) + w) % w
        ctx.globalAlpha = a
        ctx.fillStyle = s.z > 0.7 ? '#eaf0ff' : s.z > 0.4 ? '#d4ddf2' : '#c2cce0'
        ctx.beginPath(); ctx.arc(sx, sy, s.r, 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1

      // drifting asteroids
      for (const a of asteroids) {
        a.x += a.vx; a.y += a.vy; a.rot += a.rotSpeed
        if (a.x < -a.r * 2) a.x = w + a.r * 2; else if (a.x > w + a.r * 2) a.x = -a.r * 2
        if (a.y < -a.r * 2) a.y = h + a.r * 2; else if (a.y > h + a.r * 2) a.y = -a.r * 2
        ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.rot); ctx.beginPath()
        for (let i = 0; i < a.verts.length; i += 2) {
          const rad = a.verts[i] * a.r, ang = a.verts[i + 1]
          const px = Math.cos(ang) * rad, py = Math.sin(ang) * rad
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
        }
        ctx.closePath()
        ctx.fillStyle = a.shade; ctx.globalAlpha = a.bright; ctx.fill()
        ctx.strokeStyle = 'rgba(200,190,170,0.25)'; ctx.lineWidth = 0.8; ctx.stroke()
        ctx.globalAlpha = 1; ctx.restore()
      }

      // shooting stars (frequent)
      nextMeteor -= 1
      if (nextMeteor <= 0) {
        nextMeteor = 60 * (1.4 + Math.random() * 2.2)
        const ang = Math.PI * (0.15 + Math.random() * 0.2)
        const sp = 1.6 + Math.random() * 1.4
        meteors.push({ x: Math.random() * w * 0.7, y: Math.random() * h * 0.4, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1, max: 60 + Math.random() * 30, len: 40 + Math.random() * 50 })
      }
      meteors = meteors.filter((m) => m.life > 0)
      for (const m of meteors) {
        m.x += m.vx; m.y += m.vy; m.life -= 1 / m.max
        const a = Math.max(0, Math.min(1, m.life)) * 0.9
        const tx = m.x - m.vx * (m.len / Math.hypot(m.vx, m.vy)), ty = m.y - m.vy * (m.len / Math.hypot(m.vx, m.vy))
        const g = ctx.createLinearGradient(m.x, m.y, tx, ty)
        g.addColorStop(0, `rgba(220,235,255,${a})`); g.addColorStop(1, 'rgba(220,235,255,0)')
        ctx.strokeStyle = g; ctx.lineWidth = 1.4
        ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(tx, ty); ctx.stroke()
        ctx.globalAlpha = a; ctx.fillStyle = '#eaf0ff'
        ctx.beginPath(); ctx.arc(m.x, m.y, 1.2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1
      }

      // supernovae (rare bright explosions, off-center)
      nextSupernova -= 1
      if (nextSupernova <= 0) {
        nextSupernova = 60 * (15 + Math.random() * 10)
        const side = Math.random()
        let x: number, y: number
        if (side < 0.5) { x = w * (0.1 + Math.random() * 0.3); y = h * (0.08 + Math.random() * 0.22) }
        else { x = w * (0.62 + Math.random() * 0.28); y = h * (0.66 + Math.random() * 0.22) }
        const hues = ['#fff0c8', '#cfe0ff', '#ffd8b0']
        supernovas.push({ x, y, age: 0, maxR: Math.min(w, h) * (0.18 + Math.random() * 0.12), dur: 130 + Math.random() * 50, hue: hues[Math.floor(Math.random() * hues.length)] })
      }
      supernovas = supernovas.filter((s) => s.age < 1)
      for (const s of supernovas) {
        s.age += 1 / s.dur
        const p = s.age
        const coreA = Math.max(0, 1 - p) * 0.9
        const coreR = 6 + p * 26
        const core = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, coreR)
        core.addColorStop(0, `rgba(255,255,255,${coreA})`); core.addColorStop(0.4, `${s.hue}40`); core.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = core; ctx.beginPath(); ctx.arc(s.x, s.y, coreR, 0, Math.PI * 2); ctx.fill()
        const ringR = p * s.maxR, ringA = Math.max(0, (1 - p) * 0.6)
        ctx.strokeStyle = s.hue; ctx.globalAlpha = ringA; ctx.lineWidth = 2.2 * (1 - p) + 0.4
        ctx.beginPath(); ctx.arc(s.x, s.y, ringR, 0, Math.PI * 2); ctx.stroke()
        ctx.globalAlpha = ringA * 0.5; ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(s.x, s.y, ringR * 0.78, 0, Math.PI * 2); ctx.stroke()
        ctx.globalAlpha = 1
      }

      // vignette
      const vg = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.18, w * 0.5, h * 0.5, Math.max(w, h) * 0.75)
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)')
      ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h)

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf); window.removeEventListener('resize', fit)
      window.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [])

  return (
    <main style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#080c14', fontFamily: "'JetBrains Mono', 'Geist Mono', monospace" }}>
      <canvas ref={canvasRef} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />

      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24, pointerEvents: 'none' }}>
        {/* ringed-planet logo (our own, not the Z logo) */}
        <div style={{ width: 54, height: 54, marginBottom: 24, opacity: 0.92, pointerEvents: 'auto' }}>
          <svg viewBox="0 0 60 60" width="54" height="54" aria-hidden="true">
            <circle cx="30" cy="30" r="12" fill="none" stroke="#cfe0ff" strokeWidth="1.5" />
            <ellipse cx="30" cy="30" rx="26" ry="6" fill="none" stroke="#cfe0ff" strokeWidth="1.2" transform="rotate(-18 30 30)" />
          </svg>
        </div>

        <h1 style={{ margin: 0, color: '#eaf0ff', fontSize: 'clamp(34px, 7vw, 76px)', fontWeight: 700, letterSpacing: 'clamp(2px, 0.6vw, 8px)', lineHeight: 1.05, textShadow: '0 0 30px rgba(90,120,200,0.45), 0 0 8px rgba(180,200,255,0.6)' }}>
          COSMIC<br/>PLAYBACK
        </h1>

        <div style={{ display: 'flex', gap: 18, marginTop: 44, flexWrap: 'wrap', justifyContent: 'center', pointerEvents: 'auto' }}>
          <BigButton href="/launch" label="LAUNCH" accent="#c8a838" />
          <BigButton href="/play" label="PLAY" accent="#37c6ff" />
          <BigButton href="/explore" label="EXPLORE" accent="#ff8a2b" />
        </div>
      </div>

      <div style={{ position: 'absolute', bottom: 14, left: 0, right: 0, textAlign: 'center', color: '#5d6b86', fontSize: 10.5, letterSpacing: 2, textShadow: '0 0 6px rgba(0,0,0,0.7)' }}>
        built for the NASA International Space Apps Challenge · Apache-2.0
      </div>
    </main>
  )
}

function BigButton({ href, label, accent }: { href: string; label: string; accent: string }) {
  const [hover, setHover] = useState(false)
  return (
    <a
      href={href}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
        padding: '18px 38px', borderRadius: 14, minWidth: 210,
        border: `1.5px solid ${hover ? accent : 'rgba(255,255,255,0.18)'}`,
        background: hover ? `radial-gradient(circle at 50% 20%, ${accent}22, rgba(6,8,18,0.86))` : 'rgba(8,12,24,0.66)',
        color: hover ? '#fff' : accent, textDecoration: 'none',
        fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 18, letterSpacing: 4,
        backdropFilter: 'blur(8px)',
        boxShadow: hover ? `0 0 30px ${accent}55, inset 0 0 18px ${accent}22` : '0 4px 18px rgba(0,0,0,0.5)',
        transform: hover ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'transform 0.15s ease, box-shadow 0.2s ease, border-color 0.2s ease, color 0.2s ease',
        overflow: 'hidden',
      }}
    >
      <span style={{ lineHeight: 1 }}>{label}</span>
      <span style={{ position: 'absolute', left: '50%', bottom: 6, transform: 'translateX(-50%)', width: hover ? '70%' : '0%', height: 2, borderRadius: 2, background: accent, opacity: hover ? 0.9 : 0, transition: 'width 0.2s ease, opacity 0.2s ease', boxShadow: `0 0 8px ${accent}` }} />
    </a>
  )
}
