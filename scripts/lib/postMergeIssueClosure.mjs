import { createHash } from 'node:crypto';

export const ACCEPTANCE_CRITERIA_HEADING = 'Acceptance Criteria';
export const COMPLETION_EVIDENCE_MARKER_PREFIX = '<!-- stage-tracker:post-merge-completion';

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/iu;
const DIRECT_CHECKBOX_PATTERN = /^-\s+\[([ xX])\]\s+(.+?)\s*$/u;
const CHECKBOX_MARKER_PATTERN = /\[[ xX]\]/u;
const LEVEL_TWO_HEADING_PATTERN = /^##(?:\s|$)/u;
const NESTED_HEADING_PATTERN = /^###[ \t]*/u;
const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})(.*)$/u;

function normalizeNumber(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function normalizeIndexList(indexes) {
  if (!Array.isArray(indexes) || indexes.length === 0) {
    throw new Error('at least one Acceptance Criteria index is required');
  }

  const normalized = indexes.map((value) => {
    if (typeof value === 'string' && /^\d+$/u.test(value)) return Number(value);
    return value;
  });

  for (const index of normalized) normalizeNumber(index, 'Acceptance Criteria index');
  return [...new Set(normalized)].sort((left, right) => left - right);
}

function lineEndingFor(body) {
  return body.includes('\r\n') ? '\r\n' : '\n';
}

function ambiguous(reason, extra = {}) {
  return {
    status: 'ambiguous',
    reason,
    items: [],
    uncheckedCount: null,
    ...extra,
  };
}

function fenceRun(line) {
  const match = FENCE_PATTERN.exec(line);
  if (match === null) return null;
  return {
    character: match[1][0],
    length: match[1].length,
    rest: match[2],
  };
}

function stripHtmlComments(line, inComment) {
  let visible = '';
  let cursor = 0;
  let comment = inComment;

  while (cursor < line.length) {
    if (comment) {
      const closeIndex = line.indexOf('-->', cursor);
      if (closeIndex === -1) return { line: visible, inComment: true };
      comment = false;
      cursor = closeIndex + 3;
      continue;
    }

    const openIndex = line.indexOf('<!--', cursor);
    if (openIndex === -1) {
      visible += line.slice(cursor);
      return { line: visible, inComment: false };
    }

    visible += line.slice(cursor, openIndex);
    const closeIndex = line.indexOf('-->', openIndex + 4);
    if (closeIndex === -1) return { line: visible, inComment: true };
    cursor = closeIndex + 3;
  }

  return { line: visible, inComment: comment };
}

function maskNonRenderedLines(lines) {
  const visibleLines = [];
  let fence = null;
  let htmlComment = false;

  for (const line of lines) {
    if (fence !== null) {
      visibleLines.push(null);
      const run = fenceRun(line);
      if (
        run !== null &&
        run.character === fence.character &&
        run.length >= fence.length &&
        run.rest.trim().length === 0
      ) {
        fence = null;
      }
      continue;
    }

    const openingFence = fenceRun(line);
    if (openingFence !== null) {
      visibleLines.push(null);
      fence = openingFence;
      continue;
    }

    const stripped = stripHtmlComments(line, htmlComment);
    const blockHtmlLine = htmlComment || /^\s*<!--/u.test(line);
    if (blockHtmlLine && !stripped.inComment && stripped.line.trim().length > 0) {
      return {
        error: 'block HTML with trailing text makes the Issue body ambiguous',
        lines: [],
      };
    }
    htmlComment = stripped.inComment;
    visibleLines.push(stripped.line);
  }

  if (fence !== null) {
    return { error: 'an unclosed fenced code block makes the Issue body ambiguous', lines: [] };
  }
  if (htmlComment) {
    return { error: 'an unclosed HTML comment makes the Issue body ambiguous', lines: [] };
  }
  return { error: null, lines: visibleLines };
}

/**
 * Parse only the repository's explicit, top-level `## Acceptance Criteria`
 * section. This intentionally does not attempt to understand arbitrary
 * Markdown, nested checklists, or alternate heading/list syntax.
 */
export function parseAcceptanceCriteria(body) {
  if (typeof body !== 'string') {
    return ambiguous('Issue body is missing or is not text');
  }

  const lineEnding = lineEndingFor(body);
  const lines = body.split(/\r\n|\n/u);
  const rendered = maskNonRenderedLines(lines);
  if (rendered.error !== null) return ambiguous(rendered.error);
  const visibleLines = rendered.lines.map((line) => line ?? '');
  const headingPattern = /^## Acceptance Criteria[ \t]*$/u;
  const headingIndexes = visibleLines.flatMap((line, index) =>
    headingPattern.test(line) ? [index] : [],
  );

  if (headingIndexes.length !== 1) {
    return ambiguous(
      headingIndexes.length === 0
        ? 'exactly one `## Acceptance Criteria` section is required; none was found'
        : 'exactly one `## Acceptance Criteria` section is required; multiple were found',
    );
  }

  const headingLine = headingIndexes[0];
  const sectionEnd = visibleLines.findIndex(
    (line, index) => index > headingLine && LEVEL_TWO_HEADING_PATTERN.test(line),
  );
  const endLine = sectionEnd === -1 ? visibleLines.length : sectionEnd;
  const items = [];

  for (let index = headingLine + 1; index < endLine; index += 1) {
    const line = visibleLines[index] ?? '';
    if (NESTED_HEADING_PATTERN.test(line)) {
      return ambiguous('nested headings inside the Acceptance Criteria section are ambiguous');
    }

    if (!CHECKBOX_MARKER_PATTERN.test(line)) continue;
    const match = DIRECT_CHECKBOX_PATTERN.exec(line);
    if (match === null) {
      return ambiguous(
        'Acceptance Criteria contains a checklist marker that is not a top-level `- [ ]` item',
      );
    }

    const [, marker, text] = match;
    if (typeof text !== 'string' || text.trim().length === 0) {
      return ambiguous('every Acceptance Criteria checkbox must have text');
    }

    items.push({
      index: items.length + 1,
      lineIndex: index,
      checked: marker.toLowerCase() === 'x',
      text: text.trim(),
    });
  }

  if (items.length === 0) {
    return ambiguous('Acceptance Criteria section contains no unambiguous checklist items');
  }

  return {
    status: 'clear',
    reason: null,
    headingLine,
    endLine,
    lineEnding,
    items,
    uncheckedCount: items.filter((item) => !item.checked).length,
  };
}

export function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function isPullRequestPayload(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, 'pull_request')
  );
}

/**
 * Apply only the explicitly selected checkbox changes to a parsed section.
 * Selecting an already checked item is idempotent; no other line is changed.
 */
export function applyAcceptanceCriteriaUpdates(body, criteria, indexes) {
  if (typeof body !== 'string') throw new Error('Issue body is missing or is not text');
  if (criteria?.status !== 'clear') {
    throw new Error('Acceptance Criteria must be unambiguous before a body update');
  }

  const selectedIndexes = normalizeIndexList(indexes);
  const itemByIndex = new Map(criteria.items.map((item) => [item.index, item]));
  const missingIndexes = selectedIndexes.filter((index) => !itemByIndex.has(index));
  if (missingIndexes.length > 0) {
    throw new Error(
      `Acceptance Criteria index out of range: ${missingIndexes.map(String).join(', ')}`,
    );
  }

  const lines = body.split(/\r\n|\n/u);
  const changedIndexes = [];
  for (const index of selectedIndexes) {
    const item = itemByIndex.get(index);
    if (item.checked) continue;
    const line = lines[item.lineIndex];
    const updatedLine = line?.replace(/^(-\s+)\[\s\]/u, '$1[x]');
    if (updatedLine === undefined || updatedLine === line) {
      throw new Error(`Acceptance Criteria item ${index} could not be updated safely`);
    }
    lines[item.lineIndex] = updatedLine;
    changedIndexes.push(index);
  }

  return {
    body: lines.join(lineEndingFor(body)),
    selectedIndexes,
    changedIndexes,
    bodyChanged: changedIndexes.length > 0,
  };
}

export function isFullSha(value) {
  return typeof value === 'string' && FULL_SHA_PATTERN.test(value);
}

export function completionEvidenceMarker({ issueNumber, prNumber, mergeSha }) {
  normalizeNumber(issueNumber, 'Issue number');
  normalizeNumber(prNumber, 'PR number');
  if (!isFullSha(mergeSha)) throw new Error('merge SHA must be a 40-character hexadecimal SHA');
  return `${COMPLETION_EVIDENCE_MARKER_PREFIX} issue=${issueNumber} pr=${prNumber} merge-sha=${mergeSha} -->`;
}

function escapeRegExp(value) {
  return String(value).replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function isSufficientCompletionEvidence(body, { issueNumber, prNumber, mergeSha }) {
  if (typeof body !== 'string') return false;

  const marker = completionEvidenceMarker({ issueNumber, prNumber, mergeSha });
  const prPattern = new RegExp(
    `^\\s*Implementation PR:\\s*(?:#${prNumber}\\b|https://github\\.com/[^\\s/]+/[^\\s/]+/pull/${prNumber}\\b)`,
    'imu',
  );
  const mergePattern = new RegExp(
    `^\\s*Merge commit:\\s*\\x60?${escapeRegExp(mergeSha)}\\x60?\\s*$`,
    'imu',
  );
  const requiredLinePatterns = [
    /^\s*Acceptance Criteria:\s*\S/imu,
    /^\s*Verification:\s*\S/imu,
    /^\s*Review:\s*\S/imu,
    /^\s*Unresolved items:\s*0\s*$/imu,
  ];

  return (
    body.includes(marker) &&
    prPattern.test(body) &&
    mergePattern.test(body) &&
    requiredLinePatterns.every((pattern) => pattern.test(body))
  );
}

export function findCompletionEvidence(comments, identity) {
  const marker = completionEvidenceMarker(identity);
  const matchingComments = (Array.isArray(comments) ? comments : []).filter(
    (comment) => typeof comment?.body === 'string' && comment.body.includes(marker),
  );

  if (matchingComments.length === 0) {
    return { status: 'missing', marker, comments: [] };
  }
  if (matchingComments.length > 1) {
    return { status: 'duplicate', marker, comments: matchingComments };
  }
  if (!isSufficientCompletionEvidence(matchingComments[0].body, identity)) {
    return { status: 'invalid', marker, comments: matchingComments };
  }
  return { status: 'present', marker, comments: matchingComments };
}

function isOpenIssue(issue) {
  return String(issue?.state ?? '').toLowerCase() === 'open';
}

function isMergedPullRequest(pullRequest) {
  return pullRequest?.merged === true && isFullSha(pullRequest?.merge_commit_sha);
}

/**
 * Evaluate only deterministic closure prerequisites. The three boolean
 * assertions are deliberately supplied by the agent; this function never
 * classifies an Issue or decides whether an AC is semantically satisfied.
 */
export function evaluatePostMergeIssueClosure({
  issue,
  pullRequest,
  acceptanceCriteria,
  comments,
  completionAllowed,
  semanticAcVerified,
  noKnownRemainingWork,
}) {
  const reasons = [];

  if (!isOpenIssue(issue)) reasons.push('Issue is not open');
  if (completionAllowed !== true) {
    reasons.push('agent did not affirm that this Task contract allows completion');
  }
  if (semanticAcVerified !== true) {
    reasons.push('agent did not affirm per-item semantic Acceptance Criteria verification');
  }
  if (noKnownRemainingWork !== true) {
    reasons.push('agent did not affirm that no known post-merge work remains');
  }
  if (!isMergedPullRequest(pullRequest)) {
    reasons.push('implementation PR is not confirmed merged with a known merge SHA');
  }
  if (acceptanceCriteria?.status !== 'clear') {
    reasons.push(acceptanceCriteria?.reason ?? 'Acceptance Criteria section is ambiguous');
  } else if (acceptanceCriteria.uncheckedCount !== 0) {
    reasons.push(
      `${acceptanceCriteria.uncheckedCount} unchecked Acceptance Criteria item(s) remain`,
    );
  }

  let evidence = { status: 'missing', marker: null, comments: [] };
  if (isMergedPullRequest(pullRequest)) {
    evidence = findCompletionEvidence(comments, {
      issueNumber: issue?.number,
      prNumber: pullRequest?.number,
      mergeSha: pullRequest.merge_commit_sha,
    });
    if (evidence.status !== 'present') {
      reasons.push(`completion evidence is ${evidence.status}`);
    }
  } else {
    reasons.push('completion evidence cannot be bound until the merge SHA is known');
  }

  return {
    status: reasons.length === 0 ? 'READY_TO_CLOSE' : 'HOLD',
    readyToClose: reasons.length === 0,
    reasons,
    mergeSha: isMergedPullRequest(pullRequest) ? pullRequest.merge_commit_sha : null,
    evidence,
  };
}
