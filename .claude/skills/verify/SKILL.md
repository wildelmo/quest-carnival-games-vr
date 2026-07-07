---
name: verify
description: Build, launch and drive the carnival VR app headlessly to verify changes at the desktop surface (the XR path itself needs a headset — verify its math numerically instead).
---

# Verifying quest-carnival-games-vr

## Launch

```bash
npm ci                      # if node_modules is missing
npx vite --port 5199 &      # dev server; 200 on http://localhost:5199/
```

Drive with Playwright + the pre-installed Chromium
(`executablePath: '/opt/pw-browsers/chromium'`). WebGL needs SwiftShader in
headless: launch args `['--use-gl=angle', '--use-angle=swiftshader',
'--enable-unsafe-swiftshader']`.

## Drive

1. `page.goto`, then wait for boot: `!document.getElementById('btn-desktop').disabled`.
2. `page.click('#btn-desktop')` to enter desktop mode.
3. Pointer lock doesn't reliably engage headless — force the flag the app
   keys off: `page.evaluate(() => { window.__carnival.input.pointerLocked = true; })`.
4. Everything is poke-able via `window.__carnival` (world, games, input,
   deps.grabbables, hands, settings). Teleport with
   `__carnival.world.rig.position.set(...)`, aim with
   `__carnival.input.look.yaw/pitch`.
5. Grab/throw: teleport within 1.4 m of a grabbable
   (`deps.grabbables.items[n].object.getWorldPosition(...)`), then
   `page.mouse.click(640, 400)` grabs, a second click throws.
6. Capture `console`/`pageerror` events — the app logs nothing in a clean run.

The desktop glove renders lower-right of centre at 1280×800; crop
`{x: 620, y: 480, width: 560, height: 320}` for a close-up.

## Gotchas

- The immersive-VR path (controller grip spaces, XR gloves) cannot run
  headless — no WebXR device. Verify grip-space transforms numerically with
  `node --input-type=module` + three.js from node_modules, and note the
  on-headset check as a limitation.
- Settings persist in `localStorage['carnival.settings.v1']` — seed via
  `page.addInitScript` to test persisted-state paths.
