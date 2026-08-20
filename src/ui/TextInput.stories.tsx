import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { TextInput } from './TextInput';

const meta: Meta<typeof TextInput> = {
  title: 'Shared/TextInput',
  component: TextInput,
};

export default meta;
type Story = StoryObj<typeof TextInput>;

export const Default: Story = {
  args: { label: 'イベント名', placeholder: '例: 春公演' },
};

export const WithHelperText: Story = {
  args: { label: 'イベント名', helperText: 'catalog上に表示される名称です' },
};

export const WithError: Story = {
  args: { label: 'イベント名', error: 'イベント名を入力してください' },
};

export const Disabled: Story = {
  args: { label: 'イベント名', disabled: true, value: '春公演' },
};
