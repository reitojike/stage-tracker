import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Badge } from './Badge';

const meta: Meta<typeof Badge> = {
  title: 'Shared/Badge',
  component: Badge,
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Outline: Story = {
  args: { variant: 'outline', children: '月組' },
};

export const Subtle: Story = {
  args: { variant: 'subtle', children: '申込中' },
};

export const Deadline: Story = {
  args: { variant: 'deadline', children: '残り1日' },
};

export const Terminal: Story = {
  args: { variant: 'terminal', children: '落選' },
};
