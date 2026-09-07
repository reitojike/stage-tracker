import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Button } from './ui/button';
import { StatePanel } from './state-panel';

/**
 * `StatePanel` is the cross-screen primitive for "there is nothing (useful)
 * to render". docs/v2/oracle-routes-ui.md §2 documents each screen's usage;
 * a few representative ones are reproduced here as stories.
 */
const meta: Meta<typeof StatePanel> = {
  title: 'Components/StatePanel',
  component: StatePanel,
  parameters: {
    docs: {
      description: {
        component:
          'empty / error / unavailable の3 variant。RLS 等の silent failure を空状態 UI へ誤変換しないための全画面共通原則（decisions.md 「引き継ぐと決めた不変原則」）。3 状態は同一構造(title→description→action)を共有し、色/icon では区別しない。',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof StatePanel>;

/** ホーム（`/`）: 「申し込み期限」「直近の予定」が両方 0 件の統合空表示。 */
export const Empty: Story = {
  args: {
    variant: 'empty',
    title: '期限が近い申し込みも、直近の予定もありません',
  },
};

/** カレンダー（`/calendar`）: 選択日 0 件 + primary の追加導線。 */
export const EmptyWithAction: Story = {
  args: {
    variant: 'empty',
    title: 'この日の予定はまだありません',
    action: <Button variant="default">+ 予定を追加</Button>,
  },
};

/** ホーム全体 / カレンダー全体の読込失敗。role="alert" が付く唯一の variant。 */
export const Error: Story = {
  args: {
    variant: 'error',
    title: 'ホームを読み込めませんでした',
    description: '時間をおいて再度お試しください。',
  },
};

/** `/catalog` の読込失敗パターン: 再読み込み導線つき。 */
export const ErrorWithRetry: Story = {
  args: {
    variant: 'error',
    title: 'イベントを読み込めませんでした',
    action: <Button variant="outline">再読み込み</Button>,
  },
};

/**
 * 権限が無い/参照できない場合。`/catalog/events/new` の非 designated-creator、
 * `/catalog/events/[id]/edit` の非 owner など。
 */
export const Unavailable: Story = {
  args: {
    variant: 'unavailable',
    title: 'このページを表示する権限がありません',
  },
};

/** ホームの認証失敗ケース。 */
export const UnavailableUnauthenticated: Story = {
  args: {
    variant: 'unavailable',
    title: 'ログインが必要です',
  },
};

/**
 * 3 variant を並べた比較表示。色/icon が同一で、文言と `role` だけが違うことを
 * 目視 + a11y addon の両方で確認できる。
 */
export const AllVariantsSideBySide: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <StatePanel variant="empty" title="empty: 0件です" />
      <StatePanel variant="error" title="error: 読み込みに失敗しました" />
      <StatePanel variant="unavailable" title="unavailable: 参照できません" />
    </div>
  ),
};
