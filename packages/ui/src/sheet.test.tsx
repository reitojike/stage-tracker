import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { compile } from 'tailwindcss';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './components/sheet';

const require = createRequire(import.meta.url);
const appCssPath = resolve(process.cwd(), '../../apps/web/src/app/globals.css');
const appCssDirectory = resolve(process.cwd(), '../../apps/web/src/app');

async function generateSheetCss(candidates: string[]) {
  const appCss = readFileSync(appCssPath, 'utf8').replace(/^@import .*$/gm, '');
  const tailwindTheme = readFileSync(require.resolve('tailwindcss/theme.css'), 'utf8');
  const compiler = await compile(`${tailwindTheme}\n${appCss}\n@tailwind utilities;`, {
    base: appCssDirectory,
  });
  return compiler.build(candidates);
}

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

  it('keeps side sheets on the container width and preserves footer safe-area spacing', async () => {
    render(
      <>
        <Sheet open onOpenChange={() => undefined}>
          <SheetContent side="left">
            <SheetFooter>
              <button type="button">Save left</button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
        <Sheet open onOpenChange={() => undefined}>
          <SheetContent>
            <SheetFooter>
              <button type="button">Save right</button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </>,
    );

    const dialogs = screen.getAllByRole('dialog', { hidden: true });
    const leftDialog = dialogs.find((dialog) => dialog.getAttribute('data-side') === 'left');
    const rightDialog = dialogs.find((dialog) => dialog.getAttribute('data-side') === 'right');
    expect(leftDialog).toHaveClass('data-[side=left]:max-w-sm');
    expect(rightDialog).toHaveClass('data-[side=right]:max-w-sm');
    const footer = screen.getByRole('button', { name: 'Save left', hidden: true }).parentElement;
    expect(footer).toHaveClass('pb-[calc(var(--spacing-sm)+env(safe-area-inset-bottom))]');

    const generatedCss = await generateSheetCss([
      'data-[side=left]:max-w-sm',
      'data-[side=right]:max-w-sm',
      'pb-[calc(var(--spacing-sm)+env(safe-area-inset-bottom))]',
    ]);
    expect(generatedCss).toMatch(
      /\.data-\\\[side\\=left\\\]\\:max-w-sm\[data-side="left"\]\s*\{\s*max-width:\s*var\(--container-sm\);\s*\}/,
    );
    expect(generatedCss).toMatch(
      /\.data-\\\[side\\=right\\\]\\:max-w-sm\[data-side="right"\]\s*\{\s*max-width:\s*var\(--container-sm\);\s*\}/,
    );
    expect(generatedCss).toMatch(
      /\.pb-\\\[calc\\\(var\\\(--spacing-sm\\\)\\\+env\\\(safe-area-inset-bottom\\\)\\\)\\\]\s*\{\s*padding-bottom:\s*calc\(var\(--spacing-sm\) \+ env\(safe-area-inset-bottom\)\);\s*\}/,
    );
  });
});
