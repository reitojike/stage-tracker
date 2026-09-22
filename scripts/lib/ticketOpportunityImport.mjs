// Compatibility adapter for the operator CLI and existing script tests.
// Validation, resolution, planning, reporting, and apply ownership lives in
// @stage-tracker/official-import; only local seed-file loading remains here.
import fs from 'node:fs';
import path from 'node:path';
import {
  applyPlans,
  formatPlanReport,
  resolvePlans,
  validateSeedEntries,
} from '@stage-tracker/official-import/ticket';

export { applyPlans, formatPlanReport, resolvePlans, validateSeedEntries };

export function seedFilePaths(entry) {
  const stat = fs.statSync(entry);
  if (stat.isDirectory()) {
    return fs
      .readdirSync(entry)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => path.join(entry, name));
  }
  return [entry];
}

export function loadAndValidateSeed(target) {
  const rawEntries = [];
  const problems = [];
  for (const file of seedFilePaths(target)) {
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
  return validateSeedEntries(rawEntries);
}
