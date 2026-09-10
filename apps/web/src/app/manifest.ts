import type { MetadataRoute } from "next";
import {
  PWA_APP_ID,
  PWA_BACKGROUND_COLOR,
  PWA_ICON_ASSETS,
  PWA_NAME,
  PWA_SCOPE,
  PWA_SHORT_NAME,
  PWA_START_URL,
  PWA_THEME_COLOR,
} from "@/lib/pwa/app-identity";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: PWA_APP_ID,
    name: PWA_NAME,
    short_name: PWA_SHORT_NAME,
    start_url: PWA_START_URL,
    scope: PWA_SCOPE,
    display: "standalone",
    theme_color: PWA_THEME_COLOR,
    background_color: PWA_BACKGROUND_COLOR,
    icons: PWA_ICON_ASSETS.filter((asset) => asset.purpose !== null).map(
      (asset) => ({
        src: asset.path,
        sizes: `${String(asset.size)}x${String(asset.size)}`,
        type: "image/png",
        purpose: asset.purpose,
      }),
    ),
  };
}
