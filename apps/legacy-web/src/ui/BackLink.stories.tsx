import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { BackLink } from './BackLink';

const meta: Meta<typeof BackLink> = {
  title: 'Shared/BackLink',
  component: BackLink,
};

export default meta;
type Story = StoryObj<typeof BackLink>;

export const Default: Story = {
  args: { href: '#', children: 'カレンダーに戻る' },
};
