import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './components/sheet';

const meta = {
  title: 'UI/Sheet',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

function InteractiveSheet() {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background p-md text-foreground">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            <button type="button" className="rounded-control border border-input px-md py-sm">
              Open sheet
            </button>
          }
        />
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>Browser verification</SheetTitle>
            <SheetDescription>
              Verify the bottom sheet behavior at a narrow viewport.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-md py-md">
            <div className="flex flex-col gap-sm">
              <p>Scrollable body</p>
              {Array.from({ length: 12 }, (_, index) => (
                <p key={index}>Body item {index + 1}</p>
              ))}
            </div>
          </div>
          <SheetFooter>
            <button
              type="button"
              className="rounded-control bg-primary px-md py-sm text-primary-foreground"
            >
              Save
            </button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export const Interactive: Story = {
  render: () => <InteractiveSheet />,
};
