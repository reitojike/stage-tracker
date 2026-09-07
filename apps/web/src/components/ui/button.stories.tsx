import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "./button";

const meta: Meta<typeof Button> = {
  title: "UI/Button",
  component: Button,
  args: {
    children: "ボタン",
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
