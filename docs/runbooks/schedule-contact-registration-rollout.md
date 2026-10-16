# 共有相手登録の段階移行（Draft）

追跡は [#825](https://github.com/reitojike/stage-tracker/issues/825)、
承認済み仕様案と分割は [登録の設計案](../design/schedule-contact-registration.md)。
現段階は P1a に続く P1b の無効な DB 基盤であり、登録機能をリリースする手順ではない。
本番 apply・main merge・実利用者への申請・既存共有変更は別の実行フェーズとする。

## P1a のローカル検証

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

## P1b のローカル検証と停止境界

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
Auth サービス全体の並行削除の完全な検証とは扱わない。

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

## 有効化の前提（P1b → P2 → P3）

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

## 復旧と報告

P1a は gate=false なので旧 runtime のまま待てる。P4 の transaction 失敗は旧可視性へ戻り、
成功後は対応 schema を理解する runtime だけへ戻す。旧 email 経路の再開、accepted 自動作成、
解除済み share の復元を復旧手段にしない。

対象・操作・理由・完了部分と、拒否/保留/結果不明を区別して報告する。結果不明の apply や
投稿は状態を再確認してから扱い、重複実行しない。
