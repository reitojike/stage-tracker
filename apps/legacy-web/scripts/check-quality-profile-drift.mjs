import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveFoundationCheckout } from './foundation-checkout.mjs';

const foundationRoot = resolveFoundationCheckout();
const source = path.join(foundationRoot, 'profiles', 'next-supabase', 'quality');
const destination = path.join(process.cwd(), '.ai-dev-foundation', 'quality');

const drifted = [];
const sourceFiles = new Set();
for (const file of await readdir(source, { recursive: true })) {
  const sourcePath = path.join(source, file);
  const destinationPath = path.join(destination, file);
  const [sourceContent, destinationContent] = await Promise.all([
    readFile(sourcePath, 'utf8').catch(() => null),
    readFile(destinationPath, 'utf8').catch(() => null),
  ]);
  if (sourceContent === null) continue; // directory entry
  sourceFiles.add(file);
  if (sourceContent !== destinationContent) drifted.push(file);
}

// A file the pinned Foundation revision removed or renamed would otherwise
// go undetected: the loop above only walks `source`, so a stale destination
// entry with no matching source entry never gets compared.
for (const file of await readdir(destination, { recursive: true }).catch(() => [])) {
  if (sourceFiles.has(file)) continue;
  const destinationContent = await readFile(path.join(destination, file), 'utf8').catch(() => null);
  if (destinationContent !== null) drifted.push(file);
}

if (drifted.length > 0) {
  console.error(`Foundation-managed quality profile drift detected: ${drifted.join(', ')}`);
  console.error(
    `Run: node ${path.join(foundationRoot, 'tooling', 'bootstrap-next-supabase.mjs')} --consumer .`,
  );
  process.exitCode = 1;
} else {
  console.log('Foundation-managed quality profile is current.');
}
