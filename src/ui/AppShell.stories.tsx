import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { AppShell } from './AppShell';
import { LinkButton } from './LinkButton';
import { PageHeading } from './PageHeading';
import { ActionRow } from './ActionRow';
import { Surface } from './Surface';

const meta: Meta<typeof AppShell> = {
  title: 'Shared/AppShell',
  component: AppShell,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof AppShell>;

export const WithPrimaryNav: Story = {
  args: {
    children: (
      <>
        <PageHeading>Event Catalog</PageHeading>
        <ActionRow>
          <LinkButton href="#">+ イベントを登録</LinkButton>
          <LinkButton href="#" variant="secondary">
            招待一覧を見る
          </LinkButton>
        </ActionRow>
        <Surface variant="subtle">スクリーンの内容がここに入ります。</Surface>
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
        <Surface variant="subtle">
          サインイン前の画面では、認証境界の向こう側にある主要ナビゲーションを出しません。
        </Surface>
      </>
    ),
  },
};
