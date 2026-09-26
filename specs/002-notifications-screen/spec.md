# Feature Specification: Notifications画面

**Feature Branch**: `002-notifications-screen`

**Created**: 2026-09-17

**Status**: Current behavior contract

**Input**: GitHub Issue #513（Issue #231の最終product contractに基づく）。

## 権限境界

この文書はIssue #513で実装されたNotifications topicの、範囲を限定した現行product behavior authorityです。
Issue #513は引き続きcanonicalな変更意図です。architecture文書、database migration、test、CI、post-PR procedureは
それぞれの責務を保持し、この文書では重複して記述しません。

## User Scenarios & Testing _(mandatory)_

### User Story 1 - 受信したnoticeを確認する (Priority: P1)

authenticated userとして、お知らせ画面を開き、受信したinvitation noticeを新しい順に確認したい。他の利用者のprivate
informationを公開せず、重要な変更を把握できるようにするためです。

**Why this priority**: この画面は、永続化されたNotification inboxをアプリ内で利用者に初めて提示するsurfaceだからです。

**Independent Test**: recipient-owned inboxにデータを用意し、`/notifications`へ移動して、heading、件数に上限のある新しい順のrow、
invitationのexact copy、timestamp、非破壊的な未読表示の区別を確認します。

**Acceptance Scenarios**:

1. **Given** authenticated recipient宛てのinvitation noticeが永続化されている状態で、**when** 利用者が`/notifications`を開くと、
   **then** pageには`お知らせ`と、`created_at`降順、同値の場合は`id`を決定的なtie-breakerとする現在の上限付きwindowが表示される。
2. **Given** 永続化されたinvitation noticeが上限付きwindowを複数分含む状態で、**when** 利用者がolderまたはprevious windowへのnavigationを
   有効にすると、**then** noticeを飛ばしたり重複させたりせず、次の上限付きwindowに到達できる。navigationは上限付きhigh-water snapshotを
   保持し、後から届くnoticeによって順序がずれない。
3. **Given** `invitation_received` noticeがある状態で、**when** 表示すると、**then** titleは正確に`参加への招待が届いています`であり、
   Event、Occurrence、inviter、Participationの詳細を複製せずNotification timestampを表示する。
4. **Given** read timestampのないnoticeがある状態で、**when** 表示すると、**then** 目視できる非破壊的な未読cueとaccessibility上の
   `未読`表示がある。既読noticeにはそのcueを使用しない。
5. **Given** 別のrecipientに属するnoticeがある状態で、**when** 利用者が画面を開くと、**then** それらのnoticeは表示されない。

---

### User Story 2 - 利用可能なsourceへ安全に移動する (Priority: P1)

authenticated userとして、activeなinvitation noticeから既存のInvitation surfaceへ移動したい。Invitationへの応答をsource domainの
責務として保つためです。

**Why this priority**: Notificationsは変更を提示するものであり、Invitation actionを実行する第二の場所やhistory ledgerにはならないためです。

**Independent Test**: active source rowとunavailable source rowを個別に表示し、active rowだけがkeyboardで操作可能な
`/catalog/invitations`へのnavigationを公開することを確認します。

**Acceptance Scenarios**:

1. **Given** Invitation sourceのlookupが成功しrecipientがsourceを見られる状態で、**when** 利用者がnotice navigationを有効にすると、
   **then** appは`/catalog/invitations`へ移動する。
2. **Given** source lookupは成功したがInvitationが存在しないかrecipientに見えない状態で、**when** rowを表示すると、**then** 正確に
   `この招待はすでに終了しています。`を表示し、actionもnavigationも公開しない。
3. **Given** source lookup自体が失敗した状態で、**when** pageを表示すると、**then** screenはretry案内付きのread errorを表示し、sourceが
   正常に解決されたかのようにresolved-source messageを表示しない。
4. **Given** invitation noticeがある状態で、**when** 利用者がrowを確認すると、**then** acceptまたはdecline controlは存在しない。

---

### User Story 3 - 表示済みの内容だけを既読にする (Priority: P1)

authenticated userとして、自分の画面snapshotで実際に表示されたnoticeだけを既読にし、新しく届いたnoticeは未読のままにしたい。
これにより、read stateを複数device間で正確に保ち、未表示noticeを暗黙に既読にしないようにします。

**Why this priority**: `read_at IS NULL`だけが未読状態のauthorityであり、画面はIssue #512で定められたrace-safeな上限付き遷移を
維持しなければならないためです。

**Independent Test**: 制御されたrendered snapshotを用意し、render後のread requestを観察して、そのsnapshotの正確なIDだけが送られることを
確認します。さらに、同じ処理の再実行とwrite失敗の際、itemを既読成功として扱わないことを確認します。

**Acceptance Scenarios**:

1. **Given** list readが成功した状態で、**when** 現在の上限付きwindowをrenderすると、**then** render後に既存の上限付きread operationへ
   渡されるのはrenderされたNotification IDそのものだけである。
2. **Given** rendered snapshot取得後にnoticeが届いた状態で、**when** read operationを実行すると、**then** 新しいIDは送信されない。
3. **Given** 同じsnapshotについてread operationが複数回呼び出された状態で、**when** serverが処理すると、**then** 結果は安全かつ
   idempotentなままである。
4. **Given** read operationが失敗した状態で、**when** pageが結果を受け取ると、**then** 誤って成功したかのようにunread cueを取り除かず、
   利用者に見える失敗状態はretry可能なままである。

### Edge Cases

- 0件でlist readが成功した場合は、canonicalなempty stateを使う。titleは`お知らせはありません`、descriptionは
  `新しいお知らせが届くとここに表示されます。`とする。
- list read失敗はempty stateではなくerror stateである。不明な原因には`しばらくしてから再度お試しください。`を使い、確認済みの
  network原因に限りnetwork固有の案内を使用してよい。
- source readの失敗は、source readが成功してrowがなかった場合と区別する。
- 各Notification windowは上限付きのままとし、composite keyset cursorと安定したhigh-water snapshotを使う明示的なpage navigationで
  古いwindowへ移動できる。このfeatureではload more、infinite scroll、filtering、grouping、bulk read、dismissalを追加しない。
- Loading presentationはproduction pageと一貫した`お知らせ` heading chromeを保ち、無制限なlayout shiftを避ける。

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: systemは既存のauthenticated route ownershipを使い、authenticatedな`/notifications` routeを提供しなければならない。
- **FR-002**: pageはloading presentationも含め、共有`PageHeading`を使い、headingを正確に`お知らせ`としなければならない。
- **FR-003**: pageは既存のrecipient-ownedで上限付きのNotification page boundaryを利用し、route内でNotificationを直接重複queryすることなく、
  到達可能なwindow間で新しい順を維持しなければならない。前後のnavigationでは上限付きcomposite cursorを使い、上限のないpage履歴を
  serializeするのではなく定数サイズのhigh-water snapshotを保持しなければならない。cursor timestampは永続化されたsub-millisecond精度を
  保たなければならない。
- **FR-004**: pageにはMVPの`invitation_received` title `参加への招待が届いています`、Notification timestamp、unread/read cue、source navigation
  stateだけを表示し、source domainの詳細を複製してはならない。
- **FR-005**: active invitation sourceは`/catalog/invitations`へ移動しなければならず、Notifications pageにacceptまたはdecline controlを
  表示してはならない。
- **FR-006**: 正常に解決されたが利用できないsourceには、actionもnavigationも付けず`この招待はすでに終了しています。`だけを表示しなければ
  ならない。
- **FR-007**: Notification listまたはsource-resolution readの失敗には、適切なcanonical error semanticsを表示し、emptyまたはresolved fallbackへ
  変換してはならない。
- **FR-008**: 通常のempty listには、上記の正確なtitleとdescriptionを持つ共有canonical StatePanelを使わなければならない。
- **FR-009**: unreadの唯一のauthorityはread timestampの不在でなければならない。cueは色だけに頼らず、destructive/error semanticを使わずに
  区別できなければならない。
- **FR-010**: render後、systemはrendered snapshotに含まれる正確なIDだけを既存の上限付きread actionへ送らなければならない。すべての未読row、
  未表示window、またはsnapshot取得後のrowを既読にしてはならない。
- **FR-011**: read-state writeに失敗しても、未読であることを見た目または意味上維持し、retry可能でなければならない。write成功前にUIがcanonicalな
  既読成功を示してはならない。
- **FR-012**: featureはrecipient privacyを維持し、NotificationsをInvitation history ledgerにしてはならない。
- **FR-013**: authenticated AppBar actionでは、unread stateにかかわらずbellをkeyboard-accessibleな`/notifications`へのlinkとして公開しなければ
  ならない。inboxが空の場合またはunread readに失敗した場合でもbellをdisabledにしてはならない。
- **FR-014**: authenticated `(app)` layoutは共有server clientでcanonicalなboolean unread-existence resultを読み取り、そのpresentation booleanだけを
  AppShell/AppBarへ渡さなければならない。unread readに失敗した場合はdotなしのbellを表示し、product factとしてcacheまたは永続化してはならない。
- **FR-015**: AppBar unread cueはbooleanのまま、既存の非破壊的なprimary semanticを使い、renderされたrowが既読になった後は既存の
  Notifications/read-surface revalidation contractを通じて収束しなければならない。numeric count、global store、polling、client-side unread cacheは
  このbehaviorに含まれない。

## 対象範囲の境界

現在のsurfaceには、authenticatedな`/notifications` routeとauthenticated AppBarのbell entry point、永続化されたrecipient-ownedの
`invitation_received` inbox row、正確なunread/read semantics、Notification timestamp、active Invitation sourceへのnavigation、解決済みかつ
利用不可の場合のfallback、loading、empty、read errorのbehavior、および上述のboolean unread projectionが含まれます。page navigationで古い
上限付きwindowへ到達でき、各windowは上限付きhigh-water navigation snapshotの中で独立したrendered snapshotとして扱われます。

次の項目はこのtopicの現行behaviorではありません: unread count、直接のaccept/decline、その他のNotification kind、Push、email、preference、
filter、grouping、load-more、infinite scroll、mark-all-read、dismiss/delete、Invitation history ledger。

### Key Entities _(include if feature involves data)_

- **Notification**: 表示対象となった変更を記録するrecipient-ownedの永続record。kind、source identity、creation timestamp、nullable read timestampで
  識別します。source-domain stateの複製でもInvitation historyでもありません。
- **Invitation source**: soft referenceされたpending Invitation。navigationに利用できる場合も、存在しないか不可視でgenericなresolved fallbackを
  使用する場合もあります。

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: populated、empty、loading、errorのjourneyで、screen-level checkの100%が必要なheadingとstate固有copyを表示します。
- **SC-002**: controlled rendered-snapshot testの100%で、rendered snapshot外のIDをread operationへ送信しません。
- **SC-003**: active-source journey checkの100%で、利用者はkeyboard-accessibleなnavigationで`/catalog/invitations`へ到達でき、resolved rowは
  navigation/actionを一切公開しません。
- **SC-004**: recipient-privacy checkの100%で、別recipient宛てnoticeとsource-domainのprivate detailは画面に表示されません。

## Assumptions

- 既存のauthenticated route group、Supabase client boundary、Notification list/read action、PageHeading、StatePanel、Tokyo date/time utilityが
  利用可能であり、引き続きauthorityを持ちます。
- 各Notification windowは既存の明示的な上限である50 rowに制限されます。composite-cursor page navigationでrender済みのものだけを既読にする
  semanticsを変えずに古いwindowやprevious windowに到達でき、後から届くnoticeは進行中のnavigation snapshotの順序をずらしません。
- MVPには`invitation_received`だけが含まれます。AppBar bellはauthenticated entry pointであり、unread cueは上記のとおりbooleanのみです。
- appは既存design systemを通じてmobileとdesktopの幅をサポートし、新しいdesign-system primitiveは必要ありません。
