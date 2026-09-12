import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './components/sheet';

function SheetHarness() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<button type="button">Open sheet</button>} />
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Test sheet</SheetTitle>
          <SheetDescription>Test sheet description</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-md py-md">
          <button type="button">Body action</button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

describe('Sheet', () => {
  it('supports controlled open/close, modal focus, Escape, and backdrop', async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);
    const trigger = screen.getByRole('button', { name: 'Open sheet' });
    await user.click(trigger);
    expect(screen.getByRole('heading', { name: 'Test sheet' })).toBeInTheDocument();
    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    expect(screen.getByRole('dialog')).toContainElement(activeElement);
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Test sheet' })).not.toBeInTheDocument(),
    );
    await user.click(trigger);
    await user.click(screen.getByTestId('sheet-backdrop'));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Test sheet' })).not.toBeInTheDocument(),
    );
  });

  it('keeps footer outside the scrollable body', () => {
    render(
      <Sheet open onOpenChange={() => undefined}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>Short viewport</SheetTitle>
            <SheetDescription>Short viewport description</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-md py-md">
            <p>Body</p>
          </div>
          <div data-slot="sheet-footer">
            <button type="button">Save</button>
          </div>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByText('Body').parentElement).toHaveClass('overflow-y-auto');
  });

  it('bounds a bottom sheet on desktop and carries slide lifecycle styles', async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);

    await user.click(screen.getByRole('button', { name: 'Open sheet' }));
    expect(screen.getByRole('dialog', { name: 'Test sheet' })).toHaveClass(
      'data-[side=bottom]:max-w-[480px]',
      'data-[side=bottom]:data-starting-style:translate-y-full',
      'data-[side=bottom]:data-ending-style:translate-y-full',
    );
  });
});
