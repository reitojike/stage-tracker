import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Bell } from 'lucide-react';
import { Button } from './button';

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  args: {
    children: 'ボタン',
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {};

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap gap-2">
      <Button {...args} variant="default">
        default
      </Button>
      <Button {...args} variant="secondary">
        secondary
      </Button>
      <Button {...args} variant="outline">
        outline
      </Button>
      <Button {...args} variant="ghost">
        ghost
      </Button>
      <Button {...args} variant="destructive">
        destructive
      </Button>
      <Button {...args} variant="link">
        link
      </Button>
    </div>
  ),
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};

/**
 * decisions.md A1: v2 replaces legacy's single 6-value `variant` enum
 * (which mixed meaning and size) with shadcn's 2 independent axes. This
 * story renders every legacy variant using its (variant, size) mapping -
 * see the comment above `buttonVariants` in button.tsx for the full table.
 */
export const LegacyVariantMapping: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="default">primary</Button>
      <Button variant="outline">secondary</Button>
      <Button variant="outline" size="sm">
        small
      </Button>
      <Button variant="ghost">quiet</Button>
      <Button variant="ghost" size="icon" aria-label="icon">
        <Bell />
      </Button>
      <Button variant="destructive">danger</Button>
    </div>
  ),
};

/** `size` の全ステップ（`variant="outline"` 固定で比較）。 */
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" size="xs">
        xs
      </Button>
      <Button variant="outline" size="sm">
        sm
      </Button>
      <Button variant="outline" size="default">
        default
      </Button>
      <Button variant="outline" size="lg">
        lg
      </Button>
      <Button variant="outline" size="icon" aria-label="icon">
        <Bell />
      </Button>
    </div>
  ),
};
