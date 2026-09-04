import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildPwaManifest } from '../manifest.ts';
import {
  PWA_APP_ID,
  PWA_BACKGROUND_COLOR,
  PWA_ICON_ASSETS,
  PWA_MANIFEST_PATH,
  PWA_PUBLIC_ASSET_PATHS,
  PWA_SCOPE,
  PWA_START_URL,
  PWA_THEME_COLOR,
} from '../appIdentity.ts';

// Issue #304. These bind the three places the PWA surface is spelled out -
// the manifest builder, the committed icon files, and the proxy's public
// exception - so none of them can be changed alone. The boundary itself is
// additionally proven over real HTTP in test/auth/routeProtection.test.ts;
// what these add is that the allowlist stays *exactly* the declared set,
// which an HTTP test can only sample.

const repositoryRoot = new URL('../../../', import.meta.url);

function readRepositoryFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, repositoryRoot)), 'utf8');
}

const proxySource = readRepositoryFile('src/proxy.ts');

/**
 * The matcher has to be a literal for Next.js to analyze it statically, so
 * it cannot import PWA_PUBLIC_ASSET_PATHS - it is read back out of the
 * source here instead. Only `\\` appears as an escape inside it, so
 * unescaping that one sequence recovers the runtime string.
 */
function readProxyMatcher(): string {
  const literal = /matcher:\s*\[\s*'([^']+)'/.exec(proxySource)?.[1];
  assert.ok(literal !== undefined, 'expected a single quoted matcher literal in src/proxy.ts');
  return literal.replaceAll('\\\\', '\\');
}

const proxyMatcher = readProxyMatcher();

/**
 * The matcher is one negative lookahead over the path. Re-forming it as a
 * plain RegExp is enough to answer "would the proxy run for this path",
 * which is the property under test; Next.js' own compilation of the same
 * literal is what routeProtection.test.ts exercises end to end.
 */
const proxyMatcherPattern = new RegExp(`^${proxyMatcher}$`);

function isProxied(pathname: string): boolean {
  return proxyMatcherPattern.test(pathname);
}

// --- Public exception is exactly the declared PWA resource set ---

void test('every declared PWA public resource is reachable without passing through the proxy', () => {
  for (const path of PWA_PUBLIC_ASSET_PATHS) {
    assert.equal(isProxied(path), false, `${path} must be excluded from the auth boundary`);
  }
});

void test('the proxy exception is exact-path, so nothing else under /pwa/ becomes public', () => {
  // A prefix rule here would make any future path under /pwa/ public
  // without ever being declared. Each of these differs from a declared
  // asset only by what a prefix rule would have ignored.
  const mustStayGuarded = [
    '/pwa',
    '/pwa/',
    '/pwa/icon-192.png/sub',
    '/pwa/icon-193.png',
    '/pwa/secret.png',
    '/pwa/../events/1',
    '/manifest.webmanifest/sub',
    '/manifest.webmanifestx',
  ];

  for (const path of mustStayGuarded) {
    assert.equal(isProxied(path), true, `${path} must still hit the auth boundary`);
  }
});

void test('the PWA exception did not widen the boundary for ordinary application paths', () => {
  // Regression guard for the matcher edit itself: the paths
  // routeProtection.test.ts cares about must be unaffected by adding
  // image/manifest exceptions.
  for (const path of ['/', '/calendar', '/catalog', '/mypage', '/events/some-future-page.png']) {
    assert.equal(isProxied(path), true, `${path} must still hit the auth boundary`);
  }
});

void test('the matcher exclusion list holds nothing beyond the Next internals and the declared set', () => {
  const lookahead = /\(\?!([^)]+)\)/.exec(proxyMatcher)?.[1];
  assert.ok(lookahead !== undefined, 'expected a negative lookahead in the matcher');
  const alternatives = lookahead.split('|');

  const expected = [
    '_next/static',
    '_next/image',
    'favicon\\.ico$',
    ...PWA_PUBLIC_ASSET_PATHS.map((path) => `${path.slice(1).replaceAll('.', '\\.')}$`),
  ];

  assert.deepEqual(
    [...alternatives].sort(),
    [...expected].sort(),
    'the proxy allowlist and PWA_PUBLIC_ASSET_PATHS disagree',
  );
});

// --- Icons exist, at the sizes the manifest advertises ---

function readPngHeader(path: string): { width: number; height: number } {
  const file = readFileSync(fileURLToPath(new URL(`public${path}`, repositoryRoot)));
  assert.equal(
    file.subarray(0, 8).toString('hex'),
    '89504e470d0a1a0a',
    `${path} is not a PNG file`,
  );
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
}

void test('every declared icon exists under public/ at exactly the advertised size', () => {
  // A manifest icon whose real pixel size differs from its `sizes` entry
  // is rejected by installability checks, and the file is a binary a
  // reviewer cannot eyeball.
  for (const asset of PWA_ICON_ASSETS) {
    const { width, height } = readPngHeader(asset.path);
    assert.equal(width, asset.size, `${asset.path} width`);
    assert.equal(height, asset.size, `${asset.path} height`);
  }
});

void test('the maskable icon is its own artwork, not a copy of the same-sized any icon', () => {
  // The two are the same pixel size, so a copy-paste during export would
  // look right in a file listing and only show up as a clipped mark on a
  // real Android launcher: `any` art is full-bleed, maskable art has to
  // keep its content inside the 80% safe-zone circle.
  const bytesOf = (path: string) =>
    readFileSync(fileURLToPath(new URL(`public${path}`, repositoryRoot)));

  for (const maskable of PWA_ICON_ASSETS.filter((asset) => asset.purpose === 'maskable')) {
    for (const plain of PWA_ICON_ASSETS.filter(
      (asset) => asset.purpose === 'any' && asset.size === maskable.size,
    )) {
      assert.equal(
        bytesOf(maskable.path).equals(bytesOf(plain.path)),
        false,
        `${maskable.path} is byte-identical to ${plain.path}`,
      );
    }
  }
});

void test('the icon set covers what an install needs: 192, 512 and a maskable variant', () => {
  const manifestIcons = PWA_ICON_ASSETS.filter((asset) => asset.role === 'manifest');
  const anySizes = manifestIcons
    .filter((asset) => asset.purpose === 'any')
    .map((asset) => asset.size);

  assert.ok(anySizes.includes(192), 'a 192x192 icon is required');
  assert.ok(anySizes.includes(512), 'a 512x512 icon is required');
  assert.ok(
    manifestIcons.some((asset) => asset.purpose === 'maskable'),
    'a maskable icon is required',
  );
  assert.ok(
    PWA_ICON_ASSETS.some((asset) => asset.role === 'apple-touch'),
    'an iOS Home Screen icon is required',
  );
});

// --- Manifest content ---

void test('the manifest declares the stable app identity explicitly', () => {
  // Identity, not routing: a later manifest is matched to an installed app
  // by `id`, so these three drifting would orphan an already-installed app
  // rather than update it.
  const result = buildPwaManifest();

  assert.equal(result.id, PWA_APP_ID);
  assert.equal(result.start_url, PWA_START_URL);
  assert.equal(result.scope, PWA_SCOPE);
  assert.equal(result.display, 'standalone');
  assert.equal(result.theme_color, PWA_THEME_COLOR);
  assert.equal(result.background_color, PWA_BACKGROUND_COLOR);
});

void test('the manifest lists exactly the declared manifest icons, with their purposes kept apart', () => {
  const result = buildPwaManifest();
  const icons = result.icons ?? [];

  assert.deepEqual(
    icons.map((icon) => ({ src: icon.src, sizes: icon.sizes, purpose: icon.purpose })),
    PWA_ICON_ASSETS.filter((asset) => asset.role === 'manifest').map((asset) => ({
      src: asset.path,
      sizes: `${String(asset.size)}x${String(asset.size)}`,
      purpose: asset.purpose ?? 'any',
    })),
  );
  // One file cannot be correct for both purposes: `any` art fills the
  // canvas, `maskable` art has to sit inside the safe zone, so reusing a
  // single PNG under both purposes would be wrong for one of them.
  const anySources = icons.filter((icon) => icon.purpose === 'any').map((icon) => icon.src);
  const maskableSources = icons
    .filter((icon) => icon.purpose === 'maskable')
    .map((icon) => icon.src);

  assert.ok(anySources.length > 0 && maskableSources.length > 0);
  for (const source of maskableSources) {
    assert.equal(
      anySources.includes(source),
      false,
      `${source} is served as both any and maskable art`,
    );
  }
  assert.ok(icons.every((icon) => icon.type === 'image/png'));
});

void test('the manifest path the proxy exempts is the one Next.js serves', () => {
  // src/app/manifest.ts is served at /manifest.webmanifest; exempting any
  // other path would leave the real manifest behind the auth boundary,
  // where an install prompt could never fetch it.
  assert.equal(PWA_MANIFEST_PATH, '/manifest.webmanifest');
  assert.ok(PWA_PUBLIC_ASSET_PATHS.includes(PWA_MANIFEST_PATH));
});

// --- Colours stay design tokens rather than new brand values ---

void test('the manifest colours still match the design tokens they were taken from', () => {
  const tokens = readRepositoryFile('src/ui/tokens.css');
  const accent = /--color-accent:\s*(#[0-9a-fA-F]{6})/.exec(tokens)?.[1];
  const canvas = /--color-canvas:\s*(#[0-9a-fA-F]{6})/.exec(tokens)?.[1];

  assert.ok(
    accent !== undefined && canvas !== undefined,
    'expected both tokens in src/ui/tokens.css',
  );
  assert.equal(PWA_THEME_COLOR, accent.toLowerCase());
  assert.equal(PWA_BACKGROUND_COLOR, canvas.toLowerCase());
});

// --- Out of scope stays out of scope ---

void test('no Service Worker, offline cache or push subscription is introduced', () => {
  // Issue #304 keeps all of these out: installability is the bounded goal
  // and a Service Worker is only worth adding once Web Push has a use for
  // it. Asserted here because "we did not add X" is otherwise invisible to
  // every other check.
  const publicEntries = readdirSync(fileURLToPath(new URL('public', repositoryRoot)), {
    recursive: true,
    withFileTypes: true,
  });
  for (const entry of publicEntries) {
    assert.doesNotMatch(entry.name, /^(sw|service-worker|workbox.*)\.js$/);
  }

  const sourceFiles = readdirSync(fileURLToPath(new URL('src', repositoryRoot)), {
    recursive: true,
    withFileTypes: true,
  }).filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name));

  for (const entry of sourceFiles) {
    const contents = readFileSync(`${entry.parentPath}/${entry.name}`, 'utf8');
    // This file names them to assert their absence, so it cannot check itself.
    if (entry.name === 'appIdentity.test.ts') continue;
    assert.doesNotMatch(contents, /serviceWorker\.register|pushManager|PushSubscription/);
  }
});
