# Asset Credits

## Sound effects — Kenney.nl (CC0)

All files in `public/assets/sounds/` are from [Kenney.nl](https://kenney.nl/)'s
free game audio packs, licensed **CC0 (public domain)**:
<https://creativecommons.org/publicdomain/zero/1.0/>

> "You may use these graphics in personal and commercial projects.
> Credit (Kenney or www.kenney.nl) would be nice but is not mandatory."

They were obtained through the asset bundle distributed with the
[Python Arcade](https://api.arcade.academy/) library, which redistributes
this Kenney subset under the same CC0 license.

| File(s) | Used for |
|---|---|
| `hit1-3.wav` | ball smacking a target |
| `rockHit2.wav` | heavy thuds, gutter clunk |
| `fall1-2.wav` | targets flopping backwards |
| `coin1/2/4.wav` | score points |
| `secret2.wav`, `secret4.wav` | round-start bell |
| `upgrade1.wav`, `upgrade4.wav` | win jingle / clear-the-board fanfare |
| `gameover3.wav`, `lose4.wav`, `error1.wav` | round end / miss |
| `phaseJump1.wav` | ball dispenser, balloon-nozzle inflate |
| `jump1.wav`, `jump3.wav` | target winch, dart sticking in cork |
| `explosion1-2.wav` | balloon pop (pitched up, layered with a synth snap) |
| `laser1.wav` | reserved for the future duck-shooting gallery |

## Music — Anttis Instrumentals (free)

`public/assets/music/1918.mp3` — ragtime piano by **Anttis instrumentals**,
released free for use in games (credit appreciated):
- <https://www.soundclick.com/artist/default.cfm?bandid=1277008>
- Announcement: r/gameassets, "2000 instrumental pieces free"

Also redistributed with the Python Arcade library's asset bundle.

## Synthesized audio (WebAudio, generated at runtime)

A few textures have no bundled recording and are synthesized in
`src/core/AudioManager.js`, deliberately layered UNDER the real samples:

- **Crowd murmur bed** — drop a real loop at
  `public/assets/sounds/ambience_crowd.ogg` and it is used automatically.
- **Ball-rolling rumble** — filtered noise driven by each ball's speed.
- **Balloon-pop "snap" layer** — 50ms noise burst on top of the real
  explosion sample.

## Everything else

All models, textures and code are original to this repository (textures are
generated on `<canvas>` at load time — see `src/core/textures.js`) and are
released under the repository license.
