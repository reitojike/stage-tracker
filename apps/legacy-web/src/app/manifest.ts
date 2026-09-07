import type { MetadataRoute } from 'next';
import { buildPwaManifest } from '@/pwa/manifest.ts';

/**
 * App Router metadata route for the Web App Manifest (Issue #304), served
 * at /manifest.webmanifest. Next.js emits the matching
 * `<link rel="manifest">` from this file's presence, so the root layout
 * declares none of its own.
 *
 * The manifest is fetched before a session exists, so this path and every
 * icon it lists sit in the proxy's public exception
 * (PWA_PUBLIC_ASSET_PATHS in src/pwa/appIdentity.ts).
 */
export default function manifest(): MetadataRoute.Manifest {
  return buildPwaManifest();
}
