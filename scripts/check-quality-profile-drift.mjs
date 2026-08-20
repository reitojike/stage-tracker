import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const foundationRoot = path.resolve(process.env.FOUNDATION_CHECKOUT ?? '../ai-dev-foundation');
const source = path.join(foundationRoot, 'profiles', 'next-supabase', 'quality');
const destination = path.join(process.cwd(), '.ai-dev-foundation', 'quality');

if (!existsSync(source)) {
  console.error(
    `Foundation checkout not found at ${foundationRoot}.\n` +
      'Set FOUNDATION_CHECKOUT to a local ai-dev-foundation checkout pinned to the ' +
      'SHA recorded in .ai-dev-foundation/product-rules.md / the bootstrap Issue.',
  );
  process.exitCode = 1;
  process.exit();
}

const drifted = [];
for (const file of await readdir(source, { recursive: true })) {
  const sourcePath = path.join(source, file);
  const destinationPath = path.join(destination, file);
  const [sourceContent, destinationContent] = await Promise.all([
    readFile(sourcePath, 'utf8').catch(() => null),
    readFile(destinationPath, 'utf8').catch(() => null),
  ]);
  if (sourceContent === null) continue; // directory entry
  if (sourceContent !== destinationContent) drifted.push(file);
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
