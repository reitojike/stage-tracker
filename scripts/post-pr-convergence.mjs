import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import {
  CODEX_REVIEW_TRIGGER,
  POST_PR_POLICY,
  evaluateCi,
  evaluatePostPrConvergence,
  evaluateReview,
  latestReviewRequestObservation,
  shouldStopBeforeConvergence,
} from './lib/postPrConvergence.mjs';

const REPO_PATTERN = /^[^/\s]+\/[^/\s]+$/u;
const REVIEW_THREADS_QUERY = `
  query($owner: String!, $name: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $after) {
          nodes {
            id
            isResolved
            isOutdated
            path
            line
            comments(first: 100) {
              nodes {
                id
                body
                createdAt
                url
                author { login }
                commit { oid }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

class GhCommandError extends Error {
  constructor(args, result) {
    const stderr = String(result.stderr ?? '').trim();
    const stdout = String(result.stdout ?? '').trim();
    super(`gh ${args.join(' ')} failed${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ''}`);
    this.name = 'GhCommandError';
    this.args = args;
    this.stderr = stderr;
    this.stdout = stdout;
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

function apiJson(path) {
  const raw = runGh(['api', path, '--header', 'Accept: application/vnd.github+json']);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`GitHub API returned invalid JSON for ${path}: ${error.message}`);
  }
}

function apiPages(path) {
  const raw = runGh([
    'api',
    path,
    '--paginate',
    '--slurp',
    '--header',
    'Accept: application/vnd.github+json',
  ]);
  try {
    const pages = JSON.parse(raw);
    if (!Array.isArray(pages)) throw new Error('paginated response is not an array');
    return pages;
  } catch (error) {
    throw new Error(`GitHub API returned invalid paginated JSON for ${path}: ${error.message}`);
  }
}

function apiList(path) {
  return apiPages(path).flatMap((page) => {
    if (Array.isArray(page)) return page;
    throw new Error(`GitHub API returned a non-list page for ${path}`);
  });
}

function apiItems(path, key) {
  return apiPages(path).flatMap((page) => {
    if (Array.isArray(page?.[key])) return page[key];
    throw new Error(`GitHub API page for ${path} did not include ${key}`);
  });
}

function graphqlJson(args) {
  const raw = runGh(['api', 'graphql', ...args]);
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error(`GitHub GraphQL API returned invalid JSON: ${error.message}`);
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(
      `GitHub GraphQL API returned errors: ${payload.errors.map((item) => item.message).join('; ')}`,
    );
  }
  return payload;
}

function parseNumber(value, flag, { allowZero = false } = {}) {
  if (!/^\d+$/u.test(value)) throw new Error(`${flag} must be a non-negative integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || (!allowZero && number === 0)) {
    throw new Error(`${flag} is outside the supported range`);
  }
  return number;
}

function parseArgs(argv) {
  const options = {
    base: POST_PR_POLICY.baseBranch,
    ciTimeoutSeconds: POST_PR_POLICY.ciTimeoutMs / 1000,
    reviewTimeoutSeconds: POST_PR_POLICY.reviewTimeoutMs / 1000,
    pollSeconds: 20,
    correctionAttempt: 0,
    json: false,
    create: false,
    once: false,
  };

  const valueFlags = new Map([
    ['--pr', 'pr'],
    ['--repo', 'repo'],
    ['--base', 'base'],
    ['--title', 'title'],
    ['--body', 'body'],
    ['--body-file', 'bodyFile'],
    ['--ci-timeout-seconds', 'ciTimeoutSeconds'],
    ['--review-timeout-seconds', 'reviewTimeoutSeconds'],
    ['--poll-seconds', 'pollSeconds'],
    ['--correction-attempt', 'correctionAttempt'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (argument === '--create') {
      options.create = true;
      continue;
    }
    if (argument === '--once') {
      options.once = true;
      continue;
    }

    const equalsIndex = argument.indexOf('=');
    const flag = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
    if (!valueFlags.has(flag)) throw new Error(`unknown option: ${argument}`);
    const value = equalsIndex === -1 ? argv[++index] : argument.slice(equalsIndex + 1);
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    options[valueFlags.get(flag)] = value;
  }

  if (options.help) return options;
  if (options.repo !== undefined && !REPO_PATTERN.test(options.repo)) {
    throw new Error('--repo must be in owner/name form');
  }
  if (options.pr !== undefined) options.pr = parseNumber(options.pr, '--pr');
  if (options.ciTimeoutSeconds !== undefined) {
    options.ciTimeoutSeconds = parseNumber(
      String(options.ciTimeoutSeconds),
      '--ci-timeout-seconds',
    );
  }
  if (options.reviewTimeoutSeconds !== undefined) {
    options.reviewTimeoutSeconds = parseNumber(
      String(options.reviewTimeoutSeconds),
      '--review-timeout-seconds',
    );
  }
  if (options.pollSeconds !== undefined) {
    options.pollSeconds = parseNumber(String(options.pollSeconds), '--poll-seconds', {
      allowZero: true,
    });
  }
  if (options.correctionAttempt !== undefined) {
    options.correctionAttempt = parseNumber(
      String(options.correctionAttempt),
      '--correction-attempt',
      { allowZero: true },
    );
  }
  if (options.create && options.pr !== undefined)
    throw new Error('--create and --pr are mutually exclusive');
  if (!options.create && options.pr === undefined)
    throw new Error('--pr is required unless --create is used');
  if (
    options.create &&
    (options.title === undefined || (options.bodyFile === undefined && options.body === undefined))
  ) {
    throw new Error('--create requires --title and either --body or --body-file');
  }
  if (options.create && options.bodyFile !== undefined && options.body !== undefined) {
    throw new Error('--body and --body-file are mutually exclusive');
  }
  if (options.create && options.bodyFile !== undefined && !existsSync(options.bodyFile)) {
    throw new Error(`PR body file does not exist: ${options.bodyFile}`);
  }
  return options;
}

function printUsage() {
  console.log(`Usage:
  pnpm run post-pr:converge -- --pr <number> [options]
  pnpm run post-pr:converge -- --create --title <title> --body-file <path> [options]

The --create form creates the PR through gh and immediately enters the same
bounded post-PR convergence phase. It never merges the PR.

Options:
  --repo <owner/name>              Repository (defaults to gh repo view)
  --body <markdown>                Inline PR body (alternative to --body-file)
  --base <branch>                  PR base (default: main)
  --ci-timeout-seconds <seconds>   CI wait bound (default: 1800)
  --review-timeout-seconds <sec>   Review wait bound (default: 900)
  --poll-seconds <seconds>         Poll interval (default: 20)
  --correction-attempt <number>    Current bounded correction count (max: 2)
  --once                           Fetch/request once, then return HOLD if incomplete
  --json                            Emit machine-readable evidence
`);
}

function resolveRepository(explicitRepo) {
  return (
    explicitRepo ?? runGh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
  );
}

function fetchReviewThreads(repo, prNumber) {
  const [owner, name] = repo.split('/');
  const nodes = [];
  let after = null;

  for (let page = 0; page < 10; page += 1) {
    const args = [
      '-f',
      `query=${REVIEW_THREADS_QUERY}`,
      '-f',
      `owner=${owner}`,
      '-f',
      `name=${name}`,
      '-F',
      `number=${prNumber}`,
    ];
    if (after !== null) args.push('-f', `after=${after}`);

    const payload = graphqlJson(args);
    const connection = payload.data?.repository?.pullRequest?.reviewThreads;
    if (connection === undefined || connection === null) {
      throw new Error('GitHub GraphQL response did not include pull request review threads');
    }
    nodes.push(...(connection.nodes ?? []).filter(Boolean));
    if (!connection.pageInfo?.hasNextPage) return nodes;
    after = connection.pageInfo.endCursor ?? null;
    if (after === null) throw new Error('review thread pagination returned no cursor');
  }

  throw new Error('review thread pagination exceeded the bounded page limit');
}

function fetchSnapshot(repo, prNumber) {
  const pr = apiJson(`repos/${repo}/pulls/${prNumber}`);
  const headSha = pr.head?.sha;
  if (typeof headSha !== 'string' || headSha.length === 0) {
    return {
      pr,
      checkRuns: [],
      statuses: [],
      reviews: [],
      comments: [],
      inlineComments: [],
      reviewThreads: [],
    };
  }

  const checkRuns = apiItems(
    `repos/${repo}/commits/${headSha}/check-runs?per_page=100`,
    'check_runs',
  );
  const statuses = apiItems(`repos/${repo}/commits/${headSha}/status?per_page=100`, 'statuses');
  const reviews = apiList(`repos/${repo}/pulls/${prNumber}/reviews?per_page=100`);
  const comments = apiList(`repos/${repo}/issues/${prNumber}/comments?per_page=100`);
  const inlineComments = apiList(`repos/${repo}/pulls/${prNumber}/comments?per_page=100`);
  const reviewThreads = fetchReviewThreads(repo, prNumber);

  return {
    pr,
    checkRuns,
    statuses,
    reviews,
    comments,
    inlineComments,
    reviewThreads,
  };
}

function reviewRequestBody(headSha) {
  return `${CODEX_REVIEW_TRIGGER}\n\nReview target: \`${headSha}\`.\nReviewed commit: ${headSha}\n`;
}

function requestReview(repo, prNumber, headSha) {
  return runGh([
    'pr',
    'comment',
    String(prNumber),
    '--repo',
    repo,
    '--body',
    reviewRequestBody(headSha),
  ]);
}

function observedReviewRequest(review) {
  return latestReviewRequestObservation(review.currentRequests ?? []);
}

function extractRunId(detailsUrl) {
  const match = String(detailsUrl ?? '').match(/\/actions\/runs\/(\d+)/u);
  return match?.[1] ?? null;
}

function collectFailureLogs(repo, failures) {
  return failures.map((failure) => {
    const runId = extractRunId(failure.detailsUrl);
    if (runId === null) {
      return { check: failure.name, detailsUrl: failure.detailsUrl, log: null };
    }
    try {
      const log = runGh(['run', 'view', runId, '--repo', repo, '--log-failed']);
      return { check: failure.name, detailsUrl: failure.detailsUrl, log: log.slice(0, 12000) };
    } catch (error) {
      return {
        check: failure.name,
        detailsUrl: failure.detailsUrl,
        log: null,
        logError: error.message,
      };
    }
  });
}

function holdForGitHubError(error, context) {
  return {
    status: 'HOLD',
    mergeReady: false,
    phase: 'github',
    reason: `GitHub authenticated operation failed while ${context}: ${error.message}`,
    evidence: { error: error.message },
  };
}

function sleep(seconds) {
  if (seconds === 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function timeoutReport(result, timeout, elapsedMs) {
  return {
    ...result,
    status: 'HOLD',
    mergeReady: false,
    reason: `${timeout} wait timeout reached`,
    timeout: { phase: timeout, elapsedMs },
  };
}

async function converge({ repo, prNumber, options }) {
  const ciTimeoutMs = options.ciTimeoutSeconds * 1000;
  const reviewTimeoutMs = options.reviewTimeoutSeconds * 1000;
  let previousHead = null;
  let ciStartedAt = Date.now();
  let reviewStartedAt = null;
  let reviewRequestIdentity = null;
  const headChanges = [];
  let reviewRequestUrl = null;

  while (true) {
    let snapshot;
    try {
      snapshot = fetchSnapshot(repo, prNumber);
    } catch (error) {
      return holdForGitHubError(error, 'reading the current PR/CI/review snapshot');
    }

    const currentHead = snapshot.pr.head?.sha ?? null;
    if (previousHead !== null && currentHead !== previousHead) {
      headChanges.push({
        from: previousHead,
        to: currentHead,
        invalidatedEvidence: true,
        observedAt: new Date().toISOString(),
      });
      ciStartedAt = Date.now();
      reviewStartedAt = null;
      reviewRequestIdentity = null;
      reviewRequestUrl = null;
    }
    previousHead = currentHead;

    const ci = evaluateCi({
      headSha: currentHead,
      checkRuns: snapshot.checkRuns,
      statuses: snapshot.statuses,
    });
    const review = evaluateReview({
      headSha: currentHead,
      reviews: snapshot.reviews,
      comments: snapshot.comments,
      reviewThreads: snapshot.reviewThreads,
    });
    const result = evaluatePostPrConvergence({
      pr: snapshot.pr,
      ci,
      review,
      correctionAttempt: options.correctionAttempt,
    });
    const report = {
      ...result,
      repo,
      prNumber,
      prUrl: snapshot.pr.html_url ?? null,
      headChanges,
      reviewRequestUrl,
      externalStatuses: snapshot.statuses.filter((status) => status.context === 'Vercel'),
      inlineComments: snapshot.inlineComments,
    };

    if (shouldStopBeforeConvergence(result)) return report;
    if (ci.status === 'failed') {
      return {
        ...report,
        failureLogs: collectFailureLogs(repo, ci.failures),
        semanticFollowUp:
          'Agent must attribute the failure and decide whether a bounded correction is in scope.',
      };
    }
    if (ci.status === 'green' && review.status === 'green') return report;
    if (review.status === 'findings') {
      return {
        ...report,
        semanticFollowUp:
          'Agent must decide whether each current unresolved finding is actionable and in scope.',
      };
    }
    if (review.status === 'unknown') return report;
    if (review.reviewThreadsError !== undefined || review.currentFailures?.length > 0)
      return report;

    if (ci.status === 'green') {
      if (review.status === 'not_requested') {
        try {
          reviewRequestUrl = requestReview(repo, prNumber, currentHead);
        } catch (error) {
          return holdForGitHubError(error, 'requesting the current-head Codex review');
        }
        reviewStartedAt = Date.now();
        reviewRequestIdentity = null;
        if (options.once) {
          return {
            ...report,
            status: 'HOLD',
            mergeReady: false,
            phase: 'review',
            reason: 'review requested; no clearing result is available yet',
            reviewRequestUrl,
          };
        }
      } else {
        const currentReviewRequest = observedReviewRequest(review);
        if (
          currentReviewRequest !== null &&
          (reviewRequestIdentity === null ||
            currentReviewRequest.identity !== reviewRequestIdentity)
        ) {
          reviewStartedAt = currentReviewRequest.timestamp ?? Date.now();
          reviewRequestIdentity = currentReviewRequest.identity;
        } else if (reviewStartedAt === null) {
          reviewStartedAt = currentReviewRequest?.timestamp ?? Date.now();
          reviewRequestIdentity = currentReviewRequest?.identity ?? null;
        }
      }

      if (options.once) {
        return {
          ...report,
          status: 'HOLD',
          mergeReady: false,
          phase: 'review',
          reason: 'single observation completed; current review evidence is not clear',
          reviewRequestUrl,
        };
      }

      const reviewElapsedMs = Date.now() - reviewStartedAt;
      if (reviewElapsedMs >= reviewTimeoutMs) {
        return timeoutReport(report, 'review', reviewElapsedMs);
      }
    } else {
      const ciElapsedMs = Date.now() - ciStartedAt;
      if (ciElapsedMs >= ciTimeoutMs || options.once) {
        return options.once ? report : timeoutReport(report, 'CI', ciElapsedMs);
      }
    }

    await sleep(options.pollSeconds);
  }
}

function createPr(repo, options) {
  const args = ['pr', 'create', '--repo', repo, '--base', options.base, '--title', options.title];
  args.push(options.bodyFile === undefined ? '--body' : '--body-file');
  args.push(options.bodyFile === undefined ? options.body : options.bodyFile);
  const output = runGh(args);
  const match = output.match(/\/pull\/(\d+)(?:\s|$)/u);
  if (match === null) throw new Error(`gh pr create did not return a PR URL: ${output}`);
  return { number: Number(match[1]), output };
}

function printReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`${report.status}: ${report.reason}`);
  console.log(`PR: ${report.prUrl ?? report.prNumber ?? 'unknown'}`);
  console.log(`Head: ${report.headSha ?? 'unknown'}`);
  if (report.baseUpToDate !== undefined) {
    console.log(
      `Base: ${report.baseUpToDate === true ? 'up-to-date' : 'not up-to-date'} (${report.baseState ?? 'unknown'})`,
    );
  }
  if (report.headChanges?.length > 0)
    console.log(`Evidence invalidations: ${report.headChanges.length}`);
  if (report.ci !== undefined) {
    console.log(`CI: ${report.ci.status}`);
    for (const check of report.ci.checks ?? []) {
      console.log(
        `  ${check.name}: ${check.state}${check.conclusion ? ` (${check.conclusion})` : ''}`,
      );
    }
  }
  if (report.review !== undefined)
    console.log(`Review: ${report.review.status} — ${report.review.reason}`);
  if (report.timeout !== undefined) console.log(`Timeout: ${report.timeout.phase}`);
  if (report.reviewRequestUrl) console.log(`Review request: ${report.reviewRequestUrl}`);
  if (report.semanticFollowUp) console.log(report.semanticFollowUp);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return 0;
  }

  let repo;
  try {
    repo = resolveRepository(options.repo);
  } catch (error) {
    printReport(holdForGitHubError(error, 'resolving the repository'), options.json);
    return 1;
  }

  let prNumber = options.pr;
  if (options.create) {
    try {
      prNumber = createPr(repo, options).number;
    } catch (error) {
      printReport(holdForGitHubError(error, 'creating the pull request'), options.json);
      return 1;
    }
  }

  const report = await converge({ repo, prNumber, options });
  printReport(report, options.json);
  return report.status === 'MERGE_READY' ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
