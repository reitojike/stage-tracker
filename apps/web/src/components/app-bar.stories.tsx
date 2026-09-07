import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { AppBar } from "./app-bar";

const meta: Meta<typeof AppBar> = {
  title: "Components/AppBar",
  component: AppBar,
  args: {
    myPageHref: "/mypage",
    myPageInitial: "S",
  },
};

export default meta;
type Story = StoryObj<typeof AppBar>;

export const Default: Story = {};

/**
 * お知らせ機能は未実装 (decisions.md P1) - ベルは配線されるまで
 * `aria-disabled` の非活性ボタンとして UI に残す。
 */
export const NotificationBellDisabled: Story = {};

/** 実装後の姿（将来像）: ハンドラを渡すと通常のボタンとして操作できる。 */
export const NotificationBellEnabled: Story = {
  args: {
    onNotificationsPress: fn(),
  },
};

export const WithUnreadNotifications: Story = {
  args: {
    hasUnreadNotifications: true,
    onNotificationsPress: fn(),
  },
};

/** `/sign-in` 等の未認証面: 両 affordance を非表示にする。 */
export const UnauthenticatedSurface: Story = {
  args: {
    showActions: false,
  },
};
