import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SectionHeading } from './section-heading';

describe('SectionHeading', () => {
  it('owns genuine section h2 semantics and canonical typography', () => {
    render(<SectionHeading>参加予定</SectionHeading>);

    expect(screen.getByRole('heading', { level: 2, name: '参加予定' })).toHaveClass(
      'text-title',
      'leading-title',
      'font-semibold',
      'text-foreground',
    );
  });

  it('passes through consumer classes for layout and semantic borders', () => {
    render(<SectionHeading className="border-b-2 border-foreground">公演回</SectionHeading>);

    expect(screen.getByRole('heading', { level: 2, name: '公演回' })).toHaveClass(
      'border-b-2',
      'border-foreground',
      'leading-title',
    );
  });
});
