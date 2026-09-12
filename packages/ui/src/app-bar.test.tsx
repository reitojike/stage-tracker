import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppBar } from './app-bar';

describe('AppBar', () => {
  it('renders the bell and My Page avatar by default', () => {
    render(<AppBar myPageHref="/mypage" myPageInitial="A" />);

    expect(screen.getByRole('button', { name: 'お知らせ' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'マイページ' })).toHaveAttribute('href', '/mypage');
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('hides both affordances when showActions=false (unauthenticated surface)', () => {
    render(<AppBar showActions={false} myPageHref="/mypage" myPageInitial="A" />);

    expect(screen.queryByRole('button', { name: /お知らせ/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'マイページ' })).not.toBeInTheDocument();
  });

  it('お知らせ機能は未実装 (P1): without onNotificationsPress the bell is aria-disabled and inert', async () => {
    const user = userEvent.setup();
    render(<AppBar myPageHref="/mypage" myPageInitial="A" />);

    const bell = screen.getByRole('button', { name: 'お知らせ' });
    expect(bell).toHaveAttribute('aria-disabled', 'true');

    await user.click(bell);
    // Nothing to assert beyond "did not throw" - there is no handler wired.
  });

  it('becomes interactive once a real handler is passed', async () => {
    const user = userEvent.setup();
    const onNotificationsPress = vi.fn();
    render(
      <AppBar myPageHref="/mypage" myPageInitial="A" onNotificationsPress={onNotificationsPress} />,
    );

    const bell = screen.getByRole('button', { name: 'お知らせ' });
    expect(bell).not.toHaveAttribute('aria-disabled', 'true');

    await user.click(bell);
    expect(onNotificationsPress).toHaveBeenCalledTimes(1);
  });

  it('hasUnreadNotifications only changes the accessible label/marker, it is never derived internally', () => {
    render(<AppBar myPageHref="/mypage" myPageInitial="A" hasUnreadNotifications />);

    expect(screen.getByRole('button', { name: 'お知らせ（未読あり）' })).toBeInTheDocument();
  });

  it('uses the canvas background and 44px header controls', () => {
    render(<AppBar myPageHref="/mypage" myPageInitial="A" />);

    expect(screen.getByRole('banner')).toHaveClass('bg-background');
    expect(screen.getByRole('button', { name: 'お知らせ' })).toHaveClass('size-11');
    expect(screen.getByRole('link', { name: 'マイページ' })).toHaveClass('size-11');
  });
});
