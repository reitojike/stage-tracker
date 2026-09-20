import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WriteNotice } from './write-notice';

describe('WriteNotice', () => {
  it('keeps a polite live region empty when there is no notice', () => {
    const { container } = render(<WriteNotice notice={null} attempt={0} />);

    expect(container.firstElementChild).toHaveAttribute('aria-live', 'polite');
    expect(container.firstElementChild).toHaveAttribute('role', 'status');
    expect(container.firstElementChild).toBeEmptyDOMElement();
  });

  it('renders the current notice with the shared typography', () => {
    const { container } = render(<WriteNotice notice="保存しました。" attempt={1} />);

    expect(container.firstElementChild).toHaveClass('text-body-sm', 'text-muted-foreground');
    expect(screen.getByText('保存しました。')).toBeInTheDocument();
  });

  it('replaces the message node when attempt changes even if the copy is the same', () => {
    const { rerender } = render(<WriteNotice notice="保存しました。" attempt={1} />);
    const firstMessage = screen.getByText('保存しました。');

    rerender(<WriteNotice notice="保存しました。" attempt={2} />);

    expect(screen.getByText('保存しました。')).not.toBe(firstMessage);
  });
});
