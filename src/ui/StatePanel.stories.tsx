import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { StatePanel } from './StatePanel';

const meta: Meta<typeof StatePanel> = {
  title: 'Shared/StatePanel',
  component: StatePanel,
};

export default meta;
type Story = StoryObj<typeof StatePanel>;

export const Empty: Story = {
  args: {
    variant: 'empty',
    title: '表示できるeventがありません',
    description: '条件に一致するeventはまだ登録されていません。',
  },
};

export const ErrorState: Story = {
  name: 'Error',
  args: {
    variant: 'error',
    title: '読み込みに失敗しました',
    description: '時間をおいて再度お試しください。',
  },
};

export const Unavailable: Story = {
  args: {
    variant: 'unavailable',
    title: 'この機能は準備中です',
    description: '近日公開予定です。',
  },
};
