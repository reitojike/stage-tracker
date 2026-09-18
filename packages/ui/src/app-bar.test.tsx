import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppBar } from './app-bar';

describe('AppBar', () => {
  it('renders the bell and My Page avatar by default', () => {
    render(<AppBar myPageHref="/mypage" myPageInitial="A" />);

    expect(screen.getByRole('link', { name: 'お知らせ' })).toHaveAttribute(
      'href',
      '/notifications',
    );
    expect(
      screen
        .getByRole('link', { name: 'お知らせ' })
        .querySelector('[data-slot="notification-unread-indicator"]'),
    ).toBeNull();
    expect(screen.getByRole('link', { name: 'マイページ' })).toHaveAttribute('href', '/mypage');
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('hides both affordances when showActions=false (unauthenticated surface)', () => {
    render(<AppBar showActions={false} myPageHref="/mypage" myPageInitial="A" />);

    expect(screen.queryByRole('link', { name: /お知らせ/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'マイページ' })).not.toBeInTheDocument();
  });

  it('keeps the Notifications entry point enabled without a callback', () => {
    render(<AppBar myPageHref="/mypage" myPageInitial="A" />);

    const bell = screen.getByRole('link', { name: 'お知らせ' });
    expect(bell).not.toHaveAttribute('aria-disabled');
    expect(bell).toHaveAttribute('href', '/notifications');
  });

  it('hasUnreadNotifications only changes the accessible label/marker, it is never derived internally', () => {
    render(<AppBar myPageHref="/mypage" myPageInitial="A" hasUnreadNotifications />);

    const bell = screen.getByRole('link', { name: 'お知らせ（未読あり）' });
    expect(bell).toHaveAttribute('href', '/notifications');
    expect(bell.querySelector('[data-slot="notification-unread-indicator"]')).toHaveClass(
      'bg-primary',
    );
    expect(bell.querySelector('[data-slot="notification-unread-indicator"]')).not.toHaveClass(
      'bg-destructive',
    );
  });

  it('renders a boolean unread indicator without a numeric count', () => {
    render(<AppBar myPageHref="/mypage" myPageInitial="A" hasUnreadNotifications />);

    expect(screen.getByRole('link', { name: 'お知らせ（未読あり）' })).not.toHaveTextContent(/\d/);
  });

  it('uses the canvas background and 44px header controls', () => {
    render(<AppBar myPageHref="/mypage" myPageInitial="A" />);

    expect(screen.getByRole('banner')).toHaveClass('bg-background');
    expect(screen.getByRole('link', { name: 'お知らせ' })).toHaveClass('size-11');
    expect(screen.getByRole('link', { name: 'マイページ' })).toHaveClass('size-11');
  });
});
