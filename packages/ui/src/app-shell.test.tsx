import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from './app-shell';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

describe('AppShell', () => {
  it('renders AppBar + children + PrimaryNav by default', () => {
    render(
      <AppShell myPageHref="/mypage" myPageInitial="A">
        <p>コンテンツ</p>
      </AppShell>,
    );

    expect(screen.getByRole('link', { name: 'マイページ' })).toBeInTheDocument();
    expect(screen.getByText('コンテンツ')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '主要ナビゲーション' })).toBeInTheDocument();
  });

  it('hides PrimaryNav when showPrimaryNav=false (unauthenticated surface)', () => {
    render(
      <AppShell myPageHref="/mypage" myPageInitial="A" showPrimaryNav={false}>
        <p>コンテンツ</p>
      </AppShell>,
    );

    expect(
      screen.queryByRole('navigation', { name: '主要ナビゲーション' }),
    ).not.toBeInTheDocument();
  });

  it("hides AppBar's actions when showActions=false", () => {
    render(
      <AppShell myPageHref="/mypage" myPageInitial="A" showActions={false}>
        <p>コンテンツ</p>
      </AppShell>,
    );

    expect(screen.queryByRole('link', { name: 'マイページ' })).not.toBeInTheDocument();
  });

  // PR #377 review / Issue #376 a11y verification: an axe-core run against
  // the AppShell stories found the content column had regressed from
  // legacy's `<main>` (apps/legacy-web/src/ui/AppShell.tsx) to a plain
  // `<div>`, tripping axe's landmark-one-main/region checks. This locks the
  // landmark in so it can't silently regress again.
  it('renders the content column as a single <main> landmark', () => {
    render(
      <AppShell myPageHref="/mypage" myPageInitial="A">
        <p>コンテンツ</p>
      </AppShell>,
    );

    const main = screen.getByRole('main');
    expect(main).toContainElement(screen.getByText('コンテンツ'));
  });
});
