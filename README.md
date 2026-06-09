# NEBULA STRIKE

A browser-based sci-fi open-world space game built with Three.js + TypeScript +
Vite. Everything — ships, enemies, planets, planet surfaces, sound, music — is
generated procedurally in code. No art or audio assets. Plays on desktop
(keyboard) **and phones** (touch controls).

## Run it

```sh
bun install
bun run dev        # → http://localhost:5173
```

Production build: `bun run build` (output in `dist/`, servable from any static
host — share the link and phone users get touch controls automatically).

## The game

Pick one of **three hulls** — the balanced SR-7 Striker, the razor-fast KV-2
Wraith, or the heavy HK-9 Bastion — and fight through **five hand-themed
sectors** (asteroid belt, ice drift, radiation storm, fleet graveyard, and the
dreadnought anchorage). Clear every wave in a sector and a **jump gate**
appears; fly into it to warp onward. Clear all five and the campaign loops at
higher difficulty (NG+).

- **5 enemy tiers**: Wasp drones, Viper interceptors, Mauler gunships, Reaper
  destroyers, and the Oblivion Dreadnought (a carrier boss that launches drones).
- **3 special archetypes**: Scarab suicide bombers, cloaking Phantom stalkers,
  and Warden support ships that beam-heal their allies.
- **Encounter types**: standard waves, close-range ambushes, escorted convoys,
  and seeded minefields (mines can be shot from range).
- **4 weapons** with distinct roles: Pulse Laser (anti-shield), Plasma Cannon
  (anti-hull, splash), Seeker Missiles (homing at full lock), Railgun
  (penetrating instant beam). All fire is swept-collision tested — no tunneling.
- **Soft lock-on targeting**: lock stability builds while you keep your nose on
  the target; full lock turns the outline red and enables missile homing and a
  wider aim-assist cone. Lead reticle shows where to shoot moving targets.
- **Landable planets modeled on the solar system**: every sector places 5–6
  worlds across five archetypes, each with **gravity that genuinely fights
  your engines**. Gravity is integrated into the flight model against thrust:
  on a Jupiter-class world the main drive *cannot reach escape altitude* — you
  sink at full throttle until you engage the afterburner. Atmospheric entry
  starts as a real gravitational plunge you must arrest, planets exert
  inverse-square gravity wells on ships in open space, and atmospheric drag
  and storm winds differ per world. Each archetype is painted realistically
  from orbit
  (continents, polar caps, Jovian bands, glowing fissures):
  - **Mars-class** (`rock`) — 3.7 m/s² gravity, thin butterscotch sky, rust
    canyons, impact craters with raised rims, strewn boulders, distant mesas,
    drifting red dust, a small far-away sun and stars through the thin air
  - **Earth-class** (`terra`) — 9.8 m/s², blue sky, animated ocean swell,
    golden beaches, grasslands with instanced forests and bushes, alpine
    snowcaps, drifting cumulus clouds
  - **Europa-class** (`ice`) — 1.5 m/s², glacier ridges with blue ice cliffs
    over a frozen sea, translucent ice spires, icebergs, falling snow
  - **Io-class** (`lava`) — starlit black sky, basalt columns, breathing lava
    seas, a great volcano with a glowing throat and smoke column, rising embers
  - **Jupiter-class** (`gas`) — **24 m/s² crushing gravity**, lateral storm
    winds, banded cloud canyon walls, a Great Spot on the horizon, dense cloud
    rafts, racing mist, and **lightning with thunder**
  Fly close and the HUD asks *"ENTER &lt;PLANET&gt;? [G]"*; gradient sky domes,
  themed sunlight and weather sell the atmosphere from the cockpit. Collect 12
  energy crystals per world, climb high to leave — *"LEAVE? [G] → OUTER
  SPACE"* — and the space battle resumes exactly where you left it. Cycle nav
  markers with **N**.
- **Mobile / touch support**: coarse-pointer devices get a floating virtual
  joystick (left half of the screen) plus FIRE / THRUST / BOOST / BRAKE hold
  buttons and TGT / NAV / SHIP / ⏏ (enter-leave planet) / pause taps. Weapon
  slots are tappable, HUD compacts to phone layouts, and the renderer drops
  pixel ratio + MSAA to keep frame rate up.
- **Mid-run hangar**: press **V** anytime in space to reopen the vessel
  hangar and switch between the three hulls without losing progress.
- **Vacuum physics**: toggle flight assist off (**X**) for pure Newtonian drift.
  Space dust, debris, shockwaves, engine exhaust, and missile trails sell the motion.
- **Procedural audio**: ambient pad/drone soundtrack that crossfades into a
  combat layer when hostiles close in, plus synthesized weapon/impact/engine sounds.

## Controls

| Key | Action |
| --- | --- |
| W / S | Thrust forward / brake |
| A / D, ← / → | Yaw |
| ↑ / ↓ | Pitch |
| Q / E | Roll |
| SHIFT | Afterburner |
| SPACE | Fire |
| 1–4 | Switch weapon |
| T | Cycle combat target |
| N | Cycle nav target (planets / jump gate) |
| G | Enter / leave a planet (when prompted) |
| V | Change vessel (reopen the hangar mid-run) |
| X | Toggle flight assist (Newtonian mode) |
| H | Toggle help · P pause · R relaunch after death |

On phones the same actions live on the touch buttons; the on-screen ⏏ button
is G (enter/leave planet) and SHIP is V.

## Verification

`bun run test` drives the real game in headless Chrome (puppeteer-core +
your installed Chrome) across six suites: boot without console errors, target
acquisition and lock build-up, every weapon dealing damage, wave progression,
missile homing after the shooter looks away, pause/game-over flows, ship
selection, music startup, assist toggling, sector clearing → jump-gate warp →
environment rebuild, planet survey bonuses, the full planet-landing round trip
(prompt → surface → crystals → terrain collision → leave → space state
preserved), and an emulated-phone run (touch UI, virtual joystick steering,
thrust/fire buttons, tap actions). Screenshots land in `scripts/`.

## Architecture

```
src/
  core/Game.ts        game loop, sector/wave/encounter orchestration, camera
  core/Input.ts       keyboard state
  core/Sfx.ts         synthesized sound effects + engine hum
  core/Music.ts       procedural ambient/combat soundtrack
  world/Sectors.ts    the five sector definitions, 27 planets (data-driven)
  world/Environment.ts starfield, nebulae, asteroids, planets, wrecks, gate
  world/PlanetSurface.ts landable surface worlds: terrain/water/sky/crystals
  entities/PlayerShip.ts  3 hull definitions + flight model (assist/newtonian)
  entities/Enemy.ts   5 tiers + 3 special behaviors, AI state machine
  entities/Mine.ts    proximity mines
  combat/Weapons.ts   4 weapons, swept-collision projectiles, homing
  systems/Targeting.ts soft lock-on system
  effects/Effects.ts  explosions, debris, shockwaves, trails, space dust
  ui/HUD.ts           DOM overlay: bars, radar, brackets, nav marker
  ui/TouchControls.ts virtual joystick + touch buttons for phones
```

Rendering uses an `EffectComposer` chain: render → OutlinePass (target
highlight, cyan → red at full lock) → UnrealBloomPass → OutputPass, on an
MSAA (4×) half-float render target.
