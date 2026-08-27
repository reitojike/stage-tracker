import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PrimaryNav } from './PrimaryNav';

const meta: Meta<typeof PrimaryNav> = {
  title: 'Shared/PrimaryNav',
  component: PrimaryNav,
  parameters: {
    layout: 'fullscreen',
    nextjs: {
      appDirectory: true,
      navigation: { pathname: '/catalog' },
    },
  },
};

export default meta;
type Story = StoryObj<typeof PrimaryNav>;

/**
 * `aria-current` / the current-item styling follow the router's pathname,
 * so the catalog entry is the current one under Storybook's default route.
 */
export const Default: Story = {};

export const OnMyCalendar: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: '/calendar' },
    },
  },
};

export const OnTickets: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: '/tickets' },
    },
  },
};
