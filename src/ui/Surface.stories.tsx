import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Surface } from './Surface';

const meta: Meta<typeof Surface> = {
  title: 'Shared/Surface',
  component: Surface,
};

export default meta;
type Story = StoryObj<typeof Surface>;

export const Default: Story = {
  args: { variant: 'default', children: 'Surface content' },
};

export const Subtle: Story = {
  args: { variant: 'subtle', children: 'Surface content' },
};
