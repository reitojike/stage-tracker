import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PrimaryNav } from "./primary-nav";

/**
 * `PrimaryNav` reads `usePathname()` itself (no props). Stories use
 * `@storybook/nextjs-vite`'s App Router mock
 * (`parameters.nextjs.navigation.pathname`) to control which item is
 * highlighted.
 */
const meta: Meta<typeof PrimaryNav> = {
  title: "Components/PrimaryNav",
  component: PrimaryNav,
  parameters: {
    nextjs: { appDirectory: true },
  },
};

export default meta;
type Story = StoryObj<typeof PrimaryNav>;

export const HomeActive: Story = {
  parameters: { nextjs: { navigation: { pathname: "/" } } },
};

export const EventsActive: Story = {
  parameters: { nextjs: { navigation: { pathname: "/catalog" } } },
};

export const TicketsActive: Story = {
  parameters: { nextjs: { navigation: { pathname: "/tickets" } } },
};

export const CalendarActive: Story = {
  parameters: { nextjs: { navigation: { pathname: "/calendar" } } },
};

/** ネストしたルート（例: Event 詳細）でも「イベント」がハイライトされる。 */
export const NestedRouteStillHighlightsEvents: Story = {
  parameters: {
    nextjs: { navigation: { pathname: "/catalog/events/123" } },
  },
};
