import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { LoadingIndicator } from './LoadingIndicator';

const meta: Meta<typeof LoadingIndicator> = {
  title: 'Shared/LoadingIndicator',
  component: LoadingIndicator,
};

export default meta;
type Story = StoryObj<typeof LoadingIndicator>;

export const Default: Story = {};

export const CustomLabel: Story = {
  args: { label: 'イベントを読み込んでいます' },
};
