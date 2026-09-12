<!--
このPRが supabase/migrations/ 配下に新規fileを追加しない場合は、
「Migration ordering」セクションごと削除してください。追加する場合は
このセクションを残し、下の2行のうちどちらか一方だけを残してください
（他方は削除）。`Verify / Migration Ordering Fence`
（scripts/check-migration-ordering-fence.mjs）がこのPR本文のmarkerを
literalに読み取ります。2行とも残っている場合はambiguousとしてfailします。
判断基準は docs/architecture/runtime-stack.md「デプロイ・実行経路」と
docs/v2/decisions.md「A8 追補」を参照してください（Issue #131 / #393）。
-->

## Migration ordering

<!--
**この PR は migration と、deploy に届く artifact を同時に含めてはいけません**
（PO 判断 D1 = D、docs/v2/decisions.md）。`Verify / Artifact Sequencing Fence`
が機械的に拒否します。

migration を含む PR で同居してよいのは次だけです。それ以外は既定で拒否されます
（root の package.json / lockfile / build config も含む）。

  supabase/migrations/**               migration 本体
  supabase/tests/**                    pgTAP
  docs/**                              文書
  test/rls/**                          DB/RLS integration test
  apps/web/src/lib/data/database.types.ts  生成された exact path

supabase/ を丸ごと許可はしません。supabase/functions/** は
`supabase functions deploy` で実際に deploy されるため、また
config.toml / seed.sql も実需が出るまで許可しないためです。

Issue #121/#124/#125 の事故（code → schema: PR のコードが新しい schema を
必要とする）は、artifact sequencing fence が**同一 PR 内**の同居を拒否
するため単一 PR の中ではもう起きません。ただし **PR をまたぐ merge 順序
までは保証しません**（docs/v2/decisions.md「D が保証しないこと（残存
リスク）」）。新しい build が直ちに参照する migration を別 PR に分離した
場合、migration PR が app code PR より先に merge・適用済みであることを、
app code PR の reviewer が確認してください。

下の marker が問うのは**逆方向**（schema → code: この migration が、既に
deploy されているコードを壊すか）です。

**checker が判断しないこと** —— reviewer が判断してください。

  - この migration は本当に additive か（既存 reader の挙動を一切変えないか）
  - runtime-first-required の場合、依存する runtime PR は実際に
    **Production へ deploy 済み**か（merge 済みだけでは不十分）

column を足すだけの変更は大抵 additive です。**DB が出す値を変える変更
（error code 等）は additive ではありません。** `raise ... using errcode`
は 1 つの値しか持てず、「新旧どちらの code も出す」という DB 側だけの
expand が原理的にできないため、読む側（runtime）を先に広げる必要が
あります（PR #389 は当時この判断を誤り、後から #392 を先に merge・deploy
して是正しました）。
-->

<!-- どちらか一方だけを残し、他方は削除してください。 -->

Migration ordering: additive
Migration ordering: runtime-first-required

<!--
"runtime-first-required" の場合: このPRをmergeする前に、その新しい値を
理解・許容できる runtime 変更を merge し、**その Vercel deployment が
実際に成功したことを確認してから**このPRをmergeしてください。merge した
だけでは deploy 完了を意味しません（Vercel の deploy は非同期で、merge
直後は build 中・待機中・失敗のいずれもあり得ます）。下の行を実際の内容に
書き換えてから残してください（このコメント内の例示テキストのままでは
evidence として扱われません）。

Runtime dependency deployed: <その runtime 変更を含む PR 番号と、
Vercel deployment が succeeded したことを示す具体的な evidence
（deployment URL、確認した日時等）>
-->
