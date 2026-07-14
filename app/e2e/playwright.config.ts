import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

// app/package.json has "type": "module", so this file loads as ESM (no
// CommonJS __dirname) — derive the equivalent from import.meta.url instead.
const testDir = fileURLToPath(new URL('.', import.meta.url))

// Playwright-for-Electron smoke suite (Phase 9 / Track B). This drives the
// real packaged-shape app (electron-vite's `out/` build, launched directly
// via Playwright's Electron support — see support/launchApp.ts) rather than
// the `npm run dev` server, so the suite has no dependency on a dev server
// being up and exercises the same `out/main/index.js` entry point a real
// (unsigned or packaged) install would use.
//
// `npm run build` must be run before `npm run test:e2e` — this config does
// NOT run the build itself (electron-vite's build is slow enough that
// re-running it as a Playwright webServer on every `test:e2e` invocation
// would make iterating on a single spec painfully slow; see package.json's
// `test:e2e` script, which does not chain a build step for the same reason —
// CI/orchestration is expected to build once and run the suite against that
// output, same as a human iterating locally would).
//
// workers: 1 is deliberate, not a default left in place — every spec in this
// suite drives the app's real on-disk "Cottonmouth" sample project (see
// support/launchApp.ts for why), and two Electron instances writing to that
// same project folder concurrently would race on the same sql.js/JSON files.
export default defineConfig({
  testDir,
  // Generous: golden-path.spec.ts's Line-Editor run can spend ~20s+ inside
  // a real (but ultimately unreachable) LM Studio embeddings probe before
  // falling back — see that spec's own comment at the "Wait for the run to
  // complete" step for why.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure'
  }
})
