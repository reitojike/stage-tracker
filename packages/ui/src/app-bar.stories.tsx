import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { AppBar } from './app-bar';

const meta: Meta<typeof AppBar> = {
  title: 'Components/AppBar',
  component: AppBar,
  args: {
    myPageHref: '/mypage',
    myPageInitial: 'S',
  },
};

export default meta;
type Story = StoryObj<typeof AppBar>;

export const Default: Story = {};

/** Authenticated AppBar: the bell is always a link to the inbox. */
export const NotificationBell: Story = {};

export const WithUnreadNotifications: Story = {
  args: {
    hasUnreadNotifications: true,
  },
};

/** `/sign-in` 等の未認証面: 両 affordance を非表示にする。 */
export const UnauthenticatedSurface: Story = {
  args: {
    showActions: false,
  },
};
