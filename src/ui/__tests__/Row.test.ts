import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// No jsdom/React Testing Library in this project's toolchain (test:unit runs
// on plain `node --test`), so this guards the CSS composition contract from
// source. The target list is intentionally explicit: it covers only the
// current text/content + trailing action/metadata rows, not every flex rule
// or every `space-between` usage in the repository.
const root = fileURLToPath(new URL('../../..', import.meta.url));
const read = (relativePath: string) => readFileSync(`${root}/${relativePath}`, 'utf8');

function cssRule(css: string, selector: string, relativePath: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^{}]*)\\}`));
  assert.ok(match, `${selector} rule is missing from ${relativePath}`);
  return match[1] ?? '';
}

const composition = (role: 'row' | 'main' | 'aside') =>
  new RegExp(`composes:\\s*${role}\\s+from\\s+['"][^'"]*row\\.module\\.css['"]`);

void test('Issue #271: shared row primitive owns the flex shrink contract', () => {
  const css = read('src/ui/row.module.css');

  assert.match(cssRule(css, '.row', 'src/ui/row.module.css'), /display:\s*flex;/);
  assert.match(cssRule(css, '.row', 'src/ui/row.module.css'), /align-items:\s*center;/);
  assert.match(cssRule(css, '.row', 'src/ui/row.module.css'), /justify-content:\s*space-between;/);
  assert.match(cssRule(css, '.row', 'src/ui/row.module.css'), /gap:\s*var\(--space-sm\);/);
  assert.match(cssRule(css, '.main', 'src/ui/row.module.css'), /flex:\s*1 1 auto;/);
  assert.match(cssRule(css, '.main', 'src/ui/row.module.css'), /min-width:\s*0;/);
  assert.match(cssRule(css, '.aside', 'src/ui/row.module.css'), /flex:\s*0 0 auto;/);
});

const migratedRows = [
  ['src/app/(home)/page.module.css', '.deadlineHeadingRow'],
  ['src/app/(home)/_components/HomeDeadlineList.module.css', '.deadline'],
  ['src/app/mypage/_components/PasskeySection.module.css', '.item'],
  ['src/app/catalog/_components/OccurrenceParticipationRow.module.css', '.row'],
  ['src/app/schedule/_components/ScheduleDetail.module.css', '.titleRow'],
  ['src/app/schedule/_components/ScheduleDetail.module.css', '.sectionHeadingRow'],
  ['src/app/schedule/_components/ScheduleDetail.module.css', '.recipientRow'],
  ['src/app/catalog/_components/EventDetail.module.css', '.titleRow'],
  ['src/app/catalog/_components/EventDetail.module.css', '.occurrenceHeading'],
  ['src/app/catalog/_components/InvitationList.module.css', '.headingRow'],
  ['src/app/catalog/_components/CatalogView.module.css', '.headingRow'],
  ['src/app/catalog/_components/CatalogView.module.css', '.summaryRow'],
  ['src/app/catalog/_components/EventWriteForm.module.css', '.sectionHeading'],
  ['src/app/catalog/_components/EventWriteForm.module.css', '.occurrenceRow'],
  ['src/ui/selectedDayList.module.css', '.itemLink'],
  ['src/app/catalog/_components/InvitationCard.module.css', '.undoRow'],
  ['src/ui/Sheet.module.css', '.header'],
  ['src/app/catalog/_components/ParticipationSheet.module.css', '.choice'],
  ['src/app/tickets/_components/TicketOpportunityRow.module.css', '.row'],
] as const;

const migratedMains = [
  ['src/app/(home)/page.module.css', '.deadlineHeadingText'],
  ['src/app/(home)/_components/HomeDeadlineList.module.css', '.deadlineText'],
  ['src/app/mypage/_components/PasskeySection.module.css', '.itemLabel'],
  ['src/app/catalog/_components/OccurrenceParticipationRow.module.css', '.statusText'],
  ['src/app/schedule/_components/ScheduleDetail.module.css', '.title'],
  ['src/app/schedule/_components/ScheduleDetail.module.css', '.sectionHeading'],
  ['src/app/schedule/_components/ScheduleDetail.module.css', '.recipientIdentity'],
  ['src/app/catalog/_components/EventDetail.module.css', '.main'],
  ['src/app/catalog/_components/InvitationList.module.css', '.main'],
  ['src/app/catalog/_components/CatalogView.module.css', '.main'],
  ['src/app/catalog/_components/CatalogView.module.css', '.summaryText'],
  ['src/app/catalog/_components/EventWriteForm.module.css', '.sectionHeadingTitle'],
  ['src/app/catalog/_components/EventWriteForm.module.css', '.occurrenceSummary'],
  ['src/ui/selectedDayList.module.css', '.itemBody'],
  ['src/app/mypage/_components/ScheduleAndEventSection.module.css', '.label'],
  ['src/app/catalog/_components/InvitationCard.module.css', '.undoText'],
  ['src/ui/Sheet.module.css', '.title'],
  ['src/app/catalog/_components/ParticipationSheet.module.css', '.choiceLabel'],
  ['src/app/tickets/_components/TicketOpportunityRow.module.css', '.body'],
] as const;

const migratedAsides = [
  ['src/app/(home)/page.module.css', '.deadlineAllLink'],
  ['src/app/mypage/_components/PasskeySection.module.css', '.aside'],
  ['src/app/catalog/_components/OccurrenceParticipationRow.module.css', '.actions'],
  ['src/app/schedule/_components/ScheduleDetail.module.css', '.titleAction'],
  ['src/app/schedule/_components/ScheduleDetail.module.css', '.sectionAction'],
  ['src/app/schedule/_components/ScheduleDetail.module.css', '.removeForm'],
  ['src/app/catalog/_components/EventDetail.module.css', '.editLink'],
  ['src/app/catalog/_components/EventDetail.module.css', '.occurrenceCount'],
  ['src/app/catalog/_components/InvitationList.module.css', '.pendingCount'],
  ['src/app/catalog/_components/CatalogView.module.css', '.filterButtonWrap'],
  ['src/app/catalog/_components/CatalogView.module.css', '.summaryClear'],
  ['src/app/catalog/_components/EventWriteForm.module.css', '.sectionAction'],
  ['src/app/catalog/_components/EventWriteForm.module.css', '.occurrenceAction'],
  ['src/ui/selectedDayList.module.css', '.chevron'],
  ['src/app/mypage/_components/ScheduleAndEventSection.module.css', '.countBadge'],
  ['src/app/catalog/_components/InvitationCard.module.css', '.undoButton'],
  ['src/ui/Sheet.module.css', '.close'],
  ['src/app/catalog/_components/ParticipationSheet.module.css', '.selectedTag'],
  ['src/app/tickets/_components/TicketOpportunityRow.module.css', '.dateColumn'],
  ['src/app/tickets/_components/TicketOpportunityRow.module.css', '.chevron'],
] as const;

void test('Issue #271: migrated rows compose roles without restating shared sizing', () => {
  for (const [relativePath, selector] of migratedRows) {
    const rule = cssRule(read(relativePath), selector, relativePath);
    assert.match(rule, composition('row'), `${relativePath} ${selector}`);
    assert.doesNotMatch(rule, /display:\s*flex;/, `${relativePath} ${selector}`);
    assert.doesNotMatch(rule, /justify-content:\s*space-between;/, `${relativePath} ${selector}`);
    assert.doesNotMatch(rule, /gap:\s*var\(--space-sm\);/, `${relativePath} ${selector}`);
  }

  for (const [relativePath, selector] of migratedMains) {
    const rule = cssRule(read(relativePath), selector, relativePath);
    assert.match(rule, composition('main'), `${relativePath} ${selector}`);
    assert.doesNotMatch(rule, /\bflex\s*:/, `${relativePath} ${selector}`);
    assert.doesNotMatch(rule, /min-width\s*:/, `${relativePath} ${selector}`);
  }

  for (const [relativePath, selector] of migratedAsides) {
    const rule = cssRule(read(relativePath), selector, relativePath);
    assert.match(rule, composition('aside'), `${relativePath} ${selector}`);
    assert.doesNotMatch(rule, /\bflex(?:-shrink)?\s*:/, `${relativePath} ${selector}`);
  }
});

const selectedDayWrappers = [
  'src/app/calendar/_components/MySelectedDayList.module.css',
  'src/app/catalog/_components/SelectedDayList.module.css',
  'src/app/catalog/_components/EventLevelFallbackList.module.css',
] as const;

const selectedDaySharedClasses = [
  'list',
  'heading',
  'items',
  'itemLink',
  'itemBody',
  'chevron',
  'time',
  'title',
  'venue',
] as const;

const selectedDayComposition = (className: string) =>
  new RegExp(
    'composes:\\s*' + className + '\\s+from\\s+["\'][^"\']*selectedDayList\\.module\\.css["\']',
  );

void test('Issue #315: selected-day implementations compose one shared presentation module', () => {
  for (const relativePath of selectedDayWrappers) {
    const css = read(relativePath);
    const classes = relativePath.includes('EventLevelFallbackList')
      ? selectedDaySharedClasses.filter((className) => className !== 'time')
      : selectedDaySharedClasses;
    for (const className of classes) {
      const rule = cssRule(css, '.' + className, relativePath);
      assert.match(rule, selectedDayComposition(className), `${relativePath} .${className}`);
      assert.doesNotMatch(
        rule,
        /(?:^|;)\s*(?:display|font-size|font-weight|line-height|padding|text-decoration|color|gap|margin|touch-action):/,
        `${relativePath} .${className} must not restate shared declarations`,
      );
    }
  }

  for (const relativePath of selectedDayWrappers.slice(1)) {
    const css = read(relativePath);
    const rule = cssRule(css, '.badges', relativePath);
    assert.match(rule, selectedDayComposition('badges'), `${relativePath} .badges`);
    assert.doesNotMatch(rule, /(?:^|;)\s*(?:display|flex-wrap|gap):/);
  }

  const myCalendarCss = read('src/app/calendar/_components/MySelectedDayList.module.css');
  const badgeRow = cssRule(
    myCalendarCss,
    '.badgeRow',
    'src/app/calendar/_components/MySelectedDayList.module.css',
  );
  assert.match(badgeRow, selectedDayComposition('badges'));
  assert.match(badgeRow, /margin-top:\s*var\(--space-2xs\);/);
});
