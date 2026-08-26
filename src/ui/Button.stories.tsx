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

export const Small: Story = {
  args: { variant: 'small', children: '編集' },
};

export const Quiet: Story = {
  args: { variant: 'quiet', children: 'キャンセル' },
};

export const Icon: Story = {
  args: { variant: 'icon', children: '>', 'aria-label': '次の月' },
};

export const Danger: Story = {
  args: { variant: 'danger', children: 'このイベントを削除' },
};
