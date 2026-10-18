# 共有相手登録の段階移行

追跡は [#825](https://github.com/reitojike/stage-tracker/issues/825)、
承認済み仕様案と分割は [登録の設計案](../design/schedule-contact-registration.md)。
P1a / P1b、P2 runtime、#834の共有再読取修正、P3のDB write切替は採用済み。
P3の採用完了は [#837の完了記録](https://github.com/reitojike/stage-tracker/pull/837#issuecomment-6233186580)
を参照する。新規共有は登録済み相手を選び、登録機能は有効化済みである。
P4の既存共有bindと全readの登録必須化は未採用。現行の製品動作は
[登録Spec 013](../../specs/013-schedule-contact-registration/spec.md) と
[共有Spec 012](../../specs/012-personal-schedule-sharing-privacy/spec.md) が所有する。
下記の P1 検証手順は当時の基盤検証の手順であり、現在の配備状況の代わりに扱わない。
追加の本番apply・main merge、実利用者への申請・共有変更は、その対象を明示した実行範囲で扱う。

## P1a のローカル検証（当時の基盤検証）

既存の `stage-tracker` local stack を reset しない。専用の一時ディレクトリへ
`supabase/` をコピーし、そのコピーの `project_id` と API/DB/shadow/Studio/mail の
port を未使用値へ変更する。repository の `config.toml` は変更しない。
linked-project の metadata や資格情報はコピーせず、`--linked` / remote URL は使わない。

CLI のインストール済み version と各 command の `--help` を確認してから、専用 root を
明示して起動する。以下の `CONTACT_TEST_ROOT` は専用コピーの親ディレクトリを指す。

```sh
supabase start --workdir "$CONTACT_TEST_ROOT" --exclude realtime,storage-api,imgproxy,studio,edge-runtime,logflare,vector,supavisor
supabase test db --local --workdir "$CONTACT_TEST_ROOT"
supabase gen types typescript --local --schema public --workdir "$CONTACT_TEST_ROOT"
```

生成型は成功時だけ `scripts/generate-supabase-types.mjs` と同じ行末空白正規化で保存する。
再生成との完全一致を確認する。default project の running DB から型を生成しない。
pgTAP の gate 置換・synthetic actor・既存共有の回帰 fixture は transaction 内だけで
実行して rollback する。終了後に capability=false、申請/関係/budget=0 を確認する。

検証対象:

- capability=false と caller からの有効化不可、全操作の無効時拒否、anon の拒否
- client の表/列権限・private helper の拒否、RLS 有効、送信側の pending 列挙不可
- unknown/duplicate/reverse の void acknowledgement と存在非依存の caller budget
- 本人の明示承認、拒否/取消、古い申請 ID の再送、自己申請、形式不正
- メール変更後の ID 維持、元入力での取消、旧メール再利用への関係移転なし
- account 削除後の申請/関係/budget cleanup と、相手 owner の予定本体の維持
- 登録で既存共有行が増減しないこと、旧 email RPC と既存 recipient read の回帰

これは full feature の AC 完了ではない。有効時の HTTP 応答時間・cache の検証は後続で追加する。

PR 前は [pre-pr-verification](pre-pr-verification.md) の floor と、DB/型の検証を実施。
migration PR は `Migration ordering: additive` とし、runtime と同居させない。

## P1b のローカル検証と停止境界（当時の記録）

P1b も上記の専用コピーで起動する。実際の public capability は false のまま、
`supabase test db --local` に一覧の本人境界、alias の隔離、generation/trigger 制約、
双方向解除、再登録、メール変更と account cleanup の pgTAP を追加する。

`test/rls/scheduleContactConcurrency.test.ts` は実 migration SQL を一意な専用 schema に
展開し、その schema 内の gate だけ true にする。user FK は同じ schema の代理表を使い、
並列 suite の auth.users と DDL lock を競合させない。前後で public gate=false を検証し、
専用 schema のみを削除する。client 操作は authenticated role と本物の auth.uid() で行う。
二接続の勝者 transaction を保持し、`pg_blocking_pids` で待機を確認してから commit する。
重複/逆向き申請、accept/cancel、unlink/share、unlink/alias、account 削除/share・accept の
両順序を検証する。これは本物の auth.users FK cleanup の逐次 pgTAP と組み合わせた証跡で、
Auth サービス全体の並行削除の完全な検証や、HTTP応答時間の証拠とは扱わない。

専用コピーを cwd にして repository の絶対 test path を Node に渡し、repository の
node_modules/.bin を process-local PATH に加えれば、共有 stack を触らず実行できる。
CI は通常の `test:rls` から自動発見するので runner/config の変更は不要。
`scheduleContactAccess.test.ts` は実 PostgREST で無効時の known/unknown 応答一致、
一覧/alias/新共有/解除の拒否、直接表アクセスの拒否を検証する。

P1b の提出境界は Draft PR・required CI・head に対応する Codex review。merge、本番適用、
有効化、実ユーザー操作は行わない。P1a 採用時の main e31c49d、DB/CI 合格と production
deployment READY の既確認証跡を維持する。Vercel runtime log API の 403 を P1b 開始条件に
せず、その解消のための資格情報設定や対象拡大もしない。

旧 email RPC はまだ存在するため、unlink と旧経路からの再共有を防ぐ保証は未完成。
この段階で gate を有効化せず、P3 の閉鎖を必須とする。

## 有効化の前提（P1b → P2 → P3の採用時条件）

以下の検証対象と採用記録を、#825の全ACの完了証拠として一括で扱わない。
存在非依存の受付・試行制限の試験と、直RPC / HTTPのケース別の応答形・時間差の反復測定は別の証拠である。
保存された測定証拠が確認できなければ該当ACは未達とし、固定待機だけを完全な対策とは扱わない。
実機PWA確認も報告された操作だけに限定し、未依頼の取消後権限テストまで実施済みとしない。

### P2c の試験準備と実機確認

P2c の E2E は実 DB の capability を読み、false では停止 UI と既存 share の解除・離脱を、
true では実申請・本人承認・選択共有・解除・再登録を検証する。RPC エラーを false と扱わない。
test が gate を変更する仕組みや本番向け fixture 経路は追加しない。
切替後の共有 read fixture は accepted 世代に bind するが、それを本人承認の証拠とは扱わない。
本物の legacy NULL 行の保持は、P3 migration 検証で切替前に作った行を使う。

P2c 単独の CI は false 段階を検証する。有効時の journey は P3 を適用した専用 local DB と、
P2c を取り込んだ P3 head の CI で検証する。P3 を main へ先に merge して準備することはない。
P3 が P2c の未採用 head に依存する間は Draft / HOLD とし、採用後に main との差分を DB / tests / docs
だけへ揃える。migration と E2E/runtime を同じ PR へ混ぜて artifact fence を回避しない。

実機で必要な相手・データ・gate=false での実行範囲と停止境界は
[共有予定の実機復帰確認](schedule-contact-device-acceptance.md) を参照する。
その手順の記載と実施済み証跡を区別する。#834 の実履歴「戻る」・低速読取・通信失敗の E2E と
既存の DB / lifecycle / privacy QA は引き継ぎ、同じ結果を得るためだけの再試験は行わない。

P2b の実 DB E2E は gate=false のまま、mobile/desktop の登録管理・共有追加の停止と、
legacy fixture の owner 個別解除・recipient 自己離脱を検証する。正の登録 UI 操作は
synthetic Action 応答と実 useAction の component tests で検証する。有効時の実ブラウザ
journey と cache/timing の証跡をこれで代替しない。P3 前にはその検証と無効時専用 E2E の
切替互換を runtime-only PR で準備する。E2E/runtime の更新を P3 migration PR に混在させない。

次がすべてそろうまで gate を false のまま維持する。client GUC、環境変数、管理画面で
切り替える抜け道を作らず、将来の明示的な migration によってのみ切り替える。

1. 本人宛受信一覧と承認済み一覧、本人だけの alias、関係解除が実装済み。
2. unlink と share-add が同一 pair lock を使い、両方向の share を atomic に解除できる。
3. 同時申請、accept/cancel、unlink/add、account 削除の競合を別 DB session で検証済み。
4. unknown/known/duplicate/reverse/declined の直 RPC と HTTP の返却形・公開ログ・時間差を
   反復検証済み。固定待機だけを完全な対策と扱わない。
5. P2 の対応 runtime が Production に配備済みである実証がある。merge 済みだけでは不足。
6. P3 が旧 email share 作成の全 RPC/overload/権限を閉じ、新共有操作が accepted 当事者と
   relation ID を DB で強制する。未承認 legacy share の既存可視性はまだ自動失効させない。

P3 は `runtime-first-required`。現在の migration 自動適用と Vercel 配備は独立なので、
[runtime-stack](../architecture/runtime-stack.md) の ordering evidence を必須にする。
P4 を P1a と同時に merge/apply できる形で先に積まない。

## P3 の限定された write 切替（採用済み）

P3 migration は `20261016154603_schedule_contact_write_cutover.sql`。
P2c #836の採用後、P3は #837で採用された。以下は当時の切替前確認とtransactionの契約である。
文書を読んだことを再実行や本番変更の承認として扱わない。
採用時には差分がDB / DB・RLS tests / docsだけであること、freshなCI / exact-head reviewと
runtime-first-requiredの実配備証拠を確認した。
P2c 採用後の read-only 確認では main `c13c024a1574e493893ef2e8c4b5c2974af2a53f` の
Production deployment が READY で、`stage-tracker.com` もその deployment を指していた。
P2c は test / runbook 変更だけで対応 app runtime はこの版に含まれる。採用直前にも再確認する。
Current Living Specの登録lifecycleとP3の切替段階は、runtimeと分けた文書artifactで同期する。
P4のread強制まで完了したと記載しない。

repository の共有 INSERT は旧 email RPC の履歴定義と新 contact RPC に限られる。
旧 runtime caller は `schedule-share-actions.ts` → `schedule-share-write.ts` に残るが、
現行 UI の import はなく、P3 後は DB の拒否 stub / ACL により実行できない。
mock を使う旧 helper unit test を、切替後の正の認可証明として扱わない。
旧 export / helper / signature の削除は、利用不在を確認して後続 cleanup に分離する。

採用直前は read-only catalog で同名全 schema / overload、関数 body と caller、
ACL と role membership、table / 全 column の実効 INSERT・UPDATE、validation trigger を再確認する。
2026-10-16 の本番 read-only inventory は旧 `public.share_schedule_entry_by_email(uuid,text)` 1 件、
authenticated EXECUTE 可 / anon 不可、client の table / column INSERT・UPDATE 不可、
両 client に追加の継承 role なしだった。writer / legacy caller の source scan は旧 RPC と新 contact RPC。
この観測を将来の drift なしの保証にしない。local default grant と本番 ACL の差も推測で補わない。

登録 gate・申請/承認/拒否/取消・一覧・呼び名・共有/解除とその private helper についても、
P1a/P1b の有限な 15 関数の正式 body と owner、言語、戻り型、引数名・全引数型・mode・既定値なし、
SECURITY DEFINER、search_path、
実行属性を同じ transaction で直接照合する。既知 validator と合わせて承認経路の差異を検出し、
EXECUTE grant が同じでも未知の承認処理を有効化しない。期待外定義の再宣言・補修はしない。

同一 transaction 内で、10 秒の lock_timeout と shares の SHARE ROW EXCLUSIVE lock を取得し、
旧 INSERT transaction を drain する。validator は P1b の正式な本体（CRLF/LF 差だけを正規化）、
postgres owner、PL/pgSQL / trigger 型、SECURITY DEFINER、空 search_path と既定実行属性、
client EXECUTE 不可を transaction 内で照合する。同じ OID の CREATE OR REPLACE も検出し、
想定外の定義を上書きして補修しない。期待外 overload、既存 accepted 検証 trigger / RPC の差異、
除去後の継承 write privilege が残れば例外で全体を rollback する。知らない継承 role を一括変更しない。
旧 signature は SECURITY INVOKER の 42501 stub とし PUBLIC / anon / authenticated EXECUTE を剥奪する。
新 INSERT は role / gate にかかわらず contact_id を必須にし、既存 trigger が当事者・現世代を検証する。
最後に gate=true を公開する。既存行の bind / UPDATE / DELETE、accepted 作成、read policy 変更はしない。

`scheduleContactCutover.test.ts` は実 SQL の専用 schema 再生で、故障 rollback、overload、
明示・継承 grant、無効な trigger、同 OID の弱化 body / SECURITY INVOKER / search_path / owner /
EXECUTE drift、INSERT 済み transaction の待機、INSERT 前の旧 RPC の再開を検証する。
承認 RPC の同 OID 弱化 body / SECURITY INVOKER / search_path / owner / 言語 / 実行属性と、
残る 14 関数の body 差異、同一本体の入力名・返却列名/型・default 差異も拒否する。
失敗後は全関数の定義・owner・ACL を含む snapshot、
gate、旧 RPC / ACL、既存行が不変であることを確認する。
`scheduleContactConcurrency.test.ts` は同じ切替を適用して既存の両順序 race を検証する。
切替前 legacy 行は guard 導入前にだけ fixture 作成し、管理 role の guard 除外は設けない。
local PostgREST / RLS での切替前後確認と、その後の有効時 UI journey も組み合わせる。

実機用 fixture が本番にない場合、gate=false の UI から新規作成して補わない。
端末 QA を準備する別承認では、次を範囲にする。

- 本番と別の QA app / Supabase を使い、端末から到達できる HTTPS origin と API、
  その origin だけの sign-in callback を設定する。PC の localhost を端末へそのまま渡さない。
- operator が synthetic A / B を事前 provision し、秘密鍵は server / test setup 内に限定する。
  public signup、実利用者の credential、外部通知、本番 share の作成は使わない。
- false 段階を確認する legacy fixture は切替前にだけ準備する。切替後は実申請・本人承認・
  明示共有で準備し、管理 role による NULL INSERT / guard 回避は使わない。
- 実機で home screen 追加・standalone 起動を確認し、端末手順の対象 share を明示してから実施する。
  環境準備・表示確認の承認と、対象 share の解除承認を混同しない。

この準備案は未実施であり、新しい deployment / network 公開や実機合格の証拠ではない。

適用失敗 / lock timeout は transaction rollback。適用後の緊急停止は、対応 runtime を保った
前進 migration で gate=false とする。新 INSERT guard と旧 email RPC 閉鎖は維持する。
false は既存 read の停止ではないため、read 漏えいには別途限定した修正・封じ込めを判断する。
旧 email 経路再開・accepted 自動生成・解除済み共有復元を rollback に使わない。

## 既存共有の切替（P4）

利用者自身が相互承認する。既存 share から accepted を生成しない。過去に共有 0 件でも、
実行直前の許可された read-only 接続で再集計する。公開 Issue へメール、本人 ID、予定内容、
project identifier を貼らず、非公開証跡へ最小件数だけを残す。

- current main / 配備 runtime / migration history / grant / RLS / RPC を再確認する。
- share 行数、片方向ペア数、二者ペア数、自己共有、孤児、有効 account、accepted 不足、
  relation ID が既にある行の当事者/世代不一致を集計する。
- 未承認・不整合が 1 件でもある、接続できない、history が不明なら HOLD。登録完了を待つか、
  明示解除の判断へ戻す。migration が自動承認や自動失効を行ってはいけない。
- apply transaction では必要な表を固定順に lock し、新規共有/関係変更を遮断して再集計する。
  外の preflight だけで無条件 backfill しない。lock timeout / 検証失敗なら全体を rollback。
- すべて承認済みの場合だけ既存の明示 share をその accepted generation へ bind し、
  NOT NULL/FK と friends-only read を強制する。予定本体と第三者 share は変更しない。
- 適用後に未承認/不整合/legacy-null=0、旧経路拒否、正常な owner/recipient read と型を確認。
  本番 smoke のために実利用者への申請や share の作成/解除を勝手に行わない。

### P4 candidate のロックと停止条件（未採用）

この candidate の実装・local synthetic 検証と、本番へ適用する判断は別である。
main push は migration apply を起動するため、PR の CI / review が通っても、追加の
採用判断前に merge しない。採用直前には配備 runtime、migration history、catalog と
上記の最小集計を再確認し、transaction 内でも再検証する。

transaction は `lock_timeout = '10s'` とし、次の順に lock する。

1. `auth.users EXCLUSIVE` で、guard の `KEY SHARE` を保持する既存 contact RPC と
   account DELETE を drain する。
2. `personal_schedule_entries SHARE ROW EXCLUSIVE NOWAIT` で、owner の直接書込みと
   entry DELETE からの share cascade を止める。所有者判定の通常読取りは許可する。
3. `schedule_contacts SHARE ROW EXCLUSIVE NOWAIT` で accepted generation を固定する。
4. `personal_schedule_shares ACCESS EXCLUSIVE NOWAIT` で bind / NOT NULL / policy を変更する。

初回以降の `NOWAIT` は必須である。auth lock 後に開始した entry INSERT が、先に entry の
write lock を取り、FK の auth lock を待つ場合がある。このとき migration が entry lock を
待つと循環する。競合時は `55P03` で transaction 全体を中止し、同じ transaction 内で
待ち直し・続行しない。必要なら利用の少ない時間を選び、fresh preflight から再判断する。

この間、認証の user 更新、contact 操作、entry 書込み、share 操作が短時間待つ可能性がある。
`auth.users` の FK を確認するイベント・参加等の書込みも同じ待機の対象になりうる。
一般の auth 読取りと owner entry 読取りは最初の lock と両立するが、共有を調べる読取りは
shares lock により待ちうる。初回の取得待ちは最大10秒で、後続取得は競合時に即時中止する。
10秒は transaction 全体の所要時間を保証する値ではない。local の lock / rollback 検証と
実行直前の件数から作業時間を判断する。

未知の permissive policy、function body / signature / owner / ACL、trigger、FK、account / pair
不整合があれば修復せず HOLD。既存 NULL share だけを現在の accepted relation ID に bind し、
非 NULL の世代を付け替えない。予定・申請・関係・呼び名の作成や削除は行わない。

既存の owner Boolean helper と owner email projection の EXECUTE ACL は、Production では
postgres / authenticated、fresh local / CI では Supabase bootstrap default により
postgres / anon / authenticated / service_role となる。歴史的 migration は PUBLIC だけを
revoke しており、この差を本番 drift と誤認しない。確認済みのこの二つの完全な grant 集合だけを
許容し、余分な role / PUBLIC / grant option / 継承経路は停止する。既存 ACL を修復・拡張せず、
正規の本体内の caller / owner 判定を維持する。新しい private read helper は authenticated
だけに EXECUTE を許し、anon の共有表読取りや contact 表の権限を増やさない。

shared read は private Boolean helper が actual share ID、当事者、現在の relation ID と
有効 account を検証する。shares SELECT と owner email projection をこの判定へ限定し、
entries SELECT の既存 shares EXISTS を通じて recipient read にも適用する。
entries policy の DDL や contact table の client grant を追加しない。

local 検証では実 migration の専用 schema replay と実 PostgREST を併用する。
未承認・catalog drift・途中失敗・lock 競合の rollback、child FK の逆順、entry/share 読取りの
逆順、share / unlink / accept / account DELETE、owner revoke / self-leave / entry DELETE を
確認する。成功時も旧 share の ID / 時刻と予定、第三者共有を保存し、再登録で復活しないことを確認する。

## 復旧と報告

P1a は gate=false なので旧 runtime のまま待てる。P4 の transaction 失敗は旧可視性へ戻り、
成功後は対応 schema を理解する runtime だけへ戻す。旧 email 経路の再開、accepted 自動作成、
解除済み share の復元を復旧手段にしない。

対象・操作・理由・完了部分と、拒否/保留/結果不明を区別して報告する。結果不明の apply や
投稿は状態を再確認してから扱い、重複実行しない。
