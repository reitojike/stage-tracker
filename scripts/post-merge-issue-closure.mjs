import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  applyAcceptanceCriteriaUpdates,
  completionEvidenceMarker,
  evaluatePostMergeIssueClosure,
  findCompletionEvidence,
  isFullSha,
  isSufficientCompletionEvidence,
  parseAcceptanceCriteria,
  sha256,
} from './lib/postMergeIssueClosure.mjs';

const REPO_PATTERN = /^[^/\s]+\/[^/\s]+$/u;
const BODY_SHA_PATTERN = /^[0-9a-f]{64}$/iu;
const ACCEPT_HEADER = 'Accept: application/vnd.github+json';

class GhCommandError extends Error {
  constructor(args, result) {
    const stderr = String(result.stderr ?? '').trim();
    const stdout = String(result.stdout ?? '').trim();
    super(`gh ${args.join(' ')} failed${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ''}`);
    this.name = 'GhCommandError';
    this.exitCode = result.status ?? null;
  }
}

function runGh(args) {
  const result = spawnSync('gh', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
  });

  if (result.error || result.status !== 0) {
    throw new GhCommandError(args, {
      ...result,
      stderr: result.error?.message ?? result.stderr,
    });
  }

  return String(result.stdout ?? '').trim();
}

function parseJson(raw, description) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`GitHub returned invalid JSON for ${description}: ${error.message}`);
  }
}

function apiJson(path) {
  return parseJson(runGh(['api', path, '--header', ACCEPT_HEADER]), path);
}

function apiList(path) {
  const pages = parseJson(
    runGh(['api', path, '--paginate', '--slurp', '--header', ACCEPT_HEADER]),
    path,
  );
  if (!Array.isArray(pages)) throw new Error(`GitHub response for ${path} was not paginated JSON`);
  return pages.flatMap((page) => {
    if (!Array.isArray(page)) throw new Error(`GitHub response page for ${path} was not a list`);
    return page;
  });
}

function parseNumber(value, flag) {
  if (!/^\d+$/u.test(value)) throw new Error(`${flag} must be a positive integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${flag} is outside the supported range`);
  }
  return number;
}

function parseArgs(argv) {
  const options = {
    command: null,
    repo: null,
    issue: null,
    pr: null,
    expectedBodySha256: null,
    checkIndexes: [],
    evidenceFile: null,
    allowCompletion: false,
    semanticAcVerified: false,
    noKnownRemainingWork: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--allow-completion':
        options.allowCompletion = true;
        break;
      case '--semantic-ac-verified':
        options.semanticAcVerified = true;
        break;
      case '--no-known-remaining-work':
        options.noKnownRemainingWork = true;
        break;
      case '--repo':
        options.repo = argv[++index];
        break;
      case '--issue':
        options.issue = parseNumber(argv[++index], '--issue');
        break;
      case '--pr':
        options.pr = parseNumber(argv[++index], '--pr');
        break;
      case '--check-index':
        options.checkIndexes.push(parseNumber(argv[++index], '--check-index'));
        break;
      case '--expected-body-sha256':
        options.expectedBodySha256 = argv[++index];
        break;
      case '--evidence-file':
        options.evidenceFile = argv[++index];
        break;
      default:
        if (typeof argument === 'string' && argument.startsWith('--')) {
          throw new Error(`unknown option: ${argument}`);
        }
        if (options.command !== null) throw new Error(`unexpected argument: ${argument}`);
        options.command = argument;
        break;
    }
  }

  if (options.expectedBodySha256 !== null && !BODY_SHA_PATTERN.test(options.expectedBodySha256)) {
    throw new Error('--expected-body-sha256 must be a 64-character hexadecimal SHA-256 value');
  }
  if (options.repo !== null && !REPO_PATTERN.test(options.repo)) {
    throw new Error('--repo must use the owner/name form');
  }
  return options;
}

function printUsage() {
  console.log(`Usage:
  pnpm run post-merge:closure -- snapshot --repo owner/name --issue N --pr N
  pnpm run post-merge:closure -- update --repo owner/name --issue N --pr N
    --expected-body-sha256 SHA256 --check-index N [--check-index N ...]
    --allow-completion --semantic-ac-verified --no-known-remaining-work
  pnpm run post-merge:closure -- evidence --repo owner/name --issue N --pr N
    --evidence-file PATH --allow-completion --semantic-ac-verified --no-known-remaining-work
  pnpm run post-merge:closure -- verify --repo owner/name --issue N --pr N
    --allow-completion --semantic-ac-verified --no-known-remaining-work
  pnpm run post-merge:closure -- close --repo owner/name --issue N --pr N
    --allow-completion --semantic-ac-verified --no-known-remaining-work

snapshot is read-only. update changes only explicitly selected top-level AC
checkboxes after an expected-body hash and immediate fresh-read guard. evidence posts
one identity-marked completion comment when needed. verify and close require
all agent assertions; close performs a fresh final read and a state-only GitHub
update. All failures are HOLD.`);
}

function resolveRepository(repo) {
  if (repo !== null) return repo;
  const resolved = runGh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  const name = resolved.trim();
  if (!REPO_PATTERN.test(name)) throw new Error('gh repo view did not return owner/name');
  return name;
}

function readIssue(repo, issueNumber) {
  const issue = apiJson(`repos/${repo}/issues/${issueNumber}`);
  if (issue === null || typeof issue !== 'object' || Array.isArray(issue)) {
    throw new Error('GitHub Issue response was not an object');
  }

  const body = typeof issue.body === 'string' ? issue.body : null;
  return {
    number: issue.number ?? issueNumber,
    state: issue.state,
    stateReason: issue.state_reason ?? null,
    body,
    bodySha256: body === null ? null : sha256(body),
    title: issue.title ?? null,
    htmlUrl: issue.html_url ?? null,
    updatedAt: issue.updated_at ?? null,
  };
}

function readPullRequest(repo, prNumber) {
  const pullRequest = apiJson(`repos/${repo}/pulls/${prNumber}`);
  if (pullRequest === null || typeof pullRequest !== 'object' || Array.isArray(pullRequest)) {
    throw new Error('GitHub pull request response was not an object');
  }
  return {
    number: pullRequest.number ?? prNumber,
    state: pullRequest.state ?? null,
    merged: pullRequest.merged === true,
    merge_commit_sha: pullRequest.merge_commit_sha ?? null,
    htmlUrl: pullRequest.html_url ?? null,
    title: pullRequest.title ?? null,
    headSha: pullRequest.head?.sha ?? null,
    baseRef: pullRequest.base?.ref ?? null,
  };
}

function readComments(repo, issueNumber) {
  return apiList(`repos/${repo}/issues/${issueNumber}/comments?per_page=100`);
}

function readClosureSnapshot(repo, options, { comments = true } = {}) {
  const issue = readIssue(repo, options.issue);
  const pullRequest = readPullRequest(repo, options.pr);
  const acceptanceCriteria = parseAcceptanceCriteria(issue.body);
  return {
    issue,
    pullRequest,
    acceptanceCriteria,
    comments: comments ? readComments(repo, options.issue) : [],
  };
}

function assertAgentAssertions(options) {
  const missing = [];
  if (options.allowCompletion !== true) missing.push('--allow-completion');
  if (options.semanticAcVerified !== true) missing.push('--semantic-ac-verified');
  if (options.noKnownRemainingWork !== true) missing.push('--no-known-remaining-work');
  if (missing.length > 0) {
    throw new Error(`missing explicit agent assertions: ${missing.join(', ')}`);
  }
}

function assertMergedPullRequest(pullRequest) {
  if (pullRequest.merged !== true || !isFullSha(pullRequest.merge_commit_sha)) {
    throw new Error('implementation PR is not confirmed merged with a known merge SHA');
  }
}

function assertOpenIssue(issue) {
  if (String(issue.state ?? '').toLowerCase() !== 'open') {
    throw new Error('Issue is not open');
  }
}

function summarizeAcceptanceCriteria(criteria) {
  if (criteria.status !== 'clear') {
    return { status: criteria.status, reason: criteria.reason };
  }
  return {
    status: criteria.status,
    uncheckedCount: criteria.uncheckedCount,
    items: criteria.items.map(({ index, checked, text }) => ({ index, checked, text })),
  };
}

function snapshotReport(snapshot, options) {
  return {
    status: 'SNAPSHOT',
    issueNumber: snapshot.issue.number,
    issueState: snapshot.issue.state,
    issueUrl: snapshot.issue.htmlUrl,
    prNumber: snapshot.pullRequest.number,
    prState: snapshot.pullRequest.state,
    prMerged: snapshot.pullRequest.merged,
    mergeSha: snapshot.pullRequest.merge_commit_sha,
    bodySha256: snapshot.issue.bodySha256,
    acceptanceCriteria: summarizeAcceptanceCriteria(snapshot.acceptanceCriteria),
    body: snapshot.issue.body,
    semanticBoundary:
      'The agent must review each AC against merged evidence; this command only reports the fresh snapshot.',
    agentAssertions: {
      completionAllowed: options.allowCompletion,
      semanticAcVerified: options.semanticAcVerified,
      noKnownRemainingWork: options.noKnownRemainingWork,
    },
  };
}

function closureReport(snapshot, result, options) {
  return {
    ...result,
    issueNumber: snapshot.issue.number,
    issueState: snapshot.issue.state,
    issueUrl: snapshot.issue.htmlUrl,
    prNumber: snapshot.pullRequest.number,
    prState: snapshot.pullRequest.state,
    prMerged: snapshot.pullRequest.merged,
    mergeSha: snapshot.pullRequest.merge_commit_sha,
    bodySha256: snapshot.issue.bodySha256,
    acceptanceCriteria: summarizeAcceptanceCriteria(snapshot.acceptanceCriteria),
    evidence: {
      status: result.evidence?.status ?? 'missing',
      marker: result.evidence?.marker ?? null,
      commentCount: result.evidence?.comments?.length ?? 0,
    },
    agentAssertions: {
      completionAllowed: options.allowCompletion,
      semanticAcVerified: options.semanticAcVerified,
      noKnownRemainingWork: options.noKnownRemainingWork,
    },
  };
}

function printReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const reasons = report.reasons ?? (report.reason ? [report.reason] : []);
  console.log(`${report.status}: ${reasons.join('; ') || 'completed'}`);
  if (report.issueNumber !== undefined) {
    console.log(`Issue: ${report.issueUrl ?? report.issueNumber}`);
    console.log(`PR: ${report.prNumber ?? 'unknown'}`);
    console.log(`Merge SHA: ${report.mergeSha ?? 'unknown'}`);
  }
  if (report.bodySha256) console.log(`Body SHA-256: ${report.bodySha256}`);
  if (report.acceptanceCriteria?.status) {
    console.log(
      `Acceptance Criteria: ${report.acceptanceCriteria.status}` +
        (report.acceptanceCriteria.uncheckedCount === undefined
          ? ''
          : `; unchecked=${report.acceptanceCriteria.uncheckedCount}`),
    );
  }
  if (report.evidence?.status) console.log(`Evidence: ${report.evidence.status}`);
  if (report.body !== undefined) {
    console.log('\nFresh Issue body:\n');
    console.log(report.body ?? '<missing>');
  }
}

function holdReport(error, options = {}) {
  return {
    status: 'HOLD',
    readyToClose: false,
    reasons: [error instanceof Error ? error.message : String(error)],
    ...options,
  };
}

function patchIssueBody(repo, issue, body) {
  const raw = runGh([
    'api',
    `repos/${repo}/issues/${issue.number}`,
    '--method',
    'PATCH',
    '--header',
    ACCEPT_HEADER,
    '--raw-field',
    `body=${body}`,
  ]);
  return parseJson(raw, `Issue #${issue.number} body update`);
}

function patchIssueClosed(repo, issue) {
  const raw = runGh([
    'api',
    `repos/${repo}/issues/${issue.number}`,
    '--method',
    'PATCH',
    '--header',
    ACCEPT_HEADER,
    '--raw-field',
    'state=closed',
    '--raw-field',
    'state_reason=completed',
  ]);
  return parseJson(raw, `Issue #${issue.number} close`);
}

function postComment(repo, issueNumber, body) {
  const raw = runGh([
    'api',
    `repos/${repo}/issues/${issueNumber}/comments`,
    '--method',
    'POST',
    '--header',
    ACCEPT_HEADER,
    '--raw-field',
    `body=${body}`,
  ]);
  return parseJson(raw, `Issue #${issueNumber} completion evidence comment`);
}

function runSnapshot(repo, options) {
  return snapshotReport(readClosureSnapshot(repo, options, { comments: false }), options);
}

function runUpdate(repo, options) {
  assertAgentAssertions(options);
  if (options.expectedBodySha256 === null) {
    throw new Error('--expected-body-sha256 is required for update');
  }
  if (options.checkIndexes.length === 0) {
    throw new Error('update requires at least one --check-index');
  }

  const snapshot = readClosureSnapshot(repo, options, { comments: false });
  assertOpenIssue(snapshot.issue);
  assertMergedPullRequest(snapshot.pullRequest);
  if (snapshot.issue.bodySha256 !== options.expectedBodySha256) {
    throw new Error(
      'Issue body changed since the semantic snapshot; refusing to overwrite a concurrent edit',
    );
  }
  if (snapshot.acceptanceCriteria.status !== 'clear') {
    throw new Error(snapshot.acceptanceCriteria.reason);
  }

  const plan = applyAcceptanceCriteriaUpdates(
    snapshot.issue.body,
    snapshot.acceptanceCriteria,
    options.checkIndexes,
  );
  if (plan.bodyChanged) patchIssueBody(repo, snapshot.issue, plan.body);

  const after = readIssue(repo, options.issue);
  if (after.bodySha256 !== sha256(plan.body)) {
    throw new Error('Issue body update could not be confirmed after the write; HOLD');
  }
  const afterCriteria = parseAcceptanceCriteria(after.body);
  if (
    afterCriteria.status !== 'clear' ||
    options.checkIndexes.some((index) => !afterCriteria.items[index - 1]?.checked)
  ) {
    throw new Error(
      'expected Acceptance Criteria checkbox state was not confirmed after the write',
    );
  }

  return {
    status: 'UPDATED',
    readyToClose: false,
    reasons: [
      plan.bodyChanged
        ? `updated explicitly selected Acceptance Criteria item(s): ${plan.changedIndexes.join(', ')}`
        : 'selected Acceptance Criteria items were already checked; no body write was needed',
    ],
    issueNumber: after.number,
    issueState: after.state,
    issueUrl: after.htmlUrl,
    prNumber: snapshot.pullRequest.number,
    mergeSha: snapshot.pullRequest.merge_commit_sha,
    bodySha256: after.bodySha256,
    acceptanceCriteria: summarizeAcceptanceCriteria(afterCriteria),
    guardedByBodySha256: options.expectedBodySha256,
    bodyWritePerformed: plan.bodyChanged,
    agentAssertions: {
      completionAllowed: options.allowCompletion,
      semanticAcVerified: options.semanticAcVerified,
      noKnownRemainingWork: options.noKnownRemainingWork,
    },
  };
}

function readEvidenceFile(path) {
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`could not read --evidence-file ${path}: ${error.message}`);
  }
  const trimmed = content.trim();
  if (trimmed.length === 0) throw new Error('completion evidence file is empty');
  if (trimmed.includes('<!-- stage-tracker:post-merge-completion')) {
    throw new Error('completion evidence file must not provide its own identity marker');
  }
  return trimmed;
}

function runEvidence(repo, options) {
  assertAgentAssertions(options);
  if (options.evidenceFile === null) throw new Error('--evidence-file is required for evidence');

  const snapshot = readClosureSnapshot(repo, options);
  assertOpenIssue(snapshot.issue);
  assertMergedPullRequest(snapshot.pullRequest);
  if (snapshot.acceptanceCriteria.status !== 'clear') {
    throw new Error(snapshot.acceptanceCriteria.reason);
  }
  if (snapshot.acceptanceCriteria.uncheckedCount !== 0) {
    throw new Error(
      `${snapshot.acceptanceCriteria.uncheckedCount} unchecked Acceptance Criteria item(s) remain`,
    );
  }

  const identity = {
    issueNumber: snapshot.issue.number,
    prNumber: snapshot.pullRequest.number,
    mergeSha: snapshot.pullRequest.merge_commit_sha,
  };
  const marker = completionEvidenceMarker(identity);
  const currentEvidence = findCompletionEvidence(snapshot.comments, identity);
  if (currentEvidence.status === 'present') {
    return {
      status: 'EVIDENCE_EXISTS',
      readyToClose: false,
      reasons: ['matching sufficient completion evidence already exists; no duplicate was posted'],
      ...closureReport(snapshot, { evidence: currentEvidence }, options),
    };
  }
  if (currentEvidence.status !== 'missing') {
    throw new Error(
      `matching completion evidence is ${currentEvidence.status}; manual review required`,
    );
  }

  const content = readEvidenceFile(options.evidenceFile);
  const evidenceBody = `${marker}\n\n${content}\n`;
  if (!isSufficientCompletionEvidence(evidenceBody, identity)) {
    throw new Error(
      'completion evidence must include Implementation PR, Merge commit, Acceptance Criteria, Verification, Review, and Unresolved items: 0',
    );
  }

  postComment(repo, options.issue, evidenceBody);
  const afterComments = readComments(repo, options.issue);
  const afterEvidence = findCompletionEvidence(afterComments, identity);
  if (afterEvidence.status !== 'present') {
    throw new Error(`completion evidence was not confirmed after posting: ${afterEvidence.status}`);
  }

  return {
    status: 'EVIDENCE_POSTED',
    readyToClose: false,
    reasons: ['durable completion evidence was posted and confirmed'],
    ...closureReport(
      { ...snapshot, comments: afterComments },
      { evidence: afterEvidence },
      options,
    ),
  };
}

function evaluateSnapshot(snapshot, options) {
  assertAgentAssertions(options);
  return evaluatePostMergeIssueClosure({
    issue: snapshot.issue,
    pullRequest: snapshot.pullRequest,
    acceptanceCriteria: snapshot.acceptanceCriteria,
    comments: snapshot.comments,
    completionAllowed: options.allowCompletion,
    semanticAcVerified: options.semanticAcVerified,
    noKnownRemainingWork: options.noKnownRemainingWork,
  });
}

function runVerify(repo, options) {
  const snapshot = readClosureSnapshot(repo, options);
  const result = evaluateSnapshot(snapshot, options);
  return closureReport(snapshot, result, options);
}

function runClose(repo, options) {
  const firstSnapshot = readClosureSnapshot(repo, options);
  const firstResult = evaluateSnapshot(firstSnapshot, options);
  if (!firstResult.readyToClose) return closureReport(firstSnapshot, firstResult, options);

  // Re-read immediately before the state mutation. The body hash catches an
  // unrelated concurrent edit observed before the state-only close request.
  const latestIssue = readIssue(repo, options.issue);
  if (latestIssue.bodySha256 !== firstSnapshot.issue.bodySha256) {
    return {
      status: 'HOLD',
      readyToClose: false,
      reasons: ['Issue body changed during close preparation; refusing to close'],
      ...closureReport(
        { ...firstSnapshot, issue: latestIssue },
        { evidence: { status: 'missing', marker: null, comments: [] } },
        options,
      ),
    };
  }
  const latestSnapshot = {
    issue: latestIssue,
    pullRequest: readPullRequest(repo, options.pr),
    acceptanceCriteria: parseAcceptanceCriteria(latestIssue.body),
    comments: readComments(repo, options.issue),
  };
  const latestResult = evaluateSnapshot(latestSnapshot, options);
  if (!latestResult.readyToClose) return closureReport(latestSnapshot, latestResult, options);

  patchIssueClosed(repo, latestIssue);
  const after = readIssue(repo, options.issue);
  if (
    String(after.state ?? '').toLowerCase() !== 'closed' ||
    String(after.stateReason ?? '').toLowerCase() !== 'completed'
  ) {
    throw new Error(
      'Issue close response was not confirmed as state=closed, state_reason=completed',
    );
  }

  return {
    status: 'CLOSED',
    readyToClose: true,
    reasons: ['Issue closed with state_reason=completed after final prerequisite recheck'],
    issueNumber: after.number,
    issueState: after.state,
    issueUrl: after.htmlUrl,
    prNumber: latestSnapshot.pullRequest.number,
    mergeSha: latestSnapshot.pullRequest.merge_commit_sha,
    bodySha256: after.bodySha256,
    stateReason: after.stateReason,
    acceptanceCriteria: summarizeAcceptanceCriteria(parseAcceptanceCriteria(after.body)),
    evidence: latestResult.evidence,
    agentAssertions: {
      completionAllowed: options.allowCompletion,
      semanticAcVerified: options.semanticAcVerified,
      noKnownRemainingWork: options.noKnownRemainingWork,
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || options.command === null) {
    printUsage();
    return 0;
  }

  const commands = new Set(['snapshot', 'update', 'evidence', 'verify', 'close']);
  if (!commands.has(options.command)) throw new Error(`unknown command: ${options.command}`);
  if (options.issue === null) throw new Error('--issue is required');
  if (options.pr === null) throw new Error('--pr is required');

  const repo = resolveRepository(options.repo);
  let report;
  switch (options.command) {
    case 'snapshot':
      report = runSnapshot(repo, options);
      break;
    case 'update':
      report = runUpdate(repo, options);
      break;
    case 'evidence':
      report = runEvidence(repo, options);
      break;
    case 'verify':
      report = runVerify(repo, options);
      break;
    case 'close':
      report = runClose(repo, options);
      break;
    default:
      throw new Error(`unsupported command: ${options.command}`);
  }

  printReport(report, options.json);
  return report.status === 'HOLD' ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  const json = process.argv.includes('--json');
  printReport(holdReport(error), json);
  process.exitCode = 1;
}
