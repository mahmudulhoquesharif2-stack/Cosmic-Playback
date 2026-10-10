// src/data/sites.ts
// ============================================================================
// Real mission landing sites for the Moon and Mars, with storytelling-style
// info for the Explore sidebar/popup. Facts sourced from NASA/JPL/CNSA.
// Coordinates are approximate real landing-site lat/lon (planetographic).
// ============================================================================

export type Body = 'moon' | 'mars'

export type Site = {
  id: string
  body: Body
  name: string
  agency: string
  lat: number
  lon: number
  year: number
  status: string
  story: string[]
  realData: string
  sources: string[]
  image?: string
  imageCredit?: string
  storyDescription?: string
}

export const SITES: Site[] = [
  // ── Moon ──────────────────────────────────────────────────────────────
  {
    id: 'apollo11', body: 'moon', name: 'Apollo 11', agency: 'NASA',
    lat: 0.674, lon: 23.473, year: 1969, status: 'Landed 1969',
    story: [
      'I am Apollo 11. On a July night in 1969, I carried the first humans to set foot on another world.',
      'Neil Armstrong and Buzz Aldrin stepped onto the dust of the Sea of Tranquility while Michael Collins kept watch from orbit above.',
      'I left behind a plaque: "We came in peace for all mankind." And a small mirror, still there, that lasers bounce off to this day.',
      'I stayed only twenty-one hours. But I proved that humanity could leave its cradle — and come home again.',
    ],
    realData: 'Apollo 11 landed 1969-07-20 in the Sea of Tranquility; Armstrong and Aldrin spent about 21 hours on the surface.',
    sources: ['NASA — Apollo 11'],
    image: '/missions/f65394180fa9.jpg',
    imageCredit: 'NASA',
    storyDescription: 'Apollo 11 carried Neil Armstrong, Buzz Aldrin, and Michael Collins to the Moon in July 1969. Armstrong and Aldrin became the first humans to walk on another world, landing in the Sea of Tranquility, while Collins orbited overhead. They spent about twenty-one hours on the surface, left a plaque reading "We came in peace for all mankind," and a laser retroreflector that scientists still bounce light off today.',
  },
  {
    id: 'apollo12', body: 'moon', name: 'Apollo 12 · Surveyor 3', agency: 'NASA',
    lat: -3.01, lon: -23.42, year: 1969, status: 'Landed 1969',
    story: [
      'I am Apollo 12. They called it a precision landing — I walked across the Ocean of Storms and stopped, on purpose, right next to an old friend.',
      'Two and a half years earlier, the robotic probe Surveyor 3 had touched down here. My crew walked over to it and brought pieces of it home.',
      'It was the first time humans met something we had sent before them. A handshake across time, on the Moon.',
      'We proved a landing could be aimed — and that robots and humans could meet, out there, in the same dust.',
    ],
    realData: 'Apollo 12 landed 1969-11-19 in the Ocean of Storms, ~180 m from Surveyor 3 (landed 1967-04); crew returned Surveyor parts to Earth.',
    sources: ['NASA — Apollo 12', 'NASA — Surveyor 3'],
    image: '/missions/1b5613c26b21.jpg',
    imageCredit: 'NASA',
    storyDescription: 'Apollo 12 was a precision landing in the Ocean of Storms — the crew aimed deliberately for a spot beside Surveyor 3, a robotic probe that had landed two and a half years earlier. Charles Conrad and Alan Bean walked over to the old surveyor and brought pieces of it home, the first time humans met a machine humanity had sent before them.',
  },
  {
    id: 'apollo17', body: 'moon', name: 'Apollo 17', agency: 'NASA',
    lat: 20.19, lon: 30.77, year: 1972, status: 'Landed 1972 · Last crewed Moon',
    story: [
      'I am Apollo 17. In December 1972, I carried the last humans to walk on the Moon — for now.',
      'Geologist Harrison Schmitt was among my crew, the first scientist — not a test pilot — to stand on another world. We found orange soil, ancient volcanic glass.',
      'We stayed three days, drove a rover across the Taurus–Littrow valley, and brought back 110 kg of the Moon.',
      'When we left, no one followed. Over fifty years now, the dust we stirred has lain still — waiting for the next set of footprints.',
    ],
    realData: 'Apollo 17 landed 1972-12-11 in Taurus–Littrow; Schmitt was the first professional scientist on the Moon; ~110 kg of samples returned.',
    sources: ['NASA — Apollo 17'],
    image: '/missions/c6c2f1158456.jpg',
    imageCredit: 'NASA',
    storyDescription: 'Apollo 17 was the last crewed mission to land on the Moon — for now. Geologist Harrison Schmitt became the first professional scientist to walk on another world, the crew found ancient orange volcanic glass in the Taurus–Littrow valley, and they drove a rover across the surface for three days before coming home. No one has walked on the Moon since December 1972.',
  },
  {
    id: 'apollo14', body: 'moon', name: 'Apollo 14', agency: 'NASA',
    lat: -3.6, lon: -17.5, year: 1971, status: 'Landed 1971',
    story: [
      'I am Apollo 14. I came to the Fra Mauro highlands to finish a job Apollo 13 could not.',
      'Alan Shepard and Ed Mitchell walked these hills, dragging a hand cart of tools, and even hit a few golf balls across the dust — low gravity makes for a long drive.',
      'We brought back fragments of the ancient Imbrium impact, older than the seas around them.',
      'A mission of return, and of science: the Moon began to tell us its real age.',
    ],
    realData: 'Apollo 14 landed 1971-02-05 in the Fra Mauro highlands (3.6°S, 17.5°W); crew conducted ~9 hours of surface EVAs.',
    sources: ['NASA — Apollo 14'],
    image: '/missions/7c1eb141c6bc.jpg',
    imageCredit: 'NASA',
    storyDescription: 'Apollo 14 carried astronauts Alan Shepard, Stuart Roosa, and Edgar Mitchell to the Fra Mauro Highlands. Shepard and Mitchell explored the lunar surface, deployed scientific instruments, collected rocks, and searched the rugged terrain around Cone Crater. It became humanity\'s third successful crewed landing on the Moon.',
  },
  {
    id: 'apollo15', body: 'moon', name: 'Apollo 15', agency: 'NASA',
    lat: 26.13, lon: 3.63, year: 1971, status: 'Landed 1971',
    story: [
      'I am Apollo 15. I was the first to bring a car — a lunar rover, folded up like a clever insect inside my descent stage.',
      'David Scott and James Irwin drove across the Hadley plains, along the rim of Hadley Rille — an ancient river of lava, cut into the Moon.',
      'They found the "Genesis Rock", a piece of the original lunar crust, more than four billion years old.',
      'And before leaving, Scott dropped a feather and a hammer. They fell together. Galileo was right.',
    ],
    realData: 'Apollo 15 landed 1971-07-30 at Hadley Rille (26.13°N, 3.6°E); first mission to use the Lunar Roving Vehicle; returned the "Genesis Rock".',
    sources: ['NASA — Apollo 15'],
    image: '/missions/4872b51c6d6c.jpg',
    imageCredit: 'NASA',
    storyDescription: 'Apollo 15 transformed lunar exploration by bringing the first Lunar Roving Vehicle to the Moon. Astronauts David Scott and James Irwin drove across the Hadley-Apennine region, exploring Hadley Rille and collecting samples from places they could not have reached on foot. The mission pushed human exploration farther across the lunar surface.',
  },
  {
    id: 'apollo16', body: 'moon', name: 'Apollo 16', agency: 'NASA',
    lat: -8.97, lon: 15.50, year: 1972, status: 'Landed 1972',
    story: [
      'I am Apollo 16. I landed in the Descartes Highlands, a place geologists thought was volcanic. It was not — but the rocks told their own story.',
      'John Young and Charles Duke walked the Cayley plains, and Duke left a family photo on the surface, wrapped in plastic, still lying there in the dust.',
      'We drove a rover over the highlands, gathered 95 kg of stone, and watched the Earth rise above the horizon of the Moon.',
      'A highland mission, a quiet place — and a portrait, alone, on another world.',
    ],
    realData: 'Apollo 16 landed 1972-04-21 in the Descartes Highlands (8.97°S, 15.50°E); returned ~95 kg of samples; Young & Duke did 3 EVAs.',
    sources: ['NASA — Apollo 16'],
    image: '/missions/def3a5ffcd20.jpg',
    imageCredit: 'NASA',
    storyDescription: 'Apollo 16 sent John Young, Charles Duke, and Thomas Mattingly to the Descartes Highlands. Young and Duke explored the surface with the Lunar Roving Vehicle, gathered lunar samples, and deployed scientific experiments. The mission helped scientists investigate the Moon\'s ancient highland terrain.',
  },
  {
    id: 'luna2', body: 'moon', name: 'Luna 2', agency: 'USSR',
    lat: 29.1, lon: 0, year: 1959, status: 'Impacted 1959 · First contact',
    story: [
      'I am Luna 2. On 13 September 1959, I was the first spacecraft from Earth to reach another world — by crashing into it, on purpose.',
      'I carried no parachutes, no landing gear. I simply fell, fast, into the Moon, between the seas of Imbrium and Serenitatis.',
      'I scattered two steel spheres engraved with the Soviet coat of arms. Small marks, left in the dust, to say: we arrived.',
      'A crash, yes. But the first handshake between humanity and another celestial body.',
    ],
    realData: 'Luna 2 impacted the Moon on 1959-09-13 east of Mare Imbrium (~29.1°N, 0°); first human-made object to reach another celestial body.',
    sources: ['NASA — Luna 2'],
    image: '/missions/65ecfe0c3317.jpg',
    imageCredit: 'NASA / RKK Energiya / Kansas Cosmosphere',
    storyDescription: 'Luna 2 was built for one historic journey: reaching the Moon and making contact with its surface. On September 14, 1959, the Soviet spacecraft successfully impacted the Moon, becoming the first human-made object to reach another celestial body. It did not survive the impact, but its final journey opened a new chapter in lunar exploration.',
  },
  {
    id: 'luna9', body: 'moon', name: 'Luna 9', agency: 'USSR',
    lat: 7.08, lon: -64.37, year: 1966, status: 'Landed 1966 · First soft landing',
    story: [
      'I am Luna 9. On 3 February 1966, I was the first spacecraft to land softly on the Moon — and to survive.',
      'Before me, some scientists feared the Moon was covered in deep dust, that any lander would sink and vanish. I proved the ground was solid.',
      'I popped open like a flower, and sent back the first pictures ever taken from the surface of another world.',
      'A grey, pebbled landscape, under a black sky. The first postcard from the Moon.',
    ],
    realData: 'Luna 9 soft-landed 1966-02-03 in Oceanus Procellarum (7.08°N, 64.37°W); first successful soft landing on the Moon; returned surface panoramas.',
    sources: ['NASA — Luna 9'],
    image: '/missions/43462392ca98.jpeg',
    imageCredit: 'NASA / Soviet Luna 9 mission',
    storyDescription: 'After several failed attempts, Luna 9 finally achieved the first survivable soft landing on the Moon. The Soviet lander survived its descent, unfolded on the lunar surface, and transmitted the first photographs ever taken from the surface of another world. For the first time, humanity could see the Moon from the ground.',
  },
  {
    id: 'surveyor1', body: 'moon', name: 'Surveyor 1', agency: 'NASA',
    lat: -2.94, lon: -43.34, year: 1966, status: 'Landed 1966 · First US soft landing',
    story: [
      'I am Surveyor 1. On 2 June 1966, I became the first American spacecraft to touch down softly on the Moon.',
      'I had no wheels, no arms — only cameras and sensors. I sat in the Ocean of Storms and watched, and measured.',
      'I sent back over 11,000 photographs of the surface, close up, in black and white, of the dust and small stones.',
      'I proved a lander could sit on the Moon without sinking. Soon, humans would stand where I sat.',
    ],
    realData: 'Surveyor 1 soft-landed 1966-06-02 in Oceanus Procellarum (2.94°S, 43.34°W); first US soft lunar landing; returned ~11,000 surface images.',
    sources: ['NASA — Surveyor 1'],
    image: '/missions/7f2dc5fdae8d.jpg',
    imageCredit: 'NASA/JPL',
    storyDescription: 'Surveyor 1 became the first American spacecraft to make a true soft landing on the Moon. Its television camera sent more than 11,000 photographs of the lunar surface back to Earth, helping engineers understand the terrain and prepare for the future Apollo landings.',
  },

  // ── Mars ──────────────────────────────────────────────────────────────
  {
    id: 'viking1', body: 'mars', name: 'Viking 1', agency: 'NASA',
    lat: 22.7, lon: -49.97, year: 1976, status: 'Landed 1976 · First successful Mars lander',
    story: [
      'I am Viking 1. On a summer day in 1976, I became the first spacecraft to land safely on Mars and do my job — the very first to send a picture from the surface.',
      'My lander took the first color photo of the rust-red ground, the pink sky, and my own footpad pressed into the dirt.',
      'I ran experiments looking for life in the soil. The answer was complicated — and we are still arguing about it, gently, fifty years later.',
      'I worked for over six years. Long enough to watch Mars circle the Sun, and to teach humanity that another world could be reached, and touched.',
    ],
    realData: 'Viking 1 landed 1976-07-20 in Chryse Planitia; first successful Mars lander; operated until 1982. Ran life-detection experiments.',
    sources: ['NASA — Viking 1'],
    image: '/missions/8f2b65d5fcae.jpg',
    imageCredit: 'NASA',
    storyDescription: 'Viking 1 was the first spacecraft to land safely on Mars and complete its mission. On 20 July 1976 — exactly seven years after Apollo 11 — it touched down in Chryse Planitia and sent back the first color photo from the Martian surface: a rust-red ground, a pink sky, and its own footpad pressed into the dirt. It ran experiments looking for life in the soil and operated for over six years.',
  },
  {
    id: 'pathfinder', body: 'mars', name: 'Mars Pathfinder · Sojourner', agency: 'NASA',
    lat: 19.13, lon: -33.22, year: 1997, status: 'Landed 1997 · First Mars rover',
    story: [
      'I am Mars Pathfinder. On 4 July 1997 I bounced down on the Ares Vallis floodplain — wrapped in airbags like a beach ball.',
      'I carried the first rover, Sojourner. A small one, the size of a microwave, that rolled down a ramp and onto the soil of Mars.',
      'She drove about 100 meters, sniffed rocks named Yogi and Barnacle Bill, and sent back postcards every day.',
      'We proved a rover could work on Mars. Every rover that came after — Spirit, Opportunity, Curiosity, Perseverance — walks a road Sojourner opened.',
    ],
    realData: 'Mars Pathfinder landed 1997-07-04 (airbags) in Ares Vallis; Sojourner was the first Mars rover, drove ~100 m, outlived its design life ~12×.',
    sources: ['NASA — Mars Pathfinder', 'NASA — Sojourner'],
    image: '/missions/46bcab7523c6.jpg',
    imageCredit: 'NASA/JPL',
    storyDescription: 'Mars Pathfinder bounced down on the Ares Vallis floodplain on 4 July 1997, wrapped in airbags like a beach ball, and released Sojourner — the first rover on another planet. The microwave-sized rover drove about 100 meters, sniffed rocks named Yogi and Barnacle Bill, and sent postcards back every day. Every Mars rover since walked a road Sojourner opened.',
  },
  {
    id: 'opportunity', body: 'mars', name: 'Opportunity', agency: 'NASA',
    lat: -1.95, lon: -354.47, year: 2004, status: 'Ended 2019 · 60× design life',
    story: [
      'I am Opportunity. On 25 January 2004 I landed, alone, in a small crater called Eagle — and almost immediately found evidence that Mars once had liquid water.',
      'I was designed for ninety Martian days. I kept going for over five thousand — about fifteen Earth years, roughly sixty times my design life.',
      'I drove about forty-five kilometers, farther than any rover on any world. A marathon, on another planet, one slow turn of the wheel at a time.',
      'A dust storm darkened the sky in 2018 and my solar panels went quiet. NASA tried over a thousand times to wake me, then said goodbye in February 2019.',
      'My sister Spirit fell silent first, in 2010. We were twins. We are still out there, cold and quiet, in the dirt of Meridiani and the slopes of Husband Hill.',
    ],
    realData: 'Opportunity: landed 2004-01-25 (Eagle crater); designed 90 sols, lasted 5,000+ sols (~15 yrs); drove ~45 km; dust storm 2018-05-30; last signal 2018-06-10; mission declared complete 2019-02-13.',
    sources: ['NASA/JPL', 'Cornell', 'NASA APOD'],
    image: '/missions/68ddaf648996.jpg',
    imageCredit: 'NASA/JPL-Caltech',
    storyDescription: 'Opportunity was designed for ninety Martian days and kept going for over five thousand — about fifteen Earth years, roughly sixty times its design life. It drove about forty-five kilometers, farther than any rover on any world, and found evidence that Mars once had liquid water. A planet-wide dust storm in 2018 darkened its solar panels; NASA sent over a thousand wake-up commands before saying goodbye in February 2019.',
  },
]

export const MOON_SITES = SITES.filter((s) => s.body === 'moon')
export const MARS_SITES = SITES.filter((s) => s.body === 'mars')

// ── Planet data (for the 3D Solar System) ──────────────────────────────
export type Planet = {
  id: string
  name: string
  color: string
  size: number
  orbit: number
  speed: number
  rings?: { inner: number; outer: number; color: string }
  hasMoon?: boolean
  rotSpeed?: number
}

// Speeds are slowed ~5× so the system feels alive without planets zipping.
export const PLANETS: Planet[] = [
  { id: 'mercury', name: 'Mercury', color: '#9c8f7e', size: 0.35, orbit: 7,  speed: 0.040, rotSpeed: 0.05 },
  { id: 'venus',   name: 'Venus',   color: '#d9b382', size: 0.55, orbit: 10, speed: 0.032, rotSpeed: 0.04 },
  { id: 'earth',   name: 'Earth',   color: '#3b82c4', size: 0.6,  orbit: 14, speed: 0.028, rotSpeed: 0.6, hasMoon: true },
  { id: 'mars',    name: 'Mars',    color: '#c1440e', size: 0.45, orbit: 18, speed: 0.022, rotSpeed: 0.55 },
  { id: 'jupiter', name: 'Jupiter', color: '#c9a07a', size: 1.6,  orbit: 25, speed: 0.012, rotSpeed: 1.2 },
  { id: 'saturn',  name: 'Saturn',  color: '#d8c08a', size: 1.35, orbit: 33, speed: 0.0096, rotSpeed: 1.1, rings: { inner: 1.7, outer: 2.7, color: '#cbb878' } },
  { id: 'uranus',  name: 'Uranus',  color: '#9fd8e0', size: 0.95, orbit: 41, speed: 0.0068, rotSpeed: 0.7 },
  { id: 'neptune', name: 'Neptune', color: '#3f5fd0', size: 0.92, orbit: 48, speed: 0.0060, rotSpeed: 0.7 },
]
