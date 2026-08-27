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
 * Default shell state: press handlers unset (Issue #141 boundary - no
 * `/notifications` or `/mypage` route exists yet), so both affordances
 * render inert.
 */
export const Default: Story = {};

export const WithUnreadNotification: Story = {
  args: {
    hasUnreadNotifications: true,
  },
};

/**
 * Once a caller has a real destination and identity to hand it (post-#148),
 * the same component accepts them without any markup change.
 */
export const WithWiredActions: Story = {
  args: {
    hasUnreadNotifications: true,
    myPageInitial: 'S',
    onNotificationsPress: () => {},
    onMyPagePress: () => {},
  },
};

/** `/sign-in`: no session exists yet, so the authenticated-only affordances stay hidden. */
export const WithoutActions: Story = {
  args: {
    showActions: false,
  },
};
