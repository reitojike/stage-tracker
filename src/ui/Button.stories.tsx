import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Button } from './Button';

const meta: Meta<typeof Button> = {
  title: 'Shared/Button',
  component: Button,
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: { variant: 'primary', children: '登録する' },
};

export const Secondary: Story = {
  args: { variant: 'secondary', children: 'キャンセル' },
};

export const Disabled: Story = {
  args: { variant: 'primary', children: '登録する', disabled: true },
};
