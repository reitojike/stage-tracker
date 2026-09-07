import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { RequirementIndicator } from './RequirementIndicator';

const meta: Meta<typeof RequirementIndicator> = {
  title: 'Shared/RequirementIndicator',
  component: RequirementIndicator,
};

export default meta;
type Story = StoryObj<typeof RequirementIndicator>;

export const Required: Story = {
  args: { required: true },
};

export const Optional: Story = {
  args: { required: false },
};
