/*
 * Loading fallback stable-chrome contract (Issue #355).
 *
 * docs/ux-ui.md's loading rule says a route's `loading.tsx` must restate
 * the stable/unconditional page chrome its own page.tsx renders before any
 * data/permission-dependent branch - not merely "a component that also
 * appears somewhere in page.tsx". Which chrome is actually unconditional
 * for a given route is a control-flow fact read by hand off each
 * page.tsx (see this file's own allowlist comments and docs/ux-ui.md) -
 * this module does not derive it from source, matching Issue #355's Test
 * contract ("AST / control-flow analyzerの新設へscopeを広げず... bounded
 * mechanismにする").
 *
 * Deliberately regex-only, mirroring src/ui/__tests__/sharedRoleWiring.ts:
 * this only answers "does this loading.tsx's source import and render the
 * named component", not whether the JSX is well-formed or reachable.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

/** Reads a repository-relative source file. */
export const readSource = (repoRelativePath: string): string =>
  readFileSync(`${repoRoot}/${repoRelativePath}`, 'utf8');

/** Whether a repository-relative path exists. */
export const sourceExists = (repoRelativePath: string): boolean =>
  existsSync(`${repoRoot}/${repoRelativePath}`);

/**
 * Whether `source` both imports and renders `componentName` as a JSX
 * element - either alone is not enough: an unused import proves nothing
 * about what actually renders, and a JSX-shaped string inside prose/a
 * comment is not a real usage without a matching import bringing that name
 * into scope.
 */
export const importsAndRendersComponent = (source: string, componentName: string): boolean => {
  const importPattern = new RegExp(`import\\s*\\{[^}]*\\b${componentName}\\b[^}]*\\}\\s*from`);
  const usagePattern = new RegExp(`<${componentName}[\\s/>]`);
  return importPattern.test(source) && usagePattern.test(source);
};

export interface LoadingChromeExpectation {
  /** Human-readable route label, matching docs/ux-ui.md's/Issue #355's own notation. */
  route: string;
  /** Repository-relative path to that route's `loading.tsx`. */
  loadingPath: string;
  /**
   * Stable/unconditional chrome components this route's page.tsx renders
   * before any data/permission-dependent branch, and which this route's
   * loading.tsx must therefore also render. Empty when the route has no
   * stable chrome to restate.
   */
  expectedChrome: readonly string[];
}

/**
 * Issue #355's fresh, per-route classification of `src/app/**\/loading.tsx`
 * (13 routes, verified against current page.tsx control flow - not the
 * route census itself, so a 14th route added later is not required to
 * appear here until it is deliberately classified).
 *
 * Three entries correct Issue #355's own starting allowlist after fresh
 * verification found it did not match current page.tsx control flow (see
 * each route's own loading.tsx for the full reasoning):
 *
 * - `catalog/events/new` and `catalog/events/[eventId]/edit`: the Issue's
 *   allowlist listed `PageHeading`, but in current page.tsx both routes
 *   render `PageHeading` only in the final success branch (after an
 *   auth/permission or event-load/canEdit check passes) while `BackLink`
 *   is unconditional across every branch - the exact "BackLink
 *   unconditional, heading conditional" pattern the Issue's own Context
 *   section names as the motivating problem for `schedule/[entryId]/edit`
 *   and `catalog/events/[eventId]`.
 * - `catalog/invitations`: the Issue's allowlist omitted `BackLink`, but
 *   current page.tsx renders it unconditionally ahead of its `state`
 *   branch, same as every other BackLink-classified route here.
 */
export const LOADING_CHROME_ALLOWLIST: readonly LoadingChromeExpectation[] = [
  { route: 'calendar', loadingPath: 'src/app/calendar/loading.tsx', expectedChrome: ['PageHeading'] },
  { route: 'catalog', loadingPath: 'src/app/catalog/loading.tsx', expectedChrome: ['PageHeading'] },
  { route: 'tickets', loadingPath: 'src/app/tickets/loading.tsx', expectedChrome: ['PageHeading'] },
  { route: '(home)', loadingPath: 'src/app/(home)/loading.tsx', expectedChrome: ['PageHeading'] },
  { route: 'mypage', loadingPath: 'src/app/mypage/loading.tsx', expectedChrome: ['PageHeading'] },
  {
    route: 'catalog/events/new',
    loadingPath: 'src/app/catalog/events/new/loading.tsx',
    expectedChrome: ['BackLink'],
  },
  {
    route: 'catalog/events/[eventId]/edit',
    loadingPath: 'src/app/catalog/events/[eventId]/edit/loading.tsx',
    expectedChrome: ['BackLink'],
  },
  {
    route: 'catalog/invitations',
    loadingPath: 'src/app/catalog/invitations/loading.tsx',
    expectedChrome: ['BackLink', 'PageHeading'],
  },
  {
    route: 'schedule/new',
    loadingPath: 'src/app/schedule/new/loading.tsx',
    expectedChrome: ['BackLink', 'SchedulePageHeading'],
  },
  {
    route: 'schedule/[entryId]',
    loadingPath: 'src/app/schedule/[entryId]/loading.tsx',
    expectedChrome: ['BackLink'],
  },
  {
    route: 'schedule/[entryId]/edit',
    loadingPath: 'src/app/schedule/[entryId]/edit/loading.tsx',
    expectedChrome: ['BackLink'],
  },
  {
    route: 'catalog/events/[eventId]',
    loadingPath: 'src/app/catalog/events/[eventId]/loading.tsx',
    expectedChrome: ['BackLink'],
  },
  { route: 'schedule', loadingPath: 'src/app/schedule/loading.tsx', expectedChrome: [] },
];
