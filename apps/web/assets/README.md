# App icon

`app-icon.svg` is the editable 512-unit master. Calendar binding tabs surround
an open stage: two curved curtains frame a single light. This combines the
app's event/ticket purpose with its calendar-led planning, without relying on
initials. Navy `#2f4a7a`, recessed `#253455`, white, and a restrained cool light
follow the current UI palette. Shapes stay bold at favicon sizes.

From the repository root, after the usual frozen pnpm install:

```sh
node scripts/generate-app-icons.mjs
node scripts/generate-app-icons.mjs --check
```

The script reuses Next.js's locked `sharp` dependency, reads the master SVG,
and writes the existing four public PNGs plus the App Router `favicon.ico`
(16/32/48 px, uncompressed BGRA ICO). No fonts, remote images, timestamps,
or additional project dependencies are involved. `--check` regenerates in
memory and fails on byte drift, dimensions, alpha, manifest asset declarations,
or maskable foreground outside the safe zone. Use the same locked renderer
and platform when comparing bytes; a renderer/native library update requires
regeneration and visual review. In an asset-only environment, a provisioned
locked sharp can be selected through Node's standard `NODE_PATH`.

| Output                             | Size       | Treatment                                 |
| ---------------------------------- | ---------- | ----------------------------------------- |
| `public/pwa/icon-192.png`          | 192 × 192  | Standard, mark enlarged 1.12×             |
| `public/pwa/icon-512.png`          | 512 × 512  | Standard, mark enlarged 1.12×             |
| `public/pwa/maskable-icon-512.png` | 512 × 512  | Master scale, opaque full bleed           |
| `public/pwa/apple-touch-icon.png`  | 180 × 180  | Standard, opaque, no baked-in corner mask |
| `src/app/favicon.ico`              | 16, 32, 48 | Standard, individual size renders         |

The maskable master keeps every foreground pixel inside the centered circle
of radius 40% required by the [Web App Manifest safe-zone definition](https://www.w3.org/TR/appmanifest/#icon-masks).
Rounded-square/circle masking belongs to the OS. The existing manifest,
Apple metadata, favicon file convention, exact public paths, application ID,
theme colors, authentication boundary, and standalone behavior remain intact.

Deployment and device installation have not been tested by this asset change.
Installed icons can remain cached by the browser/OS; check a fresh home-screen
addition on Android and iOS after deployment. An icon update adds no offline
capability or service worker.
