/**
 * `docs/v2/oracle-routes-ui.md` §1: `/mypage` の `loading` は Server
 * Component で十分（URL 依存の見出し再構築は不要）。
 */
export default function MyPageLoading() {
  return (
    <p role="status" className="text-body-sm text-muted-foreground">
      読み込み中…
    </p>
  );
}
