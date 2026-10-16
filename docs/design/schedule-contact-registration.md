# 共有相手登録の仕様案と最初の DB 基盤

**Status: Draft / 実装途中。Current behavior contract ではない。**

変更意図は [Issue #825](https://github.com/reitojike/stage-tracker/issues/825)。
現在の予定共有は引き続き [Spec 012](../../specs/012-personal-schedule-sharing-privacy/spec.md)
が所有する。この文書は承認済みの将来動作と、最初の限定実装の境界を記録する。

## User scenarios and testing

### 1. 家族を共有相手として登録する（P1）

利用者は初回だけ相手の登録メールを完全一致で指定する。申請する意思と、相手本人の
明示承認がそろって共有相手になる。登録だけでは予定を一件も公開しない。

1. A が B へ申請し、B が承認すると A/B の関係が一つ成立する。
2. A の重複申請、B からの逆方向申請だけでは承認にならず、重複関係も作らない。
3. B の拒否と A の取消は申請だけを解消する。古い承認操作で関係を作らない。
4. 未登録メールにアカウントや外部申請を作らず、実在を示す結果を A に返さない。
5. B のメール変更後も申請先は同じ本人。A は申請時のメール入力で取消できる。

### 2. 登録した相手へ予定を明示共有する（P1、後続実装）

owner が登録済み相手を選び、予定ごとに共有する。相手は閲覧のみで、予定を編集したり
他 recipient を管理したりできない。「妻」など自分だけの呼び名を付けられる。

1. 登録した直後は共有予定が 0 件。owner の明示追加で初めて当該予定が見える。
2. 予定単位の解除と recipient 自身の離脱は当該共有だけを削除し、登録関係を残す。
3. 呼び名は本人だけが読め、相手の表示名やプロフィールを変更しない。

### 3. 登録を解除して再登録する（P1、後続実装）

どちらかの解除で二者間の両方向の既存共有をすべて失効させる。予定本体と第三者への
共有は残る。再登録は新しい同意サイクルで、過去の共有を復活させない。

1. 解除と共有追加の両順序で、解除 commit 後に二者間の共有が残らない。
2. 再登録後も古い関係を指定した追加・古い申請への承認は無効。
3. account 削除時は関係と申請を除去し、相手所有の予定本体を消さない。

## Requirements

- **SCR-001**: 対象は本人とオペレーターが事前登録した家族のみ。signup と account
  provisioning は変更しない。一般検索、第三者展開、SNS、group、登録リンクは対象外。
- **SCR-002**: 完全一致入力は既存と同じ trim + case normalization。部分一致や provider
  固有の dot/plus alias 展開はしない。認証・関係の identity はメールでなく本人 ID。
- **SCR-003**: 相手本人の明示承認が必要。同方向・逆方向・同時実行は重複を作らない。
- **SCR-004**: 拒否と取消は pending のみを解消する。undo・拒否理由/履歴・恒久拒否は
  提供しない。再申請は新規申請とし、解消済み申請への承認は無効。
- **SCR-005**: 未登録・既存・重複・逆方向で申請と取消の結果から実在を知らせない。
  実在する相手だけが載る送信一覧・件数は提供しない。受信一覧と承認済み相手に限る。
- **SCR-006**: status/body/header/Cookie、公開エラー、直 API、応答時間も検証する。
  caller ごとの試行制限は unknown/no-op も同じように数え、pending 件数から算出しない。
- **SCR-007**: 登録は予定を公開しない。予定単位の明示共有と有効な登録関係の両方が必要。
- **SCR-008**: 個別解除/自己離脱と登録解除は別操作。登録解除は双方向の共有だけを失効。
- **SCR-009**: 再登録は別の関係として扱い、過去の共有を復活させない。
- **SCR-010**: 呼び名、他人の申請/関係、他 recipient は第三者に開示しない。
- **SCR-011**: メール変更と旧メール再利用で関係/共有を別 account へ移転しない。
- **SCR-012**: 既存共有から相互承認を自動生成しない。切替直前に未承認共有があれば
  自動失効せず停止して明示判断へ戻す。過去の「共有 0 件」は切替時の保証ではない。

## Success criteria

- **SC-001**: 相手の明示承認なしに成立する登録は 0 件で、登録だけで公開される予定も 0 件。
- **SC-002**: 重複/逆方向/二重回答/取消後の古い回答で関係が増えない。
- **SC-003**: 解除後の二者間共有と、再登録で自動復活する共有はいずれも 0 件。
- **SC-004**: 呼び名や他人の申請/関係を読める無関係な利用者は 0 人。
- **SC-005**: 未承認既存共有を自動承認・自動失効する移行は存在しない。

## 最初の限定実装（P1a）

P0 の仕様案と P1 のうち、申請・承認関係の永続化基盤だけを扱う。
migration と runtime の分離ルールに従い、作業仕様はこの `docs/` 配下に置く。
Spec Kit の標準 spec 構成を評価し、シナリオ・要件・成功基準を利用したが、今回は
`specs/` の新しい Current Spec や feature pointer を作らない。

- pending 申請と accepted 関係を別の表にし、正規順の二者ペアを unique にする。
- accepted 関係の ID は承認成立ごとに新規生成する。申請の ID を再利用しない。
- 申請・承認・拒否・取消の DB 操作を追加するが、**登録 capability は常に false**。
  通常利用者は新操作を実行できない。client の GUC や入力による有効化経路はない。
- pgTAP の transaction 内でのみ capability 定義を置換し、synthetic A/B/C で遷移を検証。
  rollback により有効化を残さない。無効のままの配備状態も別途検証する。
- pending/accepted/caller budget の直接 CRUD と private helper の実行を client に許可しない。
  受信一覧、alias、共有 RPC、関係解除は後続の限定 PR で追加する。
- `personal_schedule_entries` / `personal_schedule_shares` / 旧 email RPC / grant / RLS を
  変更しない。既存行の backfill や accepted 自動作成も行わない。
- exact generated types と DB テストを同梱する。web/domain の手書きコードは変更しない。

これは登録機能のリリースではない。内部の opaque な戻り値や試行制限だけで、応答時間を
含む実在推測対策が完成したとも扱わない。無効化は後続の安全条件がそろうまで維持する。

## 一覧・管理・共有世代の限定実装（P1b）

P1a を含む main `e31c49d` から独立した migration PR とする。登録 capability は
false のままで、実ユーザーの関係・共有を作成/解除しない。Current Spec の昇格、UI、
旧 email 作成経路の閉鎖、既存行の backfill は含めない。

- `list_received_schedule_contact_requests()` は本人宛 pending の ID、申請者の現メール、
  申請日時だけを返す。送信履歴・対象メールの存在・件数照会は提供しない。
- `list_schedule_contacts()` は本人が参加する accepted generation と相手の現メール、
  本人だけの alias、承認日時を返す。メール変更後も関係は account UUID に結び付く。
- `set_schedule_contact_alias(contact_id, alias)` は本人の値だけを設定する。前後の空白を
  除き 1–80 文字、空値/null は自分の値だけを削除する。相手・第三者には公開しない。
- `share_schedule_entry_with_contact(entry_id, contact_id)` は所有者だけが、参加中の
  accepted generation に明示共有する。登録自体では予定を公開しない。同じ予定/相手への
  再実行は同じ共有行。既存 legacy 行の binding はこの明示操作時だけ可能にする。
- `unlink_schedule_contact(contact_id)` はどちらの参加者からでも、当該ペアの双方向共有
  （legacy NULL を含む）、両者の alias、関係を同一 transaction で削除する。予定本体と
  第三者共有は残す。古い/無関係な ID は opaque no-op。再承認には新しい UUID が必要で、
  過去の共有と alias は復活しない。

共有行の nullable `contact_id` FK は関係削除で cascade し、新経路の共有だけを世代に
拘束する。trigger は予定 owner と recipient が当該関係の二者であることを検証し、
一度 bind した共有の generation/予定/recipient の変更や binding 解除を拒否する。
alias 表は直接 client CRUD を許可せず、share の直接 INSERT/UPDATE 権限も追加しない。
既存の SELECT/DELETE RLS と recipient 離脱は維持する。

新しい share/alias/unlink は account の KEY SHARE → canonical pair advisory lock →
当該 generation の再取得を同じ順序で行う。share が先なら解除がその共有も削除し、
解除が先なら待機後の追加は失敗する。並行する二接続で実際の blocking PID を観測する。
account 削除による FK cascade を待つ間に、先に request/contact/share 行を変更しない。

pgTAP は実 schema を transaction 内だけ有効化して rollback する。複数接続の検証は
実 migration SQL の schema 名と auth.users 参照を fixture 専用 schema/代理 user 表へ
置換し、その専用 gate だけ有効化する。実際の auth.uid/role/FK/row lock を使うが、
これは実 Auth サービスとの並行削除の完全な代替ではない。実 auth.users の逐次 cleanup
は pgTAP、無効時の PostgREST/権限/known-unknown 応答一致は HTTP テストで補う。
共有 public gate を別 session へ公開するテスト用の有効化は行わない。

**リリース上の残件:** P1b の旧 email RPC は従来どおり NULL 世代の共有を作成できる。
旧 RPC と unlink の競合を安全にする friends-only 保証は P3 の旧経路閉鎖まで成立しない。
有効時 HTTP の status/body/header/Cookie/公開ログ/応答時間と cache の検証も後続の
有効化条件であり、今回の SQL/無効時 HTTP の合格を存在推測対策の完成とは扱わない。

## P2a: runtime の read/write・Action 準備

P1b の main `043a424b`、migration 履歴一致・Production READY の採用証拠を前提に、
runtime 専用 PR で型付きの本人限定 read、7 操作の write と Server Action を追加する。
DB、権限、旧 email 共有、既存 UI は変更しない。Current Spec の昇格もしない。

既存の session client、`ReadResult`、`authActionClient`、再検証境界を使う。
capability は厳密な boolean のみ受理し、false/不明/失敗なら操作を開始しない。
一覧の拒否を空の成功へ変換せず、送信一覧・存在照会は追加しない。write の成功は
opaque acknowledgement だけで、内部 row/ID/件数を返さない。SQL/通信の生詳細や
対象メールをログ・返却文言へ載せず、旧 email の 90010 文言も流用しない。

Action の strict input は当該操作の email/request ID/contact generation ID/entry ID/
alias だけを受け取る。actor/owner/recipient UUID を入力にせず、世代の再解決や retry は
しない。最終的な所有者・当事者・失効世代の検証は DB RPC が担う。alias は空欄で自分の
値だけ解除し、Postgres に合わせた 80 code point 上限を検証する。

関係解除は My Page/Home/Calendar と `/(app)/schedule/[entryId]` の page pattern を
再検証し、削除対象の列挙を返さず全 detail を対象にする。これは端末上の既読内容の
遠隔消去や別タブへの push 更新ではない。画面・戻る/別タブ/PWA の検証は P2b/P3 に残す。
既存 UI は新 Action/read を参照せず、無効時の全 Action は mutation と再検証を行わない。
DB 世代/競合の根拠は P1b のテスト、runtime の契約は unit/MSW/実 auth middleware の
Action テストで分けて検証し、mock の成功を本番登録の実施とは扱わない。

## P2b: 利用開始前の UI 準備

採用済み P2a の main `8b22c0e` を基準に、My Page の共有相手登録画面と、予定詳細の
登録済み相手 selector を runtime 専用 PR で接続する。共有相手の受信申請・承認/拒否、
opaque な email 申請/取消、私的 alias、確認付き unlink をそれぞれ P2a Action へ渡す。
送信済み一覧・相手の存在照会・自動共有は作らない。旧 email RPC/権限は変更しない。

capability=false/取得失敗では申請・登録管理の control を出さず、新規共有の email UI も
提供しない。旧共有の owner projection・個別解除・recipient 自己離脱は維持する。
この利用開始前の画面 guard だけを Spec 012 に同期し、将来の登録動作や friends-only
read を Current authority へ昇格しない。有効時の UI は typed な本人限定 read だけを使い、
独立した受信/登録一覧の読取失敗を sibling のデータや空件数へ置き換えない。

contact write の再検証対象に管理画面と予定 detail selector を加え、unlink では Home /
Calendar / 全 detail も再検証する。別タブ/戻る/PWA の有効時の実ブラウザ検証は P3 の
条件として残す。UI の正の操作は synthetic な Action 応答と実 useAction で検証し、
実 DB の E2E は gate=false のまま mobile/desktop で新規操作停止と旧共有の解除・離脱を
検証する。ブラウザ試験のために public gate を有効化したり抜け道を追加したりしない。

P2b は Draft PR・CI・head review まで。本番配備/merge、P3 の旧経路閉鎖/有効化、
P4 の既存共有 bind は別段階であり、未承認ペアの自動承認・自動失効を行わない。

## 後続の依存関係

### 共有投影の再読取（P2b 後の runtime 専用差分）

#832 は人間の承認により main `027f326` と同 SHA の Production へ採用済み。
main Verify・Apply Migrations は成功し、87 migrations 一致・追加適用なし、登録 gate=false を確認した。

履歴復帰で残る Next App Router の画面と共有投影を分ける。Home/Calendar の初期 props は
本人の予定・参加予定・チケットだけを渡し、共有予定は session/RLS による read-only Server Action の
新しい返答で追加する。詳細の owner 画面と入力は従来のまま維持し、recipient 本文だけを同じ境界へ置く。
tab 非表示・pagehide・blur・履歴復帰・保持画面の再入場では共有投影を隠し、新しい結果を待つ。
local request version は古い非同期返答の破棄にだけ使い、認可の根拠にしない。
本人が変わった返答では旧本人の projection も表示しない。

router.refresh() は完了結果を返さないため、時間待機や transition 完了を認可結果と解釈しない。
通信失敗・低速応答では共有本文・件数・月帯・overflow/aria label を戻さず、本人の表示と入力を保つ。
再試行も同じ read のみ。新しい認可基盤、共有解除の polling、URL/cookie nonce、登録 gate の変更、
旧 email RPC の閉鎖、migration は加えない。専用 DB の legacy 合成共有を用いた E2E は gate=false で行う。
P3 有効化やインストール済み実機 PWA の検証を、この runtime PR の採用と混同しない。

### 実装・有効化の順序

1. P1b（本 PR）: bounded な受信/登録一覧、本人用 alias、関係解除、新しい共有作成の DB 基盤。
   accepted 関係の世代と share を結び、解除/add の同一 pair lock を徹底する。
2. P2: DB 適用の実証後に型付き read/action と登録管理・選択式共有 UI を別 PR で追加。
   capability 不明/無効なら新操作を止める。
3. P3: P2 の Production 配備済み証拠を前提に、旧 email share 作成経路を DB で閉じる。
   応答時間/直 API/並行操作の証拠、一覧・alias・unlink がそろうまで capability を有効化しない。
4. P4: 利用者自身の相互承認後、lock 下で preflight を再実行する。未承認・孤児・不整合が
   1 件でもあれば transaction を abort。全既存明示 share を accepted 関係へ bind できる
   場合だけ friends-only read を強制し、Spec 012 の Current authority を同期する。
5. 必要な cleanup は DB と runtime の PR を分離し、旧関係/共有を復元しない。

本番 apply、main merge、旧 email 共有の閉鎖、実データの変更、実ユーザーへの申請は
この実装フェーズにも含まれない。PR は #825 に紐付けて Draft のまま報告する。
