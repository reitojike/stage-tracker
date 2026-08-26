import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { TextArea } from './TextArea';

const meta: Meta<typeof TextArea> = {
  title: 'Shared/TextArea',
  component: TextArea,
};

export default meta;
type Story = StoryObj<typeof TextArea>;

export const Default: Story = {
  args: { label: 'メモ', placeholder: '例: 座席は当日引換' },
};

export const WithHelperText: Story = {
  args: { label: 'メモ', helperText: '未入力のままにできます。' },
};

export const RequiredField: Story = {
  args: { label: '件名', required: true },
};

export const OptionalField: Story = {
  args: { label: 'メモ' },
};

export const WithError: Story = {
  args: { label: 'メモ', error: 'メモが長すぎます' },
};

export const Disabled: Story = {
  args: { label: 'メモ', disabled: true, value: '座席は当日引換' },
};
