/**
 * Canonical app identity and public resource set for the installable
 * standalone Web App (Issue #304).
 *
 * Kept out of `src/app/manifest.ts` on purpose: that file is an App Router
 * metadata route, so anything exported beside its default `manifest()` is
 * constrained by Next.js' own route-export rules. This module is a plain
 * module the manifest route, the tests, and the icon generator can all
 * import.
 */

/**
 * `id` / `start_url` / `scope` are app *identity*, not routing detail.
 *
 * A browser that already installed the app matches a later manifest by
 * `id`; changing it registers a different app and orphans the installed
 * one, and changing `start_url` / `scope` moves what the installed app
 * launches and which navigations stay inside the standalone window. Issue
 * #304 fixes all three at the origin root so a future route change cannot
 * quietly re-identify the installed app. Treat them as stable values.
 */
export const PWA_APP_ID = '/';
export const PWA_START_URL = '/';
export const PWA_SCOPE = '/';

/**
 * The product name as it already appears in the app bar logotype
 * (src/ui/AppBar.tsx) and the root metadata title. `short_name` is the
 * same string rather than an invented abbreviation - picking a different
 * home-screen label would be a branding decision, which Issue #304 keeps
 * out of scope.
 */
export const PWA_NAME = 'stage-tracker';
export const PWA_SHORT_NAME = 'stage-tracker';

/**
 * Both are existing design tokens read out of src/ui/tokens.css, not new
 * brand colours: `--color-accent` (#2f4a7a, the 藍 accent repinned in
 * Issue #137) and `--color-canvas` (#eef0f1, the app background the
 * splash screen should match). They are duplicated as literals because a
 * manifest is emitted server-side and cannot resolve a CSS custom
 * property; the test in this directory asserts they still agree with
 * tokens.css.
 */
export const PWA_THEME_COLOR = '#2f4a7a';
export const PWA_BACKGROUND_COLOR = '#eef0f1';

export interface PwaIconAsset {
  /** Origin-absolute request path, also the path under `public/`. */
  readonly path: string;
  /** Square edge length in CSS pixels. */
  readonly size: number;
  /**
   * `manifest` icons are listed in the Web App Manifest; `apple-touch` is
   * referenced only from the root metadata's `icons.apple`, because iOS
   * Home Screen still takes its icon from that link rather than the
   * manifest.
   */
  readonly role: 'manifest' | 'apple-touch';
  /**
   * Manifest icon `purpose`. `maskable` art is drawn inside the 80%
   * safe-zone circle so an Android adaptive-icon mask cannot clip it;
   * `any` art uses the full canvas. Null for the Apple icon, which is not
   * a manifest entry.
   */
  readonly purpose: 'any' | 'maskable' | null;
}

/**
 * Every PWA image asset, in one place. The manifest route, the root
 * metadata, and the proxy allowlist test all read this list, so a new or
 * resized icon cannot be added to one of them alone.
 *
 * The files under `public/pwa/` are supplied artwork, not generated: the
 * `any` art is full-bleed, and the maskable art is a separate rendering
 * whose content sits inside the 80% safe-zone circle. Both are opaque, so
 * iOS has no transparency to composite onto black. Replacing one means
 * exporting a new file at exactly the `size` declared here - the test in
 * this directory reads each PNG's header and fails on a mismatch.
 */
export const PWA_ICON_ASSETS: readonly PwaIconAsset[] = [
  { path: '/pwa/icon-192.png', size: 192, role: 'manifest', purpose: 'any' },
  { path: '/pwa/icon-512.png', size: 512, role: 'manifest', purpose: 'any' },
  { path: '/pwa/maskable-icon-512.png', size: 512, role: 'manifest', purpose: 'maskable' },
  { path: '/pwa/apple-touch-icon.png', size: 180, role: 'apple-touch', purpose: null },
];

/** Origin-absolute path of the App Router manifest route (src/app/manifest.ts). */
export const PWA_MANIFEST_PATH = '/manifest.webmanifest';

/**
 * The complete set of paths that must be reachable without a session.
 *
 * An install prompt is evaluated before the user signs in, so the
 * manifest and its icons have to be fetchable anonymously. This list is
 * the canonical enumeration of that exception; `src/proxy.ts` mirrors it
 * as literal alternatives in `config.matcher` (Next.js only accepts a
 * statically analyzable matcher, so it cannot import this array), and
 * src/pwa/__tests__/appIdentity.test.ts fails if the two ever disagree.
 *
 * Nothing else may be added here to make an application route public:
 * the exception is exact-path, and `public/pwa/` is reserved for these
 * assets so no application route is ever served from one of them.
 */
export const PWA_PUBLIC_ASSET_PATHS: readonly string[] = [
  PWA_MANIFEST_PATH,
  ...PWA_ICON_ASSETS.map((asset) => asset.path),
];
