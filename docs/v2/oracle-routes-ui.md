# Oracle: Routes / UI（v2 再実装仕様）

現行 stage-tracker（`src/app/**`, `src/ui/**`）を読んで抽出した、v2 実装者が
これだけを見て再実装するための仕様書。現行コードの読み替えではなく、
**現行の振る舞いの記述**として書く。憶測は書かず、確認できないことは
「未確認」と明記する。

対象外: `src/domain/**` / `src/infrastructure/**` の内部実装詳細、
DB migration / RLS の SQL 本文（テーブル名・RPC 名のみ本書に登場する）。

## 0. 全ルート共通の前提

- 認証境界は `src/proxy.ts`（Next.js Middleware）が一元的に持つ。
  `PUBLIC_PATHS = {'/sign-in', '/auth/confirm'}` の **完全一致のみ**未認証
  アクセスを許可し、それ以外の全パスは default-deny で `/sign-in` へ
  redirect する。認証済みで `/sign-in` に来た場合は `/` へ redirect する。
  各 page.tsx 側の認証チェックはこの一次防御の**上に**乗る二次チェック
  （UI 表示の分岐用。真の書き込み権限境界は常に RLS / RPC 側）。
- PWA の `manifest.webmanifest` と `pwa/icon-192.png` / `icon-512.png` /
  `maskable-icon-512.png` / `apple-touch-icon.png` の 4 アイコンのみ、
  `proxy.ts` の matcher から明示的に除外され未認証でも取得できる
  （インストールプロンプトがサインイン前に評価されるため）。
- 各 route segment の `layout.tsx` は例外なく Server Component で、
  `resolveMyPageAppBarIdentity()`（自分の email 頭文字と `/mypage` への
  href を解決）を呼んで `<AppShell>` を描画するだけ。`loading.tsx` も
  この shell の内側に描画される（app bar / bottom nav が pending 中も
  画面に残り続ける）。
- 各 route は横断共有の「今日」ヘルパーを持たず、`_lib/today.ts` /
  `_lib/now.ts` を機能ごとに個別に持つ（`src/domain` を pure/clock-free
  に保つための意図的な重複。v2 で共通化するかは 5 節参照）。
- `searchParams` / `params` は Next.js 15+ の Promise 形式
  （`await searchParams`）。

## 1. Route inventory

| path                             | Component                                                                   | 認証要否 / 未認証時                                                                                                                                     | 目的（1行）                                                                | params / searchParams                                                                          | 主要 data fetch                                                                                                                                                                                                                        | Server Action / mutation                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                              | page: Server / layout: Server                                               | proxy.ts の default-deny。ページ内でも `requireAuthenticatedUserId` で二重チェックし、失敗時は redirect せず error パネル表示                           | ホームダッシュボード（申し込み期限＋直近の予定の2ブロック）                | なし                                                                                           | `ticket_opportunities` 系（`listTicketOpportunitiesWithDetails`）／`occurrence_participations`（`listMyParticipations`）／`personal_schedule_entries`（`listVisiblePersonalSchedule`）／`events`・`event_occurrences` を ID 指定で解決 | なし（読み取り専用）                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/calendar`                      | page: Server / layout: Server                                               | 同上                                                                                                                                                    | 個人カレンダー（参加登録した公演回＋個人スケジュールの月表示・選択日詳細） | `searchParams`: 月・選択日（`resolveMyCalendarParams` が正規化。不正値は今日にフォールバック） | `occurrence_participations`／`personal_schedule_entries`／`event_occurrences`・`events`（表示グリッド範囲内のみ ID 解決）                                                                                                              | なし                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/catalog`                       | page: Server / layout: Server / loading: Server                             | proxy.ts のみ                                                                                                                                           | 共有 Event catalog の月表示（genre/group/venue フィルタ付き）              | `searchParams`: `month`, `date`                                                                | `listEventCatalogInRange`（`events`＋`event_occurrences`、月グリッド範囲）／`listCatalogGenres`→group/venue option chain（`genres`, `event_groups` 等）／event ごとの classification 結合                                              | なし（読み取り専用。フィルタ選択は client-local）                                                                                                                                                                                                                                                                                                                                                                                             |
| `/catalog/events/new`            | page: Server / loading: **Client**（`useSearchParams`で戻り先復元）         | proxy.ts に加え、designated catalog creator 判定（`isDesignatedCatalogCreator`、`catalog_creators` membership）。非 creator は permission-denied パネル | Event 新規作成（designated creator 限定）                                  | `searchParams`: `month`, `date`（戻り先）                                                      | `isDesignatedCatalogCreator`                                                                                                                                                                                                           | `createEventAction`→RPC `create_event`。成功時 event 詳細へ redirect。真の権限境界は RPC 側（このページの判定はレンダー制御のみ）                                                                                                                                                                                                                                                                                                             |
| `/catalog/events/[eventId]`      | page: Server / loading: **Client**                                          | proxy.ts のみ（誰でも閲覧可、RLS が制御）                                                                                                               | Event 詳細（occurrence 一覧、participation/invite 操作）                   | `params.eventId`、`searchParams`: `month`, `date`, `occurrence`（フォーカス対象）              | `getEventWithOccurrences`（`events`+`event_occurrences`）／`getMyParticipationsForOccurrences`（`occurrence_participations` 一括）                                                                                                     | `setParticipationChoiceAction`（`occurrence_participations` upsert/delete）、`inviteToOccurrenceAction`（RPC `invite_to_occurrence(_by_email)`）                                                                                                                                                                                                                                                                                              |
| `/catalog/events/[eventId]/edit` | page: Server / loading: **Client**（`useParams`+`useSearchParams`）         | proxy.ts に加え owner 判定（`entry.ownerId === callerId`）。非 owner は permission-denied パネル、未存在は empty、読込失敗は error                      | owner 専用の Event/Occurrence 編集                                         | `params.eventId`、`searchParams`: `month`, `date`                                              | `getEventWithOccurrences`                                                                                                                                                                                                              | `updateEventDetailsAction` / `updateEventRangeAction`（RPC `reschedule_event`）／ `addOccurrenceAction` / `updateOccurrenceAction` / `deleteEventOccurrenceAction`（RPC `delete_event_occurrence`）／`deleteEventAction`（RPC `delete_event`）／`cancelEventAction`・`uncancelEventAction`（`events.canceled_at` 直接 UPDATE）／`cancelEventOccurrenceAction`・`uncancelEventOccurrenceAction`（`event_occurrences.canceled_at` 直接 UPDATE） |
| `/catalog/invitations`           | page: Server / loading: Server                                              | proxy.ts のみ                                                                                                                                           | 自分宛 pending Invitation 一覧                                             | なし                                                                                           | `listMyReceivedInvitations`（`occurrence_invitations`、invitee 限定 RLS）／context 解決用に `events`・`event_occurrences`                                                                                                              | `acceptInvitationAction`（実体は participation write と同一）／`finalizeDeclineInvitationAction`（RPC `decline_occurrence_invitation`）                                                                                                                                                                                                                                                                                                       |
| `/mypage`                        | page: Server / layout: Server / loading: Server                             | proxy.ts のみ                                                                                                                                           | アカウント情報・Passkey管理・予定/イベント関連の入口                       | なし                                                                                           | `getAuthenticatedUser`／`resolveCanCreateEvent`（fail-closed の membership 判定）／`listMyReceivedInvitations`（pending 件数バッジ用）／Passkey 一覧は Supabase Auth 自体の API                                                        | `deletePasskeyAction`→Supabase Auth `auth.passkey.delete()`。登録は Server Action ではなくブラウザ直接 `supabase.auth.registerPasskey()`（WebAuthn ceremony のため Client 限定）                                                                                                                                                                                                                                                              |
| `/schedule/new`                  | page: Server / loading: **Client**                                          | proxy.ts のみ（作成は誰でも可。RLS `..._insert_own` が owner_id を強制）                                                                                | 個人予定（event 非依存）の新規作成                                         | `searchParams.date`（My Calendar 選択日からの prefill。不正/欠如時は prefill なし）            | なし                                                                                                                                                                                                                                   | `createScheduleEntryAction`→`personal_schedule_entries` INSERT。成功時 `/calendar` へ redirect                                                                                                                                                                                                                                                                                                                                                |
| `/schedule/[entryId]`            | page: Server / loading: **Client**                                          | proxy.ts に加え `requireAuthenticatedUserId`                                                                                                            | 予定詳細の閲覧＋owner 向け共有相手管理                                     | `params.entryId`、`searchParams.month`（戻り先）                                               | `getVisiblePersonalScheduleEntry`（存在しない/非公開は同一の empty 扱い＝RLS で区別不能）／owner なら `list_schedule_share_recipient_emails` RPC、非 owner なら `personal_schedule_shares`                                             | owner: `addScheduleShareByEmailAction`（RPC `share_schedule_entry_by_email`）、`removeScheduleShareAsOwnerAction`、`deleteScheduleEntryAction`。非owner: `removeScheduleShareAction`（自己離脱）                                                                                                                                                                                                                                              |
| `/schedule/[entryId]/edit`       | page: Server / loading: **Client**                                          | proxy.ts + `requireAuthenticatedUserId` + owner 一致チェック（非owner は permission-denied パネル、フォーム非表示）                                     | 予定の編集（owner専用）                                                    | `params.entryId`、`searchParams.month`                                                         | `getVisiblePersonalScheduleEntry`                                                                                                                                                                                                      | `updateScheduleEntryAction`→`personal_schedule_entries` UPDATE。成功時 `/calendar` へ redirect                                                                                                                                                                                                                                                                                                                                                |
| `/sign-in`                       | page: Server（フォームは`action`直結）+ Client部分（`PasskeySignInButton`） | 公開（`PUBLIC_PATHS`）。認証済みなら `/` へ redirect                                                                                                    | サインイン（Passkey優先＋Magic Linkフォールバック）                        | `searchParams.requested`（`'1'`で受付メッセージ）、`error`（`link_expired`\|`missing_email`）  | なし                                                                                                                                                                                                                                   | `requestSignInLink`（Magic Link 送信、cookieless client で enumeration 対策）。Passkeyは Server Action ではなくブラウザ直接 `supabase.auth.signInWithPasskey()`                                                                                                                                                                                                                                                                               |
| `/auth/confirm`                  | Route Handler（`GET`のみ）                                                  | 公開                                                                                                                                                    | Magic Link コールバック（token_hash 検証→セッション確立）                  | query: `token_hash`, `type`, `next`（`safeRedirectPath`で同一オリジンのみ許可）                | なし。`supabase.auth.verifyOtp({token_hash, type:'email'})`                                                                                                                                                                            | なし（Route Handler 自体が session cookie を発行する mutation）。`type=email` 以外は拒否し `/sign-in?error=link_expired`へ                                                                                                                                                                                                                                                                                                                    |
| `/tickets`                       | page: Server / layout: Server / loading: Server                             | proxy.ts のみ                                                                                                                                           | チケット機会（抽選/先行/販売）のタイムライン＋自分の planning state        | なし                                                                                           | `ticket_opportunities`＋`ticket_opportunity_target_occurrences`＋`ticket_opportunity_milestones`＋`user_ticket_opportunity_states`（`listTicketOpportunitiesWithDetails`）／`events`・`event_occurrences` ID解決                       | `updateTicketOpportunityStateAction`→`user_ticket_opportunity_states` の upsert/delete（`intent`: `planned`\|`applied`\|`remove`、常に`user_id=caller`で scope）                                                                                                                                                                                                                                                                              |
| `/sign-out`（page なし）         | Server Action のみ                                                          | 呼び出し元は `/mypage` の AccountSection フォーム                                                                                                       | サインアウト                                                               | なし                                                                                           | なし                                                                                                                                                                                                                                   | `signOut`→`supabase.auth.signOut()`→`/sign-in` へ redirect                                                                                                                                                                                                                                                                                                                                                                                    |
| `/manifest.webmanifest`          | metadata route（`src/app/manifest.ts`）                                     | 公開（PWA install 用の明示例外）                                                                                                                        | Web App Manifest 配信                                                      | なし                                                                                           | なし                                                                                                                                                                                                                                   | なし                                                                                                                                                                                                                                                                                                                                                                                                                                          |

補足（書き込み系 action の revalidate 方針）: `createEventAction` /
`deleteEventAction` のみ成功時に `redirect()` する。他の catalog 系 action
は同一画面に留まり、`revalidatePath` で `/catalog`, `/catalog/events/[id]`,
`/catalog/events/[id]/edit`, `/calendar`, `/catalog/invitations`, `/mypage`
のうち影響する経路だけを個別指定する。schedule 系は成功時に必ず `/calendar`
へ redirect する（詳細作成/編集/共有解除いずれも「戻ってカレンダーを見る」
導線に収束）。

## 2. 画面ごとの UI state

全画面共通のポリシー: **auth failure / read failure（unavailable）と
「0 件」は必ず別表示。** RLS 等による silent failure を empty UI に
誤変換しない（`StatePanel` の `error`/`unavailable` と `empty` の 3-variant
はこの区別のためにある）。破壊的操作（hard delete）のみ確認 Sheet を要求し、
可逆操作（cancel/uncancel、招待の accept/decline 等）は確認なしの即時実行。

### ホーム（`/`）

- 「申し込み期限」「直近の予定」の 2 ブロックは**完全に独立**した data
  fetch/表示状態を持つ。各ブロックは `unavailable`（読込失敗）/`empty`
  （0件）/`populated` の3状態。
- 両ブロックが `empty` の場合のみ、1つの統合空表示にまとめる
  （「期限が近い申し込みも、直近の予定もありません」）。`unavailable` は
  この統合に絶対に含めない（失敗を空表示に偽装しない）。
- ページ全体の認証/読込失敗は `unauthenticated`（「ログインが必要です」）
  と `failure`（「ホームを読み込めませんでした」）を区別。
- 操作: 「申し込み期限」カードは Event 詳細（対象 occurrence が未来なら
  その回、無ければ event 全体）へのリンク。「すべて見る›」で `/tickets`
  へ。「直近の予定」の各行は occurrence 詳細 or `/schedule/[id]` へ。
  すべて通常ナビゲーションで、状態遷移や楽観的更新はない。
- バリデーション: 入力フォームなし。

### カレンダー（`/calendar`）

- loading: `CalendarSkeleton`（URL の `date`/`month` から表示予定月を
  先読みし、本物と同じ形のグリッド骨組みを表示。月が特定できない場合の
  み plain な `LoadingIndicator`）。
- 認証/読込失敗はページ全体を単一の error パネルに置換（ホームほど
  ブロック単位に細分化されていない）。
- 月ランディング（`selectedDate === null`）: 当月 agenda が 0 件なら
  empty パネル、非0件なら日付グループ化された agenda。
- 選択日リスト（`selectedDate !== null`）: 0件なら「この日の予定はまだ
  ありません」＋**primary の追加導線**（`LinkButton`）。非0件なら各行＋
  末尾に常設の「＋ 予定を追加」行。
- 祝日データの公表範囲外の月は、色に依存しない注記（`role="note"`）を
  月カレンダー内に表示（該当日を通常の非祝日と誤認させない）。
- 中止（cancellation）状態の occurrence には「中止」バッジを併記。
- ナビゲーションは全てリンク遷移（URL の `month`/`date` パラメータ切替）
  であり、クライアント側 state は持たない。入力フォームなし。

### イベントカタログ一覧（`/catalog`）

- 空状態は2種類を区別: 生データ0件（`isEmptyRange`、フィルタ以前）→
  「この月に登録されているイベントはありません」。フィルタ適用後0件→
  「条件に合うイベントがありません」＋フィルタ解除ボタン。
- 読込失敗時は `CatalogReloadButton`（`router.refresh()`）付き error
  パネルを表示し、このケースでは filter UI 自体も含めマウントしない
  （「エラーが他すべてをブロックする」形）。
- フィルタ機能自体が利用不能（`filterData.ok===false`）な場合は
  「絞り込みを利用できません」パネルを出しつつ、一覧本体は表示を続ける
  （部分劣化）。
- 操作: フィルタアイコン→`FilterSheet`を開く。Sheet 内は
  「applied」（確定済み）とは別に「draft」（編集中）を持ち、確定操作を
  押した時だけ applied を更新し `localStorage` へ永続化。クリアは
  「この条件で絞り込む」ボタン以外に、一覧側の「条件を解除する」導線
  からも即時リセットできる。フィルタはすべて client-local 計算で、
  サーバ再取得は発生しない（楽観的更新の概念自体がない）。
- バリデーション: フィルタは選択式のみでバリデーションエラーの概念なし。

### イベント詳細（`/catalog/events/[eventId]`）

- 空状態: 指定 event が存在しない→「指定された公演が見つかりません」。
- error: event 読込失敗→専用パネル。participation の個別読込失敗は
  event 本体とは別枠で表示（event は表示継続）。
- 権限: 編集リンクは owner にのみ**表示自体を出す**（非 owner には
  拒否メッセージではなく単純に非表示）。
- 操作: occurrence 行の「変更」→`ParticipationSheet`。選択肢クリックで
  即座に保存・即座に close（`attending`/`considering`/`withdraw`）、
  楽観的更新はなくサーバ action 完了後の `revalidatePath` に依存
  （選択中は行が一時 disable）。「招待」ボタンは自分が `attending` かつ
  中止されていない occurrence にのみ表示、`InviteSheet` で email 送信、
  成功時 sheet が自動 close。
- バリデーション: ParticipationSheet は選択式でバリデーション概念なし。
  InviteSheet はサーバ側 email パース失敗時にフィールド直下へエラー表示。

### Event 作成（`/catalog/events/new`）

- 権限なし: designated creator チェック失敗時はフォーム自体を描画せず
  permission-denied パネルのみ表示。
- loading: 送信中はボタンが「作成中…」に切替＋フィールド disable。
- バリデーション: クライアント側は HTML5 `required` のみ。実バリデーション
  はサーバ側（イベント基本情報、Event range の順序整合、初回 occurrence
  の時刻整合）で行われ、`fieldErrors` が各フィールド直下に表示される。
  occurrence の開始日時重複はサーバ側で個別フィールドエラーへマッピング。
  全体エラーはフォーム先頭の `StatePanel`。成功時のみ event 詳細へ
  redirect（このフォームだけが redirect する create 系画面）。

### Event 編集（`/catalog/events/[eventId]/edit`）

- 権限なし: owner 以外は permission-denied パネルのみ（フォーム非表示）。
- 詳細編集/期間編集: 成功時は画面に留まり `WriteNotice`（`aria-live`
  live region）で通知。期間編集は Sheet 内フォームで、成功時に自動 close。
- occurrence 追加/更新: Sheet 内フォーム。追加成功後はフィールドを
  クリアして次の追加に備える。更新成功後は値を保持したまま sheet を close。
- 中止/解除: 同一コンポーネントが state に応じて cancel/uncancel を
  出し分けるトグル。確認ダイアログなし（可逆操作のため）。
- 削除（Event/Occurrence）: 確認 Sheet 必須（`showCloseButton=false`の
  Sheet に確認文言）。Event 削除成功時は `/catalog` へ redirect。
  Occurrence 削除成功時は同一画面に留まる。削除拒否（downstream data
  存在等）は feedback パネルで理由を表示。
- バリデーション: occurrence 時刻は Event range 内包チェックと
  doors≦starts≦ends の順序チェックをサーバ側で行い、フィールド単位で
  エラー表示。

### Invitation 一覧（`/catalog/invitations`）

- 空状態: pending invitation が0件（解決済みは行として存在しない
  pending-only モデル）→「招待はありません」。
- error: invitation 自体の読込失敗と、event/occurrence context の読込
  失敗（invitation は表示しつつ「（イベント情報を読み込めませんでした）」
  にフォールバック）を区別。
- 操作（楽観的更新あり）:
  - 「参加する」→即 `busy` phase→action 実行→成功でカードを
    client-local state から即時除去＋`router.refresh()`（サーバトリガーが
    同一 occurrence への他の pending invitation も自動解決するため）。
  - 「参加しない」→即座に `declining` phase へ（8秒間のクライアント
    ローカルな Undo 可能状態、まだサーバ呼び出しはしない）。8秒経過
    または画面離脱（unmount）で確定。「取り消す」で `pending` に戻す。
  - 効果的に中止済み（Event/Occurrence 側の cancellation）の招待は
    「閉じる」のみ（Undo なしの decline 相当）。
  - 「未回答 {n}件」の件数表示は declining 中のカードを除外した
    client-local state でリアルタイム更新。
- バリデーションの概念なし（選択操作のみ）。

### 予定作成（`/schedule/new`）

- 空状態: 該当なし（読み取りなしの新規作成フォームのみ）。
- loading: `page.tsx` と同一の見出し/BackLink を Client Component 側で
  再現してレイアウトシフトを防ぐ。
- 操作: フォーム送信（`useActionState`）→成功時 `/calendar` へ redirect。
  失敗時は入力値と fieldErrors を保持して再描画。
- バリデーション: 件名必須、temporalMode 必須、all-day なら開始日必須＋
  終了日≧開始日、time-bounded なら開始日時必須＋終了日時≧開始日時。
  すべてサーバ側パースで判定し、フィールド単位でエラー表示。

### 予定詳細（`/schedule/[entryId]`）

- 空状態: 存在しない/非公開は同一の empty 扱い（RLS が区別不能にして
  いるため意図的に一体化）。
- error: 読込失敗、認証状態確認失敗（owner 判定不能）、非owner側の
  自分の share 行取得失敗、owner側の recipient 一覧取得失敗をそれぞれ
  専用メッセージで区別。
- 権限: owner 専用セクション（編集リンク、共有管理、削除）は非owner に
  一切レンダリングされない（拒否表示ではなく非表示）。
- 空状態（共有先0件）: owner視点で「まだ誰とも共有していません」。
- 操作: owner の「+ 追加」→`ShareAddSheet`、成功で自動 close。owner の
  recipient「解除」は確認なしの即時実行。owner の「削除」は確認 Sheet
  必須、成功で `/calendar` へ redirect。非owner の「共有から外れる」は
  確認なしの即時実行、成功で `/calendar` へ redirect。
- バリデーション: 共有追加の email は HTML `type="email" required` のみ
  クライアント側。実際の存在確認は RPC 側で行われ、未登録等は
  フィールドエラーとして表示。

### 予定編集（`/schedule/[entryId]/edit`）

- 空状態/error は詳細画面と同じ区分。
- 権限なし: owner以外が直接 URL へ到達した場合、明示的な permission-denied
  パネルを表示（フォーム自体は描画しない）。
- バリデーションルールは作成フォームと共通。

### チケット一覧（`/tickets`）

- 空状態: 表示対象0件→「現在表示できる抽選・販売スケジュールはありません」。
- error: 未認証は「ログインが必要です」、それ以外は一般失敗文言。
- バッジ優先順位（重要な仕様）: ①中止 ②受付終了（履歴保持のpost-final）
  ③申し込み済み ④申し込む予定 ⑤バッジなし、の順で1つだけ表示。
- planning state 変更（Opportunity ごとに1行のコントロール）:
  - 未登録→「申し込む予定にする」のみ
  - `planned`→「申し込み済みにする」+「登録を解除」
  - `applied`→「申し込む予定に戻す」+「登録を解除」
  - 確認ダイアログなしの即時送信。成功時 `WriteNotice` で通知。
  - post-final（受付終了確定後）行はコントロール自体を非表示。
- バリデーション: 入力フィールドなし（ボタン操作のみ）。

### マイページ（`/mypage`）

- アカウント情報: email 取得失敗時は識別情報行を出さずサインアウト
  ボタンのみ（明示エラー表示はなし）。
- Passkey: 0件で「登録済みのPasskeyはありません。」。登録操作は
  client-only の WebAuthn ceremony（`navigator.credentials.create()`）、
  失敗時はエラー種別分類→パネル表示、成功時 `router.refresh()`。削除は
  行内即時ボタン、確認ダイアログなし（低リスク・再登録可能なため意図的
  に省略）。未サインインでは Passkey セクション自体を出さない。
- 予定/イベントセクション: 「招待一覧」行は常時表示（0件でも消えない）、
  pending件数>0のときのみバッジ。「イベントを追加」行は
  `canCreateEvent`（fail-closed）が true のときのみ表示（無効化ではなく
  非表示）。

### サインイン（`/sign-in`）

- 初期表示: Passkey ボタン＋区切り線「または」＋Magic Link フォーム
  （常に両方併記、Passkey未登録者への fallback を欠かさない）。
- 送信後（`requested=1`）: フォームを隠し、アカウント存在の有無を一切
  示唆しない中立文言のみ表示（enumeration 対策で常に同一メッセージ）。
- バリデーションエラー: `missing_email`（メール欄空でのサブミット）、
  `link_expired`（`/auth/confirm`でのOTP検証失敗から遷移）。それ以外の
  `error` 値は無視されパネルは出ない（未知キーへの誤反応を防ぐ実装）。
- Passkeyボタン: 押下で即座に「サインイン中…」表示＋disable。成功で
  `/` へ push+refresh。失敗はエラー種別分類→パネル表示＋Magic Linkへの
  フォールバック文言。

## 3. UI primitive の semantic API

現行は CSS Modules + 独自 primitive。v2 は shadcn/ui（Radix base）+
Base UI + Tailwind v4 `@theme` へ置き換える前提。「要自作」はプロダクト
固有ロジックが強く汎用ライブラリに直接の対応物がないもの。

| Component                    | 役割                                                                                                           | Props と意味（semantic）                                                                                                                                                                                                         | v2 対応候補                                                                                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AppShell**                 | 全画面共通シェル（AppBar+bounded content column+PrimaryNav）                                                   | `showPrimaryNav`（未認証面で nav を隠す）、`myPageHref`/`myPageInitial`（AppBarへ素通し）。純粋 presentational（Supabase依存なし）                                                                                               | 要自作（プロダクト構造そのもの）                                                                                                                                                       |
| **AppBar**                   | 48px 固定ヘッダー（通知ベル／ロゴタイプ／My Pageアバター）                                                     | `showActions`（未認証面で両affordance非表示）、`hasUnreadNotifications`（表示専用、データ導出はしない）、`onNotificationsPress`、`myPageHref`/`myPageInitial`                                                                    | 要自作。内部ボタンは shadcn `Button`(icon) で代替可                                                                                                                                    |
| **PrimaryNav**               | 4項目 bottom nav（ホーム/イベント/チケット/カレンダー）                                                        | props なし（`usePathname`で自己判定）。現在地は色＋非色的手がかり（太字/バー）の両方で表現                                                                                                                                       | 要自作（固定4項目・ドメイン固有IA）。Base UI `Tabs`のnavigation版として組み替え可                                                                                                      |
| **PageHeading**              | 各画面唯一の `<h1>`                                                                                            | `children`, `className`                                                                                                                                                                                                          | 要自作（単純だが typography policy の体現）                                                                                                                                            |
| **BackLink**                 | 文脈的な「戻る」リンク（PrimaryNavとは別概念、戻り先は呼び出し元が決める）                                     | `href`, `children`                                                                                                                                                                                                               | 要自作。Next `Link` + shadcn linkスタイルで組み替え可                                                                                                                                  |
| **Button**                   | 6-variant ボタン                                                                                               | `variant`: `primary`=主要アクション、`secondary`=標準/可逆操作、`small`=secondaryと同chromeでコンパクト、`quiet`=最低強調のテキストのみ操作、`icon`=アイコン専用40×40、`danger`=不可逆/破壊的操作専用（secondaryとは明確に分離） | shadcn `Button` が直接候補。ただし現行はvariantに「用途」と「サイズ」が混在（`secondary`/`small`は同一chromeでサイズのみ違う）。v2では `variant`（意味）と`size`の2軸分離を推奨（5節） |
| **LinkButton**               | Button と同じ見た目の実リンク                                                                                  | `ButtonVariant`共通＋`showPending`（既定true、遷移中フィードバックのON/OFF）                                                                                                                                                     | shadcn `Button asChild`+Next `Link`。`LinkPending`相当は要自作                                                                                                                         |
| **LinkPending**              | 特定`<Link>`直下でのみ動作する「タップ受理」フィードバック（`useLinkStatus`使用）                              | `label`（既定「移動中」）                                                                                                                                                                                                        | 要自作（Next.js固有機構）                                                                                                                                                              |
| **LoadingIndicator**         | スピナー                                                                                                       | `label`（既定「読み込み中」）、`size`: `sm`=インライン用／`md`=ページ/セクション単独用                                                                                                                                           | shadcn直接なし。lucide `Loader2`+ラップで代替可。`role="status"`パターンは維持                                                                                                         |
| **CalendarSkeleton**         | カレンダー系 `loading.tsx` 用スケルトン。URLから表示予定月を先読みして本物と同形のグリッドを出す               | `sectionLabel`, `fallbackLabel`                                                                                                                                                                                                  | 要自作（プロダクト固有）。骨組み自体はshadcn `Skeleton`で代替可                                                                                                                        |
| **Badge**                    | 5種の shape-based variant（色だけで意味を分けない）                                                            | `variant`: `outline`=分類（組/一般発売等）、`subtle`=進行中・未完了の意思、`done`=ユーザーが完了させた行動（トーン＋component側チェックマークで区別）、`deadline`=まだ間に合う期限、`terminal`=終了・行動不可                    | shadcn `Badge` を基盤に薄いラッパーで5-variant semantics を再実装                                                                                                                      |
| **StatePanel**               | empty/error/unavailable の共通状態提示。3状態は同一構造（title→description→action）を共有し色/iconで区別しない | `variant`: `empty`/`error`/`unavailable`、`title`, `description`, `action`。errorのみ`role="alert"`                                                                                                                              | shadcn直接なし。`Alert`に近いが3-variant構造ロジックは要自作                                                                                                                           |
| **Sheet**                    | ネイティブ`<dialog>`ベースの bottom sheet                                                                      | `open`/`onOpenChange`, `title`, `children`, `bodyClassName`, `footer`（スクロール外の固定アクション行）, `showCloseButton`                                                                                                       | shadcn `Sheet`（Radix Dialog base）が直接候補。footer/body分離のAPIは再設計要                                                                                                          |
| **TextInput** / **TextArea** | ラベル付き入力（ペア設計）                                                                                     | `label`(必須), `helperText`, `error`（フィールド直下に`role="alert"`表示、`aria-invalid`/`aria-describedby`自動配線）。TextInputのみ`labelClassName`（エスケープハッチ）                                                         | shadcn `Input`/`Textarea` + `Form`（RHF連携）。現行はuncontrolled前提のHTML属性パススルー設計で、RHF前提ではない点が移行時の判断点                                                     |
| **TriStateCheckbox**         | checked/unchecked/indeterminate の3状態                                                                        | `state`, `label`, `onChange`（indeterminateへは戻さない）, `disabled`。親子連動ロジックは持たず外部からcontrolled                                                                                                                | shadcn `Checkbox`（Radix base、indeterminate対応）が直接候補。ドメインの`TriState`遷移ロジックはアプリ側に残す                                                                         |
| **FormSection**              | フォームのセクション/フィールドグループ化（非ボックス）                                                        | `heading`, `as`: `section`(見出し+内容)／`fieldset`(`<fieldset>+<legend>`の真のa11yグルーピング、共にボーダーなし), `requirement`: `required`/`optional`, `description`                                                          | shadcn `Form`はRHF統合前提で設計思想が異なる。要自作 or `FormItem`/`FormLabel`ベースに組み替え                                                                                         |
| **RequirementIndicator**     | 必須フィールドマーカー（赤い`*`）                                                                              | `required`（false時は何も描画しない＝「*」の不在=任意）。`aria-hidden`（実requirednessはネイティブ`required`属性が担う）                                                                                                         | 要自作（極小）。shadcn Formの`FormLabel`内に組み込み可                                                                                                                                 |
| **WriteNotice**              | 書き込み完了フィードバック用の安定した`aria-live="polite"`live region                                          | `notice`（表示文言、nullで空）, `attempt`（Reactキーとして使い同一文言でも再アナウンスさせる識別子）                                                                                                                             | 要自作。`attempt`キー技法はReact特有の再アナウンス回避策。shadcn `Sonner`/toastで代替する場合はretry-announce要件を再設計する必要                                                      |
| **DayRoleText**              | 日付の曜日/祝日ロールに応じた色付けの単一権威（日曜/祝日=danger、土曜=accent、平日=呼び出し元色を継承）        | `role`, `as`(既定`span`、h2/h3/p等を指定可), `aria-label`                                                                                                                                                                        | 要自作（ドメイン固有の色付けコンポーネント）                                                                                                                                           |

### 共有 CSS クラス（コンポーネント化されていない契約）

| クラス                               | 役割                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `tapTarget.module.css` (`.expand44`) | 可視fillが44px未満でもタップ領域を44px確保（WCAG AAの24pxより厳格な自社ポリシー）。Button/BackLinkが利用                     |
| `visuallyHidden.module.css`          | 視覚的に隠しつつDOM/フォーカス/live regionを維持（`display:none`は使わない）                                                 |
| `pendingLabel.module.css`            | 送信中ラベル切替時にボタン幅を変えない grid 重ね合わせ技法（「保存」→「保存中…」）                                           |
| `sectionHeading.module.css`          | セクション見出し下の太罫（2px、hairlineの1pxより強い境界）                                                                   |
| `row.module.css`                     | 可変テキスト+末尾アクション/メタデータの水平行の基礎契約                                                                     |
| `listRow.module.css`                 | 一覧行の共有語彙（見出し/リスト/行/本文/シェブロン/時刻/タイトル/会場/バッジ行）。カード面ではなく下線区切り                 |
| `monthCalendarGrid.module.css`       | 月間カレンダーグリッドの共有presentation（ヘッダー/月ナビ/曜日/週グリッド/日付セル/祝日通知/今日・選択中・週末祝日の色分け） |
| `actionRow.module.css` (`.equal`)    | 同役割アクション群を等幅で横並びさせる行（cancel/delete ペア等）                                                             |
| `fixedSubmitBar.module.css`          | フォーム下部固定送信バー（PrimaryNav上へのオフセット、safe-area対応、640px幅コンテンツ、末尾余白確保が一体契約）             |

## 4. Design token

現行は primitive→semantic の2層構成（`src/ui/tokens.css`）。component/
feature-local コードは semantic token のみ参照する規約（例外2件を5節で
指摘）。v2 は Tailwind v4 `@theme` へ semantic 層をそのまま移す想定。

### 色

| semantic token                                   | 生値                       | 用途                                    | 実際の使われ方                                                                                                                                                |
| ------------------------------------------------ | -------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--color-canvas`/`--color-bg`                    | `#eef0f1`                  | ページ背景                              | body背景、Sheet/AppBarのcanvas面                                                                                                                              |
| `--color-surface`                                | `#ffffff`                  | 白カード面                              | PrimaryNav背景、checkbox面                                                                                                                                    |
| `--color-surface-subtle`                         | `#dfe4e7`                  | 淡いfill                                | hover背景全般＋notice/skeletonの静的背景（hoverと常時subtleの2用途が同一token）                                                                               |
| `--color-surface-active`                         | `#dde1e4`                  | pressed面                               | 押下状態の背景全般                                                                                                                                            |
| `--color-border`                                 | `#d7dcde`                  | 汎用罫線                                | container間・行間の区切り線（最頻出）                                                                                                                         |
| `--color-control-border`                         | `#7f878b`                  | フォームコントロール境界                | input/button/badge輪郭専用（コンテナ罫線とは意図的に分離、WCAG 1.4.11の3:1を確保）                                                                            |
| `--color-text`                                   | `#1f2426`                  | 本文色                                  | 主要テキスト全般                                                                                                                                              |
| `--color-text-secondary`                         | `#5c6467`                  | 副次テキスト                            | 日時・メタ情報・helper text                                                                                                                                   |
| `--color-text-tertiary`                          | `#454b4e`                  | Badge専用第3階層                        | Badgeのoutline/subtle文字のみ（汎用bodyには不使用）                                                                                                           |
| `--color-text-disabled`                          | `#9aa2a9`                  | disabled文字                            | 未確認（module.css上に実使用箇所が見当たらない）                                                                                                              |
| `--color-icon-affordance`                        | `#737b82`                  | 非テキストicon（chevron等）             | listRowのchevronアイコン。4.30:1でnon-text基準のみクリアし、可読テキストへの流用は不可                                                                        |
| `--color-accent`                                 | `#2f4a7a`（藍）            | primary操作色                           | Button primary、リンク、選択チップ、checkbox checked、土曜文字色、フォーカスリング                                                                            |
| `--color-accent-hover`/`-active`                 | accent-700/800             | hover/press                             | Button primaryのみ                                                                                                                                            |
| `--color-accent-foreground`                      | `#ffffff`                  | accent面上の文字                        | Button primary文字、checkグリフ                                                                                                                               |
| `--color-accent-subtle`/`-subtle-foreground`     | accent-100/700             | 低強調accent tint                       | 未確認（現状の実使用箇所が見当たらない）                                                                                                                      |
| `--color-success`/`--color-warning`              | `#22684a`/`#7a5417`        | ステータス色                            | 値は残るが現状UIから参照なし（Issue #137でBadgeから撤去済み）                                                                                                 |
| `--color-danger`                                 | `#a13b2e`（赤）            | destructive操作／まだ間に合う期限／休日 | Button danger、TextInputエラー、RequirementIndicator、Badge`deadline`、日曜・祝日文字色。**destructive actionとcalendarマーカーの両方に使われる**唯一の色役割 |
| `--color-danger-on`                              | `#f7f5f1`                  | danger塗り上の文字                      | Badge `deadline` の文字色のみ                                                                                                                                 |
| `--color-info`                                   | accent-600                 | 情報色                                  | 未確認（実使用箇所なし）                                                                                                                                      |
| `--color-terminal`/`-on`                         | `#2b3033`/`#eef0f1`        | 終了状態（墨）の塗り/文字               | Badge `terminal` のみ                                                                                                                                         |
| `--color-band-fill`/`-text`                      | `#dbe2ee`/`#24365c`        | 複数日bandの塗り/文字                   | Badge `done`、カレンダー Event-range band（blocking）                                                                                                         |
| `--color-band-outline`                           | `#6a7d9e`                  | non-blocking band輪郭                   | My Calendarのnon-blocking多日程bandのみ（共有catalogカレンダーには輪郭variant自体が無い）                                                                     |
| `--color-calendar-saturday`/`-sunday`/`-holiday` | accent/danger のエイリアス | 曜日・祝日ロール色                      | 月カレンダー曜日ヘッダ、`DayRoleText`のロールマッピング                                                                                                       |

primitive層はneutral 0-900（11段階）、accent 50-900（10段階）、
status-success/warning/danger-500（各1段階）の3スケール。色の役割は
「藍＝操作できる場所と現在地／赤＝まだ間に合う期限と休日／墨＝もう
行動できないもの」の3つに整理する方向がコメントに明記されている
（success/warning/infoは値のみ残置、UIからの参照は撤去済み）。

### スペーシング（4px刻み、2箇所のみ意図的なoff-grid）

| token                | 実値             | 用途                                            |
| -------------------- | ---------------- | ----------------------------------------------- |
| `--space-2xs`        | 2px              | hairline gap（ラベル-値間）                     |
| `--space-xs`         | 4px              | icon-text間、Button内gap                        |
| `--space-sm`         | 8px              | list行/カード内gapで最頻出                      |
| `--space-compact`    | 12px             | notice/inline panel padding                     |
| `--space-card-block` | 14px（off-grid） | カード上下padding専用                           |
| `--space-md`         | 16px             | 最も汎用的な標準spacing                         |
| `--space-section`    | 20px             | AppShell content columnのセクション間リズム専用 |
| `--space-lg`         | 24px             | 中〜大spacing                                   |
| `--space-xl`         | 32px             | ページレベルgap                                 |

primitive `--space-scale-7`(48px) は対応するsemantic aliasが無く、
現状どこからも参照されていない orphan。

### Radius

| token                 | 実値  | 用途                                                              |
| --------------------- | ----- | ----------------------------------------------------------------- |
| `--radius-control`    | 4px   | 標準コントロール（Button本体、TextInput等）                       |
| `--radius-control-sm` | 4px   | コンパクトコントロール（Button small/quiet/icon、日セル、チップ） |
| `--radius-band`       | 2px   | calendar Event-range bandのみ                                     |
| `--radius-badge`      | 2px   | Badge、checkbox箱                                                 |
| `--radius-pill`       | 999px | PrimaryNavインジケータ、今日/押下日circle、avatar、chip           |
| `--radius-sheet`      | 4px   | bottom sheetの上端角のみ                                          |

`--radius-control` と `--radius-control-sm` は現在どちらも同じ実値
（4px）に収束済み（Design Wave 2で意図的に統合）。primitive
`--radius-scale-xs`(8px)/`-md`(10px)/`-lg`(16px) は現状どこからも
参照されていない orphan。

### タイポグラフィ

| token                                             | 実値                                             | 用途                                                    |
| ------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| `--font-size-heading`                             | 20px                                             | ページ/セクション見出し                                 |
| `--font-size-caption`                             | 11px                                             | 曜日ヘッダ、calendar overflow、補足文言                 |
| `--font-size-label`                               | 12px                                             | 短い太字ラベル（AppBarチップ、フォームlabel）           |
| `--font-size-body-sm`                             | 14px                                             | 副次本文（最頻出サイズ）                                |
| `--font-size-body`                                | 16px                                             | 標準本文                                                |
| `--font-size-title`                               | 16px（body同値、weight/line-heightのみで差別化） | カード/list-item title（listRow, Sheet title等）        |
| `--font-weight-regular`/`-medium`/`-semibold`     | 400/500/600                                      | 階層表現3段階                                           |
| `--line-height-base`/`-tight`/`-heading`/`-title` | 1.5/1.25/1.3/1.35                                | 本文/コンパクトcontrol/見出し/titleロールでそれぞれ専用 |

フォントファミリーは system-ui系＋日本語フォールバック
（`Hiragino Kaku Gothic ProN`, `Meiryo` 等）。

### その他

| token                          | 実値      | 用途                                                                   |
| ------------------------------ | --------- | ---------------------------------------------------------------------- |
| `--focus-ring-width`/`-offset` | 2px/2px   | フォーカスリング（常に`--color-focus-ring`とセット）                   |
| `--opacity-disabled`           | 0.6       | disabled制御の唯一の値権威（専用テストが5サイトを固定監視）            |
| `--size-checkbox-box`/`-glyph` | 18px/12px | チェックボックス箱/グリフ寸法（component API自体は共有せず値のみ共有） |

**存在しないカテゴリ（確認結果）**: shadow/elevation の専用tokenは
存在しない（`box-shadow`は4箇所のみで色tokenを枠線的に再利用している
だけ）。z-indexのtokenも存在せず生の整数値（0〜2）がハードコード。
breakpoint/`@media`によるレスポンシブ切替も、`prefers-reduced-motion`
以外は存在しない（意図的にモバイル単一レイアウト方針）。

## 5. v2 で意図的に変えるべき点（提案・断定しない）

- **Button の variant にサイズと意味が混在している。** `secondary` と
  `small` は同一chrome（transparent+control-border）でサイズだけが違い、
  `quiet`/`icon`/`danger` も「強調度」と「形状」が1つのenumに同居して
  いる。shadcn の `variant`（意味: default/outline/ghost/destructive
  等）と `size`（sm/default/icon）の2軸分離の方が、破壊的操作か否か・
  強調度・サイズを独立に組み合わせられて堅牢。v2では2軸化を検討する
  価値がある。
- **`--color-primary` という未定義token参照が1箇所ある**
  （`src/app/catalog/_components/EventWriteForm.module.css`）。
  `tokens.css` にこの名前の定義は無く、`--color-accent` の書き間違い
  または命名変更の残骸と見られる（実害は不明、意図は未確認）。v2の
  token移行時に踏襲しないよう注意。
- **primitive token の直接参照が1箇所だけ規約を破っている**
  （`monthCalendarGrid.module.css` の `.dayNumber.today` が
  `--color-neutral-300` を直接参照）。「component は semantic token
  のみ参照する」という自社ルールの唯一の例外。v2のTailwind `@theme`
  移行時は example として残さない。
- **未使用（orphan）token が複数存在する**: `--space-scale-7`(48px)、
  `--radius-scale-xs/md/lg`、`--color-success`/`-warning`/`-info`/
  `-accent-subtle`系。v2のtoken設計時に本当に必要か棚卸しする候補。
  `--radius-control` と `--radius-control-sm` も実値が収束済みなので
  統合を検討してよい。
- **エラー表示の粒度が画面によって異なる。** ホームは「申し込み期限」
  「直近の予定」を完全独立した read として扱い、片方が落ちても他方は
  表示され続けるが、カレンダーは複数の read 失敗をまとめて単一の
  汎用エラーパネルに縮退させる（どちらの read が落ちたか画面上では
  区別できない）。同じ「部分劣化」思想を持つなら、v2では画面間で
  この粒度を揃えるか、意図的な違いなら明文化した方がよい。
- **セカンダリ destination への導線が発見しにくい。** `/schedule` と
  `/mypage` は PrimaryNav（ホーム/イベント/チケット/カレンダー の4項目）
  に存在せず、カレンダー選択日の「予定を追加」やAppBarのアバターなど
  文脈的な入口からしか到達できない。意図的な設計（`PrimaryNav.tsx`の
  コメントに明記）だが、個人予定管理の重要度次第では v2 で IA を
  再検討する価値がある。
- **通知ベルが配線されていない。** AppBar の左側 affordance は
  Issue #141 の時点から「未配線」のまま UI 上に存在し続けている
  （`onNotificationsPress` 未設定時は `aria-disabled` の非活性ボタン）。
  v2 で実装するか、実装予定がないなら UI から一旦外すか、方針を決めた
  方がよい。
- **Invitation の decline は client-side timer 前提の楽観的Undo。**
  8秒のタイマーまたはコンポーネントの unmount（画面遷移）で確定する
  実装で、ブラウザタブを閉じる／リロードするなど unmount が発火しない
  離脱経路では、decline の確定（サーバ action 実行）が行われないまま
  pending 状態が残り得る（未確認: 実際にそのケースでどう振る舞うかは
  検証していない）。v2では server 主導のタイムアウト、またはページ
  離脱時に何が起きるかを明示的に仕様化することを推奨。
- **`loading.tsx` の一部が Client Component 化してURLを再解決している。**
  `catalog/events/new`, `schedule/new`, `schedule/[entryId]`,
  `schedule/[entryId]/edit` 等の `loading.tsx` は、Next.js が
  `loading.tsx` に `params`/`searchParams` を渡さない制約への対処として
  `useSearchParams`/`useParams` で戻り先を再構築している。これは
  Next.js の実装都合であり、v2で採用するルーティング機構が同じ制約を
  持たない場合は素直に消せる実装詳細。ただし「pending中も見出し/戻り先
  が変わらない」という UX 意図自体は維持する価値がある。
  なおこの `loading.tsx` は「データ依存の見出しは先取りして表示しない」
  （権限判定前の`SchedulePageHeading`を出さない等）という原則も併せ持つ。
  v2で別の実装方式を選ぶ場合も、この原則自体は引き継ぐ価値がある。
- **各ルートが「今日」を個別に再実装している。** `_lib/today.ts` /
  `_lib/now.ts` が home/calendar/catalog/tickets/mypage で個別に存在する
  （`src/domain` を pure/clock-free に保つための意図的選択）。UI/UX
  上の不整合ではないが、v2でクロック境界の置き場所を再検討する余地は
  ある。
