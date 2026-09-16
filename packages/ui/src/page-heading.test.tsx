import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeading } from './page-heading';

describe('PageHeading', () => {
  it('owns the page-level h1 semantics and canonical heading typography', () => {
    render(<PageHeading>イベント</PageHeading>);

    const heading = screen.getByRole('heading', { level: 1, name: 'イベント' });
    expect(heading).toHaveClass(
      'text-heading',
      'leading-heading',
      'font-semibold',
      'text-foreground',
    );
  });

  it('allows consumers to add layout classes without replacing the semantic contract', () => {
    render(<PageHeading className="min-w-0 flex-1">イベント</PageHeading>);

    const heading = screen.getByRole('heading', { level: 1, name: 'イベント' });
    expect(heading).toHaveClass('min-w-0', 'flex-1', 'leading-heading');
  });
});
