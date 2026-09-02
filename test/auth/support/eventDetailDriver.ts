import type { Locator } from 'playwright-core';
import { clickWhenInteractive, waitUntilGone, type JourneyActor } from './journeyActor.ts';

// Driving the Event detail screen's per-occurrence controls
// (src/app/catalog/_components/OccurrenceParticipationRow.tsx and the two
// bottom sheets it owns). Shared by the participation and invitation
// journeys, which both act on the same row - keeping it here stops the two
// from drifting on what "the write landed" means.

/** The two statuses OccurrenceParticipationRow can label a row with
 * (myCalendarFormatting.ts's participationStatusLabel). No row label at all
 * means no participation row exists - Issue #36/#230: absence of a row is
 * "not participating", and the component deliberately shows no literal
 * "未定" for it. */
const STATUS_LABELS = ['参加する', '気になる'] as const;

export type ParticipationChoice = '参加する' | '気になる' | '参加をやめる';

/** One occurrence's `<li>`. Scoping to it matters: EventDetail renders a
 * ParticipationSheet and an InviteSheet *per occurrence*, so an unscoped
 * locator for any of their controls is ambiguous the moment an event has
 * more than one occurrence. */
export function occurrenceRow(actor: JourneyActor, occurrenceId: string): Locator {
  return actor.page.locator(`#occurrence-${occurrenceId}`);
}

/**
 * One of the row's two bottom sheets, by its title.
 *
 * Matched as a `dialog` *role* with that accessible name (src/ui/Sheet.tsx
 * gives every sheet `aria-labelledby` pointing at its title) rather than by
 * the title text itself. Two reasons: a sheet's title string often also
 * appears on a control inside it (「招待する」 is both the invite sheet's
 * title and its submit button), which makes a text locator ambiguous; and
 * a role locator resolves only while the sheet is actually open, since a
 * `<dialog>` that was never `showModal()`-ed is `display: none` and so is
 * absent from the accessibility tree.
 */
export function occurrenceSheet(actor: JourneyActor, occurrenceId: string, title: string): Locator {
  return occurrenceRow(actor, occurrenceId).getByRole('dialog', { name: title });
}

/**
 * The status this row currently shows for the caller's own participation,
 * or null when it shows none.
 *
 * Only meaningful with both sheets closed: the participation sheet's own
 * choice rows carry these same two strings, and are visible while it is
 * open.
 */
export async function readParticipationStatus(
  actor: JourneyActor,
  occurrenceId: string,
): Promise<string | null> {
  const row = occurrenceRow(actor, occurrenceId);
  for (const label of STATUS_LABELS) {
    if ((await row.getByText(label, { exact: true }).filter({ visible: true }).count()) > 0) {
      return label;
    }
  }
  return null;
}

/** The row label a given choice should produce. Withdrawing removes the
 * participation row entirely, so it produces no label at all. */
function expectedStatusAfter(choice: ParticipationChoice): string | null {
  return choice === '参加をやめる' ? null : choice;
}

/** How long setParticipation keeps retrying before giving up. */
const SET_PARTICIPATION_TIMEOUT_MS = 30_000;

/**
 * Opens the row's 参加の状態 sheet, picks `choice`, and returns once the row
 * itself actually reflects the result.
 *
 * Synchronizing on the row's own label rather than on "the sheet closed" is
 * what makes this both correct and non-flaky. ParticipationSheet reports
 * success only by closing (Issue #230 addendum: a row click saves
 * immediately, with no confirm button and no lasting visible confirmation)
 * - but a sheet dismissed by a stray click on its backdrop closes exactly
 * the same way, having written nothing (src/ui/Sheet.tsx's onClick).
 * "Closed" therefore cannot tell a successful save from a lost one. The
 * row's label can: it is re-rendered from the server after
 * setParticipationChoiceAction's revalidatePath, so it changes only when
 * the write really landed.
 *
 * Retrying the whole open-and-choose is safe because it is idempotent:
 * choosing an already-selected status short-circuits in ParticipationSheet's
 * own handleChoose (it just closes the sheet), so a redundant pass writes
 * nothing. A genuinely broken write still fails here, on the deadline.
 */
export async function setParticipation(
  actor: JourneyActor,
  occurrenceId: string,
  choice: ParticipationChoice,
): Promise<void> {
  const row = occurrenceRow(actor, occurrenceId);
  const sheet = occurrenceSheet(actor, occurrenceId, '参加の状態');
  const expected = expectedStatusAfter(choice);
  const deadline = Date.now() + SET_PARTICIPATION_TIMEOUT_MS;

  for (;;) {
    await clickWhenInteractive(
      row.getByRole('button', { name: '変更', exact: true }),
      sheet,
      `opening the participation sheet for occurrence ${occurrenceId}`,
    );
    await sheet.getByRole('button', { name: choice, exact: true }).click();
    await waitUntilGone(sheet);

    if ((await readParticipationStatus(actor, occurrenceId)) === expected) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `occurrence ${occurrenceId} never reached ${expected ?? 'no participation'} ` +
          `after choosing "${choice}" within ${String(SET_PARTICIPATION_TIMEOUT_MS)}ms ` +
          `(it shows ${(await readParticipationStatus(actor, occurrenceId)) ?? 'no participation'})`,
      );
    }
  }
}

/**
 * Sends an invitation to `email` from the row's 招待 sheet.
 *
 * Synchronizes on the sheet closing, which is what InviteSheet does on a
 * successful submission and only then - a rejected one keeps the sheet open
 * with a StatePanel. Unlike the participation sheet, a backdrop dismissal
 * here cannot masquerade as success: this is a real `<form>` submission, so
 * a dismissed sheet leaves the invitee with no invitation, which every
 * caller of this goes on to assert about one way or the other.
 */
export async function inviteFromOccurrence(
  actor: JourneyActor,
  occurrenceId: string,
  email: string,
): Promise<void> {
  const row = occurrenceRow(actor, occurrenceId);
  const sheet = occurrenceSheet(actor, occurrenceId, '招待する');
  await clickWhenInteractive(
    row.getByRole('button', { name: '招待', exact: true }),
    sheet,
    `opening the invite sheet for occurrence ${occurrenceId}`,
  );
  await sheet.getByLabel('招待するユーザーの登録メールアドレス').fill(email);
  await sheet.getByRole('button', { name: '招待する', exact: true }).click();
  await waitUntilGone(sheet, 30_000);
}
