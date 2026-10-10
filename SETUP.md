# The Cosmic Playback — Setup

A game-like storytelling experience about real retired space explorers —
rovers, landers, and probes. Built with Next.js 16, React 19, TypeScript,
React Three Fiber, and three.js.

## Quick start

```bash
# Install dependencies
bun install        # or: npm install

# Start the dev server (port 3000)
bun run dev        # or: npm run dev
```

Then open http://localhost:3000 in your browser.

## What's included

- `/` — Landing page (cinematic starfield + LAUNCH / PLAY / EXPLORE buttons)
- `/launch` — Fully automated rocket launch + lunar arrival + rover deployment cinematic
- `/play` — Drive the Apollo Lunar Roving Vehicle on the Moon (keyboard + mobile)
- `/explore` — 3D solar system with real mission landing-site markers

## Requirements

- Node.js ≥ 20.19 (or Bun)
- A modern browser with WebGL support

## Database (optional)

The game routes do not use the database. The Prisma schema (`prisma/schema.prisma`)
defines `User` and `Post` models from the project template — they are scaffold,
not used by the game.

If you want Prisma to work anyway:
1. Copy `.env.example` to `.env`
2. Run `bun run db:push`

## Performance notes

The 3D scenes are tuned for low-powered devices:
- Shadow map: 1024²
- Terrain: 100×100 segments (re-displaced only when the rover crosses a 10 m snap cell)
- Particles: capped at 60 (dust) + 40 (tracks)
- Rocks: 40 (shared material, fixed world positions)

## Architecture

All 3D models (rover, rocket, CSM/LM, planets, Moon) are procedurally generated
with three.js primitives — no external 3D model files. Textures are generated
at runtime with CanvasTexture. Mission site photos are bundled locally in
`public/missions/`.

## License

Apache-2.0 (see `upload/LICENSE`)
