import { render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MonthNavigation } from './month-navigation';

const mockUseLinkStatus = vi.hoisted(() => vi.fn(() => ({ pending: false })));

vi.mock('next/link', () => ({
  default: ({ href, ...props }: ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...props} />
  ),
  useLinkStatus: mockUseLinkStatus,
}));

describe('MonthNavigation', () => {
  beforeEach(() => {
    mockUseLinkStatus.mockReset();
    mockUseLinkStatus.mockReturnValue({ pending: false });
  });

  it('keeps both month controls at 44px and labels the navigation context', () => {
    render(
      <MonthNavigation
        label="2026年9月"
        previousHref="/calendar?month=2026-08"
        nextHref="/calendar?month=2026-10"
      />,
    );

    expect(screen.getByRole('navigation', { name: '2026年9月の月移動' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '前の月' })).toHaveClass('size-11');
    expect(screen.getByRole('link', { name: '次の月' })).toHaveClass('size-11');
  });

  it('replaces only the pending control with progress while keeping its 44px geometry', () => {
    mockUseLinkStatus.mockReturnValueOnce({ pending: true }).mockReturnValue({ pending: false });

    render(
      <MonthNavigation
        label="2026年9月"
        previousHref="/calendar?month=2026-08"
        nextHref="/calendar?month=2026-10"
      />,
    );

    const previous = screen.getByRole('link', { name: '前の月' });
    expect(previous).toHaveClass('size-11');
    expect(within(previous).getByText('読み込み中')).toBeInTheDocument();
    expect(
      within(screen.getByRole('link', { name: '次の月' })).queryByText('読み込み中'),
    ).toBeNull();
  });
});
