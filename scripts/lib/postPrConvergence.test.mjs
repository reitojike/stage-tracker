import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CODEX_REVIEW_ACTOR,
  POST_PR_POLICY,
  REQUIRED_CI_CHECKS,
  evaluateCi,
  evaluatePostPrConvergence,
  evaluateReview,
  latestReviewRequestObservation,
  shouldStopBeforeConvergence,
} from './postPrConvergence.mjs';

const HEAD_A = 'a'.repeat(40);
const HEAD_B = 'b'.repeat(40);

function greenCheckRuns(headSha) {
  return REQUIRED_CI_CHECKS.filter((check) => check.source === 'check-run').map((check) => ({
    name: check.name,
    head_sha: headSha,
    status: 'completed',
    conclusion: 'success',
    details_url: `https://github.com/actions/runs/${check.name.replaceAll(/\W/gu, '')}`,
  }));
}

function greenStatuses() {
  return [{ context: 'Vercel', state: 'success', target_url: 'https://vercel.example/deployment' }];
}

function reviewResult(headSha) {
  return {
    reviews: [
      {
        user: { login: CODEX_REVIEW_ACTOR },
        state: 'COMMENTED',
        commit_id: headSha,
      },
    ],
    comments: [
      {
        user: { login: CODEX_REVIEW_ACTOR },
        body: `Codex Review: Didn't find any major issues.\n\n**Reviewed commit:** \`${headSha.slice(0, 10)}\``,
      },
    ],
    reviewThreads: [],
  };
}

function pr(headSha = HEAD_A) {
  return {
    state: 'open',
    base: { ref: 'main' },
    head: { sha: headSha },
    mergeable_state: 'clean',
  };
}

test('green exact-head CI and Codex result produce MERGE_READY', () => {
  const ci = evaluateCi({
    headSha: HEAD_A,
    checkRuns: greenCheckRuns(HEAD_A),
    statuses: greenStatuses(),
  });
  const review = evaluateReview({ headSha: HEAD_A, ...reviewResult(HEAD_A) });
  const result = evaluatePostPrConvergence({ pr: pr(), ci, review });

  assert.equal(ci.status, 'green');
  assert.equal(review.status, 'green');
  assert.equal(result.status, 'MERGE_READY');
  assert.equal(result.mergeReady, true);
  assert.equal(result.headSha, HEAD_A);
  assert.equal(result.baseUpToDate, true);
});

test('external Vercel status is not part of the repository merge-ready gate', () => {
  const ci = evaluateCi({
    headSha: HEAD_A,
    checkRuns: greenCheckRuns(HEAD_A),
    statuses: [],
  });

  assert.equal(ci.status, 'green');
  assert.equal(
    ci.checks.some((check) => check.name.startsWith('Vercel')),
    false,
  );
});

test('pending CI is not green', () => {
  const checkRuns = greenCheckRuns(HEAD_A);
  checkRuns[0].status = 'in_progress';
  checkRuns[0].conclusion = null;
  const ci = evaluateCi({ headSha: HEAD_A, checkRuns, statuses: greenStatuses() });

  assert.equal(ci.status, 'pending');
  assert.equal(
    evaluatePostPrConvergence({ pr: pr(), ci, review: { status: 'green' } }).mergeReady,
    false,
  );
});

test('a newer in-progress rerun wins over an older green check for the same head', () => {
  const checkRuns = greenCheckRuns(HEAD_A);
  const older = {
    ...checkRuns[0],
    started_at: '2026-09-16T10:00:00Z',
    completed_at: '2026-09-16T10:05:00Z',
  };
  const newer = {
    ...checkRuns[0],
    started_at: '2026-09-16T10:06:00Z',
    completed_at: null,
    status: 'in_progress',
    conclusion: null,
  };
  const ci = evaluateCi({
    headSha: HEAD_A,
    checkRuns: [older, newer, ...checkRuns.slice(1)],
    statuses: greenStatuses(),
  });

  assert.equal(ci.status, 'pending');
  assert.equal(ci.checks[0].state, 'pending');
});

test('missing or unknown CI is not green', () => {
  const checkRuns = greenCheckRuns(HEAD_A).slice(1);
  const ci = evaluateCi({ headSha: HEAD_A, checkRuns, statuses: greenStatuses() });

  assert.equal(ci.status, 'unknown');
  assert.equal(ci.unknown[0].name, 'Verify / Code');
});

test('failed CI is surfaced without classifying its cause', () => {
  const checkRuns = greenCheckRuns(HEAD_A);
  checkRuns[0].conclusion = 'failure';
  const ci = evaluateCi({ headSha: HEAD_A, checkRuns, statuses: greenStatuses() });

  assert.equal(ci.status, 'failed');
  assert.equal(ci.failures[0].name, 'Verify / Code');
  assert.match(ci.reason, /failed/iu);
});

test('old-head review evidence cannot clear a new head', () => {
  const ci = evaluateCi({
    headSha: HEAD_B,
    checkRuns: greenCheckRuns(HEAD_B),
    statuses: greenStatuses(),
  });
  const oldReview = evaluateReview({ headSha: HEAD_B, ...reviewResult(HEAD_A) });
  const result = evaluatePostPrConvergence({ pr: pr(HEAD_B), ci, review: oldReview });

  assert.equal(oldReview.status, 'not_requested');
  assert.equal(oldReview.oldReviewObjects.length, 1);
  assert.equal(result.status, 'HOLD');
  assert.equal(result.phase, 'review');
  assert.equal(result.mergeReady, false);
});

test('a base update that changes the head requires fresh CI and review evidence', () => {
  const ci = evaluateCi({
    headSha: HEAD_B,
    checkRuns: greenCheckRuns(HEAD_A),
    statuses: greenStatuses(),
  });
  const review = evaluateReview({ headSha: HEAD_B, ...reviewResult(HEAD_A) });
  const result = evaluatePostPrConvergence({ pr: pr(HEAD_B), ci, review });

  assert.equal(ci.status, 'unknown');
  assert.equal(review.status, 'not_requested');
  assert.equal(result.status, 'HOLD');
  assert.equal(result.phase, 'ci');
  assert.equal(result.baseUpToDate, true);
});

test('an unresolved current review thread blocks merge-ready', () => {
  const ci = evaluateCi({
    headSha: HEAD_A,
    checkRuns: greenCheckRuns(HEAD_A),
    statuses: greenStatuses(),
  });
  const review = evaluateReview({
    headSha: HEAD_A,
    ...reviewResult(HEAD_A),
    reviewThreads: [
      {
        isResolved: false,
        isOutdated: false,
        path: 'scripts/example.mjs',
        line: 10,
        comments: { nodes: [{ commit: { oid: HEAD_A } }] },
      },
    ],
  });
  const result = evaluatePostPrConvergence({ pr: pr(), ci, review });

  assert.equal(review.status, 'findings');
  assert.equal(review.unresolvedThreads.length, 1);
  assert.equal(result.mergeReady, false);
});

test('resolved outdated history does not block a current clear review', () => {
  const review = evaluateReview({
    headSha: HEAD_A,
    ...reviewResult(HEAD_A),
    reviewThreads: [{ isResolved: true, isOutdated: true }],
  });

  assert.equal(review.status, 'green');
  assert.equal(review.unresolvedThreads.length, 0);
});

test('an unresolved outdated thread blocks until it is explicitly resolved', () => {
  const review = evaluateReview({
    headSha: HEAD_A,
    ...reviewResult(HEAD_A),
    reviewThreads: [{ isResolved: false, isOutdated: true }],
  });
  const result = evaluatePostPrConvergence({
    pr: pr(),
    ci: { status: 'green' },
    review,
  });

  assert.equal(review.status, 'findings');
  assert.equal(review.unresolvedThreads.length, 1);
  assert.equal(result.status, 'HOLD');
  assert.equal(result.phase, 'review');
});

test('an unresolved thread from an old head is unknown rather than current evidence', () => {
  const review = evaluateReview({
    headSha: HEAD_B,
    ...reviewResult(HEAD_B),
    reviewThreads: [
      {
        isResolved: false,
        isOutdated: false,
        comments: { nodes: [{ commit: { oid: HEAD_A } }] },
      },
    ],
  });

  assert.equal(review.status, 'unknown');
  assert.equal(review.unresolvedThreads.length, 0);
  assert.equal(review.unknownThreads.length, 1);
});

test('the latest current-head Codex result clears an earlier failure', () => {
  const review = evaluateReview({
    headSha: HEAD_A,
    reviews: [],
    comments: [
      {
        user: { login: CODEX_REVIEW_ACTOR },
        created_at: '2026-09-16T10:00:00Z',
        body: `Review failed. Reviewed commit: ${HEAD_A}`,
      },
      {
        user: { login: CODEX_REVIEW_ACTOR },
        created_at: '2026-09-16T10:01:00Z',
        body: `Codex Review: Didn't find any major issues. Reviewed commit: ${HEAD_A}`,
      },
    ],
    reviewThreads: [],
  });

  assert.equal(review.status, 'green');
  assert.equal(review.currentFailures.length, 0);
});

test('a newer non-clearing Codex result does not get masked by an earlier success', () => {
  const review = evaluateReview({
    headSha: HEAD_A,
    reviews: [],
    comments: [
      {
        user: { login: CODEX_REVIEW_ACTOR },
        created_at: '2026-09-16T10:00:00Z',
        body: `Codex Review: Didn't find any major issues. Reviewed commit: ${HEAD_A}`,
      },
      {
        user: { login: CODEX_REVIEW_ACTOR },
        created_at: '2026-09-16T10:01:00Z',
        body: `Found a possible issue. Reviewed commit: ${HEAD_A}`,
      },
    ],
    reviewThreads: [],
  });

  assert.equal(review.status, 'findings');
  assert.equal(review.evidence.length, 1);
  assert.match(review.evidence[0].body, /Found a possible issue/iu);
});

test('a newer review request invalidates an earlier no-findings result', () => {
  const review = evaluateReview({
    headSha: HEAD_A,
    reviews: [],
    comments: [
      {
        user: { login: CODEX_REVIEW_ACTOR },
        created_at: '2026-09-16T10:00:00Z',
        body: `Codex Review: Didn't find any major issues. Reviewed commit: ${HEAD_A}`,
      },
      {
        user: { login: 'reitojike' },
        created_at: '2026-09-16T10:01:00Z',
        body: `@codex review\n\nReviewed commit: ${HEAD_A}`,
      },
    ],
    reviewThreads: [],
  });

  assert.equal(review.status, 'pending');
  assert.equal(review.currentRequests.length, 1);
  assert.equal(review.evidence.length, 0);
});

test('equal-time review request and result ordering is fail-closed', () => {
  const review = evaluateReview({
    headSha: HEAD_A,
    reviews: [],
    comments: [
      {
        user: { login: CODEX_REVIEW_ACTOR },
        created_at: '2026-09-16T10:00:00Z',
        body: `Codex Review: Didn't find any major issues. Reviewed commit: ${HEAD_A}`,
      },
      {
        user: { login: 'reitojike' },
        created_at: '2026-09-16T10:00:00Z',
        body: `@codex review\n\nReviewed commit: ${HEAD_A}`,
      },
    ],
    reviewThreads: [],
  });

  assert.equal(review.status, 'unknown');
  assert.match(review.reason, /ordering/iu);
});

test('a no-findings result after the latest review request clears the head', () => {
  const review = evaluateReview({
    headSha: HEAD_A,
    reviews: [],
    comments: [
      {
        user: { login: 'reitojike' },
        created_at: '2026-09-16T10:00:00Z',
        body: `@codex review\n\nReviewed commit: ${HEAD_A}`,
      },
      {
        user: { login: CODEX_REVIEW_ACTOR },
        created_at: '2026-09-16T10:01:00Z',
        body: `Codex Review: Didn't find any major issues. Reviewed commit: ${HEAD_A}`,
      },
    ],
    reviewThreads: [],
  });

  assert.equal(review.status, 'green');
});

test('latest review request observation exposes a stable identity for timer resets', () => {
  assert.deepEqual(
    latestReviewRequestObservation([
      { id: 1, created_at: '2026-09-16T10:00:00Z', body: '@codex review' },
      { id: 2, created_at: '2026-09-16T10:01:00Z', body: '@codex review' },
    ]),
    { identity: '2', timestamp: Date.parse('2026-09-16T10:01:00Z') },
  );
});

test('review request observation uses creation time before update time', () => {
  assert.deepEqual(
    latestReviewRequestObservation([
      {
        id: 1,
        created_at: '2026-09-16T10:00:00Z',
        updated_at: '2026-09-16T10:30:00Z',
        body: '@codex review',
      },
      {
        id: 2,
        created_at: '2026-09-16T10:01:00Z',
        updated_at: '2026-09-16T10:02:00Z',
        body: '@codex review',
      },
    ]),
    { identity: '2', timestamp: Date.parse('2026-09-16T10:01:00Z') },
  );
});

test('review request observation uses comment ID to break creation-time ties', () => {
  assert.equal(
    latestReviewRequestObservation([
      { id: 10, created_at: '2026-09-16T10:00:00Z', body: '@codex review' },
      { id: 11, created_at: '2026-09-16T10:00:00Z', body: '@codex review' },
    ]).identity,
    '11',
  );
});

test('review evidence unknown is fail-closed', () => {
  const ci = evaluateCi({
    headSha: HEAD_A,
    checkRuns: greenCheckRuns(HEAD_A),
    statuses: greenStatuses(),
  });
  const review = evaluateReview({ headSha: HEAD_A, reviews: [], comments: [], reviewThreads: [] });
  const result = evaluatePostPrConvergence({ pr: pr(), ci, review });

  assert.equal(review.status, 'not_requested');
  assert.equal(result.status, 'HOLD');
  assert.equal(result.mergeReady, false);
});

test('unreadable review thread state is unknown rather than clear', () => {
  const review = evaluateReview({
    headSha: HEAD_A,
    ...reviewResult(HEAD_A),
    reviewThreadsError: 'permission denied',
  });

  assert.equal(review.status, 'unknown');
  assert.equal(review.reviewThreadsError, 'permission denied');
  assert.equal(
    evaluatePostPrConvergence({ pr: pr(), ci: { status: 'green' }, review }).mergeReady,
    false,
  );
});

test('correction retry ceiling is enforced', () => {
  const result = evaluatePostPrConvergence({
    pr: pr(),
    ci: { status: 'green' },
    review: { status: 'green' },
    correctionAttempt: 3,
  });

  assert.equal(result.status, 'HOLD');
  assert.equal(result.phase, 'correction');
  assert.match(result.reason, /ceiling/iu);
});

test('correction and PR phases stop before external convergence actions', () => {
  assert.equal(shouldStopBeforeConvergence({ phase: 'correction' }), true);
  assert.equal(shouldStopBeforeConvergence({ phase: 'pr' }), true);
  assert.equal(
    shouldStopBeforeConvergence({ phase: 'pr', baseUpToDate: null, retryable: true }),
    false,
  );
  assert.equal(shouldStopBeforeConvergence({ phase: 'ci' }), false);
  assert.equal(shouldStopBeforeConvergence({ phase: 'review' }), false);
});

test('wrong base branch is not merge-ready', () => {
  const result = evaluatePostPrConvergence({
    pr: { ...pr(), base: { ref: 'release' } },
    ci: { status: 'green' },
    review: { status: 'green' },
  });

  assert.equal(result.status, 'HOLD');
  assert.equal(result.phase, 'pr');
});

test('a behind base is not merge-ready', () => {
  const result = evaluatePostPrConvergence({
    pr: { ...pr(), mergeable_state: 'behind' },
    ci: { status: 'green' },
    review: { status: 'green' },
  });

  assert.equal(result.status, 'HOLD');
  assert.equal(result.phase, 'pr');
  assert.equal(result.baseUpToDate, false);
  assert.match(result.reason, /behind/iu);
});

test('unknown base freshness is not merge-ready', () => {
  const result = evaluatePostPrConvergence({
    pr: { ...pr(), mergeable_state: 'unknown' },
    ci: { status: 'green' },
    review: { status: 'green' },
  });

  assert.equal(result.status, 'HOLD');
  assert.equal(result.phase, 'pr');
  assert.equal(result.baseUpToDate, null);
  assert.equal(result.retryable, true);
  assert.equal(shouldStopBeforeConvergence(result), false);
  assert.equal(POST_PR_POLICY.baseTimeoutMs, 2 * 60 * 1000);
});
