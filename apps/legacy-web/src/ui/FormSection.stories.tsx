import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { TextInput } from './TextInput';
import { FormSection } from './FormSection';

const meta: Meta<typeof FormSection> = {
  title: 'Shared/FormSection',
  component: FormSection,
};

export default meta;
type Story = StoryObj<typeof FormSection>;

export const SectionDefault: Story = {
  args: {
    heading: 'イベント情報',
    children: <TextInput label="タイトル" required />,
  },
};

export const FieldsetGrouping: Story = {
  name: 'Fieldset grouping (unboxed)',
  args: {
    as: 'fieldset',
    heading: '公演回を追加',
    children: <TextInput label="開演日時" type="datetime-local" required />,
  },
};

export const FieldsetWithOptionalRequirement: Story = {
  name: 'Fieldset group whose presence is itself optional',
  args: {
    as: 'fieldset',
    heading: '初回公演回',
    requirement: 'optional',
    children: <TextInput label="開演日時" type="datetime-local" />,
  },
};

export const WithDescription: Story = {
  args: {
    heading: '開催期間',
    description:
      '開催期間と公演回の日時を両方とも新しい期間へ移す場合は、まず開催期間を広げてから公演回の日時を編集してください。',
    children: <TextInput label="開催期間（開始日）" type="date" required />,
  },
};
