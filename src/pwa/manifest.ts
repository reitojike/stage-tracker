import type { MetadataRoute } from 'next';
import {
  PWA_APP_ID,
  PWA_BACKGROUND_COLOR,
  PWA_ICON_ASSETS,
  PWA_NAME,
  PWA_SCOPE,
  PWA_SHORT_NAME,
  PWA_START_URL,
  PWA_THEME_COLOR,
} from './appIdentity.ts';

/**
 * Builds the Web App Manifest for the installable standalone Web App
 * (Issue #304). src/app/manifest.ts is the App Router metadata route that
 * serves it at /manifest.webmanifest; the content lives here so it stays a
 * plain function the tests can call directly.
 *
 * Deliberately limited to the fields Issue #304 scopes. No Service Worker
 * is registered and no offline/push capability is declared: installability
 * is the bounded goal, and offline support is explicitly not a condition
 * of it.
 */
export function buildPwaManifest(): MetadataRoute.Manifest {
  return {
    id: PWA_APP_ID,
    name: PWA_NAME,
    short_name: PWA_SHORT_NAME,
    start_url: PWA_START_URL,
    scope: PWA_SCOPE,
    display: 'standalone',
    theme_color: PWA_THEME_COLOR,
    background_color: PWA_BACKGROUND_COLOR,
    icons: PWA_ICON_ASSETS.filter((asset) => asset.role === 'manifest').map((asset) => ({
      src: asset.path,
      sizes: `${String(asset.size)}x${String(asset.size)}`,
      type: 'image/png',
      // Narrowed by the filter above: every `manifest` asset carries a
      // purpose. `any` and `maskable` stay separate entries rather than one
      // combined `"any maskable"` value - a single icon drawn for one of
      // the two is wrong for the other.
      purpose: asset.purpose ?? 'any',
    })),
  };
}
