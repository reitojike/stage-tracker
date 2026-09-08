<!--
このPRが supabase/migrations/ 配下に新規fileを追加しない場合は、
「Migration ordering」セクションごと削除してください。追加する場合は
このセクションを残し、下の2行のうちどちらか一方だけを残してください
（他方は削除）。`Verify / Migration Ordering Fence`
（scripts/check-migration-ordering-fence.mjs）がこのPR本文のmarkerを
literalに読み取ります。2行とも残っている場合はambiguousとしてfailします。
判断基準は docs/architecture/runtime-stack.md「デプロイ・実行経路」を
参照してください（Issue #131）。
-->

## Migration ordering

<!--
**この PR は migration と、deploy に届く artifact を同時に含めてはいけません**
（PO 判断 D1 = D、docs/v2/decisions.md）。`Verify / Artifact Sequencing Fence`
が機械的に拒否します。

migration を含む PR で同居してよいのは次だけです。それ以外は既定で拒否されます
（root の package.json / lockfile / build config も含む）。

  supabase/**                          migration 本体、pgTAP、seed、config
  docs/**                              文書
  apps/legacy-web/test/rls/**          DB/RLS integration test
  生成された database.types.ts 2 file  exact path のみ

Issue #121/#124/#125 の事故は、同居していたために「migration がまだ
Production に無いのに新 schema 必須の app が先に deploy される」状態を
作れてしまったのが原因でした。その状態自体を作れなくします。

**checker が判断しないこと** —— どちらも reviewer が判断してください。

  - この migration は後方互換な expand か
  - **どちらの PR を先に land させるか**

順序は変更の種類で逆になります。column を足す変更は migration が先ですが、
**DB が出す値を変える変更（error code 等）は runtime が先**です。
`raise ... using errcode` は 1 つの値しか持てず、「新旧どちらの code も出す」
という DB 側だけの expand が原理的にできないため、読む側を先に広げるしか
ありません（PR #389 / #392 で実際に間違えました）。
-->

<!-- どちらか一方だけを残し、他方は削除してください。 -->

Migration ordering: post-deploy-safe
Migration ordering: schema-first-required

<!--
"schema-first-required" の場合: このPRをmergeする前に、operatorが
Productionへ該当migrationを適用してください（docs/runbooks/
gate-a-remote-environment.md「Schema migration to the hosted project」）。
`pnpm run supabase:migrations:drift -- --linked` で確認した上で、
下の行を実際の内容に書き換えてから残してください（このコメント内の
例示テキストのままでは evidence として扱われません）。

Production migration applied: <supabase db push --linked を実行した
日時、drift check結果等の具体的なevidence>

Production credential・project ref等のsecretはここに貼り付けないで
ください（docs/runbooks/gate-a-remote-environment.md「Secret boundary」
参照）。
-->
