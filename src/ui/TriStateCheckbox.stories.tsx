import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { TriStateCheckbox, type TriState } from './TriStateCheckbox';
import { deriveTriState } from '../domain/triState';

const meta: Meta<typeof TriStateCheckbox> = {
  title: 'Shared/TriStateCheckbox',
  component: TriStateCheckbox,
};

export default meta;
type Story = StoryObj<typeof TriStateCheckbox>;

export const Unchecked: Story = {
  args: { state: 'unchecked', label: 'カテゴリA', onChange: () => {} },
};

export const Checked: Story = {
  args: { state: 'checked', label: 'カテゴリA', onChange: () => {} },
};

export const Indeterminate: Story = {
  args: { state: 'indeterminate', label: 'カテゴリA', onChange: () => {} },
};

export const Disabled: Story = {
  args: { state: 'unchecked', label: 'カテゴリA', disabled: true, onChange: () => {} },
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
            label="カテゴリA"
            onChange={(next) => {
              setChildren(children.map(() => next));
            }}
          />
          <div style={{ marginInlineStart: 24 }}>
            {(['サブカテゴリ1', 'サブカテゴリ2'] as const).map((childLabel, index) => (
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
