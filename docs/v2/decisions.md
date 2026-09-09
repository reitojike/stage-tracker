# v2 決定ログ

oracle 抽出中に見つかった、v2 で判断が必要な論点。
`OPEN` は未決、`AGENT` は実装側で決めてよい技術判断、`PO` は product 判断が要るもの。

## PO 判断が必要

| #   | 論点                                                                                                                                                                         | 現状                                                     | 出典                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------- |
| P1  | 通知ベルが未配線のまま UI に存在（Issue #141 以降）。v2 で実装するか、UI から外すか                                                                                          | `aria-disabled` の非活性ボタンとして表示され続けている   | oracle-routes-ui §5 |
| P2  | `/schedule` と `/mypage` が PrimaryNav に無く、文脈的な入口からしか到達できない。個人予定管理の重要度次第で IA を再検討するか                                                | 意図的な設計（コード内コメントに明記）だが妥当性は未評価 | oracle-routes-ui §5 |
| P3  | Invitation の decline が client-side 8秒タイマー + unmount 確定の楽観的 UI。タブを閉じる等の離脱で pending が残り得る。server 主導へ変えるか、現挙動を仕様として明文化するか | 実際の離脱時挙動は未検証                                 | oracle-routes-ui §5 |
| P4  | エラー表示の粒度が画面間で不揃い。ホームは read ごとに独立劣化、カレンダーは単一エラーへ縮退。v2 で揃えるか、意図的な差として明文化するか                                    | 意図か未整理かが不明                                     | oracle-routes-ui §5 |

## 実装側で決めてよい技術判断

| #   | 論点                                                                                                        | 方針                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `Button` の variant に「意味」と「サイズ」が混在（`secondary` と `small` が同一 chrome でサイズのみ差）     | shadcn 準拠で `variant`（意味）と `size` の2軸へ分離する                                                                                                      |
| A2  | `--color-primary` という未定義 token 参照が1箇所ある                                                        | 現行のバグ。v2 へ踏襲しない                                                                                                                                   |
| A3  | `monthCalendarGrid.module.css` が primitive token を直接参照（自社規約の唯一の違反）                        | v2 では semantic token のみ参照する規約を維持し、これを踏襲しない                                                                                             |
| A4  | orphan token（`--space-scale-7`, `--radius-scale-xs/md/lg`, `--color-success/-warning/-info` 等）が複数ある | Tailwind `@theme` 移行時に棚卸しし、使用実績のないものは移さない                                                                                              |
| A5  | `loading.tsx` が Client Component 化して URL を再解決している                                               | Next.js が `loading.tsx` に params を渡さない制約への対処。v2 でも Next.js を使うため制約は同じ。ただし「データ依存の見出しを先取り表示しない」原則は維持する |
| A6  | 各ルートが「今日」を個別実装（`_lib/today.ts` / `_lib/now.ts`）                                             | `packages/domain` を clock-free に保つ意図は正しい。clock 境界を1箇所に集約し直す                                                                             |

## 引き継ぐと決めた不変原則

- `StatePanel` の `empty` / `error` / `unavailable` 3分岐。RLS 等の silent failure を
  空状態 UI へ誤変換しないための全画面共通原則。v2 でも維持する。
- 認証は `proxy.ts` 相当の default-deny を基本とし、ページ内でも権限を再確認する二重化を維持する。
- 権限判定の真の境界は RPC / RLS 側にあり、画面側の判定はレンダー制御に過ぎない、という位置づけを維持する。

---

## 追記: DB / domain oracle から（2巡目）

### PO 判断が必要（追加）

| #   | 論点                                                                                                                                                                                                                                                          | 現状                                                                                       | 出典               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------ |
| P5  | `auth.users` への FK の `ON DELETE` 方針が一貫していない（`catalog_creators` だけ CASCADE、他は全て NO ACTION）。アカウント削除・退会を v2 の scope に入れるか。入れるなら「shared catalog data は残す / personal data は消す」等の方針を先に決める必要がある | アカウント削除機能が無いため、一度も明示的に決定されていない                               | oracle-database §7 |
| P6  | `venue` を canonical master 無しの生 text + exact match のまま踏襲するか                                                                                                                                                                                      | product rules で明示的に先送り済み。実データの表記揺れ実態を見てから判断すべき、という指摘 | oracle-database §7 |

### 実装側で決めてよい技術判断（追加）

| #   | 論点                                                                                                                          | 方針                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A7  | `occurrence_invitations.declined_at` が死列（pending-only 移行後に誰も読み書きしない）。`updated_at` トリガーもほぼ発火しない | pending invitation を INSERT / DELETE のみの不変レコードとして設計し直し、両列を持ち越さない                                                                                                                      |
| A8  | RPC 例外の意味復元を `error.message.includes(...)` の文字列マッチングで行っている。migration の文言変更で静かに壊れる         | cancellation 系が既に custom SQLSTATE（`90001`/`90002`）で構造化済み。invite / decline / share 系も custom SQLSTATE へ寄せ、message matching を撤去する。エラーコード表はコード内の単一定数モジュールを正本にする |
| A9  | エラー分類語彙が 2 系統に分裂（`EventCatalogWriteErrorKind` と `PlanningErrorKind`）                                          | 共通の error kind 語彙へ統一し、feature 固有 kind は discriminated union の拡張として表現する                                                                                                                     |
| A10 | `mapXRow` 系が pure boundary 内で `throw` する。周囲は全て `Result` 規約なので、ここだけ例外が boundary を突き破る            | 「読めない行はスキップ」か「`Result` に倒す」かを v2 で明示的に決める                                                                                                                                             |
| A11 | ページネーションヘルパーが実質同一実装で 2 箇所に存在                                                                         | 1 つの共有ユーティリティへ統合する                                                                                                                                                                                |
| A12 | FormData 手続き的 reader が feature ごとに重複                                                                                | Zod schema を入力契約にすれば層ごと不要。v2 では手書き reader を作らない                                                                                                                                          |
| A13 | Event range containment を constraint trigger 2 本 + `SET CONSTRAINTS DEFERRED` で実現                                        | `daterange` + `btree_gist` の `EXCLUDE` 等でより宣言的に表現できないか、採用 Postgres バージョンと併せて検討する                                                                                                  |
| A14 | `event_occurrences_event_id_idx` が一意制約 `(event_id, starts_at)` のインデックスと事実上重複                                | v1 では scope 外として残されただけ。v2 で単一インデックスへ統合する                                                                                                                                               |
| A15 | genre（0..1 の nullable FK）と group（0..N の中間テーブル）でモデリング様式が非対称                                           | 意図的な設計判断。理由をスキーマ設計ドキュメントにも明示し、非対称のまま維持する                                                                                                                                  |
| A16 | SECURITY DEFINER RPC 間でボイラープレートが重複（invite 系 2 本、import 系 4 本）                                             | opacity 境界のような本質的差分は保ったまま、共通の書き込みパターンを部品化できないか検討する                                                                                                                      |
| A17 | TicketOpportunity のタイムライン計算が、歴史的な差分の積層で読みにくい                                                        | ルール自体は忠実に再現しつつ、実装は最初から 1 つの設計として書き直す                                                                                                                                             |
| A18 | imperative action（`QuickActionResult`）と `useActionState` action（`OperationState`）で戻り値の形が違う                      | imperative UI パターン自体は残る。next-safe-action 採用時に戻り値 shape だけ揃えられるか検討する                                                                                                                  |

## v2 実装で踏んではいけない地雷

oracle が「実際に踏んだ失敗」として記録している事項。単純化する場合も、根拠を確認せずに消してはならない。

- **旧 Ticket モデル（取得済みチケットの在庫・割当・譲渡）を history から復元しないこと。**
  v1 は一度実装してから過剰スコープに気づき、Issue #225 → #234 で完全撤去した実例。
  詳細な申込管理が必要になった場合は、TicketOpportunity を前提にゼロから設計する。
- **並行性対策（`FOR SHARE` 行ロック / advisory lock / デッドロック回避の順序規律）は、
  実際に踏んだレースコンディションの再現テストから来ている実証済みの対策。**
  advisory lock は「invitee の participation 行が存在しない状態」を安全に扱うための
  やや特殊な回避策なので代替設計を検討する価値はあるが、単純化するなら同等のテストで
  再検証すること。テストごと消してはならない。
- **Invitation の opacity 境界は「動いているように見えても静かに破れる」領域。**
  エラーメッセージや revalidate タイミングの差から invitee の状態が間接的に漏れうる。
  v2 実装時は oracle-domain §1.7 をレビューのチェックリストとして明示的に使う。

### 追加の技術判断

| #   | 論点                                                                                                                            | 方針                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A19 | `apps/web` の prettier 設定（double quote）が Foundation の quality profile（single quote）と衝突する                           | shadcn/ui は double quote でコードを生成し、`shadcn add` のたびに再生成される。Foundation config に合わせ続けると恒久的な摩擦になるため、`apps/web` は自前の `.prettierrc.json` を正とする。root の `format:check` からは除外し、`pnpm --filter @stage-tracker/web run format:check` が自分の設定で検証する |
| A20 | shadcn init が `layout.tsx` に `next/font/google` の Geist を追加し、ビルド時に Google Fonts へのネットワークアクセスが発生する | CI のビルド再現性を損なうため、M2 でセルフホストフォントか system font stack へ差し替える                                                                                                                                                                                                                   |

## PO / owner 作業が必要（dashboard 操作）

| #   | 作業                                                                 | 理由                                                                                                                                                                                                                                         | 状態                                                                                                          |
| --- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| O1  | Vercel project の **Root Directory を `apps/legacy-web` に設定する** | monorepo 化で root から Next.js アプリが無くなり、Vercel の Next.js ビルダーが Root Directory の `package.json` に `next` を見つけられずデプロイが失敗する。Root Directory は dashboard 設定であり、リポジトリ内のファイルからは変更できない | **対応済み**（2026-09-08 実測。main の `52e0e6d` の Production デプロイが success、`/sign-in` が 200 を返す） |

補足:

- `vercel.json` を root に置いて `buildCommand` / `outputDirectory` を明示する方法を
  試したが解決しなかった。また `vercel.json` は Root Directory 配下が参照される仕様のため、
  O1 を実施すると root の `vercel.json` は無視される。誤解を避けるため撤去した。
- Root Directory を `apps/legacy-web` にすれば、Vercel は pnpm workspace を検出して
  リポジトリ root から install する。追加の設定は不要な見込み。
- **cutover 時にこの設定を `apps/web` へ変更する必要がある。** 移行契約の一部として記録する。

### 申し送り（M6 で対応する）

| #   | 内容                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Playwright の E2E がまだ CI で実行されていない。browser バイナリの install step を workflow へ追加する必要がある。現時点の E2E はプレースホルダページの表示確認のみで、CI 時間とflaky面を増やす割に得るものが小さいため、実際の画面ができる M6 で CI へ載せる。**CI で走らないテストは飾りである**という原則自体は保つ |

| A21 | CI が Node 22.6 に pin されていたが、`jsdom@30` -> `html-encoding-sniffer@6` -> `@exodus/bytes` が `require()` で ESM を読むため、Node 22.6（require(ESM) 未対応。対応は 22.12 以降）で `apps/web` の Vitest が起動できなかった | CI の Node を 24 へ上げ、`engines` も `>=24.0.0` にした。ローカル開発は既に Node 24.18 で、legacy の 1016 件と build もそこで通ることを実測済み。CI が誰も使っていない Node を検証している状態を解消する方が、test 環境を jsdom から happy-dom へ替えて回避するより筋が良いと判断した |

---

## PO 判断: 確定（2026-09-07）

P1–P6 はすべて PO 判断済み。以下が正本であり、上記の「PO 判断が必要」節は解決済みとして読むこと。

| #   | 決定                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | **通知ベルは残す。** お知らせ機能を今後実装する。それまで非活性のまま UI に置いておく                                                                                  |
| P2  | **受信した招待はお知らせ機能に集約する。** グローバルナビは 4 項目のまま増やさない。`/schedule` はカレンダーからの入口を維持する（個人予定は本質的にカレンダーの一部） |
| P3  | **decline は即座に hard delete して確定させ、undo は「作り直し」で実現する**（下記）                                                                                   |
| P4  | **エラー表示は「read ごとに独立して劣化」へ統一する**（下記）                                                                                                          |
| P5  | **アカウント削除機能自体は将来。ただし FK の `ON DELETE` 方針は M4 で明示的に決める**（下記）                                                                          |
| P6  | **venue は生 text のまま。会場マスタは作らない。import 時に正規化して表記揺れを減らす**                                                                                |

### P3 — decline の確定と undo

現行は「8 秒待ってから削除」のため、タブを閉じる等で unmount が発火しない離脱では
削除されないまま pending が残り得る。v2 ではこれを反転する。

```
「参加しない」を押す
  -> 即座に invitation を hard delete（サーバ確定）
  -> 画面に「取り消す」を N 秒表示
  -> 押されたら、同じ inviter からの pending invitation を作り直す
```

- タブを閉じても押した通りに確定するため、現行のバグが構造的に消える
- 作り直しに必要な情報（inviter / occurrence）は直前まで画面が保持しているので、
  サーバ側に中間状態を持つ必要がない
- product rules が「decline を永久 opt-out として扱わない、再 invite できる」と
  定めているため、作り直しは既存の意味論と整合する
- undo の猶予時間の具体値は実装 Task で決める

### P4 — エラー粒度の統一

「read ごとに独立して劣化」（現行のホームの挙動）へ統一する。カレンダーの
「複数 read の失敗を単一の汎用エラーへ縮退させる」挙動は採用しない。

これは UX が良い方に揃うだけでなく、**作りも単純になる**。データ取得層で各 read が
`Result` を返す設計にすれば独立劣化が既定の挙動になり、集約する方がむしろ余分な
コードを必要とするため。

### P5 — FK の `ON DELETE` 方針

アカウント削除機能の実装は将来。ただし方針の決定は M4 のスキーマ再構築時に行う。
現行の不統一（`catalog_creators` だけ CASCADE、他は全て NO ACTION）は決めた結果では
なく決めていない結果であり、後から変更するとデータ移行が必要になる。ゼロから作る
今なら追加コストがほぼ無い。

**PO 確定の方針**: shared catalog data（Event / Occurrence）は残す。personal data
（participation / invitation / personal schedule / ticket opportunity state）は消す。
これを FK の `ON DELETE` 句として明示する。

この方針は M4 のスキーマ再構築で FK に反映すること。アカウント削除機能そのものの
実装時期とは独立であり、機能が無い段階でも FK は正しい方針で作る。

### P6 — venue の正規化

会場マスタ（`venues` テーブル + `venue_id` FK）は作らない。`events.venue` は
nullable な生 text、フィルタは完全一致のまま維持する。

ただし import 時に空白・全角半角を正規化して表記揺れを減らす。将来 `venue_id` を
追加で導入できる形（既存 text 列を壊さない）を保つ。

---

## M4 計画の修正: DB テストは pgTAP 単独では成立しない（2026-09-07）

`docs/v2/README.md` の Milestone 4 は「RLS を pgTAP へ移す」としていたが、
実際に pgTAP 基盤を作って検証した結果、**全面移行は不適切**と判明した。

pgTAP は 1 ファイル = 1 セッション = 1 トランザクションであり、次を表現できない。

| 移せないもの                                                                                  | 理由                                                                                                                                       |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 並行性テスト（advisory lock の競合、デッドロック回避、同時書き込みの勝者判定）                | 同時トランザクションを張れない。`dblink` / background worker が必要になり、Node 側の `Promise.all` で 2 本の実 HTTP を投げる方が遥かに単純 |
| PostgREST 層の挙動（引数欠落の弾かれ方、JWT の期限切れ / refresh、column grant のエラー形状） | pgTAP は Postgres へ直接話すため PostgREST を通らない                                                                                      |
| ページネーション境界（`api.max_rows` による切り詰め）                                         | 同上                                                                                                                                       |

これは軽視できない。「並行性対策は実際に踏んだレースの再現テストから来ている実証済みの
対策であり、テストごと消してはならない」と本文書が記録している、まさにその領域が
pgTAP では守れないため。

### 修正後の方針

DB テストを **2 層**にする。片方を捨てない。

- **pgTAP**（`supabase/tests/`）— RLS policy、CHECK constraint、trigger、
  DB level の product invariant。**単一トランザクションで決まる性質**を担当する。
  宣言的で読みやすく、この領域では Node スイートより優れている
- **Node / HTTP level**（移行先は未定）— 並行性、PostgREST 層の挙動、
  large dataset の境界。**現行 Node スイートのうちこの部分だけを残す**。
  全体を捨てない

現行の Node スイート（22 ファイル・約 9300 行）のうち、pgTAP へ移せる分を移し、
残る並行性 / PostgREST 層のテストだけを Node 側に残す、という縮退移行にする。
どこまで縮退できるかは実際に移してみて決める。

### 現時点の pgTAP カバレッジ

9 ファイル / 42 アサーション。Docker 上で実行して全 pass 済み。
oracle-database の §2（RLS policy）§5（product invariant）§6（既存テストの観点）に対応。
実行は `pnpm run test:db`（既存の `test:rls` は置き換えず併存させている）。

### packages/domain 実装時の申し送り（2026-09-07）

| #   | 内容                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F2  | `Instant` はミリ秒精度、Postgres `timestamptz` はマイクロ秒精度。方向としてはドメインの方が厳しく（µs で異なる 2 件をドメインが重複と判定しても DB が許すだけ）、取りこぼしは起きないため安全側。ただし読み書きの往復で µs が失われる懸念は残る。実際の occurrence は分単位で設定されるため実害は想定していないが、sub-ms 精度が必要になったら再評価する |
| F3  | **【誤診・解決済み。この記述に従わないこと】** 当初「Windows 固有の pnpm junction リンク不具合であり lockfile 自体は正しい」と記録したが、**どちらも誤りだった。** OS 非依存であり CI（ubuntu）でも同じく再現していた。根本原因と修正は下記「再レビューで発見した CI 破壊」節を正本とすること                                                            |

### 固定オフセット演算の前提（確認済み）

`Asia/Tokyo` を固定 +9h として扱う現行の方式は妥当。日本は 1888 年の JST 制定以降
（1948-1951 年の一時的なサマータイムを除き）DST を持たず、product が扱う日付範囲に
その例外は入らないため。将来 `Asia/Tokyo` 以外のタイムゾーンを扱う必要が出たら、
この前提は成立しなくなる。

`Date.UTC` の 2 つの落とし穴を回避していることも記録しておく。

- 範囲外の値を暗黙に正規化する（`2026-02-30` -> `2026-03-02`）
- 2 桁の年を 1900 年代へ読み替える（`26` -> `1926`）

`setUTCFullYear` / `setUTCHours` で構成要素を round-trip 検証する方式で回避している。

---

## PO 判断: 中止時の participation 新規作成（2026-09-07）

**oracle 間の矛盾を PO 判断で解消した。**

`oracle-database.md` §3.2 / §5 invariant 12（DB の trigger 実装）は「実質的中止状態では
新規 participation の作成をステータス問わず拒否」と記述する一方、`product-rules.md` および
`oracle-domain.md` §1.6 / §2.4 は「拒否するのは新規の active action（新規 participation の
**attending 化**、新規 invitation 等）」と、considering の新規作成は拒否対象外に読める
書き方をしていた。

争点は 1 ケースのみ。**中止された occurrence に対して新規に `considering` 行を作れるか。**
withdraw、attending -> considering の降格、considering -> attending の昇格については
両文書が一致していた。

### 決定

**拒否する。** 現行の DB 実装（一律ブロック）が正しい。中止された公演に新たに「検討中」を
付ける意味が薄いため。既存行の withdraw と降格は引き続き許可する。

- `packages/domain/src/participation/participationCancellationGate.ts` は既にこの意味論で
  実装済み。コード変更は不要
- **M4 の DB 制約もこの意味論で書くこと**
- `product-rules.md` の「新規の active action（新規 participation の attending 化…）」という
  表現は、この決定に照らすと誤解を招く。v2 の product rule を書き直す際は
  「新規 participation の作成（ステータス問わず）」と明記すること

---

## レビュー指摘の対応（PR #372 / 2026-09-07）

Claude と Codex の独立レビューで 5 件の指摘。4 件を修正し、1 件を申し送りにした。

### 修正した指摘

| #   | 出典   | 指摘                                                                                                |
| --- | ------ | --------------------------------------------------------------------------------------------------- |
| F3  | Codex  | `InviteDecision` が inviter へ返す値に invitee の private state 由来の `writePlan` を同居させていた |
| F1  | Codex  | `apps/web` に `agentRules: false` が無く、`agent-rules:check` も legacy しか検査していなかった      |
| F4  | Codex  | UTC offset の範囲が未検証で、`+99:99` 等を受理して別の時刻へ変換していた                            |
| —   | Claude | pgTAP が `attending` の新規 INSERT 拒否を検証していなかった（冒頭コメントは両方を主張）             |

**F3 が最も重要。** `InviteOutcome` を単一値のリテラル型にして「分岐を区別できない」を
型で満たしていたが、**同じオブジェクトに `writePlan` を同居させたことで構造として
破っていた**。Server Action が `result.value` を serialize すれば
`createInvitation: false` から「invitee は既に attending」が読める。

修正は `evaluateInvite` の成功値を**オブジェクトではなく文字列リテラルそのもの**
（`Result<InviteOutcome, InviteRejectionReason>`）にした。文字列には分岐依存の値を
後から付けられないため、漏洩が構造的に不可能になる。write boundary は
`planInviteWrite` を別途呼ぶ。

**この指摘は Claude が見逃し Codex が発見した。** Claude は同じファイルを明示的に
レビューして「型レベルでよく効いている」と評価している。opacity が
「動いているように見えても静かに破れる」領域であることの実例であり、
独立した 2 系統のレビューが必要であることの実証でもある。

### 申し送り（修正しない）

| #   | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F4b | ~~**Preview origin を Magic Link に渡していない。**~~ **撤回（2026-09-08、PO 判断）。** 下記「PO 判断: Preview 環境の位置づけ」により、Free 運用中は remote Preview Supabase を持たず、Vercel Preview で authenticated flow を提供しない。したがって Preview へ戻る redirect 先そのものが不要になった。将来 remote Preview 環境を持つ場合は、trusted な Vercel framework 値からのみ Preview origin を導出する方式を再採用候補とする |

### レビュアーからの補足（対応不要だが記録）

- **タイミング側チャネル**: `signInWithOtp` はアカウント有無で Supabase 側の処理が
  非対称なため応答時間に差が出得る。stage-tracker のコードでは制御できない残存リスク
- **Invitation の write boundary 実装時**: 3 分岐で SQL のクエリ時間と
  エラーコードが揃っているかを、型だけでなく実行時にも確認すること

### PR サイズについて

CodeRabbit が「130 files exceed the limit of 100」でレビューをスキップした。
`path_filters` で `apps/legacy-web/**` を除外してもファイル数の上限判定には効かない。
**M4 以降は 1 マイルストーン 1 PR とし、100 ファイル未満を目安にする。**

---

## 再レビューで発見した CI 破壊（2026-09-07）

Codex の再レビューが **CI が現に壊れていること**を検出した。2 件とも実測で再現・修正済み。

### 1. `packages/domain` の lint が CI で exit 127（コマンド不在）

**症状**: クリーンインストール後、`packages/domain/node_modules/.bin` に `tsc` しか作られず、
`eslint` / `vitest` のバイナリが存在しない。`apps/web` では 9 個作られる。

**根本原因**: lockfile が `apps/web` の eslint を
`9.39.5(jiti@2.7.0)(supports-color@7.2.0)` と **peer 修飾付き**で記録する一方、
`packages/domain` では修飾なしの `9.39.5` として記録していた。eslint の
optional peer（`jiti` / `supports-color`）が domain の依存ツリーに存在しないため
別スナップショットへ解決され、そちらのリンクが機能していなかった。
**lockfile を削除して再生成しても再発する** ため、記録の破損ではなく解決結果そのもの。

**修正**: 対症療法ではなく構成を変えた。**共有の開発ツール（eslint / vitest / vite /
typescript / typescript-eslint / @types/node / eslint-config-prettier）を root の
devDependencies へ集約し、`packages/domain` からは削除した。** 設定を共有している
ツールを各パッケージが重複して持つ必要がそもそも無い。`pnpm run` は自パッケージから
workspace root まで `node_modules/.bin` を遡るため、スクリプトはそのまま動く。

**検証**: `node_modules` を全削除して `pnpm install --frozen-lockfile` した状態から
`lint` / `test:unit`（239 件）/ `typecheck` がすべて成功することを確認した。

**申し送り F3（Windows の pnpm リンク不具合）は誤診だった。** Windows 固有ではなく、
lockfile の解決結果に起因する OS 非依存の問題であり、CI（ubuntu）でも同じく再現していた。
domain 実装時に `node_modules` を手動修復して受け入れ条件を確認したことが、
この問題を隠していた。**手動修復した環境での「検証済み」は信用しない。**

### 2. `Verify / Build` が env 未設定で失敗

**症状**: `apps/web/src/env.ts`（T3 Env + Zod）が Supabase の env を必須とするため、
env を持たない fresh runner で `next build` が失敗する。認証境界（env を参照する経路）を
追加した時点から壊れていた。それ以前に Build が pass していたのは、その経路が
存在しなかったため。

**修正**: CI の Build step へ明らかに偽の placeholder を渡す。`SKIP_ENV_VALIDATION` で
検証ごと迂回するのではなく placeholder を渡すことで、スキーマ自体（URL 形式等）は
依然として実行される。この job が検証するのはコンパイルが通ることであり、env 配線の
正しさは Vercel の build が本物の値で行う。成果物は破棄される。

### 予防: workspace 内で開発ツールの specifier を分岐させない

`packages/domain` の exit 127 と同じクラスの芽が `apps/web` / `apps/legacy-web` にも
残っていた（Claude の指摘）。同一ツールの specifier が package ごとに違うと、pnpm が
別スナップショットへ解決し、リンクとバイナリが壊れうる。

解決済みバージョンへ揃えた。

| ツール                 | 変更前（root / web / legacy）     | 変更後    |
| ---------------------- | --------------------------------- | --------- |
| eslint                 | `^9.39.5` / `^9` / `^9.0.0`       | `^9.39.5` |
| typescript-eslint      | `^8.0.0` / `^8.69.0` / `^8.0.0`   | `^8.69.0` |
| eslint-config-prettier | `^10.0.0` / `^10.1.8` / `^10.0.0` | `^10.1.8` |

`vite` は揃えていない（root/web が `^7.3.6`、legacy が `^6.4.0`）。legacy の
Storybook 9 の peer 制約に由来する意図的な差であり、legacy は削除予定のため。

**新しい package を追加する際は、開発ツールを個別に宣言せず root から使うこと。**

---

## PO 判断: v2 の DB 方針（2026-09-07）

**v2 は既存 Supabase project とスキーマを legacy と共有し、段階的に進化させる。**
v2 専用の新 project を作ってゼロからスキーマを書き直すことはしない。

### 理由

1. **並走比較が移行戦略の柱である。** cutover 前に `apps/legacy-web` と `apps/web` を
   同じデータに対して動かし、主要な操作の結果を比較する。v2 が別 DB を持つとこれができず、
   oracle を仕様書として使う戦略の実効性が落ちる
2. **`auth.users` と dogfood データの移行が不要になる**
3. **現行スキーマに構造的な問題がほとんど無い。** oracle で精査した結果、指摘は死列・
   重複インデックス・モデリングの非対称・range 制約の実装方式といった局所的なもので、
   段階的な変更で対応できる。作り直す動機が弱い

### M4 の意味が変わる

「スキーマ再構築」ではなく **「決定済みの変更を expand -> migrate -> contract で適用する」**
になる。`docs/v2/README.md` の Milestone 4 はこの方針で読むこと。

**legacy は本番稼働中である。すべての migration は legacy を壊さずに適用できること。**

### M4 で行う変更

| #   | 内容                                                                                       | 根拠 | 安全性                                                  |
| --- | ------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------- |
| 1   | `auth.users` への FK に `ON DELETE` を明示（shared catalog は残す / personal data は消す） | P5   | legacy は `auth.users` を削除しないため影響なし         |
| 2   | 死列 `occurrence_invitations.declined_at` の削除                                           | A7   | **legacy が参照していないことを実測で確認してから行う** |
| 3   | `event_occurrences_event_id_idx` を一意制約のインデックスへ統合                            | A14  | 読み取り性能のみ。動作は変わらない                      |

### M4 で行わない変更

| #   | 内容                                                               | 理由                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A13 | Event range containment を `daterange` + `btree_gist` へ置き換える | 現行は constraint trigger + 行ロック + advisory lock で実装され、実際に踏んだレースの再現テストで守られている。動いているものを書き直す リスク に対して得るものが「宣言的で読みやすい」だけであり、割に合わない。**単純化するなら同等のテストで再検証すること**という本文書の原則にも反する。必要になった時点で別 Task にする |

---

## 目標構成の修正: `packages/ui` は作らない（2026-09-08）

`docs/v2/README.md` の目標ディレクトリ構成には `packages/ui` を挙げていたが、
**当面は作らず `apps/web/src/components/` に置く。** PO 判断。

### 理由

現時点で UI の consumer は `apps/web` 一つだけである。

| package           | 判断                                                        |
| ----------------- | ----------------------------------------------------------- |
| `packages/domain` | I/O から隔離する明確な価値がある。**維持する**              |
| `packages/ui`     | 現時点では package 境界を作るだけになりやすい。**作らない** |

**共有コンポーネント = 必ず workspace package、ではない。**
`apps/web/src/components/` 内で十分に共通化できている。

二つ目の consumer が現れるか、package 境界によって明確な依存制約を得られると
分かった時点で抽出する。親 Issue #373 の Acceptance Criteria にある
「`packages/*` が価値を出しているかを評価し、出していなければ単一 app 構成へ戻す」
と整合する。

## M6 が負う責任: StatePanel の 3 状態を正しく分類すること

`StatePanel` は `variant` を必須にすることで、caller に semantic な判断を強制する。
**しかし component だけで RLS の silent empty を判別できるわけではない。**

M6 の data / application layer が、次を正しく分類する責任を負う。

```
fetch 成功 + 0 行   -> empty
fetch 失敗           -> error
権限が無い / 見えない -> unavailable
```

RLS は権限の無い行を「存在しない」ように見せるため、**素朴に実装すると
`unavailable` が `empty` に化ける。** read boundary が `Result` を返し、
権限起因の失敗を空の成功へ潰さない設計にすること
（decisions.md の P4「read ごとに独立して劣化」とも整合する）。

型が守るのは「caller が 3 択から選ぶこと」までであり、**選択が正しいことは守らない。**

---

## PO 判断の更新: `packages/ui` を作る（2026-09-08）

**上記「目標構成の修正: `packages/ui` は作らない」を明示的に上書きする。**
以降はこの節を正本とすること。

### 経緯

「作らない」と判断した時点では、抽出コストと component テストの置き場が未検証だった。
その後 PO から「検証ができてデメリットが気にならないレベルなら作ってよい」との判断を得て
実測したところ、**すべて解決した**。

### 実測結果（使い捨て worktree での spike）

| #   | 問い                                                      | 結果                                                         |
| --- | --------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | Next は workspace package の TS ソースを transpile するか | **する**（ビルド成功、route 生成を確認）                     |
| 2   | `"use client"` は package 越しに効くか                    | **効く**（client chunk 内に該当コードを確認）                |
| 3   | Tailwind は package 内のクラスを走査するか                | **しない。`@source` の明示が必要**（両方向の対照実験で確定） |
| 4   | package 内で component テストを実行できるか               | **できる**（下記の構成で実際に pass）                        |

### 必須の構成（実測で確定。守らないと壊れる）

1. **`react` / `react-dom` は package の `peerDependencies` のみで宣言する。**
   `dependencies` / `devDependencies` に入れると `react-dom` のリンクが切れる。
   実体は `react-dom@19.2.8(react@19.2.8)` だが、package からは修飾なしを指してしまう。
   `dependencies` / `devDependencies` のどちらでも、lockfile を完全再生成しても再発する。
   **`packages/domain` の eslint が exit 127 になったのと同じクラスの問題**であり、
   React の場合は二重ロードで hooks が壊れるため深刻度が高い

2. **React のテストツールチェーンを root の devDependencies へ集約する。**
   `react` / `react-dom` / `@types/react` / `@types/react-dom` / `@vitejs/plugin-react` /
   `@testing-library/{react,jest-dom,user-event}` / `jsdom`。
   これにより package 内の Vitest から解決できる。`eslint` / `vitest` を root へ
   集約したのと同じパターン

3. **`apps/web/src/app/globals.css` へ `@source "<package の src への相対パス>";` を追加する。**
   workspace package は `node_modules` 経由の symlink になり Tailwind の自動検出から
   除外される

### 検証の証跡

`useState` を使う `"use client"` コンポーネントを package 内に置き、Vitest +
Testing Library で render してクリックで state が更新されることを確認した
（`react-dom` が package 内で動く証拠）。

### 残る判断

`packages/domain` と `packages/ui` が価値を出しているかは、親 Issue #373 の
Acceptance Criteria どおり Milestone 8 で改めて評価する。この決定はそれを免除しない。

## Issue #375 実装時の追記: 死列 `occurrence_invitations.declined_at` を削除しない（2026-09-08）

A7（`declined_at` は死列）を根拠に Issue #375 は削除を In Scope としていたが、
**実装時の実測で legacy が参照していることが判明したため、このマイグレーションでは
削除しないと判断した。** Issue の Escalate When 節「legacy が死列を参照していることが
判明した場合」に該当する。

実測結果:

1. `apps/legacy-web/src/infrastructure/supabase/invitation.ts` の
   `listMyReceivedInvitations` は `select('*', ...)` で列指定ではなく全列取得して
   いる。`declined_at` は select 対象に含まれる。
2. `apps/legacy-web/src/domain/invitation.ts` の `mapInvitationRow` がこれを
   `Invitation.declinedAt` へマップし、型定義上は公開されている。しかし
   `.declinedAt` を実際に読む箇所は `apps/legacy-web/src/domain/__tests__/
invitation.test.ts` の 1 アサーション（fixture に対して null を確認するだけ）のみで、
   UI コンポーネント（`InvitationCard.tsx` / `InvitationList.tsx` 等）はどれも
   読んでいない。
3. 書き込みは無い。`decline_occurrence_invitation`（
   `supabase/migrations/20260830000000_simplify_invitation_pending_only.sql`）は
   pending-only 移行後、行を DELETE するだけで `declined_at` に一切書き込まない。

判断: 選択肢 (a)（読み取りが型定義だけで実質未使用なら expand → contract の順序が
必要）を採用し、**このマイグレーションでは削除しない。**

決め手は (b) の影響評価: `apps/legacy-web/src/infrastructure/supabase/
database.types.ts`（生成された Supabase 型、Technology profile が database type の
source of truth と定める）は `occurrence_invitations.declined_at` を宣言している。
`select('*')` なので列削除自体は SELECT を壊さないが、DB からその列を落とすと
生成型がその時点の実 schema と食い違う（`pnpm run supabase:types:check` が
検出する drift）。型を追従させるには `apps/legacy-web/src/infrastructure/supabase/
database.types.ts` の再生成、および `Invitation.declinedAt` /
`RawInvitationRow.declined_at` を参照除去する `apps/legacy-web` 側の編集が要る。
これは本 Task の「`apps/` 配下のアプリケーションコードを変更しないこと」制約の
対象であり、この PR の scope（DB migration + pgTAP）を越える。

実際に確認済み: 本 PR のマイグレーション適用後、`pnpm run supabase:types:check` は
`Generated Supabase types match the local schema exactly.` と報告している
（`declined_at` を残したことで drift が発生していないことの直接の証跡）。

**次にやること（別 Task）**: legacy 側で `Invitation.declinedAt` /
`RawInvitationRow.declined_at` への参照を先に除去し、`database.types.ts` を
再生成してから、`declined_at` 列を DROP する contract マイグレーションを別途
起票する。

### PO 確認: `events.owner_id` は `NO ACTION` で確定（2026-09-08）

`auth.users` 削除時に Event を「残す」の解釈として、**`NO ACTION`（Event を所有する間は
ユーザー削除を拒否）で確定**。`SET NULL`（所有者なしの Event を許す）は採らない。
`owner_id` を nullable にする product 判断は不要になった。

**運用方針（PO より）**

- **Event 作成は Admin アカウントからの実施のみに集約する。**
  したがって `NO ACTION` によって「Event を持つユーザーはアカウント削除できない」
  という制約が効くのは実質 Admin アカウントのみであり、運用上の問題にならない
- **Production Supabase の既存 Event についても、近日中に `owner_id` を
  Admin アカウントへ変更する予定**（operator 作業）

**注意**: この `owner_id` 変更は operator が DB 上で行う作業であり、
**product operation としての owner transfer を提供するという意味ではない。**
product-rules.md の「owner transfer は product operation として提供しません」は維持する。
v2 の実装で owner 変更の UI / API を作らないこと。

---

## `packages/ui` 抽出の実測結果（2026-09-08）

「後で抽出できる」を推測で言わないため、使い捨て worktree で spike を実施した。
**結論: 抽出は可能。必要なのは 2 点のみ。**

### 検証結果

| #   | 問い                                                      | 結果                                                         |
| --- | --------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | Next は workspace package の TS ソースを transpile するか | **する**（ビルド成功、route 生成を確認）                     |
| 2   | `"use client"` は package 越しに効くか                    | **効く**（client chunk 内に該当コードを確認）                |
| 3   | Tailwind は package 内のクラスを走査するか                | **しない。`@source` の明示が必要**（両方向の対照実験で確定） |

### 抽出時に必要なこと

1. **`globals.css` に `@source "<package の src への相対パス>";` を追加する。**
   workspace package は `node_modules` 経由の symlink になり Tailwind の自動検出から
   除外される。対照実験（追加前 0 件 -> 追加後 出力 -> 除去後 0 件）で確定済み
2. **`react` / `react-dom` は `peerDependencies` のみで宣言する。**
   `dependencies` / `devDependencies` に入れると `react-dom` のリンクが切れる
   （実体は `react-dom@19.2.8(react@19.2.8)` だが、リンクは修飾なしを指す）。
   これは `packages/domain` の eslint が exit 127 になったのと**同じクラスの問題**で、
   React の場合は二重ロードで hooks が壊れるため深刻度が高い。
   型（`@types/react` 等）は peer を持たないので devDependencies で問題ない

### 未検証の点

- **package 内で component テストを実行できるか。** peer のみの構成では `react-dom` の
  実体が無いため動かない見込み。root へ hoist すれば解決すると予想されるが未検証
  （`eslint` / `vitest` を root へ集約した先例はある）

### 判断: 当面は作らない 【この判断は撤回済み。下記「PO 判断の更新」を正本とすること】

> **【撤回済み】** この節は「component テストの置き場が未解決である」ことを理由の一つに
> していたが、その後の実測で解決した（React のテストツールチェーンを root へ集約すれば
> package 内で Vitest の component テストが動く）。PO 判断の更新により `packages/ui` は
> **作成済み**であり、`@stage-tracker/domain` の配線も**完了済み**である。
> 判断の根拠として下記の「PO 判断の更新: `packages/ui` を作る」節を読むこと。
> 以下は当時の検討記録として残す。

コストが低いことは確認できたが、**「安い」は「価値がある」ではない。**

`packages/ui` に期待できる実質的な価値は「UI が env / Supabase client / Server Action を
import できない」という依存制約だが、**それは ESLint ルール一本で同じ効果が得られる**
（`apps/legacy-web` の import 禁止と同じ手法）。同じ制約が一行で手に入るなら、
package 境界の追加分は割に合わない。加えて component テストの置き場が未解決である。

**当時想定した順序**（いずれも実施済み。1 と 2 は M6 で完了、3 は前倒しで実施）。

1. ESLint ルールで UI からアプリ固有モジュールへの import を禁止する
2. `@stage-tracker/domain` を `apps/web` へ配線する
3. `packages/ui` を抽出する

### 運用メモ: migration ordering fence は PR 本文の更新後に再実行では通らない

`check-migration-ordering-fence.mjs` は PR 本文を `PR_BODY` 環境変数から読み、
workflow がそれをイベントペイロードから渡している。**GitHub Actions の再実行は
元のイベントペイロードを再利用する**ため、PR 本文へマーカーを追加した後に
「失敗した job の再実行」をしても、古い本文が読まれて通らない。

**マーカーを追加したら、新しい commit を push して新しい実行を発生させること。**
`pull_request` の `synchronize` イベントで現在の本文が渡る。

（実測で確認。マーカーが正しい形式であることをチェッカーと同じ正規表現でローカル
検証した上で、再実行が 2 回とも同じエラーで失敗した）

---

## M7 の検討事項: Preview 環境の DB 隔離（2026-09-08）

> **解決済み。** 下記「PO 判断: Preview 環境の位置づけ（2026-09-08）」を参照。
> 選択肢の比較は判断の経緯として残すが、**結論はそちらが正本**。

**当初のアーキテクチャ案にあった Supabase Branching が、Milestone へ落とし込む段階で
抜け落ちていた。** `packages/ui` や Spec Kit と同じ抜け方をしている。PO の指摘で判明した。

### 解決したい問題

**現在、Vercel Preview は本番 Supabase を共有している。** Preview での書き込みが
dogfood データに到達し得る。M6 で v2 の画面を作り始めると Preview で操作する機会が
増えるため、リスクが顕在化する。

あわせて、`Verify / Database` が Docker で毎回スタックを立てるため 5 分かかっている。

### 選択肢

| 方式                           | Preview の隔離              | 費用                              | 手間                      |
| ------------------------------ | --------------------------- | --------------------------------- | ------------------------- |
| 現状（Preview が本番を共有）   | 無し                        | 0                                 | 0                         |
| Supabase Branching             | PR ごとに完全隔離           | **branch ごとに課金**（Pro 以上） | dashboard 設定 + workflow |
| Preview 用の別 project を 1 つ | 本番とは分離、PR 間では共有 | project 1 つ分                    | 中                        |

**「Preview を本番から隔離する」ことが目的なら 3 番目でも大半を達成でき、費用も読みやすい。**

### 後付け可能である理由（PO へ回答済み）

Branching は **CI と Preview の実行環境の話**であり、アプリのコードに影響しない。

- `apps/web` / `packages/*` / migration / RLS / pgTAP: 影響なし
- `.github/workflows/verify.yml` の接続先のみ変わる

**移行コストが時間で増えない。** `packages/ui` のように「後回しにすると移す対象が増える」
性質ではないため、M7 で扱えばよい。

### 制約

**cutover より前に決める必要がある。** cutover では Vercel の Root Directory を
`apps/web` へ切り替えるため、Preview の DB 接続先も同時に確定させる必要がある。

### それまでの運用

**M6 の Preview では書き込みを伴う操作を実行しない。** 画面の表示確認までに留める。
書き込みの検証はローカルの Supabase と CI の `Verify / Database` で行う。

---

## P3 の実装可否: decline の undo は現行スキーマでは実現できない（2026-09-08）

M6d の実装時に実測で判明。**PO 判断により undo は作らないことで確定した**
（Issue #382 は close 済み。下記「PO 判断: undo は作らない」節）。

### 判明した事実

**invitee には invitation を作る手段が存在しない。**

| 確認項目                                               | 結果                                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| `occurrence_invitations` への `authenticated` の grant | **SELECT のみ**（INSERT 無し）                                         |
| `invite_to_occurrence` / `_by_email`                   | `inviter_id := auth.uid()` で束縛。invitee が呼ぶと self-invite で拒否 |
| invitee が呼べる復元 RPC                               | 存在しない                                                             |

decline のページを見られるのは invitee 本人だけなので、既存経路では構造的に復元できない。
`env.ts` が app runtime の service-role key 保持を禁じているため、その回避も不可。

### PO 判断

**M6d では decline のみ実装する。undo は作らない**（PO 判断で確定。下記）。

M6d は undo action/UI を持たない（動かないものを動くように見せない）。decline は
取り消せないため、client は実行前に一段階の確認を挟む（押し間違い対策）。

実装状況の正本は `docs/prd.md` と `docs/roadmap.md`。この節は決定の記録であって
実装完了の記録ではない。

### PO 判断: undo は作らない（2026-09-08、Issue #382 を close）

> 確認ダイアログがあれば押し間違いによってレコードの不可逆な物理削除が発生して
> しまうことも抑止できると思うので、undo を作らず close で OK です

**確認ダイアログは M6d でマージ済み**（`InvitationList.tsx` の
`confirm-decline` フェーズ）。押し間違いによる不可逆な hard delete は
この一段階で抑止される。

P3 が反転させようとしていた元のバグ —「8 秒タイマーで確定するため、タブを
閉じると pending が残り得る」— は、**decline を即時確定にした時点で既に
解消**している。undo が無いことによる実害は「確認ダイアログで OK を押し間違えた
場合のみ」に縮んでいた。

### undo を実装しようとすると要件が両立しない

Issue #382 の Decisions / Invariants は、次の 3 つが同時に成立しない。

| #   | 要件                                                           |
| --- | -------------------------------------------------------------- |
| A   | 復元は通常の invite 判定を通す（inviter が `attending` 等）    |
| B   | 復元の成否から inviter の状態が invitee へ漏れない             |
| C   | 猶予時間を過ぎた復元が拒否される／サーバ側に中間状態を持たない |

**A と B が両立しない。** 復元 RPC を invite と同じく無条件 `void` にして
呼び出し元へ何も返さなくても、**invitee は招待一覧の再描画で結果を観測できる**。
invitation が戻らなければ「inviter はもう `attending` ではない」と分かる。
invite 操作の opacity は返り値を潰せば成立するが、こちらは**画面そのものが
観測面**なので閉じられない。

**A を外すと C が閉じない。** eligibility を再確認せず「元に戻すだけ」にすれば
B は保てるが、invitee が任意のタイミングで自分宛の invitation を作れることに
なる。これを猶予時間で縛るには「いつ decline したか」をサーバが知る必要があり、
pending-only という Invitation の設計（Issue #225/#230）と衝突する。

将来 undo が必要になった場合は、この矛盾から設計をやり直すこと。

P3 で決めた「decline は即座に確定させる」部分は、未マージの M6d ブランチで
実装する予定の範囲に含まれる。それがマージされれば、現行 legacy の
「8 秒タイマーで確定（タブを閉じると pending が残り得る）」というバグは
解消される。undo が無い状態は、現行より悪くはならない。

---

## 規約: authenticated route は `(app)` route group 配下に置く（2026-09-08）

**M6a が確立した構造を、M6b / M6c / M6d の 3 本すべてが踏み外した。** 原因は
この規約が明文化されておらず、後続への指示にも含めなかったこと。

### 規約

**認証を要する画面は `apps/web/src/app/(app)/` 配下に置く。**
`(app)/layout.tsx` が `AppShell`（AppBar + PrimaryNav）と identity 解決を担う。

- **画面ごとに `layout.tsx` を作って `AppShell` を当てない。** 重複になる
- **identity 解決を feature-local に再実装しない。** `(app)/_lib/app-bar-identity.ts` を使う
- route group なので **URL には現れない**。`(app)/schedule/new` の URL は `/schedule/new`

`(app)` の外に置くのは、**認証を要しない画面だけ**。
`/sign-in` `/sign-out` `/auth/confirm` は素の layout を使うため group の外に置く。

### 何が起きたか

| PR  | 状態                                                                     |
| --- | ------------------------------------------------------------------------ |
| M6b | `(app)` の外。**`AppShell` を持たない**（AppBar も PrimaryNav も出ない） |
| M6c | `(app)` の外。独自 `schedule/layout.tsx` + 独自 `appBarIdentity`         |
| M6d | `(app)` の外。`mypage` だけ独自 layout、他 3 画面は `AppShell` なし      |

**同じ問題に 3 者が別々の解を出した。** 「規約が無ければ、各自がその場で妥当な解を作る」
という当然の結果であり、実装者の問題ではない。

### 教訓

**構造を作った PR は、その構造を使う側への規約も同時に書く。**
M6a は `(app)` route group を作ったが、「以降の authenticated route はここへ置く」
という規約を残さなかった。基盤を作る PR ほど、**使い方の明文化が成果物の一部**である。

同種の抜けが `packages/ui` の shadcn 生成先でも起きかけた（あちらは
「共有すべきと分かった時点で手動昇格」と運用を明記して回避した）。

---

## A22: 生成 Supabase 型は 2 箇所へ機械的に書き出す（2026-09-08）

**決定: `pnpm run supabase:types` は同じ生成結果を 2 つのパスへ書き、
`supabase:types:check` は両方を byte-exact で検証する。**

- `apps/legacy-web/src/infrastructure/supabase/database.types.ts`
- `apps/web/src/lib/data/database.types.ts`

### なぜ複製するのか

`apps/web` の ESLint boundary（`apps/web/eslint.config.mjs`）が
`apps/legacy-web` からの import を一律禁止している。これは「legacy は
仕様の出典であって import 元ではない」という v2 の前提そのものなので、
生成型のためだけに穴を開けない。

### なぜ手動コピーではだめか

最初の実装は legacy 側のファイルを手でコピーし、ヘッダーコメントに
「手動で同期する運用」と書いていた。これは Codex の指摘
（「生成型を read boundary に接続せよ」）が防ごうとしていた drift を、
別の場所に作り直しているだけだった。**同期を運用規律に委ねた時点で、
migration との乖離は typecheck でも CI でも検出されない。**

生成スクリプトと drift チェッカーの両方を複数パス対応にし、
`apps/web/.prettierignore` へ生成物を追加して byte 一致を保てるようにした。

### 発火することの確認

生成コマンド部分だけを差し替えたプローブで、`apps/web` 側だけを 1 行
変更した状態を検出して exit 1 することを確認した（同期済みなら exit 0、
`2 committed copies` と報告する）。CI では Verify / Database の
`supabase:types:check` が実 DB に対してこれを実行する。

### 解消時期

legacy-web を cutover で削除した時点でこの複製は消える。それまでの
暫定として、複製そのものではなく**複製が機械的であること**を担保する。

---

## A23: v2 E2E は Playwright + 実 magic-link で組む（2026-09-08）

**決定: `apps/web` の E2E は Playwright で書き、認証は Supabase SDK の
ショートカットではなく実際の magic-link フロー（Mailpit 経由）を通す。**

Issue #380 の受け入れ条件「Playwright の E2E が主要 journey をカバーし、
**CI で実行される**」に対する実装方針。

### 認証をショートカットしない

legacy の `test/auth` は `signInWithOtp` -> Mailpit から token_hash 取得 ->
アプリ自身の `/auth/confirm` を叩く、という実経路を通している。session を
SDK で直接作らないのは、**cookie の発行経路そのものが検証対象**だから。
v2 の `/auth/confirm` も session cookie を発行する Route Handler なので
同じ性質を持つ。

legacy のコードは import していない。経路の設計だけを踏襲して書き直した。

### service-role の接続先を構造的に縛る

E2E はアカウントの provision / 削除に service-role key を使う。接続先は
`supabase status -o json`（`--linked` なし、env フォールバックなし）からのみ
得るが、**それに暗黙に頼らず `assertLocalApiUrl` で明示的に検査する**。
将来 env フォールバックを足す変更が入っても、この検査が先に落ちる。

「そうならないはず」ではなく「そうなったら止まる」形にしている。
検査自体の発火は unit test で固定した。

### CI ジョブを分ける

`Verify / E2E` を `Verify / Database` とは別ジョブにする。同じジョブに
入れると、DB 検証が落ちたのか journey が落ちたのかを区別できなくなる。

### 対象 journey

網羅率を目標にしない。**read boundary の 3 状態分類や P4 の独立劣化は
unit test の担当**で、E2E で二重化しない。

1. magic-link サインイン（送信 -> Mailpit -> `/auth/confirm` -> 認証済みホーム）
2. participation の登録と取り消し
3. personal schedule の作成 -> 閲覧 -> 編集 -> 削除
4. designated catalog creator による event の作成と編集
5. invitation（attending の user が招待し、招待先が受諾する）

各 journey が自分でアカウントと catalog 行を用意し、自分で片付ける。
journey 間で共有 fixture に依存しない。

---

## PO 判断: Preview 環境の位置づけ（2026-09-08）

**「M7 の検討事項: Preview 環境の DB 隔離」の未決事項は、この判断で解決した。**

### 決定

- **stage-tracker は Free Plan で運用しており、remote Preview Supabase を持たない。**
- **PR 単位の DB / Auth / RLS / full-stack の隔離は、ephemeral な local Supabase + CI が担う。**
  `Verify / Database` と `Verify / E2E` が、それぞれ自分の runner 上に自分の
  スタックを立てて検証する（A23）。
- **Vercel Preview は Production Supabase へ authenticated 接続しない。**
  deployment / runtime の smoke environment として扱い、
  「authenticated UI 確認環境」とは位置づけない。
- **authenticated UI と user journey の検証は local Supabase + Playwright / Storybook で行う。**
- **hosted な authenticated Preview が実際に必要だと感じた時点で、独自の代替基盤を
  構築せず Supabase Pro / Branching を再評価する。**

### 直接の帰結

**F4b（Preview origin を Magic Link へ渡す）を撤回した。**

F4b は当初、hosted な authenticated Preview を成立させるための要件だった。
この判断により Preview で authenticated flow を提供しないため、Preview へ戻る
redirect 先そのものが不要になる。

**むしろ実装すると方針に反する。** `emailRedirectTo` を渡さなければ、Preview で
サインインを試みてもメール内リンクは Production の `/auth/confirm` へ向かい、
**Preview 自体は authenticated にならない**。F4b を入れると Preview が
Production Supabase に対する authenticated セッションを持つことになり、
この判断が禁じている状態を作る。

将来 remote Preview 環境を持つ場合は、**trusted な Vercel framework 値からのみ
Preview origin を導出する方式**（リクエストの `Host` / `X-Forwarded-Host` は
読まない。クライアントが指定できるため、攻撃者のドメインを載せたサインインリンクを
他人へ送らせる経路になる）を再採用候補とする。

### この方針をどう実現するか

**app code では実現しない。** PR #386 で 4 ラウンド試みて失敗した経緯と、
採用する方式（Preview deployment に Production Supabase の接続情報を
渡さない）は A24 に記録した。**実現は M7（release / deployment contract）
で行い、cutover の前提条件とする。**

### Preview の射程についての確認

`apps/web` は default-deny であり、未認証では全パスが `/sign-in` へ redirect される
（公開は `/sign-in` / `/auth/confirm` / manifest・icon のみ）。したがって
cutover 後の Preview で未認証のまま確認できるのは、**ビルドが通ること・middleware が
効くこと・サインイン画面の表示**までである。これで足りるという判断。

### 撤回しないもの

「M6 の Preview では書き込みを伴う操作を実行しない」という暫定運用は、この判断に
包含されて恒久化した（Preview では authenticated にならないため、書き込み操作に
到達しない）。

---

## A24: Preview の隔離は app code ではなく deployment 境界に置く（2026-09-08）

**決定: 「Vercel Preview は Production Supabase へ authenticated 接続しない」
という保証を、アプリのコードで実現しようとするのをやめる。Preview
deployment に Production Supabase の接続情報を渡さないことで実現し、
M7（release / deployment contract）で扱う。**

### 経緯: app code で塞ごうとして 4 ラウンド失敗した

PR #386 で、Preview の authenticated flow を app code で拒否しようとした。
毎ラウンド「guard を通らない新しい経路」が見つかった。

| round | 見つかった穴                                                                                        |
| ----- | --------------------------------------------------------------------------------------------------- |
| 1     | `emailRedirectTo` を消すだけでは、残存 cookie と `/auth/confirm` で authenticated になれる          |
| 2     | `proxy.ts` の判定は pathname ベースなので、Server Action を公開 pathname 宛に POST すれば迂回できる |
| 3     | `sign-out/actions.ts` は `authActionClient` を経由せず `auth.signOut()` を直接呼ぶ                  |
| 4     | `proxy.ts` 自身が cookie を渡したまま `getUser()` を実行し、refresh 時には cookie を発行していた    |

4 ラウンド目の修正時に「session cookie を Supabase へ渡す構成箇所は 2 つ
だけ」と主張したが、**これは偽だった**。実際には 4 ファイル 5 箇所ある。

- `apps/web/src/lib/supabase/server.ts`（2 箇所）
- `apps/web/src/proxy.ts`
- `apps/web/src/lib/actions/passkeys.ts`
- `apps/web/src/app/(app)/mypage/_data/passkeySupabaseClient.ts`

Passkey 系 2 箇所は guard を持たない。現時点で直接 exploit できる経路が
見つからないのは、**それぞれの caller が別の guard の後ろにいるから**で
あって、まさにやめようとしていた「消費側の正しさに依存する」状態だった。

### なぜ app code では無理なのか

**Production の接続情報が Preview deployment に存在する限り、「どこで
遮断するか」を列挙し続ける問題に戻る。** Server Action / Route Handler /
browser client / Passkey client が増えるたびに、guard の置き忘れが
Production への authenticated 接続になる。

### 採る方式

Preview deployment に Production Supabase の接続情報を渡さない。

```
Vercel Production   -> 実 SUPABASE_URL / ANON_KEY -> Production Supabase
Vercel Preview      -> placeholder URL / dummy key -> 到達不能
```

Preview では、protected route は Supabase へ問い合わせられず default-deny
で `/sign-in` へ、sign-in はメールを送れず、`/auth/confirm` は検証できず、
Passkey も browser client も同様に到達できない。**新しい経路が増えても、
Production credential 自体が存在しないので置き忘れが事故にならない。**

CI の `Verify / Build` が既に `https://placeholder.invalid` と dummy anon
key でビルドを通す方式を採っており、この考え方と整合する。

### この判断の帰結

- **PR #386 からは app code の Preview 遮断を撤去した。** 部分的な guard を
  残すと「守られている」という誤った前提を招く。`apps/web` は現時点で
  どこにもデプロイされていない（Vercel の Root Directory は
  `apps/legacy-web`）ため、撤去による露出の増加は無い
- **M7 へ引き継ぐ**: Preview 環境へ Production credential を渡さない設定、
  および Preview で public / default-deny の smoke が成立することの確認
- **cutover の前提条件**: この隔離が成立していない状態で Root Directory を
  `apps/web` へ切り替えてはならない

### 教訓

**アプリのコードで「環境の性質」を再現しようとしない。** 環境の違いは
環境の設定で表す。app code で表そうとすると、その表現を参照し忘れた
経路が静かに穴になる。今回は 4 ラウンドかけてそれを実証した。

## PO 判断: D1 = D。release を orchestrate せず artifact を順序非依存にする（2026-09-08）

### 経緯

C 案（GitHub Actions が「migration 適用 → deploy」の順序を保証する release
orchestrator）を PR #388 で実装したが、**4 ラウンド連続で P1 が残り close した**。

閉じられなかったのは TOCTOU である。

```text
main == A を確認  ->  （main は動き得る）  ->  Production DB へ A を書く
```

単一 DB への write と Git ref の移動を共通 transaction に載せられない以上、
check をどこに足しても閉じない。`release.yml` は 330 行に達していた。

### D で変わること

**「順序保証が不要になる」のではない。** D でも
`expand → Production 適用 → app code` という意味上の順序は残る。

変わるのは、**その順序を orchestrator で保証するのをやめ、PR / artifact の
構造そのものに埋め込む**ことである。

```text
PR A — migration + DB tests だけ
PR B — deploy に届く artifact だけ
```

同居を `Verify / Artifact Sequencing Fence`
（`scripts/lib/artifactSequencingFence.mjs`）が機械的に拒否する。

### fence が判定すること / しないこと

判定するのは **deterministic fact**（同じ PR にあるか）だけ。
次はいずれも **semantic judgment** であり reviewer が担う。

- この migration は後方互換な expand か
- **どちらの PR を先に land させるか**

### 判定を反転している理由

当初は runtime 側を列挙していた（`apps/*/src/**` → `apps/**` と `packages/**`）。
**列挙漏れがそのまま穴になる**ため、PR #390 で 2 ラウンド続けて
「これも漏れている」型の finding が出た。

| round | 漏れ                                                                   |
| ----- | ---------------------------------------------------------------------- |
| 2     | `database.types.ts` の suffix 一致で任意の runtime module が迂回できた |
| 3     | `packages/**` と `apps/*/package.json` / `next.config.ts`              |

`apps/**` / `packages/**` を既定 runtime にしても、**root の `package.json` /
lockfile / build config は素通り**する。

そこで **deploy に届かないと明示的に認めた path だけを通し、それ以外は既定で
拒否する**形にした。新しい path・新しい package・root への追加はすべて既定で
拒否され、**漏れは「過剰に拒否する」方向にしか倒れない**。

許可しているのは次だけである。

```text
supabase/migrations/**               migration 本体
supabase/tests/**                    pgTAP
docs/**                              文書
apps/legacy-web/test/rls/**          DB/RLS integration test
生成された database.types.ts 2 file  exact path のみ
```

### D が保証しないこと（残存リスク）

fence が保証するのは「同じ PR に無い」ことだけで、**PR をまたぐ merge 順序は
保証しない**。これを機械的な gate にしようとしたのが PR #388 であり、
**D はその gate を作らないという判断である。**

順序は運用規律で担保する。reviewer は、依存する側の PR をレビューする際に
相手側が既に land / 適用済みかを確認する。

## A8 追補: error code の変更では runtime を先に出す（2026-09-08）

**きっかけ**: PR #389（`share_schedule_entry_by_email` に custom SQLSTATE
`90010`/`90011` を追加）に対し、codex と claude が独立に同じ P1 を出した。

### 何が間違っていたか

「`raise exception` の message 本文を変えていないので後方互換であり、
migration を単独で先に適用してよい」という前提が成立しない。

`error.code` 自体が `P0001` → `90010`/`90011` へ変わる。
`apps/web/src/lib/actions/schedule/postgrest-error.ts` の `classifyRpcError` は

```ts
} else if (error.code === "P0001") {
  const resolved = resolveBusinessRuleMessage?.(error.message);
```

と **`error.code` の外側ゲートを通ってから** message を見る。code が変われば
このゲートを素通りし、`kind = "failure"` と汎用文言へ落ちる。

（`apps/legacy-web` は `error.message` だけで判定し code のゲートを持たないため
影響を受けない。Production は legacy なので、この不具合の影響は未 deploy の
`apps/web` に閉じていた。）

### 一般化: expand の向きは変更の種類で決まる

| 変更の種類                               | 先に出す側  | 理由                                                         |
| ---------------------------------------- | ----------- | ------------------------------------------------------------ |
| column / table を**足す**                | migration   | 既存 reader は新しい列を見ないだけ。無害                     |
| DB が出す値を**変える**（error code 等） | **runtime** | reader が新旧両方を理解できるまで、writer は切り替えられない |

`raise ... using errcode` は **1 つの値しか持てない**。したがって
「新旧どちらの code も出す」という DB 側だけの expand は**原理的に不可能**で、
広げられるのは reader 側だけである。

**writer が新しい語彙を話し始める前に、reader が両方を理解できる状態にしておく。**

実際に採った順序:

|     | 内容                                                                    | PR     |
| --- | ----------------------------------------------------------------------- | ------ |
| A   | `classifyRpcError` が `P0001` **に加えて** `90010`/`90011` も受け付ける | #392   |
| B   | migration が errcode を切り替える                                       | #389   |
| C   | `P0001` + message 一致の分岐を撤去                                      | 未着手 |

### fence との関係

artifact sequencing fence は「同じ PR にあるか」しか判定せず、**どちらを先に
出すかは判定しない**。fence の説明が「migration が常に先」と読めると次も同じ
間違いが起きるため、fence の doc comment・失敗メッセージ・PR template の
いずれにも順序を書かない。
