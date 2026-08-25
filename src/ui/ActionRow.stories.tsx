import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ActionRow } from './ActionRow';
import { LinkButton } from './LinkButton';

const meta: Meta<typeof ActionRow> = {
  title: 'Shared/ActionRow',
  component: ActionRow,
};

export default meta;
type Story = StoryObj<typeof ActionRow>;

export const Default: Story = {
  args: {
    children: (
      <>
        <LinkButton href="#">+ 追加</LinkButton>
        <LinkButton href="#" variant="secondary">
          個人予定を管理
        </LinkButton>
      </>
    ),
  },
};
