import { defineConfig } from 'vite';

// WebXR requires a secure context. `vite --host` + the Quest browser visiting
// your machine's LAN IP over http works for localhost-equivalent origins;
// otherwise serve over https (e.g. `vite --host` behind a tunnel, or add
// @vitejs/plugin-basic-ssl).
export default defineConfig({
  // Relative base so the build works both at a domain root AND under a
  // GitHub Pages project subpath (https://<user>.github.io/<repo>/) without
  // hardcoding the repo name. All bundled asset URLs become relative.
  base: './',
  server: { port: 5173 },
  build: {
    target: 'es2020',
    // Keep three.js in one chunk; the app is small.
    chunkSizeWarningLimit: 1200,
  },
});
