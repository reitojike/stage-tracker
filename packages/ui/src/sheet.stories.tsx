import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { Sheet } from './sheet';

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
      <button
        type="button"
        className="rounded-control border border-input px-md py-sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open sheet
      </button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Browser verification"
        footer={
          <button
            type="button"
            className="rounded-control bg-primary px-md py-sm text-primary-foreground"
          >
            Save
          </button>
        }
      >
        <div className="flex flex-col gap-sm">
          <p>Scrollable body</p>
          {Array.from({ length: 12 }, (_, index) => (
            <p key={index}>Body item {index + 1}</p>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

export const Interactive: Story = {
  render: () => <InteractiveSheet />,
};
