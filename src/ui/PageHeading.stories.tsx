import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PageHeading } from './PageHeading';

const meta: Meta<typeof PageHeading> = {
  title: 'Shared/PageHeading',
  component: PageHeading,
};

export default meta;
type Story = StoryObj<typeof PageHeading>;

export const Default: Story = {
  args: { children: 'Event Catalog' },
};
