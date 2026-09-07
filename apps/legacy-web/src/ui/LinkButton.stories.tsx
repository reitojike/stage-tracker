import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { LinkButton } from './LinkButton';

const meta: Meta<typeof LinkButton> = {
  title: 'Shared/LinkButton',
  component: LinkButton,
};

export default meta;
type Story = StoryObj<typeof LinkButton>;

export const Primary: Story = {
  args: { href: '#', variant: 'primary', children: '+ 追加' },
};

export const Secondary: Story = {
  args: { href: '#', variant: 'secondary', children: '招待一覧' },
};

export const Small: Story = {
  args: { href: '#', variant: 'small', children: '解除' },
};

export const Quiet: Story = {
  args: { href: '#', variant: 'quiet', children: 'キャンセル' },
};

export const Icon: Story = {
  args: { href: '#', variant: 'icon', 'aria-label': '次の月', children: '›' },
};
