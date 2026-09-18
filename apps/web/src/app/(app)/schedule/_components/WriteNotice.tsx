/**
 * `docs/v2/oracle-routes-ui.md` §3 の `WriteNotice`
 * （「書き込み完了フィードバック用の安定した `aria-live=\"polite\"`
 * live region」）に相当する最小実装。`attempt` を React key として使うのは
 * 同じ文言でも再アナウンスさせるための技法 - oracle のコメントをそのまま
 * 踏襲する。この notice は schedule の成功表示と再アナウンスの挙動を
 * 所有する feature-local component として残し、form control primitive とは
 * 責務を分ける。
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
