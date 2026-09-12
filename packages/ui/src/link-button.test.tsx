import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnchorButton, LinkButton } from './link-button';

describe('link button variants', () => {
  it('keeps internal navigation as a native link', () => {
    render(<LinkButton href="/next">次へ</LinkButton>);

    expect(screen.getByRole('link', { name: '次へ' })).toHaveAttribute('href', '/next');
    expect(screen.queryByRole('button', { name: '次へ' })).toBeNull();
  });

  it('keeps external navigation as a native link', () => {
    render(<AnchorButton href="https://example.com">公式情報</AnchorButton>);

    expect(screen.getByRole('link', { name: '公式情報' })).toHaveAttribute(
      'href',
      'https://example.com',
    );
  });
});
