# Asset Credits

## Sound effects — Kenney.nl (CC0)

Most files in `public/assets/sounds/` are from [Kenney.nl](https://kenney.nl/)'s
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
| `explosion1-2.wav` | currently unused (kept for future booths) |
| `laser1.wav` | reserved for the future duck-shooting gallery |

### Kenney "Impact Sounds" pack (CC0)

Recorded impact one-shots from Kenney's
[Impact Sounds](https://kenney.nl/assets/impact-sounds) pack (CC0), obtained
through the pack's mirror in the
[kenney-impact-sounds-for-godot](https://github.com/Boyquotes/kenney-impact-sounds-for-godot)
repository (also CC0-1.0 licensed). Trimmed, downmixed to mono and
peak-normalized for the game; original files named `impact_glass_*` /
`impact_punch_*`:

| File(s) | Used for |
|---|---|
| `glassLight1-5.wav` | ring tinking off a bottle crown, ringer landing on the shoulder |
| `glassMedium1-5.wav` | ring clattering off the glass, wedging between bottles |
| `glassHeavy1-5.wav` | hard clanks into the packed bottle field |
| `mittThud1-5.wav` | ball-toss knockdown — heavy catcher's-mitt body |
| `mittThudSoft1-5.wav` | glancing ball hits that wobble a target |

## Balloon pop — Super-Darts (MIT)

`balloonPop1.wav` and `balloonPop2.wav` are the recorded balloon bursts
`Balloon_pop_01/02.wav` from the
[Super-Darts](https://github.com/Super-Darts/Super-Darts) VR darts game,
released under the **MIT license** (Copyright (c) 2022 Super-Darts).
Trimmed, downmixed to mono and peak-normalized for the game.

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

## Fonts — Google Fonts (SIL Open Font License)

Self-hosted in `public/assets/fonts/` (woff2, latin subset) and also drawn
into the WebGL canvas textures for signs and scoreboards:

- **Rye** by Nicole Fally — circus/tuscan display face used for all
  carnival signage. <https://fonts.google.com/specimen/Rye>
- **VT323** by Peter Hull — dot-matrix terminal face used for the LED
  scoreboards. <https://fonts.google.com/specimen/VT323>

Both are licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/).

## Everything else

All models, textures and code are original to this repository (textures are
generated on `<canvas>` at load time — see `src/core/textures.js`) and are
released under the repository license.
