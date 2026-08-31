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
  assert.match(editForm, /イベント情報を保存/);
  assert.match(createForm, /styles\.fixedForm/);
  assert.match(createForm, /styles\.fixedSubmit/);
});

void test('event edit puts a canceled badge beside a wrapping datetime', () => {
  const page = read('src/app/catalog/events/[eventId]/edit/page.tsx');
  const css = read('src/app/catalog/_components/EventWriteForm.module.css');

  assert.match(page, /styles\.occurrenceDateTimeRow/);
  assert.match(page, /styles\.occurrenceCanceledBadge/);
  assert.match(
    css,
    /\.occurrenceDateTimeRow\s*\{[\s\S]*?align-items:\s*flex-start;[\s\S]*?gap:\s*6px;/,
  );
  assert.match(css, /\.occurrenceCanceledBadge\s*\{\s*flex-shrink:\s*0;/);
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
  assert.doesNotMatch(cancellation, /window\.confirm/);
  assert.doesNotMatch(deletion, /window\.confirm/);
  assert.match(deletion, /<Sheet/);
  assert.doesNotMatch(cancellation, /<StatePanel/);
  assert.doesNotMatch(deletion, /<StatePanel/);
  assert.match(update, /cancellationState\.notice/);
  assert.match(update, /deleteState\.feedback/);
});

void test('share-add sheet uses a footer submit associated with its body form', () => {
  const sheet = read('src/app/schedule/_components/ShareAddSheet.tsx');
  const form = read('src/app/schedule/_components/ShareAddForm.tsx');
  const css = read('src/app/schedule/_components/ShareAddSheet.module.css');

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

void test('write pending controls use scoped stable geometry contracts', () => {
  const eventCss = read('src/app/catalog/_components/EventWriteForm.module.css');
  const scheduleCss = read('src/app/schedule/_components/ScheduleWriteForm.module.css');
  const inviteCss = read('src/app/catalog/_components/InviteSheet.module.css');
  const shareCss = read('src/app/schedule/_components/ShareAddSheet.module.css');
  const cardCss = read('src/app/catalog/_components/InvitationCard.module.css');
  const detailCss = read('src/app/schedule/_components/ScheduleDetail.module.css');
  for (const css of [eventCss, scheduleCss, inviteCss, shareCss, cardCss, detailCss]) {
    assert.match(css, /\.stablePendingButton\s*\{[\s\S]*?white-space:\s*nowrap;/);
    assert.match(css, /\.stablePendingLabel\s*\{[\s\S]*?display:\s*grid;/);
    assert.match(css, /\.stablePendingLabel\s*>\s*span\s*\{[\s\S]*?grid-area:\s*1\s*\/\s*1;/);
    assert.match(css, /\.stablePendingSizing\s*\{[\s\S]*?visibility:\s*hidden;/);
    assert.doesNotMatch(css, /min-width:\s*10ch/);
  }
  for (const relativePath of [
    'src/app/catalog/_components/EventDetailsEditForm.tsx',
    'src/app/catalog/_components/EventCancellationForm.tsx',
    'src/app/catalog/_components/OccurrenceCancellationForm.tsx',
    'src/app/schedule/_components/DeleteEntryForm.tsx',
    'src/app/schedule/_components/LeaveShareForm.tsx',
  ]) {
    const source = read(relativePath);
    assert.match(source, /styles\.stablePendingLabel/);
    assert.match(source, /aria-hidden="true"\s+className=\{styles\.stablePendingSizing\}/);
  }
  assert.doesNotMatch(read('src/ui/Button.tsx'), /stablePendingButton/);
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
