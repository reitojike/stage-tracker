import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DurableCandidateValidationError,
  EVENT_PROPOSAL_VERSION,
  createEventDurableCandidate,
  createEvidenceLocator,
  createJevDecisionEvidence,
  createTicketOpportunityDurableCandidate,
  parseCanonicalProposal,
} from '@stage-tracker/official-import/durable-candidate';

const SENTINEL = 'RAW_SENTINEL_MUST_NOT_PERSIST';
const common = {
  runId: '00000000-0000-4000-8000-000000000001',
  sourceId: 'event.kabuki-bito.schedule',
  canonicalUrl: 'https://www.kabuki-bito.jp/schedule/example/',
  officialExternalId: 'example-1',
  observedAt: '2026-09-22T00:00:00.000Z',
  contentHash: 'a'.repeat(64),
  etag: null,
  lastModified: null,
  evidenceLocator: { sectionLabel: 'September', rowLabel: 'row-1' },
  planFingerprint: 'b'.repeat(64),
};

describe('durable official import candidates', () => {
  test('rebuilds an Event proposal from known normalized fields only', () => {
    const candidate = createEventDurableCandidate({
      ...common,
      proposal: {
        sourceKey: 'kabuki:example-1',
        title: 'Example Event',
        venue: 'Example Theatre',
        startsOn: '2026-10-01',
        endsOn: '2026-10-01',
        occurrences: [
          {
            startsAt: '2026-10-01T13:00:00+09:00',
            raw_html: SENTINEL,
          },
        ],
        raw_html: SENTINEL,
        body: SENTINEL,
        content: SENTINEL,
      },
      plan: {
        action: 'create',
        detailsChanged: false,
        rangeChanged: false,
        newOccurrences: [{ rawProviderResponse: SENTINEL }],
        endsAtFixes: [],
        doorsAtFixes: [],
        keptOccurrences: 0,
        genrePlan: { changed: false, rawPrompt: SENTINEL },
        groupsPlan: { changed: false },
        richInternalPlan: SENTINEL,
      },
    });

    assert.equal(candidate.candidateKind, 'event');
    assert.equal(candidate.proposalVersion, EVENT_PROPOSAL_VERSION);
    assert.equal(JSON.stringify(candidate).includes(SENTINEL), false);
    assert.deepEqual(candidate.proposal.occurrences, [
      { doorsAt: null, startsAt: '2026-10-01T13:00:00+09:00', endsAt: null },
    ]);
    assert.deepEqual(candidate.planSummary, {
      version: 'event_plan.v1',
      action: 'create',
      detailsChanged: false,
      rangeChanged: false,
      newOccurrenceCount: 1,
      endsAtFixCount: 0,
      doorsAtFixCount: 0,
      keptOccurrenceCount: 0,
      genreChanged: false,
      groupsChanged: false,
    });
  });

  test('rejects an impossible Event date even when there are no occurrences', () => {
    assert.throws(
      () =>
        createEventDurableCandidate({
          ...common,
          proposal: {
            sourceKey: 'kabuki:impossible-date',
            title: 'Impossible date',
            startsOn: '2026-02-30',
            endsOn: '2026-02-30',
            occurrences: [],
          },
          plan: {
            action: 'create',
            detailsChanged: false,
            rangeChanged: false,
          },
        }),
      DurableCandidateValidationError,
    );
  });

  test('rebuilds a TicketOpportunity proposal and bounded plan summary', () => {
    const candidate = createTicketOpportunityDurableCandidate({
      ...common,
      sourceId: 'ticket.shochiku.schedule',
      canonicalUrl: 'https://www1.ticket-web-shochiku.com/t/info/schedule.html',
      proposal: {
        eventSourceKey: 'kabuki:example-1',
        sourceKey: 'shochiku:example-1:general-sale',
        displayName: '一般発売',
        sourceUrl: 'https://www1.ticket-web-shochiku.com/t/info/schedule.html',
        targetScope: 'event_wide',
        milestones: [{ type: 'sale_start', precision: 'date', date: '2026-09-25' }],
        providerRawOutput: SENTINEL,
      },
      plan: {
        action: 'create',
        eventChanged: false,
        detailsChanged: false,
        occurrencesChanged: false,
        milestonesChanged: false,
        occurrenceIds: [],
        milestones: [{}],
      },
    });

    assert.equal(candidate.candidateKind, 'ticket_opportunity');
    assert.equal(JSON.stringify(candidate).includes(SENTINEL), false);
    assert.deepEqual(candidate.planSummary, {
      version: 'ticket_opportunity_plan.v1',
      action: 'create',
      eventChanged: false,
      detailsChanged: false,
      occurrencesChanged: false,
      milestonesChanged: false,
      targetOccurrenceCount: 0,
      milestoneCount: 1,
    });
  });

  test('rejects unknown candidate kind/version pairs before staging', () => {
    assert.throws(
      () => parseCanonicalProposal('event', 'event.v999', {}),
      DurableCandidateValidationError,
    );
    assert.throws(
      () => parseCanonicalProposal('raw_provider_output', 'provider.v1', {}),
      DurableCandidateValidationError,
    );
  });

  test('EvidenceLocator and Jev evidence reject raw source/provider fields', () => {
    assert.deepEqual(createEvidenceLocator({ pdfPageNumber: 2, rowLabel: 'A-12' }), {
      pdfPageNumber: 2,
      rowLabel: 'A-12',
    });
    assert.throws(
      () => createEvidenceLocator({ rowLabel: 'A-12', excerpt: SENTINEL }),
      /unsupported fields: excerpt/,
    );
    assert.throws(
      () =>
        createJevDecisionEvidence({
          decisionKind: 'relevance',
          version: 'jev.v1',
          provider: 'example',
          model: 'example-model',
          choice: 'relevant',
          inputFingerprint: 'c'.repeat(64),
          fullPrompt: SENTINEL,
        }),
      /unsupported fields: fullPrompt/,
    );
  });
});
