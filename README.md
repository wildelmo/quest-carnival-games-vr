# 🎪 Carnival Arcade VR

A Meta Quest / WebXR carnival arcade inside a cozy funhouse big-top:
striped canvas, string lights, bunting, ragtime piano from a horn speaker
on the centre pole — and a ring of physical game booths you walk or
teleport between.

The tent sits in the middle of a living night **midway**: laced canvas
windows between the booths (and the entrance doorway) look out on a lit
Ferris wheel slowly turning, glowing food stalls all the way around, a
carousel, a high striker, strolling silhouette crowds, sweeping
searchlights and fireworks bursting over the treeline — with their booms
arriving a beat late, the way distant fireworks do.

Your hands are big white **carnival gloves**: fingers curl with the
trigger, and the cuff band (blue left, orange right) glows when your
hand is near something you can grab.

![The tent](docs/tent.png)

**Playable now:**

- **🎯 Down the Clown (ball toss)** — a chute dispenses six foam softballs into your tray.
  Knock down the wall of plush carnival clowns (5 wide, 4 shelves) before
  the timer runs out. Targets wobble on glancing hits and slam backwards on
  solid ones; balls bounce around the stall, get swept into the grate at
  the base of the wall and ride the return pipe back to your tray.
  Rows score 10–40, clear the board for a bonus.
- **🎈 Balloon Darts** — a 6ft × 5ft cork board packed with 35 jiggling
  balloons (three gold ones are worth extra). Throw darts, pop balloons
  (shards, real pop sound), darts stick in the cork. Hit the big red
  RESET button and watch the nozzles re-inflate the board one balloon at
  a time — no instant respawns.
- **⭕ Ring Toss** — a full square field of 324 glass soda bottles packed
  neck-to-neck in wooden crates, ten gold bottles hiding in the field.
  Grab rings from the bucket (20 a round) and lob them: a flat ring over
  a crown is a RINGER and slides down the neck; tilted rings clatter off
  the glass and wedge between the shoulders, just like the real
  (honest-but-brutal) game. RESET sweeps every ring back into the bucket.

Three more pads stand roped off with "coming soon" marquees:
Milk Bottles, Whack-a-Mole, Skee-Ball.

A brass **EXIT bell** on a striped post by the tent's centre pole ends the
experience — pull its cord (or press `E` on desktop) to ring out, drop back
to the splash screen and pause the audio.

Next to it, the **OPERATOR PANEL** holds the player settings as three
pokeable dome buttons: the comfort vignette (irises in during smooth
locomotion), the snap-turn angle (30°/45°) and the bandstand music.
Choices persist across visits via localStorage.

![Ball toss booth](docs/balltoss.png)
![Balloon dart booth](docs/darts.png)

## Running it

```bash
npm install
npm run dev        # vite dev server on http://localhost:5173
```

**On Quest:** WebXR needs a secure context. Easiest paths:

- `npx vite --host` and open your machine's LAN IP in the Quest browser
  (fine for `localhost`-style dev if you use adb reverse:
  `adb reverse tcp:5173 tcp:5173`, then browse to `http://localhost:5173`), or
- serve `npm run build` output (`dist/`) from any HTTPS host.

Click **START VR** on the splash screen. No headset? *play on desktop
instead* gives you a mouse/keyboard version of the same tent.

## Controls

| | Quest controllers | Desktop |
|---|---|---|
| Move | left stick (smooth walk) | WASD (+Shift to hurry) |
| Turn | right stick left/right = 30° snap | mouse look (click to lock pointer) |
| Teleport | push right stick forward, aim arc, release | — |
| Grab ball/dart/ring | grip or trigger near the object | click (nearest object ahead) |
| Throw | swing arm + release grip | click again (throws along view) |
| Buttons / exit bell | physically poke / touch | look at it up close, press `E` |

## Project layout

```
src/
  core/        engine-ish pieces, no game logic
    World.js         renderer, XR session, fixed-step loop, player rig
    Physics.js       tiny custom physics: spheres vs boxes/zones (Quest-cheap)
    Input.js         XR controllers + desktop fallback behind one interface
    Grabbables.js    grip-to-grab, swing-and-release throwing, hover affordance
    Locomotion.js    smooth walk, snap turn, teleport arc, no-go zones
    Hands.js         procedural carnival gloves with analog finger curl
    Comfort.js       locomotion vignette iris (toggle on the operator panel)
    settings.js      persistent player settings (localStorage)
    AudioManager.js  positional CC0 samples + synthesized ambience beds
    textures.js      every texture, generated on <canvas> at load
    environment.js   baked PMREM env map, shiny-material factory, glows
    Shadows.js       pooled blob contact shadows for dynamic objects
  components/  reusable booth furniture
    BoothBase.js     stall structure, awning, sign, prize shelf, blockers
    Scoreboard.js    canvas-texture score / timer / status panel
    PushButton.js    pokeable arcade dome button
    SettingsPanel.js the operator panel: comfort / snap / music buttons
  env/
    Tent.js          the big-top: shell (with windows + doorway), lights,
                     bunting, entrance, pads
    Midway.js        the night carnival outside: Ferris wheel, stalls,
                     carousel, crowds, fireworks, searchlights
  games/
    registry.js      MiniGame base class + how-to-add-a-booth notes
    BallTossGame.js
    BalloonDartGame.js
    RingTossGame.js
public/assets/       CC0 sounds, free music, OFL fonts (see CREDITS.md)
```

## Adding a booth

The tent exposes six pads (`tent.getPad(i)`); three are taken. To add game #4:

1. `src/games/MilkBottlesGame.js` — subclass `MiniGame`, build on `BoothBase`
   (that alone gets you the stall, sign, scoreboard, reset button and
   prize shelf), add your props to `this.booth.group`.
2. Implement `onRoundStart / onRoundEnd / onUpdate / onResetRound`; call
   `tryStart()` from your throw handler (the first throw starts the round)
   and `finishReset()` when your reset sequence finishes.
3. In `src/main.js`, replace a `ComingSoonBooth` with
   `new MilkBottlesGame(deps, tent.getPad(3))`.

Reusable bits you get for free: `SphereBody` + `BoxCollider` + `ForceZone`
physics, the grab/throw system, positional audio with sample variations,
haptics, and locomotion blockers.

## Performance notes (Quest)

- Fixed 90Hz physics step, allocation-free hot paths, bodies sleep.
- ACES filmic tone mapping plus a small PMREM environment map baked once
  at boot: hero objects (glass bottles, balloons, rings, brass, buttons)
  are env-mapped `MeshStandardMaterial`, while the big canvas / plush
  surfaces stay cheap Lambert with shading baked into their textures.
- 3 point lights + a hemisphere, **no shadow maps** — dynamic objects get
  pooled multiply-blended blob shadows (one instanced draw call total).
- String lights, marquee chase bulbs, bunting and the ring-toss bottle
  field are instanced meshes; bulb glows and dust motes are additive
  point sprites (one draw call each).
- The whole midway outside is unlit silhouette geometry + emissive
  glows — no extra lights, ~29 draw calls, and since three.js sorts
  opaques front-to-back the tent wall early-z kills most of its overdraw
  from inside.
- Strongest fixed foveation is enabled; whole scene is ~88k triangles,
  most of it the 324-bottle field (a single static draw call).

## Audio

The soundscape is **diegetic-only**: no scoring chimes, round bells or
jingles — the scoreboard is the feedback, and everything you hear is a
physical event in the booth. All of it is real recorded samples — **CC0
packs from Kenney.nl** (Impact Sounds: glass clinks for rings clattering
off the bottle field, heavy punch impacts for the catcher's-mitt thud of a
knockdown, wood knocks for darts thunking into cork) plus **recorded
balloon bursts** (MIT, from the Super-Darts project) — with random
variation and pitch jitter; the music is a free ragtime track by **Anttis
Instrumentals**. Two ambience beds (crowd murmur, ball rolling) are
synthesized at runtime and can be replaced by dropping real files into
`public/assets/sounds/` — see `CREDITS.md` for the full mapping and swap
paths.
