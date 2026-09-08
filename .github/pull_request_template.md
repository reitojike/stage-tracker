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
**この PR は migration と application runtime code を同時に含めてはいけません**
（PO 判断 D1 = D、docs/v2/decisions.md）。`Verify / Artifact Sequencing Fence`
が機械的に拒否します。

  PR A  expand migration のみ（current production app と後方互換）
  PR B  その schema を使う app code のみ
  PR C  contract migration のみ（新 app が十分稼働した後）

Issue #121/#124/#125 の事故は、同居していたために「migration がまだ
Production に無いのに新 schema 必須の app が先に deploy される」状態を
作れてしまったのが原因でした。その状態自体を作れなくします。

**「この migration は後方互換な expand か」は checker が判断しません。**
reviewer が判断してください。
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
