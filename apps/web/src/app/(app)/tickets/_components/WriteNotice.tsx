/**
 * `docs/v2/oracle-routes-ui.md` §3 の `WriteNotice`
 * （「書き込み完了フィードバック用の安定した `aria-live="polite"`
 * live region」）に相当する最小実装。`schedule/_components/WriteNotice.tsx`
 * と全く同じ実装（`packages/ui` にまだこの primitive が無いための
 * feature-local な複製 - 同ファイルの doc comment を参照）。`attempt` を
 * React key として使うのは同じ文言でも再アナウンスさせるための技法。
 */
interface WriteNoticeProps {
  readonly notice: string | null;
  readonly attempt: number;
}

export function WriteNotice({ notice, attempt }: WriteNoticeProps) {
  return (
    <div aria-live="polite" className="text-body-sm text-muted-foreground">
      {notice ? <p key={attempt}>{notice}</p> : null}
    </div>
  );
}
