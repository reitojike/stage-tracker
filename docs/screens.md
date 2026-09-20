# stage-tracker 画面ごとの状態・権限・文言

このdocumentは、screenごとの **状態分岐・権限分岐と、その分岐を体現する
実文言のdecision** の正本です。screen横断のglobal UX/UI ruleは
[`docs/ux-ui.md`](./ux-ui.md) を正本とし、ここでは繰り返しません。

componentのpropsや実装detailのcatalogにはしません。それはStorybookと
sourceの責務です。ここに書くのは「なぜこの分岐を分けるのか」と
「そのとき何と表示するのか」だけです。

文言の正本は `src/domain/*Formatting.ts` / `src/domain/*Feedback.ts` と、
各screenのcomponentです。design側で言い換えません。

## 全画面に効く分岐のdecision

- **「空」と「読み込み失敗」を必ず別物として扱います。** 失敗を
  「データなし」に紛れ込ませません。RLSによるsilent failureをempty UIとして
  誤表示しません。唯一の例外は、既に到達可能な導線へ添えるだけの補助的な
  件数表示です（[`docs/ux-ui.md`](./ux-ui.md)「補助的な件数表示の例外」。
  current該当はMy Pageの招待未対応件数のみ）。
- **権限の確認自体が失敗したときに「権限がありません」と言いません。**
  実際には権限を持つ人へ誤った説明をすることになるためです。確認の失敗は
  読み込み失敗として扱い、別の文言を持ちます。
- **1つのpageが複数の独立した読み取りを持つ場合、blockごとに結果を持ちます。**
  片方が失敗してももう片方は表示します。page全体の失敗にするのは身元確認の
  失敗だけです。
- **認証、原因不明の失敗、network 起因と確定した失敗を文言で区別します。**
  - re-auth: 「サインインしてからもう一度お試しください。」
  - 原因不明 / temporary failure: 「しばらくしてから再度お試しください。」
  - confirmed network failure: 「通信状況を確認し、もう一度お試しください。」
- `StatePanel` の `error` を赤やiconで特別扱いしません
  （[`docs/ux-ui.md`](./ux-ui.md)「Common states」）。

## ホーム（`/`）

**decision: blockごとに独立した読み取り結果を持つ。**「申し込み期限」と
「直近の予定」は片方が失敗してももう片方を表示します。page全体の失敗に
なるのは身元確認の失敗だけです。

「申し込み期限」が参照するTicketOpportunityのplanning semanticsは
[TicketOpportunity planning Living Spec](../specs/008-ticket-opportunity-planning/spec.md)、
relevant date・月・orderingは[Spec 003](../specs/003-ticket-opportunity-timeline/spec.md)
がauthorityです。この画面文書はHomeのblock合成とread-stateだけを扱い、domain
semanticsを再定義しません。

| 状態                  | 表示                                                                      |
| --------------------- | ------------------------------------------------------------------------- |
| 申し込み期限 — 失敗   | 「申し込み期限を読み込めませんでした」（`unavailable`）                   |
| 申し込み期限 — 空     | 「期限が近いものはありません」                                            |
| 直近の予定 — 失敗     | 「直近の予定を読み込めませんでした」（`unavailable`）                     |
| 直近の予定 — 空       | 「予定はありません」                                                      |
| 両方とも空            | 個別の空表示をやめ、「期限が近い申し込みも、直近の予定もありません」の1枚 |
| 認証 — セッション切れ | 「ログインが必要です」                                                    |
| 認証 — 通信           | 「ホームを読み込めませんでした」                                          |

**decision: 両方が空のときだけ1枚にまとめる。** 空のpanelが2枚縦に並ぶ状態を
作らないためです。片方だけが空のときは個別の空表示を残します（もう片方に
中身があるので、何のblockが空なのかを言う必要があるため）。

## イベント（`/catalog`）

**decision: 「その月に登録がない」と「絞り込み条件で0件になった」を同じ
文言にしない。** 前者はcatalogの状態、後者は自分の操作の結果であり、次に
すべきことが違うためです。

| 状態                 | 表示                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------ |
| 読み込み失敗         | 「読み込めませんでした」／「しばらくしてから再度お試しください。」＋再読み込みボタン |
| その月に登録がない   | 「この月に登録されているイベントはありません」                                       |
| 条件で0件になった    | 「条件に合うイベントがありません」＋「条件を解除する」ボタン                         |
| 選択日に公演回がない | 「この日に登録されている公演はありません」                                           |

**decision: 条件0件の解除ボタンは、日付選択の有無に関わらず出す。**

### 絞り込み

Catalog classification / filter の product semantics（genre、facet、classification
matching、option universe、browser-local persistence）は
[`Catalog classification / filter Living Spec`](../specs/011-catalog-classification-filter/spec.md)
が正本です。ここではその意味を再定義せず、filter summary、draft / applied state、
loading、metadata failure、empty state、copy、layout といった画面上の表現・操作を
定義します。

**decision: 未適用のときは要約行を出さず、場所も確保しない。** 常時空の行を
置くと、適用中との差が読み取りにくくなるためです。

| 状態                 | 表示                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| 未適用               | 要約行なし。絞り込みiconにドットなし                                   |
| 適用中               | iconに藍のドット＋「絞り込み中: ジャンル / 下位条件」の要約行と解除の× |
| メタデータの取得失敗 | 「絞り込みを利用できません」。一覧の閲覧は継続可                       |

**decision: 絞り込みのメタデータが読めなくても一覧は出す。** 絞り込みは
補助機能であり、その失敗でcatalogそのものを見せない理由がないためです。

**decision: 編集中の下書きと適用済みの条件を分けて持ち、適用するまで一覧を
変えない。** ジャンルを変えたときは、表示対象外になった下位条件を画面上の
selectionから落とします。条件の組み合わせの意味とbrowser-local persistenceの
product ruleは上記Living Specが定義し、このsectionは適用済み条件の要約・解除と
draft / applied interactionの表現を定義します。

## イベント詳細（`/catalog/events/[eventId]`）

Event / Occurrenceのidentity、ownership、更新、cancellation、削除 capabilityの
現行正本は
[`specs/005-event-occurrence-lifecycle/spec.md`](../specs/005-event-occurrence-lifecycle/spec.md)
です。このsectionでは、その仕様を画面上でどう表示するかという状態・文言だけを
扱い、capability自体を再定義しません。

Participation の current behavior は
[`specs/001-occurrence-participation/spec.md`](../specs/001-occurrence-participation/spec.md)
を正本とします。画面上の capability と DB/RLS が許可する capability は同じとは
限らず、特に public Participation の他 user 向け browse と visibility 切り替えは
現在の first-party UI にありません。

**decision: 存在しないIDと読み取りの失敗を混同しない。**

| 状態                   | 表示                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| 存在しないID           | 「指定された公演が見つかりません」（`empty`）                                                        |
| 通信・RLSの失敗        | 「公演情報を読み込めませんでした」（`error`）                                                        |
| 参加予定だけが読めない | 本体を出したまま「参加予定を読み込めませんでした」／「しばらくしてから再度お試しください。」を重ねる |

**decision: 参加予定が読めなかったときに「参加なし」として描かない。**
参加していない状態と、参加状態が読めない状態は別物だからです。

**decision: 公演回のうち1件を選んで来た場合はその回に焦点を当てるが、
他イベントの・古い・不正なIDは無効化して「焦点なし」の一般表示に戻す。**
別の回を指してしまわないためです。戻り先は、選択日があればその日、
なければ月表示です。

## イベントを登録（`/catalog/events/new`）

Eventの作成 capabilityと作成者がownerになる境界は、上記のEvent / Occurrence
Living Specを正本とします。権限分岐に応じた画面表示・文言の詳細は、実装側の
screen feedbackとこの文書の全画面共通state規則が担います。

**decision: いずれの分岐でもBackLink（「カレンダーに戻る」）は残す。**
行き止まりにしないためです。

**decision: このpageの権限checkが決めるのは描画だけで、実際に何が永続するかは
DBが決める。** URLへ直接来ても作成はできません。

## イベントを編集（`/catalog/events/[eventId]/edit`）

Event / Occurrenceのowner capability、更新、cancellation、削除の意味は
[`specs/005-event-occurrence-lifecycle/spec.md`](../specs/005-event-occurrence-lifecycle/spec.md)
を正本とします。このsectionは独立した書き込み単位と、画面のstate / feedbackの
表現だけを記録します。

**decision: 1画面だが独立した書き込み単位が並ぶ。** 基本情報、開催期間、
公演回の追加、公演回の編集、event / 公演回の中止と中止解除、event / 公演回の
削除。それぞれが自分のfeedbackを持ち、1つの失敗が他を巻き込みません。

| 状態         | 表示                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 存在しないID | 「指定された公演が見つかりません」（`empty`）                                                                          |
| 読み取り失敗 | 「公演情報を読み込めませんでした」（`error`）                                                                          |
| 所有者でない | 「このイベントを編集する権限がありません」／「イベント情報を編集できるのは、そのイベントを登録したユーザーだけです。」 |

**decision: 破壊的操作は最下部の「中止と削除」sectionへ隔離する**
（[`docs/ux-ui.md`](./ux-ui.md)「破壊的操作の置き場所」）。ただし公演回
1件の中止・削除は、その公演回のSheetの中に置きます。listの行に赤を並べると
誤tapの危険があるためです。

## 招待一覧（`/catalog/invitations`）

Invitation の pending-only lifecycle、受信一覧、accept / decline、re-invite、
targeting、privacy / opacity は
[`specs/006-invitation-coordination-opacity/spec.md`](../specs/006-invitation-coordination-opacity/spec.md)
が current product authority です。この画面文書は、Invitation domain の lifecycle や
privacy contract を定義しません。画面固有のlayout・loading・copyを今後ここに残す
場合も、Living Specのdomain semanticsと重複させないでください。

## チケット（`/tickets`）

| 状態 | 表示                                                 |
| ---- | ---------------------------------------------------- |
| 空   | 「現在表示できる抽選・販売スケジュールはありません」 |
| 認証 | 「ログインが必要です」                               |
| 通信 | 「チケットスケジュールを読み込めませんでした」       |

TicketOpportunity planning modelは
[TicketOpportunity planning Living Spec](../specs/008-ticket-opportunity-planning/spec.md)、
milestoneのrelevant date・past・月配置・orderingは[Spec 003](../specs/003-ticket-opportunity-timeline/spec.md)
のauthorityです。このファイルは`/tickets` routeのscreen stateとsurface pointerを
案内し、planning semanticsのduplicate current authorityではありません。受付終了済みの
milestoneのpost-final retentionとTicketOpportunityのeffective cancellation集約は
[TicketOpportunity planning Living Spec](../specs/008-ticket-opportunity-planning/spec.md)
のauthorityです。

**decision: 行全体がイベント詳細へのlinkで、状態変更のcontrolだけが
その中で別に押せる。** そのcontrolはquietの例外として静止時に淡い面を持ちます
（[`docs/ux-ui.md`](./ux-ui.md)「Control vocabulary」）。

## カレンダー（`/calendar`）

| 状態               | 表示                                       |
| ------------------ | ------------------------------------------ |
| その月に予定がない | 「この月に登録されている予定はありません」 |
| 選択日に予定がない | 「この日の予定はまだありません」           |
| 認証               | 「ログインが必要です」                     |
| 通信               | 「カレンダーを読み込めませんでした」       |

**decision: 日付の役割は色だけで区別せず、`DayRoleText` を併記する。**
土＝藍、日・祝＝赤（祝日が優先）。

**decision: 中止された公演回は、bandのtitle自体が中止を示す表記になる。**
色や記号だけで中止を表しません。

## Personal Schedule lifecycleのauthority boundary

Personal Schedule entryのidentity、Event / Occurrenceからの独立性、時間表現、blocking、
ownerによるcreate / edit / deleteの現行正本は
[`Personal Schedule lifecycle Living Spec`](../specs/007-personal-schedule-lifecycle/spec.md)
です。この文書は、以下のsectionで画面上の状態・操作入口・文言だけを扱い、lifecycleの
product semanticsを再定義しません。

sharing / recipient privacyの現行product authorityは
[Personal Schedule sharing / recipient privacy Living Spec](../specs/012-personal-schedule-sharing-privacy/spec.md)
です。この文書の共有に関する画面状態は、そのauthorityの現行semanticsを画面に表す責務に
限り、layout、copy、操作入口、feedback、loading / empty / error presentationを定義します。

## 予定を追加 / 編集（`/schedule/new`、`/schedule/[entryId]/edit`）

**decision: 追加と編集は同じ `ScheduleFields` を共有する。** 同じ入力に
2つの見た目を作りません。

**decision: 選択日から追加した場合は日付を前埋めする。**

| 状態             | 表示                                          |
| ---------------- | --------------------------------------------- |
| 存在しない       | 「指定された予定が見つかりません」（`empty`） |
| 読み取り失敗     | 「予定を読み込めませんでした」（`error`）     |
| 権限の確認が失敗 | 「権限を確認できませんでした」                |

## 予定詳細（`/schedule/[entryId]`）

Personal Schedule entryのlifecycle semanticsは上記Living Specを正本とします。このsection
では、owner / sharedの立場、blocking表示、操作入口、状態・文言のscreen presentationを
記録します。

**decision: 先頭のBadgeが立場を示す。** 所有者＝「自分の予定」、共有された側＝
「共有されている予定」。予定を確保しない設定のときは `outline` で
「予定を確保しない」を併記します。

**decision: 権限で出し分けるのは操作だけ。**

- 所有者だけに出るもの: 「編集」、「共有」section、最下部の
  「この予定を削除」（説明:「元に戻せません。共有相手からも見えなくなります。」）
- 共有された側に出るもの: 自分の共有を外す操作だけ

| 状態                       | 表示                                                  |
| -------------------------- | ----------------------------------------------------- |
| 存在しない／見えない       | どちらも「この予定は見つかりませんでした」（`empty`） |
| 通信失敗                   | 「予定を読み込めませんでした」（`error`）             |
| 立場の確認自体が失敗       | 「権限を確認できませんでした」                        |
| 自分の共有状態が読めない   | 「共有状態を確認できませんでした」                    |
| 共有相手一覧が空           | 「まだ誰とも共有していません」                        |
| 共有相手一覧の読み取り失敗 | 「共有中の共有相手を読み込めませんでした」            |

**decision: 「存在しない」と「見えない」は区別できないので、どちらも
「この予定は見つかりませんでした」にする。** この画面上のoutcome / copyは、[Personal Schedule sharing /
recipient privacy Living Spec](../specs/012-personal-schedule-sharing-privacy/spec.md) の
privacy contractを表現します。

**decision: 立場の確認が失敗したときに「共有された側」として扱わない。**
所有者から操作を隠してしまうためです。同じ理由で、自分の共有状態が読めない
ときに「共有なし」として操作を隠しません。

## マイページ（`/mypage`）

account eligibility、protected route、account identity、Passkeyのsecurity roleは
[`specs/009-authentication-account-access/spec.md`](../specs/009-authentication-account-access/spec.md)
を正本とします。このsectionは、authenticated My Pageのlayout、screen state、
導線および表示上の例外だけを扱い、認証・credentialの意味を再定義しません。

**decision: カード面を使わず、太罫見出し＋本文のsectionで構成する。**

section構成は「予定とイベント」（個人予定の管理・イベントを追加・招待一覧）、
「アカウント」（メールアドレス・サインアウト）、「Passkey」です。

| 状態                 | 表示                                                |
| -------------------- | --------------------------------------------------- |
| 作成者でない         | 「イベントを追加」の行は描画自体しない              |
| 招待の未対応件数     | 件数chipを添える                                    |
| 件数の読み取りが失敗 | 0として扱う（下記の例外）。招待一覧への行は常に残す |
| サインインしていない | Passkey sectionを出さない                           |

**decision: 招待の未対応件数の読み取り失敗を0に潰してよい。** これは
「読み込み失敗をデータなしとして描かない」という全画面ruleに対する
**明示的な例外** であり、[`docs/ux-ui.md`](./ux-ui.md)「補助的な件数表示の
例外」がその適用条件を定めます。件数はこのpageの主データではなく、0を
描いても「招待が0件である」と主張したことにはなりません。招待一覧への行は
件数によらず常に残るので、実際の状態はその先の招待一覧で、通常の失敗表示
（「招待を読み込めませんでした」）として確認できます。

**この例外はこの件数chipだけに適用します。** 同じpage上の他の分岐
（作成者でない、サインインしていない）には広げません。

## サインイン（`/sign-in`）

account eligibility、Magic Link / Passkeyのrole、enumeration safety、protected
routeおよびredirect stateのsecurity boundaryは
[`specs/009-authentication-account-access/spec.md`](../specs/009-authentication-account-access/spec.md)
を正本とします。このsectionは、sign-in screenのstate、layout、導線および
rendered copyだけを扱います。

**decision: 3状態を持つ。**

| 状態   | 表示                                                                                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 初期   | Passkeyボタン＋「または」＋メールアドレスのフォーム                                                                                                                                                                      |
| 送信後 | 入力欄を隠し、受領文だけを出す（「リクエストを受け付けました。登録済みのメールアドレスで、メール送信が利用可能な場合はサインインリンクが届きます。届かない場合は時間をおいて再試行するか、管理者に連絡してください。」） |
| エラー | 「サインインリンクが無効です」／「メールアドレスを入力してください」を上に重ねる                                                                                                                                         |

送信後の受領文は、上記Living Specのenumeration safetyを満たすscreen copyとして
表示します。accountの登録有無やメール送信の成否を意味するものではありません。

**decision: PrimaryNavとAppBarのactionを出さない唯一の画面。** 遷移先が
すべて認証の内側にあるためです。

## Sheet（routeを持たない面）

### 参加の状態

**decision: 選んだ時点で保存して閉じるので、確定ボタンを持たない。**
現在の選択は左の藍の罫と「選択中」で示します。

| 状態         | 表示                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 参加状況なし | 「参加する」「気になる」を表示する。中止中は新規作成を受け付けない。                                                               |
| 気になる     | 「気になる」は同じ状態の no-op。「参加する」は通常は attending へ更新し、中止中は無効。既存 row の「参加をやめる」は常に表示する。 |
| 参加する     | 「参加する」は同じ状態の no-op。「気になる」への降格と「参加をやめる」は中止中も表示・実行できる。                                 |
| 読み取り失敗 | 「参加状況を読み込めませんでした」を表示し、参加状況なしとして扱わない。                                                           |

中止状態はイベント詳細上で「中止」と表示します。`events.canceled_at` または
`event_occurrences.canceled_at` のいずれかが有効な場合でも、既存の
`attending → considering` 降格と withdraw の導線は失いません。absence と
read failure は別状態です。

成功時は選択を反映してSheetを閉じます。現在のruntimeでは独立したsuccess
notificationは表示しません。これは `docs/ux-ui.md` のglobal success-notice
requirementに対する既知のcurrent deviationです。

### 招待する / 共有相手を追加

**decision: どちらも登録済みメールアドレスの正確な入力方式。** ユーザー検索や
候補表示は持ちません（相手を探せる面にしないため。product-rules.mdの
identity boundary）。Invitationの失敗は「入力されたメールアドレスを確認して、もう一度
お試しください。」です。Schedule sharingで指定したemailが未登録の場合は、
「このメールアドレスは、Stage Trackerに登録されていません。」と表示します。

submit-basedな「招待する」「共有相手を追加」は、submitをfooterへ置き、headerの
「閉じる」を出しません。入力bodyが伸びてもprimary actionをscroll領域の外で到達
できるようにするためです。状態を選んだ時点で保存する「参加の状態」はこの形の
対象外で、確定ボタンを持たず、headerの「閉じる」を残します。

### 削除の確認

**decision: 取り消せない操作だけが確認Sheetを持つ。** 「閉じる」を出さず、
footerの `danger` ボタンでのみ実行します。覆いのtapとEscapeが取り消しに
当たります。実行中はlabelが「削除中…」に変わります。

**decision: 削除確認のtitleは対象を明示する。** 表記は「このイベントを削除」／
「この公演回を削除」／「この予定を削除」とし、Sheet単体のheadingでも対象が
分かるようにします。これは短いdanger button label（「削除」）の規則とは別です。

本文は次のとおりです。

- 個人予定: 「この予定を削除します。削除すると元に戻せません。共有相手からも
  この予定が見えなくなります。よろしいですか？」
- イベント: 「このイベントとすべての公演回を削除します。削除すると元に戻せません。
  よろしいですか？」
- 公演回: 「この公演回を削除します。削除すると元に戻せません。よろしいですか？」

**decision: 中止・中止解除は元に戻せるので確認を出さない。** 押した時点で
実行し、結果は通知で伝えます。

## 書き込み失敗の分類と文言

**decision: どの書き込みも「権限がない／対象が見つからない／入力に問題がある／
原因不明・一時的に失敗した」の4つに分けて文言を持つ。** 同じ「できませんでした」で
済ませず、次に何をすればよいかを説明で言い切ります。

正本は `src/domain/eventWriteFeedback.ts` /
`src/domain/participationFeedback.ts` /
`src/domain/personalScheduleWriteFeedback.ts` /
`src/domain/ticketOpportunityFeedback.ts` /
`src/domain/invitationWrite.ts` です。

| 対象       | 分類                   | 文言の要点                                                                                                                                                                                                                                                           |
| ---------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| イベント   | 権限                   | 「イベントを作成する権限がありません」／「このイベントを編集する権限がありません」／公演回の追加・編集も同形で個別の文言を持つ                                                                                                                                       |
| イベント   | 入力                   | 「入力内容を保存できませんでした」／「入力内容に問題があります。各項目の内容を確認して、もう一度お試しください。」                                                                                                                                                   |
| イベント   | 重複                   | 開始日時fieldへ「この開始日時の公演回は、このイベントに既に登録されています。」（汎用の入力エラーへ畳まない）                                                                                                                                                        |
| イベント   | 原因不明・一時的な失敗 | 「保存に失敗しました」／「しばらくしてから再度お試しください。」                                                                                                                                                                                                     |
| イベント   | 削除不可               | 「このイベントは削除できません — 関連する参加・招待がある公演回が含まれているため削除できません。」／公演回単体なら「関連する参加・招待があるため削除できません。」                                                                                                  |
| 参加・招待 | 権限                   | 「この公演回への招待権限がありません — 招待できるのは、その公演回に「参加する」と設定しているユーザーだけです。」                                                                                                                                                    |
| 参加・招待 | 中止                   | 「この公演は中止されているため、新しく参加予定を設定できません。」／「…新しい招待を送信できません。」                                                                                                                                                                |
| 参加・招待 | 対象なし               | 「対象の公演回が見つかりません。ページを再読み込みしてもう一度お試しください。」                                                                                                                                                                                     |
| 共有       | 権限 / 対象なし        | 「共有相手を追加する権限がありません」／「この共有を削除する権限がありません — 共有相手の削除は、その予定を作成した本人だけが行えます。」／「対象の共有が見つかりませんでした — 既にこの予定の共有から外れている可能性があります。ページを更新してご確認ください。」 |
| チケット   | 登録状況               | 「登録状況を更新できませんでした」／「登録を解除できませんでした — 対象の登録が見つかりません。ページを再読み込みしてもう一度お試しください。」                                                                                                                      |
| Passkey    | 5分類                  | 登録は中断・非対応・重複・上限・その他を分ける。サインイン側も同じ分類軸で分け、いずれも代替手段（下のメールアドレスからのサインイン）を説明で示す                                                                                                                   |

**decision: 「削除できない理由」は権限の話と別立てにする。** 権限は持って
いるのに消せない、という状態を「権限がありません」と言わないためです。

**decision: 入力が拒否されても入力値は保持し、保存が通ったときだけ保存後の
値に置き換える。** やり直しのために入力し直させないためです。

**decision: 項目ごとのメッセージに加えて、フォーム上部にも
「入力内容を保存できませんでした」を出す。** 長いフォームで、どこかに問題が
あること自体に気づけるようにするためです。

## 成功時の文言

**decision: 「保存しました」で統一せず、実際に起きたことを言う。**

正本は各 `*Feedback.ts` / `*Write.ts` です。current一覧は次のとおりです。

- 「予定を作成しました。」／「予定を保存しました。」
- 「イベント情報を保存しました。」／「公演回を追加しました。」／
  「公演回を保存しました。」
- 中止・中止解除はイベント／公演回で別文言を持ちます:
  「このイベントを中止にしました。」／「このイベントの中止を解除しました。」／
  「この公演回を中止にしました。」／「この公演回の中止を解除しました。」
- 「「参加する」に設定しました。」／「「気になる」に設定しました。」／
  「参加予定を解除しました。」
- 「招待を送信しました。」／「招待を辞退しました。」
- 「共有相手を追加しました。」
- 「「申し込む予定」に設定しました。」／「「申し込み済み」に設定しました。」／
  「登録を解除しました。」

**decision: 作成後にそのpageへ留まらない書き込みは通知を持たない。**
event作成は作成したeventへ遷移するので、その場で伝えることがありません。

## 読み込み中

**decision: すべてのrouteが専用の読み込み表示を持つ。** ホーム・イベント・
イベント詳細・イベント編集・イベント登録・招待一覧・チケット・カレンダー・
予定の詳細/追加/編集・マイページです。

calendar系（`/catalog` / `/calendar`）だけがskeletonで、残りはspinnerです
（[`docs/ux-ui.md`](./ux-ui.md)「読み込み中の見せ方」）。

## お知らせ（`/notifications`）

未実装です。通知trigger / 保持期間 / 既読のdomainが未決のため、画面自体が
未着手です（[Issue #231](https://github.com/reitojike/stage-tracker/issues/231)）。
AppBarのベルは正しいサイズのtap領域を保ったまま押せない状態で、未読ドットも
呼び出し側が値を持つまで出しません。
