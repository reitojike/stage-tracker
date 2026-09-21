import fs from 'node:fs';
import path from 'node:path';
import { resolveAdminTarget } from './lib/adminTarget.mjs';
import { findUserByEmail } from './lib/findUserByEmail.mjs';
import {
  applyEventPlans,
  formatEventPlanReport,
  resolveEventPlans,
  validateEventEntries,
} from '@stage-tracker/official-import/event';

// Operator-assisted catalog import (Issue #73). This CLI intentionally keeps
// its existing interface and owns only argv parsing, local seed loading,
// operator credential resolution, console output, and exit handling. The
// validation/resolution/plan/apply implementation is shared with workflow
// callers through @stage-tracker/official-import.

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const apply = args.includes('--apply');
const ownerIndex = args.indexOf('--owner');
const ownerEmail = ownerIndex === -1 ? undefined : args[ownerIndex + 1];
const positional = args.filter((arg, index) => !arg.startsWith('--') && index !== ownerIndex + 1);
const target = positional[0];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  process.exit();
}

if (typeof target !== 'string' || typeof ownerEmail !== 'string' || ownerEmail.length === 0) {
  fail(
    'Usage: node scripts/import-catalog-events.mjs <file-or-directory> --owner <email> [--apply] [--remote]',
  );
}

function seedFilePaths(entry) {
  const stat = fs.statSync(entry);
  if (stat.isDirectory())
    return fs
      .readdirSync(entry)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => path.join(entry, name));
  return [entry];
}

function loadEntries(entry) {
  const rawEntries = [];
  const problems = [];
  for (const file of seedFilePaths(entry)) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      problems.push(`${file}: not valid JSON (${error.message})`);
      continue;
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    list.forEach((raw, index) => rawEntries.push({ raw, where: `${file}[${index}]` }));
  }
  if (problems.length > 0) return { ok: false, problems };
  return validateEventEntries(rawEntries);
}

const loaded = loadEntries(target);
if (!loaded.ok) fail(loaded.problems.join('\n'));

const admin = resolveAdminTarget(remote);
let owner;
try {
  owner = await findUserByEmail(admin, ownerEmail);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
if (owner === null)
  fail(
    `No account found for ${ownerEmail}. Provision it first: node scripts/provision-user.mjs ${ownerEmail}${remote ? ' --remote' : ''}`,
  );

const resolved = await resolveEventPlans(admin, loaded.entries, { owner, ownerEmail, remote });
if (!resolved.ok) fail(resolved.problems.join('\n'));

console.log(
  formatEventPlanReport(resolved.plans, { apply, remote, ownerEmail, ownerId: owner.id }),
);
if (!apply) process.exit();

const result = await applyEventPlans(admin, resolved.plans, { ownerId: owner.id });
for (const sourceKey of result.applied) console.log(`applied ${sourceKey}`);
if (!result.ok) fail(result.error);
console.log('\nDone.\n');
