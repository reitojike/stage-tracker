import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { AppShell } from './AppShell';
import { LinkButton } from './LinkButton';
import { PageHeading } from './PageHeading';

const meta: Meta<typeof AppShell> = {
  title: 'Shared/AppShell',
  component: AppShell,
  parameters: {
    layout: 'fullscreen',
    nextjs: {
      appDirectory: true,
      navigation: { pathname: '/catalog' },
    },
  },
};

export default meta;
type Story = StoryObj<typeof AppShell>;

export const WithPrimaryNav: Story = {
  args: {
    myPageHref: '/mypage',
    myPageInitial: 'S',
    children: (
      <>
        <PageHeading>イベント</PageHeading>
        <LinkButton href="#">+ 追加</LinkButton>
        <p>スクリーンの内容がここに入ります。</p>
      </>
    ),
  },
};

export const WithoutPrimaryNav: Story = {
  args: {
    showPrimaryNav: false,
    children: (
      <>
        <PageHeading>stage-tracker サインイン</PageHeading>
        <p>サインイン前の画面では、認証境界の向こう側にある主要ナビゲーションを出しません。</p>
      </>
    ),
  },
};
