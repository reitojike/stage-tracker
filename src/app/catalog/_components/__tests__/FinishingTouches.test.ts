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
  assert.match(deleteEvent, /削除する/);
  assert.match(deleteEvent, /aria-label="このイベントを削除"/);
  assert.match(deleteOccurrence, /削除する/);
  assert.match(deleteOccurrence, /aria-label="この公演回を削除"/);
  assert.match(occurrenceUpdate, /<span>\{isPending \? '保存中…' : '保存'\}<\/span>/);
  assert.match(eventRange, /<span>\{isPending \? '保存中…' : '保存'\}<\/span>/);
  assert.match(occurrenceAdd, /<span>\{isPending \? '追加中…' : '追加'\}<\/span>/);
  assert.match(shareAdd, /<span>\{isPending \? '追加中…' : '追加'\}<\/span>/);
  assert.match(signIn, /<Button[\s\S]*>\s*リンクをリクエスト\s*<\/Button>/);
});

void test('event edit puts a canceled badge beside a wrapping datetime', () => {
  // Issue #311's own three-file list (each badge composing inlineBadge and
  // restating no flex-shrink of its own) is gone: sharedCssRules.ts (Issue
  // #312) catches a rule that restates what it composes, and Row.test.ts
  // owns the shared `.inlineBadge` declaration itself. What stays here is
  // this screen's intentional alignment either side of the badge.
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
  assert.match(
    css,
    /\.sheetLifecycleActions\s*\{[\s\S]*?display:\s*flex;[\s\S]*?gap:\s*var\(--space-sm\);/,
  );
  assert.match(css, /\.sheetLifecycleActions > form\s*\{[\s\S]*?flex:\s*1 1 0;/);

  // The two-column lifecycle/danger action rows fill their column and take
  // the smaller label size. Moved here from Button.test.ts (Issue #312):
  // this is Event-edit's own row sizing, not part of the shared Button
  // contract that file guards. The equal-width action row itself is
  // Issue #310's scope.
  for (const selector of [
    '.sheetLifecycleActions > form > button',
    '.dangerActions > form > button',
  ]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    assert.ok(rule, `${selector} rule is missing`);
    assert.match(rule[1] ?? '', /width:\s*100%;/);
    assert.match(rule[1] ?? '', /font-size:\s*var\(--font-size-body-sm\);/);
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
  const eventCss = read('src/app/catalog/_components/EventWriteForm.module.css');
  const scheduleCss = read('src/app/schedule/_components/ScheduleWriteForm.module.css');

  for (const source of deleteForms) {
    assert.match(source, /footer=\{\s*<div className=\{styles\.sheetFooter\}>/);
    assert.match(source, /showCloseButton=\{false\}/);
    assert.match(source, /variant="danger"/);
  }
  assert.match(deleteForms[0] ?? '', /title="このイベントを削除"/);
  assert.match(deleteForms[1] ?? '', /title="この公演回を削除"/);
  assert.match(deleteForms[2] ?? '', /title="この予定を削除"/);
  for (const css of [eventCss, scheduleCss]) {
    assert.match(
      css,
      /\.sheetFooter\s*\{[\s\S]*?display:\s*flex;[\s\S]*?justify-content:\s*flex-end;[\s\S]*?padding:\s*var\(--space-md\);[\s\S]*?border-top:\s*1px solid var\(--color-border\);/,
    );
  }
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
  const css = read('src/app/schedule/_components/ShareAddSheet.module.css');
  const invite = read('src/app/catalog/_components/InviteSheet.tsx');
  const inviteCss = read('src/app/catalog/_components/InviteSheet.module.css');

  assert.match(sheet, /showCloseButton=\{false\}/);
  assert.match(sheet, /footer=\{/);
  assert.match(sheet, /<Button[\s\S]*?type="submit"[\s\S]*?form=\{formId\}/);
  assert.match(sheet, /state\.notice/);
  assert.match(sheet, /closedAttemptRef/);
  assert.match(sheet, /setOpen\(false\)/);
  assert.match(form, /id=\{formId\}/);
  assert.doesNotMatch(form, /<Button/);
  assert.doesNotMatch(form, /styles\.actions/);
  assert.match(css, /\.footer\s*\{[\s\S]*?border-top:\s*1px solid var\(--color-border\);/);

  assert.match(invite, /showCloseButton=\{false\}/);
  assert.match(invite, /footer=\{/);
  assert.match(invite, /<Button[\s\S]*?type="submit"[\s\S]*?form=\{formId\}/);
  assert.match(invite, /id=\{formId\}/);
  assert.doesNotMatch(invite, /styles\.actions/);
  assert.match(inviteCss, /\.footer\s*\{[\s\S]*?border-top:\s*1px solid var\(--color-border\);/);
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
