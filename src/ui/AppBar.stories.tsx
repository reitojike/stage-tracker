import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { AppBar } from './AppBar';

const meta: Meta<typeof AppBar> = {
  title: 'Shared/AppBar',
  component: AppBar,
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof AppBar>;

/**
 * Default shell state: neither affordance has a destination wired
 * (`/notifications` still doesn't exist - #148's remaining Notifications
 * lane), so both render inert.
 */
export const Default: Story = {};

export const WithUnreadNotification: Story = {
  args: {
    hasUnreadNotifications: true,
  },
};

/**
 * My Page avatar wired to its real destination (Issue #159). The bell stays
 * inert - Notifications is still #148's unresolved lane.
 */
export const WithWiredActions: Story = {
  args: {
    hasUnreadNotifications: true,
    myPageInitial: 'S',
    myPageHref: '/mypage',
  },
};

/** `/sign-in`: no session exists yet, so the authenticated-only affordances stay hidden. */
export const WithoutActions: Story = {
  args: {
    showActions: false,
  },
};
