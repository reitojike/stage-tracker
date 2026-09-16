import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CODEX_REVIEW_ACTOR,
  REQUIRED_CI_CHECKS,
  evaluateCi,
  evaluatePostPrConvergence,
  evaluateReview,
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
  return { state: 'open', base: { ref: 'main' }, head: { sha: headSha } };
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

test('outdated resolved history does not block a current clear review', () => {
  const review = evaluateReview({
    headSha: HEAD_A,
    ...reviewResult(HEAD_A),
    reviewThreads: [{ isResolved: false, isOutdated: true }],
  });

  assert.equal(review.status, 'green');
  assert.equal(review.unresolvedThreads.length, 0);
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

test('wrong base branch is not merge-ready', () => {
  const result = evaluatePostPrConvergence({
    pr: { ...pr(), base: { ref: 'release' } },
    ci: { status: 'green' },
    review: { status: 'green' },
  });

  assert.equal(result.status, 'HOLD');
  assert.equal(result.phase, 'pr');
});
