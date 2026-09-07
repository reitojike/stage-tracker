import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Badge } from './badge';

/**
 * 5-variant shape-based Badge (docs/v2/oracle-routes-ui.md §3). Variants are
 * not distinguished by color alone - see each story's usage note.
 */
const meta: Meta<typeof Badge> = {
  title: 'UI/Badge',
  component: Badge,
};

export default meta;
type Story = StoryObj<typeof Badge>;

/** 分類（組 / 一般発売 等）。トーンを持たないニュートラルなラベル。 */
export const Outline: Story = {
  args: { variant: 'outline', children: '花組' },
};

/** 進行中・未完了の意思（例: `/tickets` の「申し込む予定」）。 */
export const Subtle: Story = {
  args: { variant: 'subtle', children: '申し込む予定' },
};

/**
 * ユーザーが完了させた行動（例: `/tickets` の「申し込み済み」）。
 * トーンだけでなく、component が自ら描くチェックマークで `subtle` と区別する。
 */
export const Done: Story = {
  args: { variant: 'done', children: '申し込み済み' },
};

/** まだ間に合う期限。 */
export const Deadline: Story = {
  args: { variant: 'deadline', children: '本日23:59締切' },
};

/** 終了・行動不可（例: 中止、受付終了）。 */
export const Terminal: Story = {
  args: { variant: 'terminal', children: '受付終了' },
};

/**
 * `/tickets` のバッジ優先順位（oracle §2）: ①中止 ②受付終了 ③申し込み済み
 * ④申し込む予定 ⑤バッジなし、のうち1つだけを表示する実例。
 */
export const TicketPriorityExample: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-2">
      <Badge variant="terminal">中止</Badge>
      <Badge variant="terminal">受付終了</Badge>
      <Badge variant="done">申し込み済み</Badge>
      <Badge variant="subtle">申し込む予定</Badge>
    </div>
  ),
};

export const AllVariantsSideBySide: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline">outline</Badge>
      <Badge variant="subtle">subtle</Badge>
      <Badge variant="done">done</Badge>
      <Badge variant="deadline">deadline</Badge>
      <Badge variant="terminal">terminal</Badge>
    </div>
  ),
};
