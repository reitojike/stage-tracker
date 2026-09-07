import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { StatePanel } from "./state-panel";
import { AppShell } from "./app-shell";

const meta: Meta<typeof AppShell> = {
  title: "Components/AppShell",
  component: AppShell,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/" } },
  },
  args: {
    myPageHref: "/mypage",
    myPageInitial: "S",
  },
};

export default meta;
type Story = StoryObj<typeof AppShell>;

/** 通常の認証済み画面: AppBar + bounded content column + PrimaryNav。 */
export const Default: Story = {
  args: {
    children: (
      <>
        <h1 className="text-heading font-semibold">ホーム</h1>
        <p className="text-body-sm text-muted-foreground">
          コンテンツ領域はここに描画される。
        </p>
      </>
    ),
  },
};

/** `/` ホームの空状態を content column に載せた例。 */
export const WithEmptyStatePanel: Story = {
  args: {
    children: (
      <StatePanel
        variant="empty"
        title="期限が近い申し込みも、直近の予定もありません"
      />
    ),
  },
};

/**
 * 未認証面: PrimaryNav / AppBar actions の両方を隠す。
 * (`/sign-in` 等、oracle §3 AppShell `showPrimaryNav`)
 */
export const UnauthenticatedSurface: Story = {
  args: {
    showPrimaryNav: false,
    showActions: false,
    children: <StatePanel variant="unavailable" title="ログインが必要です" />,
  },
};
