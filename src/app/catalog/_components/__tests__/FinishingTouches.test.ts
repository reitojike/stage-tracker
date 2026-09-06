import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../..', import.meta.url));
const read = (relativePath: string) => readFileSync(`${root}/${relativePath}`, 'utf8');

void test('event edit keeps its save action inside the event-information group', () => {
  const editForm = read('src/app/catalog/_components/EventDetailsEditForm.tsx');
  const createForm = read('src/app/catalog/_components/EventCreateForm.tsx');

  assert.doesNotMatch(editForm, /styles\.fixedForm|styles\.fixedSubmit/);
  assert.match(editForm, /className=\{styles\.groupSubmit\}/);
  assert.match(
    editForm,
    /aria-label=\{isPending \? 'イベント情報を保存中…' : 'イベント情報を保存'\}/,
  );
  assert.match(editForm, /<span>\{isPending \? '保存中…' : '保存'\}<\/span>/);
  assert.match(createForm, /styles\.fixedForm/);
  assert.match(createForm, /styles\.fixedSubmit/);
});

void test('contextual write labels stay short while accessible names retain their target', () => {
  const eventCancellation = read('src/app/catalog/_components/EventCancellationForm.tsx');
  const occurrenceCancellation = read('src/app/catalog/_components/OccurrenceCancellationForm.tsx');
  const deleteEvent = read('src/app/catalog/_components/DeleteEventForm.tsx');
  const deleteOccurrence = read('src/app/catalog/_components/DeleteOccurrenceForm.tsx');
  const deleteEntry = read('src/app/schedule/_components/DeleteEntryForm.tsx');
  const occurrenceUpdate = read('src/app/catalog/_components/OccurrenceUpdateForm.tsx');
  const eventRange = read('src/app/catalog/_components/EventRangeEditForm.tsx');
  const occurrenceAdd = read('src/app/catalog/_components/OccurrenceAddForm.tsx');
  const shareAdd = read('src/app/schedule/_components/ShareAddSheet.tsx');
  const signIn = read('src/app/sign-in/page.tsx');

  assert.match(eventCancellation, /'中止する'/);
  assert.match(eventCancellation, /'中止を解除'/);
  assert.match(eventCancellation, /中止を解除\s*<\/span>/);
  assert.match(eventCancellation, /'このイベントを中止'/);
  assert.match(eventCancellation, /'このイベントの中止を解除'/);
  assert.match(occurrenceCancellation, /'中止する'/);
  assert.match(occurrenceCancellation, /'中止を解除'/);
  assert.match(occurrenceCancellation, /'この公演回を中止'/);
  assert.match(occurrenceCancellation, /'この公演回の中止を解除'/);
  // Issue #310: the trigger label is the short noun form, matching the
  // Sheet's own execute button and docs/screens.md's danger button label
  // rule - `aria-label` alone still carries the target.
  assert.match(deleteEvent, />\s*削除\s*<\/Button>/);
  assert.doesNotMatch(deleteEvent, />\s*削除する\s*<\/Button>/);
  assert.match(deleteEvent, /aria-label="このイベントを削除"/);
  assert.match(deleteOccurrence, />\s*削除\s*<\/Button>/);
  assert.doesNotMatch(deleteOccurrence, />\s*削除する\s*<\/Button>/);
  assert.match(deleteOccurrence, /aria-label="この公演回を削除"/);
  assert.match(deleteEntry, />\s*削除\s*<\/Button>/);
  assert.match(deleteEntry, /className=\{styles\.dangerTrigger\}/);
  assert.match(occurrenceUpdate, /<span>\{isPending \? '保存中…' : '保存'\}<\/span>/);
  assert.match(eventRange, /<span>\{isPending \? '保存中…' : '保存'\}<\/span>/);
  assert.match(occurrenceAdd, /<span>\{isPending \? '追加中…' : '追加'\}<\/span>/);
  assert.match(shareAdd, /<span>\{isPending \? '追加中…' : '追加'\}<\/span>/);
  assert.match(signIn, /<Button[\s\S]*>\s*リンクをリクエスト\s*<\/Button>/);
});

void test('event edit puts a canceled badge beside a wrapping datetime', () => {
  // Issue #311's own three-file list (each badge composing inlineBadge and
  // restating no flex-shrink of its own) is gone (Issue #312): Row.test.ts
  // owns the shared `.inlineBadge` declaration itself, and a consumer
  // restating a value it already composes is redundant rather than broken.
  // What stays here is this screen's intentional alignment either side of
  // the badge.
  const page = read('src/app/catalog/events/[eventId]/edit/page.tsx');
  const css = read('src/app/catalog/_components/EventWriteForm.module.css');
  const eventDetail = read('src/app/catalog/_components/EventDetail.module.css');
  const invitation = read('src/app/catalog/_components/InvitationCard.module.css');

  assert.match(page, /styles\.occurrenceDateTimeRow/);
  assert.match(page, /styles\.occurrenceCanceledBadge/);
  assert.match(
    css,
    /\.occurrenceDateTimeRow\s*\{[\s\S]*?align-items:\s*flex-start;[\s\S]*?gap:\s*6px;/,
  );
  assert.match(eventDetail, /\.occurrenceTime\s*\{[\s\S]*?align-items:\s*flex-start;/);
  assert.match(invitation, /\.title\s*\{[\s\S]*?align-items:\s*center;/);
});

void test('occurrence lifecycle feedback is composed above one horizontal action row', () => {
  const update = read('src/app/catalog/_components/OccurrenceUpdateForm.tsx');
  const cancellation = read('src/app/catalog/_components/OccurrenceCancellationForm.tsx');
  const deletion = read('src/app/catalog/_components/DeleteOccurrenceForm.tsx');
  const css = read('src/app/catalog/_components/EventWriteForm.module.css');

  assert.match(update, /styles\.sheetLifecycleFeedback/);
  assert.match(update, /styles\.sheetLifecycleActions/);
  assert.match(
    css,
    /\.sheetLifecycle\s*\{[\s\S]*?flex-direction:\s*column;[\s\S]*?gap:\s*var\(--space-md\);/,
  );
  // The equal-width layout itself (flex sizing, min-width, child button
  // width) moved to the shared `src/ui/actionRow.module.css` `.equal` role
  // (Issue #310; actionRow.test.ts owns that contract). What stays local
  // here is that this screen's row still composes it, and font-size - a
  // danger-trigger typography decision, not the row's layout - remains a
  // per-selector declaration (Button.test.ts no longer duplicates this;
  // Issue #312 moved it here, Issue #310 narrowed it to font-size only).
  assert.match(
    css,
    /\.sheetLifecycleActions\s*\{\s*composes:\s*equal from '\.\.\/\.\.\/\.\.\/ui\/actionRow\.module\.css';\s*\}/,
  );
  for (const selector of [
    '.sheetLifecycleActions > form > button',
    '.dangerActions > form > button',
  ]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    assert.ok(rule, `${selector} rule is missing`);
    assert.match(rule[1] ?? '', /font-size:\s*var\(--font-size-body-sm\);/);
    assert.doesNotMatch(
      rule[1] ?? '',
      /width:\s*100%;/,
      `${selector} should get width from the shared equal-width role, not restate it`,
    );
  }

  assert.doesNotMatch(cancellation, /window\.confirm/);
  assert.doesNotMatch(deletion, /window\.confirm/);
  assert.match(deletion, /<Sheet/);
  assert.doesNotMatch(cancellation, /<StatePanel/);
  assert.doesNotMatch(deletion, /<StatePanel/);
  assert.match(update, /cancellationState\.notice/);
  assert.match(update, /deleteState\.feedback/);
});

void test('delete confirmation sheets reuse the save-sheet footer vocabulary', () => {
  const deleteForms = [
    read('src/app/catalog/_components/DeleteEventForm.tsx'),
    read('src/app/catalog/_components/DeleteOccurrenceForm.tsx'),
    read('src/app/schedule/_components/DeleteEntryForm.tsx'),
  ];

  // The footer bar itself (padding, top rule, alignment) is Sheet's, checked
  // once in src/ui/__tests__/Sheet.test.ts (Issue #318). What belongs here is
  // what these three sheets mean: a danger submit in the footer slot, and no
  // header close on a confirmation.
  for (const source of deleteForms) {
    assert.match(source, /footer=\{/);
    assert.match(source, /showCloseButton=\{false\}/);
    assert.match(source, /variant="danger"/);
  }
  assert.match(deleteForms[0] ?? '', /title="このイベントを削除"/);
  assert.match(deleteForms[1] ?? '', /title="この公演回を削除"/);
  assert.match(deleteForms[2] ?? '', /title="この予定を削除"/);
});

void test('ticket opportunity controls use the shared write notice without a local duplicate', () => {
  const controls = read('src/app/tickets/_components/TicketOpportunityStateControls.tsx');
  const localNoticeName = ['TicketOpportunity', 'WriteNotice'].join('');
  const localNoticeBase = `src/app/tickets/_components/${localNoticeName}`;
  assert.match(controls, /import \{ WriteNotice \} from '@\/ui\/WriteNotice';/);
  assert.match(controls, /<WriteNotice notice=\{state\.notice\} attempt=\{state\.attempt\} \/>/);
  assert.doesNotMatch(controls, new RegExp(localNoticeName));
  assert.throws(() => read(`${localNoticeBase}.tsx`));
  assert.throws(() => read(`${localNoticeBase}.module.css`));
});

void test('submit-based email sheets use a footer submit associated with their body form', () => {
  const sheet = read('src/app/schedule/_components/ShareAddSheet.tsx');
  const form = read('src/app/schedule/_components/ShareAddForm.tsx');
  const invite = read('src/app/catalog/_components/InviteSheet.tsx');

  assert.match(sheet, /showCloseButton=\{false\}/);
  assert.match(sheet, /footer=\{/);
  assert.match(sheet, /<Button[\s\S]*?type="submit"[\s\S]*?form=\{formId\}/);
  assert.match(sheet, /state\.notice/);
  assert.match(sheet, /closedAttemptRef/);
  assert.match(sheet, /setOpen\(false\)/);
  assert.match(form, /id=\{formId\}/);
  assert.doesNotMatch(form, /<Button/);
  assert.doesNotMatch(form, /styles\.actions/);

  assert.match(invite, /showCloseButton=\{false\}/);
  assert.match(invite, /footer=\{/);
  assert.match(invite, /<Button[\s\S]*?type="submit"[\s\S]*?form=\{formId\}/);
  assert.match(invite, /id=\{formId\}/);
  assert.doesNotMatch(invite, /styles\.actions/);
});

void test('sheet write notices are before occurrence/content UI', () => {
  const invite = read('src/app/catalog/_components/InviteSheet.tsx');
  const participation = read('src/app/catalog/_components/ParticipationSheet.tsx');
  const occurrenceTime = (source: string) => source.indexOf('styles.occurrenceTime');
  const notice = (source: string) => source.indexOf('<WriteNotice');

  assert.ok(notice(invite) < occurrenceTime(invite));
  assert.ok(notice(participation) < occurrenceTime(participation));
  const occurrenceUpdate = read('src/app/catalog/_components/OccurrenceUpdateForm.tsx');
  assert.ok(
    occurrenceUpdate.indexOf('<WriteNotice') < occurrenceUpdate.indexOf('<OccurrenceFields'),
  );
});

void test('requested sign-in acknowledgement is page-local and keeps its copy', () => {
  const page = read('src/app/sign-in/page.tsx');
  const css = read('src/app/sign-in/page.module.css');
  const copy =
    'リクエストを受け付けました。登録済みのメールアドレスで、メール送信が利用可能な場合はサインインリンクが届きます。届かない場合は時間をおいて再試行するか、管理者に連絡してください。';

  assert.doesNotMatch(page, /Surface/);
  assert.match(page, new RegExp(copy));
  assert.match(
    css,
    /\.requestAcknowledgement\s*\{[\s\S]*?background:\s*var\(--color-surface-subtle\);/,
  );
  assert.match(
    css,
    /\.requestAcknowledgement\s*\{[\s\S]*?border-radius:\s*var\(--radius-control\);/,
  );
});
