import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Badge } from './Badge';

const meta: Meta<typeof Badge> = {
  title: 'Shared/Badge',
  component: Badge,
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Neutral: Story = {
  args: { variant: 'neutral', children: '下書き' },
};

export const Success: Story = {
  args: { variant: 'success', children: '確定' },
};

export const Warning: Story = {
  args: { variant: 'warning', children: '要確認' },
};

export const Danger: Story = {
  args: { variant: 'danger', children: '中止' },
};

export const Info: Story = {
  args: { variant: 'info', children: 'お知らせ' },
};
