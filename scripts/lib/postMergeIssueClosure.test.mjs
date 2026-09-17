import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyAcceptanceCriteriaUpdates,
  completionEvidenceMarker,
  evaluatePostMergeIssueClosure,
  findCompletionEvidence,
  isPullRequestPayload,
  isSufficientCompletionEvidence,
  parseAcceptanceCriteria,
  sha256,
} from './postMergeIssueClosure.mjs';

const MERGE_SHA = 'a'.repeat(40);

function body({ checked = false } = {}) {
  return [
    '# Task',
    '',
    '## Acceptance Criteria',
    `- [${checked ? 'x' : ' '}] first criterion`,
    '- [x] second criterion',
    '',
    '## Notes',
    'Keep this text unchanged.',
  ].join('\n');
}

function issue(bodyText = body()) {
  return { number: 527, state: 'open', body: bodyText };
}

function pullRequest({ merged = true, mergeSha = MERGE_SHA } = {}) {
  return { number: 528, merged, merge_commit_sha: mergeSha };
}

function evidenceBody() {
  return [
    completionEvidenceMarker({ issueNumber: 527, prNumber: 528, mergeSha: MERGE_SHA }),
    '',
    '## Post-merge completion evidence',
    '',
    'Implementation PR: #528',
    `Merge commit: \`${MERGE_SHA}\``,
    'Acceptance Criteria: all items were semantically verified and satisfied.',
    'Verification: Verify / Code and targeted tests passed.',
    'Review: current exact-head review had no unresolved findings.',
    'Unresolved items: 0',
  ].join('\n');
}

function readyInputs(overrides = {}) {
  const issueValue = issue();
  const pullRequestValue = pullRequest();
  return {
    issue: issueValue,
    pullRequest: pullRequestValue,
    acceptanceCriteria: parseAcceptanceCriteria(issueValue.body),
    comments: [{ body: evidenceBody() }],
    completionAllowed: true,
    semanticAcVerified: true,
    noKnownRemainingWork: true,
    ...overrides,
  };
}

test('parses one explicit top-level Acceptance Criteria section', () => {
  const parsed = parseAcceptanceCriteria(body());

  assert.equal(parsed.status, 'clear');
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].checked, false);
  assert.equal(parsed.items[1].checked, true);
  assert.equal(parsed.uncheckedCount, 1);
});

test('missing, duplicate, nested, and alternate checklist syntax are ambiguous', () => {
  assert.equal(parseAcceptanceCriteria('# Task').status, 'ambiguous');
  assert.equal(
    parseAcceptanceCriteria(`${body()}\n\n## Acceptance Criteria\n- [ ] duplicate`).status,
    'ambiguous',
  );
  assert.equal(
    parseAcceptanceCriteria(body().replace('- [ ] first criterion', '  - [ ] nested criterion'))
      .status,
    'ambiguous',
  );
  assert.equal(
    parseAcceptanceCriteria(body().replace('- [ ] first criterion', '* [ ] alternate')).status,
    'ambiguous',
  );
});

test('non-rendered Acceptance Criteria text is ambiguous', () => {
  const fenced = ['```markdown', '## Acceptance Criteria', '- [x] hidden', '```'].join('\n');
  const commented = ['<!--', '## Acceptance Criteria', '- [x] hidden', '-->'].join('\n');

  assert.equal(parseAcceptanceCriteria(fenced).status, 'ambiguous');
  assert.equal(parseAcceptanceCriteria(commented).status, 'ambiguous');
  assert.equal(
    parseAcceptanceCriteria('<!-- annotation -->## Acceptance Criteria\n- [x] hidden').status,
    'ambiguous',
  );
  assert.equal(
    parseAcceptanceCriteria('<pre>\n## Acceptance Criteria\n- [x] hidden\n</pre>').status,
    'ambiguous',
  );
  assert.equal(parseAcceptanceCriteria(`${body()}\n<!-- unfinished`).status, 'ambiguous');
});

test('inline HTML comments preserve visible section boundaries', () => {
  const source = [
    '## Acceptance Criteria',
    '- [x] visible criterion',
    '## Notes <!-- explanation -->',
    '- [x] unrelated checkbox',
  ].join('\n');
  const parsed = parseAcceptanceCriteria(source);

  assert.equal(parsed.status, 'clear');
  assert.deepEqual(
    parsed.items.map((item) => item.text),
    ['visible criterion'],
  );
});

test('pull-request-shaped Issues API payloads are rejected', () => {
  assert.equal(isPullRequestPayload({ number: 528, pull_request: {} }), true);
  assert.equal(isPullRequestPayload({ number: 527, body: body() }), false);
  assert.equal(isPullRequestPayload(null), false);
});

test('checkbox update changes only explicitly selected items', () => {
  const source = body();
  const criteria = parseAcceptanceCriteria(source);
  const update = applyAcceptanceCriteriaUpdates(source, criteria, [1, 2]);

  assert.equal(update.bodyChanged, true);
  assert.deepEqual(update.changedIndexes, [1]);
  assert.match(update.body, /- \[x\] first criterion/u);
  assert.match(update.body, /- \[x\] second criterion/u);
  assert.match(update.body, /Keep this text unchanged\./u);
  assert.equal(parseAcceptanceCriteria(update.body).uncheckedCount, 0);
});

test('body hashes are stable and change when the body changes', () => {
  assert.equal(sha256(body()), sha256(body()));
  assert.notEqual(sha256(body()), sha256(`${body()}\n`));
});

test('completion evidence requires the bounded fields and exact identity', () => {
  const complete = evidenceBody();
  assert.equal(
    isSufficientCompletionEvidence(complete, {
      issueNumber: 527,
      prNumber: 528,
      mergeSha: MERGE_SHA,
    }),
    true,
  );
  assert.equal(
    isSufficientCompletionEvidence(complete.replace('Unresolved items: 0', 'Unresolved items: 1'), {
      issueNumber: 527,
      prNumber: 528,
      mergeSha: MERGE_SHA,
    }),
    false,
  );
  assert.equal(
    isSufficientCompletionEvidence(complete.replace('#528', '#529'), {
      issueNumber: 527,
      prNumber: 528,
      mergeSha: MERGE_SHA,
    }),
    false,
  );
});

test('duplicate completion evidence is not treated as a clean prerequisite', () => {
  const result = findCompletionEvidence([{ body: evidenceBody() }, { body: evidenceBody() }], {
    issueNumber: 527,
    prNumber: 528,
    mergeSha: MERGE_SHA,
  });

  assert.equal(result.status, 'duplicate');
});

test('all deterministic prerequisites produce READY_TO_CLOSE', () => {
  const source = body({ checked: true });
  const result = evaluatePostMergeIssueClosure({
    ...readyInputs({
      issue: issue(source),
      acceptanceCriteria: parseAcceptanceCriteria(source),
    }),
  });

  assert.equal(result.status, 'READY_TO_CLOSE');
  assert.equal(result.readyToClose, true);
  assert.deepEqual(result.reasons, []);
});

test('unchecked Acceptance Criteria fails closed', () => {
  const result = evaluatePostMergeIssueClosure(readyInputs());

  assert.equal(result.status, 'HOLD');
  assert.equal(result.readyToClose, false);
  assert.match(result.reasons.join('\n'), /unchecked/u);
});

test('missing semantic assertions fail closed even with checked AC and evidence', () => {
  const source = body({ checked: true });
  const result = evaluatePostMergeIssueClosure(
    readyInputs({
      issue: issue(source),
      acceptanceCriteria: parseAcceptanceCriteria(source),
      semanticAcVerified: false,
      completionAllowed: false,
      noKnownRemainingWork: false,
    }),
  );

  assert.equal(result.status, 'HOLD');
  assert.equal(result.reasons.length, 3);
});

test('missing or malformed prerequisites fail closed', () => {
  const source = body({ checked: true });
  const base = readyInputs({
    issue: issue(source),
    acceptanceCriteria: parseAcceptanceCriteria(source),
  });

  assert.match(
    evaluatePostMergeIssueClosure({
      ...base,
      pullRequest: pullRequest({ merged: false }),
    }).reasons.join('\n'),
    /not confirmed merged/u,
  );
  assert.match(
    evaluatePostMergeIssueClosure({ ...base, comments: [] }).reasons.join('\n'),
    /completion evidence is missing/u,
  );
  assert.match(
    evaluatePostMergeIssueClosure({
      ...base,
      issue: { ...base.issue, state: 'closed' },
    }).reasons.join('\n'),
    /not open/u,
  );
  assert.match(
    evaluatePostMergeIssueClosure({
      ...base,
      acceptanceCriteria: parseAcceptanceCriteria(`${source}\n\n## Acceptance Criteria\n- [x] x`),
    }).reasons.join('\n'),
    /multiple/u,
  );
});
