import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Button } from './Button';
import { StatePanel } from './StatePanel';

const meta: Meta<typeof StatePanel> = {
  title: 'Shared/StatePanel',
  component: StatePanel,
};

export default meta;
type Story = StoryObj<typeof StatePanel>;

/** Issue #187 representative state: empty, no action (raw empty - e.g. 絞り込みなしで0件). */
export const Empty: Story = {
  args: {
    variant: 'empty',
    title: 'この月に登録されているイベントはありません',
  },
};

/** Issue #187 representative state: empty, with action (絞り込み中で0件 - action clears the filter). */
export const EmptyWithAction: Story = {
  name: 'Empty (with action)',
  args: {
    variant: 'empty',
    title: '条件に合うイベントがありません',
    action: <Button variant="secondary">条件を解除する</Button>,
  },
};

/**
 * Issue #187 representative state: read error, with retry action. Same
 * structural composition as Empty/EmptyWithAction - only the copy and the
 * `role="alert"` differ. No red / warning icon.
 */
export const ErrorState: Story = {
  name: 'Error (retry)',
  args: {
    variant: 'error',
    title: '読み込めませんでした',
    description: '通信状況を確認して、もう一度お試しください',
    action: <Button variant="secondary">再読み込み</Button>,
  },
};

export const Unavailable: Story = {
  args: {
    variant: 'unavailable',
    title: 'この機能は準備中です',
    description: '近日公開予定です。',
  },
};
