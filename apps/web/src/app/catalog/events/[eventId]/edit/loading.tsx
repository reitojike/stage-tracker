/**
 * `docs/v2/oracle-routes-ui.md` §5: legacy の `loading.tsx` は
 * `params`/`searchParams` を受け取れない制約への対処として Client
 * Component 化していたが、この画面には URL 由来の戻り先/見出し再構築が
 * 無い（見出し「イベントを編集」は owner 判定前でも固定文言）ため、
 * その対処は不要 —— 「データ依存の見出しを先取り表示しない」という
 * 原則自体は、そもそも先取りすべきデータ依存見出しが無いことで満たす。
 */
export default function EditEventLoading() {
  return (
    <p role="status" className="text-body-sm text-muted-foreground">
      読み込み中…
    </p>
  );
}
