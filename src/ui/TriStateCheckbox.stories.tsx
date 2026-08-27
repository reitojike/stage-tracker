import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { TriStateCheckbox, type TriState } from './TriStateCheckbox';
import { deriveTriState } from './triState';

const meta: Meta<typeof TriStateCheckbox> = {
  title: 'Shared/TriStateCheckbox',
  component: TriStateCheckbox,
};

export default meta;
type Story = StoryObj<typeof TriStateCheckbox>;

export const Unchecked: Story = {
  args: { state: 'unchecked', label: '宝塚', onChange: () => {} },
};

export const Checked: Story = {
  args: { state: 'checked', label: '宝塚', onChange: () => {} },
};

export const Indeterminate: Story = {
  args: { state: 'indeterminate', label: '宝塚', onChange: () => {} },
};

export const Disabled: Story = {
  args: { state: 'unchecked', label: '宝塚', disabled: true, onChange: () => {} },
};

export const ParentChild: Story = {
  name: 'Parent recomputed from children',
  render: () => {
    function ParentChildDemo() {
      const [children, setChildren] = useState<TriState[]>(['checked', 'unchecked']);
      const parentState: TriState = deriveTriState(children);

      return (
        <div>
          <TriStateCheckbox
            state={parentState}
            label="宝塚"
            onChange={(next) => {
              setChildren(children.map(() => next));
            }}
          />
          <div style={{ marginInlineStart: 24 }}>
            {(['花組', '月組'] as const).map((childLabel, index) => (
              <TriStateCheckbox
                key={childLabel}
                state={children[index] ?? 'unchecked'}
                label={childLabel}
                onChange={(next) => {
                  setChildren(children.map((value, i) => (i === index ? next : value)));
                }}
              />
            ))}
          </div>
        </div>
      );
    }

    return <ParentChildDemo />;
  },
};
