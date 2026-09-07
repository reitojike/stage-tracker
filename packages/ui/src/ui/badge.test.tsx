import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { Badge, type BadgeProps } from './badge';

describe('Badge', () => {
  it('renders its label', () => {
    render(<Badge variant="outline">組</Badge>);
    expect(screen.getByText('組')).toBeInTheDocument();
  });

  it('stamps data-variant for each of the 5 semantic variants', () => {
    const variants = ['outline', 'subtle', 'done', 'deadline', 'terminal'] as const;
    for (const variant of variants) {
      const { container, unmount } = render(<Badge variant={variant}>x</Badge>);
      expect(container.querySelector("[data-slot='badge']")).toHaveAttribute(
        'data-variant',
        variant,
      );
      unmount();
    }
  });

  it('only the done variant renders its own checkmark glyph', () => {
    const { container: doneContainer } = render(<Badge variant="done">申し込み済み</Badge>);
    expect(doneContainer.querySelector('svg')).toBeInTheDocument();

    const { container: subtleContainer } = render(<Badge variant="subtle">申し込む予定</Badge>);
    expect(subtleContainer.querySelector('svg')).not.toBeInTheDocument();
  });

  it('never runs (compile-time only) - variant is required with no default', () => {
    // `variant` is required; Badge must not guess a default meaning. If it
    // ever became optional, plain `ComponentProps<'span'>` (no `variant`)
    // would satisfy `BadgeProps` and this assertion would fail to
    // type-check (enforced by `pnpm run typecheck`, not at runtime -
    // `expectTypeOf` is a no-op here, same rationale as
    // state-panel.test.tsx).
    expectTypeOf<ComponentProps<'span'>>().not.toExtend<BadgeProps>();
  });
});
