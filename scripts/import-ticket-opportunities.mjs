import { resolveAdminTarget } from './lib/adminTarget.mjs';
import {
  loadAndValidateSeed,
  resolvePlans,
  formatPlanReport,
  applyPlans,
} from './lib/ticketOpportunityImport.mjs';

// Operator-assisted TicketOpportunity import (Issue #163, over the #162
// landed model).
//
// Same authority principle as scripts/import-catalog-events.mjs (Issue
// #73): official Ticket source pages/PDFs are the source of truth for the
// schedule, Production DB is stage-tracker's current shared Ticket
// planning state, and a local seed file is a reviewable cache in between -
// never a canonical archive. This script does not fetch anything from any
// source; an agent reads the official page/PDF on request and writes the
// seed file (outside this repository, not committed - see
// docs/runbooks/ticket-opportunity-import.md), an operator reviews the
// seed and this script's dry-run output, and only an explicit --apply
// writes to the database.
//
// Deliberately NOT here: any site-specific HTML/PDF parser, a crawler, or
// a scheduled refresh - the seed format exists so heterogeneous sources
// (宝塚友の会 PDF, Vpass, 松竹, artist/FC pages, ...) can all be reviewed in
// one shape without this repository needing to understand any of their
// page layouts.
//
// This script writes only shared TicketOpportunity data
// (ticket_opportunities / ticket_opportunity_target_occurrences /
// ticket_opportunity_milestones) through the service_role-only
// import_ticket_opportunity RPC. It never touches
// user_ticket_opportunity_states (personal planned/applied state) - see
// scripts/lib/ticketOpportunityImport.mjs's own header.
//
// Deliberately NOT here: no delete path exists anywhere in this script or
// its lib modules. An Opportunity absent from a seed run is left
// completely untouched - a seed directory typically covers one
// source/production batch, not the whole catalog, so "delete whatever the
// seed doesn't mention" would silently destroy unrelated Opportunities.
// This is intentional (#163 explicitly rules out directory-level
// stale-removal as out of scope), not an oversight to "fix" by adding one.
//
// Local:  node scripts/import-ticket-opportunities.mjs <path>
// Apply:  node scripts/import-ticket-opportunities.mjs <path> --apply
// Remote: node scripts/import-ticket-opportunities.mjs <path> --remote [--apply]
//   (requires STAGE_TRACKER_REMOTE_SUPABASE_URL /
//   STAGE_TRACKER_REMOTE_SERVICE_ROLE_KEY - see scripts/lib/adminTarget.mjs)
//
// Dry run is the default. Nothing is written without --apply. Unlike
// import-catalog-events.mjs, no --owner is required: a TicketOpportunity
// has no owner concept (product-rules.md "Ticket Opportunity" /
// "Shared / personal authority boundary").

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const apply = args.includes('--apply');
const target = args.find((arg) => !arg.startsWith('--'));

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  process.exit();
}

if (typeof target !== 'string') {
  fail(
    'Usage: node scripts/import-ticket-opportunities.mjs <file-or-directory> [--apply] [--remote]',
  );
}

const loaded = loadAndValidateSeed(target);
if (!loaded.ok) {
  fail(`Invalid seed:\n  - ${loaded.problems.join('\n  - ')}`);
}

const admin = resolveAdminTarget(remote);

const resolved = await resolvePlans(admin, loaded.entries);
if (!resolved.ok) {
  fail(
    `Seed does not resolve against the current catalog:\n  - ${resolved.problems.join('\n  - ')}`,
  );
}

console.log(formatPlanReport(resolved.plans, { apply, remote }));

if (!apply) {
  process.exit();
}

try {
  await applyPlans(admin, resolved.plans);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
console.log('\nDone.\n');
