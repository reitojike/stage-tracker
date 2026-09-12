import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BackLink } from './back-link';
import { CompactList, ListRowLink } from './list-row';

describe('navigation affordances', () => {
  it('gives the compact BackLink a 44px minimum pointer target', () => {
    render(<BackLink href="/catalog">イベントに戻る</BackLink>);

    expect(screen.getByRole('link', { name: 'イベントに戻る' })).toHaveClass(
      'before:h-[max(100%,2.75rem)]',
      'before:w-[max(100%,2.75rem)]',
    );
  });

  it('renders repeated navigation as separator rows with a chevron, not cards', () => {
    render(
      <CompactList>
        <li>
          <ListRowLink href="/catalog/events/1">公演</ListRowLink>
        </li>
      </CompactList>,
    );

    const link = screen.getByRole('link', { name: '公演' });
    expect(link).toHaveClass('border-b', 'min-h-11');
    expect(link).not.toHaveClass('bg-card', 'rounded-control');
    expect(link.querySelector('svg')).toBeInTheDocument();
  });
});
