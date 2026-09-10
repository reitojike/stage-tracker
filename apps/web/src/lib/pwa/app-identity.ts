/** Stable identity and public assets for the installable standalone Web App. */

export const PWA_APP_ID = "/";
export const PWA_START_URL = "/";
export const PWA_SCOPE = "/";
export const PWA_NAME = "stage-tracker";
export const PWA_SHORT_NAME = "stage-tracker";
export const PWA_THEME_COLOR = "#2f4a7a";
export const PWA_BACKGROUND_COLOR = "#eef0f1";

export const PWA_ICON_ASSETS = [
  { path: "/pwa/icon-192.png", size: 192, purpose: "any" },
  { path: "/pwa/icon-512.png", size: 512, purpose: "any" },
  { path: "/pwa/maskable-icon-512.png", size: 512, purpose: "maskable" },
  { path: "/pwa/apple-touch-icon.png", size: 180, purpose: null },
] as const;

export const PWA_MANIFEST_PATH = "/manifest.webmanifest";
export const PWA_PUBLIC_ASSET_PATHS = [
  PWA_MANIFEST_PATH,
  ...PWA_ICON_ASSETS.map((asset) => asset.path),
] as const;

export const PWA_APPLE_TOUCH_ICON_PATH = "/pwa/apple-touch-icon.png";
