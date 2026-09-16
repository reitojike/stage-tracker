/**
 * Deterministic part of the repository's bounded post-PR contract.
 *
 * GitHub remains the source of truth for PR, check, and review observations.
 * This module only evaluates an already-fetched snapshot. It deliberately
 * does not decide whether a failure is caused by the change or whether a
 * finding is actionable; those decisions belong to the agent.
 */

export const POST_PR_POLICY = Object.freeze({
  baseBranch: 'main',
  ciTimeoutMs: 30 * 60 * 1000,
  reviewTimeoutMs: 15 * 60 * 1000,
  correctionRetryCeiling: 2,
});

export const REQUIRED_CI_CHECKS = Object.freeze([
  Object.freeze({ name: 'Verify / Code', source: 'check-run' }),
  Object.freeze({ name: 'Verify / Build', source: 'check-run' }),
  Object.freeze({ name: 'Verify / Database', source: 'check-run' }),
  Object.freeze({ name: 'Verify / E2E', source: 'check-run' }),
  Object.freeze({ name: 'Verify / Migration Ordering Fence', source: 'check-run' }),
]);

// This is the review surface currently exercised by this repository. It is
// intentionally project-local rather than a provider abstraction.
export const CODEX_REVIEW_ACTOR = 'chatgpt-codex-connector[bot]';
export const CODEX_REVIEW_TRIGGER = '@codex review';

const SUCCESS_CONCLUSIONS = new Set(['success']);
const PENDING_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);
const FAILURE_CONCLUSIONS = new Set([
  'action_required',
  'cancelled',
  'failure',
  'neutral',
  'stale',
  'timed_out',
]);
const ACCEPTED_REVIEW_STATES = new Set(['APPROVED', 'COMMENTED']);
const REVIEWED_COMMIT_PATTERN = /reviewed commit:\*{0,2}\s*`?([0-9a-f]{7,40})`?/iu;
const NO_FINDINGS_PATTERN =
  /didn't find any major issues|no (?:major )?issues|no actionable findings|no findings/iu;
const REVIEW_FAILURE_PATTERN = /encountered an error|review failed|unable to complete/iu;
const OBSERVATION_TIME_FIELDS = Object.freeze([
  'submitted_at',
  'submittedAt',
  'created_at',
  'createdAt',
  'updated_at',
  'updatedAt',
]);

function observationTimestamp(observation) {
  for (const field of OBSERVATION_TIME_FIELDS) {
    const value = observation?.[field];
    if (value === undefined || value === null || String(value).length === 0) continue;
    const timestamp = Date.parse(String(value));
    if (!Number.isNaN(timestamp)) return timestamp;
  }
  return null;
}

function reviewRequestCreationTimestamp(request) {
  const value = request?.created_at ?? request?.createdAt;
  if (value === undefined || value === null || String(value).length === 0) return null;
  const timestamp = Date.parse(String(value));
  return Number.isNaN(timestamp) ? null : timestamp;
}

function latestReviewRequest(requests) {
  return [...requests]
    .sort((left, right) => {
      const leftTime = reviewRequestCreationTimestamp(left) ?? Number.NEGATIVE_INFINITY;
      const rightTime = reviewRequestCreationTimestamp(right) ?? Number.NEGATIVE_INFINITY;
      if (leftTime !== rightTime) return leftTime - rightTime;

      const leftId = String(left?.id ?? left?.node_id ?? '');
      const rightId = String(right?.id ?? right?.node_id ?? '');
      return leftId.localeCompare(rightId, undefined, { numeric: true });
    })
    .at(-1);
}

export function latestReviewRequestObservation(requests = []) {
  const latest = latestReviewRequest(requests);
  if (latest === undefined) return null;

  const identity =
    latest.id ??
    latest.node_id ??
    `${latest.created_at ?? latest.createdAt ?? ''}:${latest.body ?? ''}`;
  return {
    identity: String(identity),
    timestamp: reviewRequestCreationTimestamp(latest),
  };
}

function latestObservation(observations) {
  return [...observations].sort((left, right) => {
    const leftTime =
      left.started_at ??
      left.startedAt ??
      left.completed_at ??
      left.completedAt ??
      left.updated_at ??
      left.updatedAt ??
      left.created_at ??
      '';
    const rightTime =
      right.started_at ??
      right.startedAt ??
      right.completed_at ??
      right.completedAt ??
      right.updated_at ??
      right.updatedAt ??
      right.created_at ??
      '';
    return String(leftTime).localeCompare(String(rightTime));
  })[observations.length - 1];
}

function normaliseCheckRun(run, headSha) {
  if (run?.head_sha !== headSha) {
    return {
      state: 'unknown',
      headSha: run?.head_sha ?? null,
      reason: 'check run is not bound to the current head',
      detailsUrl: run?.details_url ?? null,
    };
  }

  const status = String(run.status ?? '').toLowerCase();
  const conclusion = String(run.conclusion ?? '').toLowerCase();

  if (status !== 'completed') {
    return {
      state: PENDING_STATUSES.has(status) ? 'pending' : 'unknown',
      headSha,
      status: status || null,
      conclusion: conclusion || null,
      detailsUrl: run.details_url ?? null,
    };
  }

  return {
    state: SUCCESS_CONCLUSIONS.has(conclusion)
      ? 'green'
      : FAILURE_CONCLUSIONS.has(conclusion)
        ? 'failed'
        : 'unknown',
    headSha,
    status,
    conclusion: conclusion || null,
    detailsUrl: run.details_url ?? null,
  };
}

function normaliseStatus(status, headSha) {
  const state = String(status.state ?? '').toLowerCase();
  return {
    state:
      state === 'success'
        ? 'green'
        : state === 'pending'
          ? 'pending'
          : state === 'failure' || state === 'error'
            ? 'failed'
            : 'unknown',
    headSha,
    status: state || null,
    detailsUrl: status.target_url ?? null,
  };
}

/**
 * Evaluate all repository-required CI observations for one exact head.
 * Missing, malformed, or differently-bound observations never become green.
 */
export function evaluateCi({
  headSha,
  checkRuns = [],
  statuses = [],
  requiredChecks = REQUIRED_CI_CHECKS,
}) {
  if (typeof headSha !== 'string' || headSha.length === 0) {
    return { status: 'unknown', checks: [], failures: [], reason: 'current head SHA is missing' };
  }

  const checks = requiredChecks.map((requirement) => {
    if (requirement.source === 'status') {
      const matches = statuses.filter((status) => status.context === requirement.name);
      if (matches.length === 0) {
        return {
          name: requirement.name,
          source: requirement.source,
          state: 'unknown',
          reason: 'required status is missing',
        };
      }
      return {
        name: requirement.name,
        source: requirement.source,
        ...normaliseStatus(latestObservation(matches), headSha),
      };
    }

    const matches = checkRuns.filter(
      (run) => run.name === requirement.name && run.head_sha === headSha,
    );
    if (matches.length === 0) {
      return {
        name: requirement.name,
        source: requirement.source,
        state: 'unknown',
        headSha: null,
        reason: 'required check run for the current head is missing',
      };
    }
    return {
      name: requirement.name,
      source: requirement.source,
      ...normaliseCheckRun(latestObservation(matches), headSha),
    };
  });

  const failures = checks.filter((check) => check.state === 'failed');
  const unknown = checks.filter((check) => check.state === 'unknown');
  const pending = checks.filter((check) => check.state === 'pending');

  return {
    status:
      failures.length > 0
        ? 'failed'
        : unknown.length > 0
          ? 'unknown'
          : pending.length > 0
            ? 'pending'
            : 'green',
    checks,
    failures,
    unknown,
    pending,
    reason:
      failures.length > 0
        ? 'one or more required checks failed'
        : unknown.length > 0
          ? 'one or more required checks are unknown or missing'
          : pending.length > 0
            ? 'one or more required checks are pending'
            : 'all required checks are green for the current head',
  };
}

function commentTargetsHead(comment, headSha) {
  const match = String(comment?.body ?? '').match(REVIEWED_COMMIT_PATTERN);
  return match !== null && headSha.toLowerCase().startsWith(match[1].toLowerCase());
}

function isCodexComment(comment) {
  return (
    comment?.user?.login === CODEX_REVIEW_ACTOR || comment?.author?.login === CODEX_REVIEW_ACTOR
  );
}

function isCodexReview(review) {
  return review?.user?.login === CODEX_REVIEW_ACTOR || review?.author?.login === CODEX_REVIEW_ACTOR;
}

function threadComments(thread) {
  if (Array.isArray(thread?.comments)) return thread.comments;
  return thread?.comments?.nodes ?? [];
}

function threadTargetsHead(thread, headSha) {
  const threadCommit = thread?.commit?.oid ?? thread?.commit_id;
  if (threadCommit === headSha) return true;
  return threadComments(thread).some((comment) => {
    const commit = comment?.commit?.oid ?? comment?.commit_id;
    return commit === headSha;
  });
}

function classifyReviewThreads(reviewThreads, headSha) {
  const unresolvedThreads = [];
  const unknownThreads = [];

  for (const thread of reviewThreads) {
    if (thread?.isResolved === true || thread?.isOutdated === true) continue;
    if (threadTargetsHead(thread, headSha)) unresolvedThreads.push(thread);
    else unknownThreads.push(thread);
  }

  return { unresolvedThreads, unknownThreads };
}

/**
 * Evaluate the repository's current Codex review evidence for one exact head.
 * The no-findings result is accepted from the observed top-level result
 * surface, while any current unresolved thread remains a blocker.
 */
export function evaluateReview({
  headSha,
  reviews = [],
  comments = [],
  reviewThreads = [],
  reviewThreadsError = null,
}) {
  if (typeof headSha !== 'string' || headSha.length === 0) {
    return {
      status: 'unknown',
      reason: 'current head SHA is missing',
      evidence: [],
      unresolvedThreads: [],
    };
  }

  const codexReviews = reviews.filter(isCodexReview);
  const currentReviewObjects = codexReviews.filter(
    (review) => review.commit_id === headSha && ACCEPTED_REVIEW_STATES.has(review.state),
  );
  const oldReviewObjects = codexReviews.filter(
    (review) => typeof review.commit_id === 'string' && review.commit_id !== headSha,
  );
  const codexComments = comments.filter(isCodexComment);
  const currentReviewComments = codexComments.filter((comment) =>
    commentTargetsHead(comment, headSha),
  );
  const currentRequests = comments.filter(
    (comment) =>
      !isCodexComment(comment) &&
      commentTargetsHead(comment, headSha) &&
      String(comment.body ?? '')
        .toLowerCase()
        .includes(CODEX_REVIEW_TRIGGER),
  );
  const latestCurrentReviewComment = latestObservation(currentReviewComments);
  const latestCurrentReviewRequest = latestReviewRequestObservation(currentRequests);
  const latestResultIsNoFindings =
    latestCurrentReviewComment !== undefined &&
    NO_FINDINGS_PATTERN.test(latestCurrentReviewComment.body ?? '');
  const latestReviewResultTimestamp = observationTimestamp(latestCurrentReviewComment);
  const latestReviewRequestTimestamp = latestCurrentReviewRequest?.timestamp ?? null;
  const reviewResultRequiresFreshness =
    latestResultIsNoFindings && latestCurrentReviewRequest !== null;
  const reviewResultTimestampUnknown =
    reviewResultRequiresFreshness &&
    (latestReviewResultTimestamp === null ||
      latestReviewRequestTimestamp === null ||
      latestReviewResultTimestamp === latestReviewRequestTimestamp);
  const reviewResultIsStale =
    reviewResultRequiresFreshness &&
    latestReviewResultTimestamp !== null &&
    latestReviewRequestTimestamp !== null &&
    latestReviewResultTimestamp < latestReviewRequestTimestamp;
  const currentNoFindings =
    latestResultIsNoFindings && !reviewResultTimestampUnknown && !reviewResultIsStale
      ? [latestCurrentReviewComment]
      : [];
  const currentFailures =
    latestCurrentReviewComment !== undefined &&
    REVIEW_FAILURE_PATTERN.test(latestCurrentReviewComment.body ?? '')
      ? [latestCurrentReviewComment]
      : [];
  const currentNonClearingResults =
    latestCurrentReviewComment !== undefined &&
    !NO_FINDINGS_PATTERN.test(latestCurrentReviewComment.body ?? '') &&
    !REVIEW_FAILURE_PATTERN.test(latestCurrentReviewComment.body ?? '')
      ? [latestCurrentReviewComment]
      : [];
  const { unresolvedThreads, unknownThreads } = classifyReviewThreads(reviewThreads, headSha);

  if (reviewThreadsError !== null) {
    return {
      status: 'unknown',
      reason: 'review thread state could not be read',
      evidence: [],
      unresolvedThreads: [],
      currentReviewObjects,
      currentReviewComments,
      currentRequests,
      oldReviewObjects,
      reviewThreadsError,
    };
  }

  if (unresolvedThreads.length > 0) {
    return {
      status: 'findings',
      reason: 'current unresolved review thread(s) remain; agent judgment is required',
      evidence: [...currentReviewObjects, ...currentNoFindings],
      unresolvedThreads,
      currentReviewObjects,
      currentReviewComments,
      currentRequests,
      oldReviewObjects,
      currentFailures,
    };
  }

  if (unknownThreads.length > 0) {
    return {
      status: 'unknown',
      reason: 'an unresolved review thread is not bound to the current exact head',
      evidence: [],
      unresolvedThreads,
      unknownThreads,
      currentReviewObjects,
      currentReviewComments,
      currentRequests,
      oldReviewObjects,
      currentFailures,
    };
  }

  if (currentFailures.length > 0) {
    return {
      status: 'unknown',
      reason: 'the current-head Codex review did not complete successfully',
      evidence: currentFailures,
      unresolvedThreads,
      currentReviewObjects,
      currentReviewComments,
      currentRequests,
      oldReviewObjects,
      currentFailures,
    };
  }

  if (reviewResultTimestampUnknown) {
    return {
      status: 'unknown',
      reason: 'current-head review result/request ordering could not be established',
      evidence: [],
      unresolvedThreads,
      currentReviewObjects,
      currentReviewComments,
      currentRequests,
      oldReviewObjects,
      currentFailures,
    };
  }

  if (reviewResultIsStale) {
    return {
      status: 'pending',
      reason: 'a newer current-head Codex review was requested after the latest no-findings result',
      evidence: [],
      unresolvedThreads,
      currentReviewObjects,
      currentReviewComments,
      currentRequests,
      oldReviewObjects,
      currentFailures,
    };
  }

  if (currentNoFindings.length > 0) {
    return {
      status: 'green',
      reason: 'current exact head has a Codex no-findings result and no unresolved current thread',
      evidence: [...currentReviewObjects, ...currentNoFindings],
      unresolvedThreads,
      currentReviewObjects,
      currentReviewComments,
      currentRequests,
      oldReviewObjects,
      currentFailures,
    };
  }

  return {
    status:
      currentNonClearingResults.length > 0
        ? 'findings'
        : currentRequests.length > 0
          ? 'pending'
          : 'not_requested',
    reason:
      currentNonClearingResults.length > 0
        ? 'current-head review output requires agent judgment; it is not treated as clear'
        : currentRequests.length > 0
          ? 'current-head Codex review was requested but no clearing result is available'
          : 'no current-head Codex review evidence is available',
    evidence: currentNonClearingResults,
    unresolvedThreads,
    currentReviewObjects,
    currentReviewComments,
    currentRequests,
    oldReviewObjects,
    currentFailures,
  };
}

export function shouldStopBeforeConvergence(result) {
  return result?.phase === 'pr' || result?.phase === 'correction';
}

/**
 * Combine the deterministic PR, CI, and review observations into the only
 * two outcomes this helper exposes: MERGE_READY or fail-closed HOLD.
 */
export function evaluatePostPrConvergence({
  pr,
  ci,
  review,
  correctionAttempt = 0,
  policy = POST_PR_POLICY,
}) {
  const headSha = pr?.head?.sha ?? null;
  const baseBranch = pr?.base?.ref ?? null;

  if (!Number.isInteger(correctionAttempt) || correctionAttempt < 0) {
    return {
      status: 'HOLD',
      mergeReady: false,
      phase: 'correction',
      reason: 'correction attempt must be a non-negative integer',
      headSha,
      baseBranch,
    };
  }

  if (correctionAttempt > policy.correctionRetryCeiling) {
    return {
      status: 'HOLD',
      mergeReady: false,
      phase: 'correction',
      reason: `correction retry ceiling exceeded (${policy.correctionRetryCeiling})`,
      headSha,
      baseBranch,
      correctionAttempt,
    };
  }

  if (String(pr?.state ?? '').toLowerCase() !== 'open') {
    return {
      status: 'HOLD',
      mergeReady: false,
      phase: 'pr',
      reason: 'PR is not open',
      headSha,
      baseBranch,
      correctionAttempt,
    };
  }

  if (baseBranch !== policy.baseBranch) {
    return {
      status: 'HOLD',
      mergeReady: false,
      phase: 'pr',
      reason: `PR base is ${baseBranch ?? 'unknown'}, expected ${policy.baseBranch}`,
      headSha,
      baseBranch,
      correctionAttempt,
    };
  }

  if (typeof headSha !== 'string' || headSha.length === 0) {
    return {
      status: 'HOLD',
      mergeReady: false,
      phase: 'pr',
      reason: 'PR head SHA is missing',
      headSha,
      baseBranch,
      correctionAttempt,
    };
  }

  if (ci?.status !== 'green') {
    return {
      status: 'HOLD',
      mergeReady: false,
      phase: 'ci',
      reason: ci?.reason ?? 'required CI is not green',
      headSha,
      baseBranch,
      correctionAttempt,
      ci,
      review,
    };
  }

  if (review?.status !== 'green') {
    return {
      status: 'HOLD',
      mergeReady: false,
      phase: 'review',
      reason: review?.reason ?? 'required review evidence is not clear',
      headSha,
      baseBranch,
      correctionAttempt,
      ci,
      review,
    };
  }

  return {
    status: 'MERGE_READY',
    mergeReady: true,
    phase: 'complete',
    reason:
      'exact-head CI and required review evidence are green with no unresolved current thread',
    headSha,
    baseBranch,
    correctionAttempt,
    ci,
    review,
  };
}
