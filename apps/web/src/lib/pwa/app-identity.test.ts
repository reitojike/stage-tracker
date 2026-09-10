import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import {
  PWA_ICON_ASSETS,
  PWA_MANIFEST_PATH,
  PWA_PUBLIC_ASSET_PATHS,
} from "./app-identity";

const proxySource = readFileSync(join(process.cwd(), "src/proxy.ts"), "utf8");
const matcherLiteral = /matcher:\s*\[\s*(["'])([\s\S]*?)\1/
  .exec(proxySource)?.[2]
  ?.replaceAll("\\\\", "\\");

function isProxied(pathname: string): boolean {
  expect(matcherLiteral).toBeDefined();
  return new RegExp(`^${matcherLiteral}$`).test(pathname);
}

describe("v2 PWA installability contract", () => {
  it("declares the manifest and four exact public asset paths", () => {
    expect(PWA_PUBLIC_ASSET_PATHS).toEqual([
      "/manifest.webmanifest",
      "/pwa/icon-192.png",
      "/pwa/icon-512.png",
      "/pwa/maskable-icon-512.png",
      "/pwa/apple-touch-icon.png",
    ]);

    for (const path of PWA_PUBLIC_ASSET_PATHS) {
      expect(isProxied(path), `${path} must bypass the auth proxy`).toBe(false);
    }
  });

  it("keeps prefix, suffix, and unrelated application paths protected", () => {
    for (const path of [
      "/pwa",
      "/pwa/",
      "/pwa/icon-192.png/extra",
      "/pwa/icon-192.pngx",
      "/pwa/icon-193.png",
      "/manifest.webmanifest/extra",
      "/manifest.webmanifestx",
      "/",
      "/catalog",
      "/events/some-future-page.png",
    ]) {
      expect(isProxied(path), `${path} must hit the auth proxy`).toBe(true);
    }
  });

  it("keeps the proxy matcher synchronized with the declared asset set", () => {
    const lookahead = /\(\?!([^)]+)\)/.exec(matcherLiteral ?? "")?.[1];
    expect(lookahead).toBeDefined();
    const expected = [
      "_next/static",
      "_next/image",
      "favicon\\.ico$",
      ...PWA_PUBLIC_ASSET_PATHS.map(
        (path) => `${path.slice(1).replaceAll(".", "\\.")}$`,
      ),
    ];
    expect(lookahead?.split("|").sort()).toEqual(expected.sort());
  });

  it("serves the stable standalone manifest metadata", () => {
    const result = manifest();
    expect({
      id: result.id,
      start_url: result.start_url,
      scope: result.scope,
      display: result.display,
      theme_color: result.theme_color,
      background_color: result.background_color,
    }).toEqual({
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
      theme_color: "#2f4a7a",
      background_color: "#eef0f1",
    });

    expect(
      result.icons?.map(({ src, sizes, purpose }) => ({ src, sizes, purpose })),
    ).toEqual(
      PWA_ICON_ASSETS.filter((asset) => asset.purpose !== null).map(
        (asset) => ({
          src: asset.path,
          sizes: `${String(asset.size)}x${String(asset.size)}`,
          purpose: asset.purpose,
        }),
      ),
    );
    expect(result.icons?.every((icon) => icon.type === "image/png")).toBe(true);
    expect(PWA_MANIFEST_PATH).toBe("/manifest.webmanifest");
  });

  it("ships every declared icon as a PNG at its advertised square size", () => {
    for (const asset of PWA_ICON_ASSETS) {
      const bytes = readFileSync(
        join(process.cwd(), "public", asset.path.slice(1)),
      );
      expect(bytes.subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      expect(bytes.readUInt32BE(16)).toBe(asset.size);
      expect(bytes.readUInt32BE(20)).toBe(asset.size);
    }
  });
});
