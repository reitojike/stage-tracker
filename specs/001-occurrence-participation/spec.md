# Feature Specification: 現行Occurrence Participation behavior

**Feature Branch**: `001-occurrence-participation`

**Created**: 2026-09-15

**Status**: Current behavior contract

**Input**: GitHub Issue #487、および現行のimplementation、schema、test

## 権限境界

この文書はOccurrence Participationの現行product behavior authorityです。
GitHub Issue #487は、この初回authority cutoverの実装contractです。
Architecture文書、database migration、schema、testはそれぞれの構造上および機械的な責務を引き続き担い、
この文書では重複して記述しません。

Invitation の broader current behavior（pending list、decline、re-invite、targeting、
opacity）は [`specs/006-invitation-coordination-opacity/spec.md`](../006-invitation-coordination-opacity/spec.md)
が正本です。このSpecに残る Invitation 要件は、Participation 側から見た receive /
accept / decline / attending convergence の直接的な contract に限ります。

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Occurrenceへの参加を選ぶ (Priority: P1)

authenticated userとして、特定のOccurrenceについて関心があるか参加するかを記録し、event-levelの
Participation objectを作らずに自分の予定を表したい。

**Why this priority**: Participationは各Occurrence単位で定義され、主要なplanning interactionだからです。

**Independent Test**: あるOccurrenceにParticipationがない状態から、利用者が選択可能なstatusを選び、選択したstatusを確認し、
変更し、取り消せることを確認します。

**Acceptance Scenarios**:

1. **Given** Participationが存在しない状態で、**when** 利用者が`considering`を選ぶと、**then** その利用者のOccurrenceに
   `considering`が表示される。
2. **Given** Participationが存在しない状態で、**when** 利用者が`attending`を選ぶと、**then** その利用者のOccurrenceに
   `attending`が表示される。
3. **Given** Participationが存在する状態で、**when** 利用者がもう一方の保存可能なstatusを選ぶと、**then** statusが
   その値に変わる。
4. **Given** Participationが存在する状態で、**when** 利用者が同じstatusを選ぶと、**then** 結果はsemantic no-opとなる。
5. **Given** Participationが存在する状態で、**when** 利用者が取り消しを選ぶと、**then** Participationは存在しない状態となり、
   statusとして表示されなくなる。

---

### User Story 2 - Participationとcancellation状態を把握する (Priority: P1)

authenticated userとして、Event detail画面で自分の現在のParticipationと、データがない状態または読み取り失敗を
区別したい。またEventまたはOccurrenceがcancelledになった後も、有効な修正を可能にしたい。

**Why this priority**: cancelledされたOccurrenceで誤解を招く新たなcommitmentを作ってはならない一方、既存のcommitmentを
弱めたり取り消したりできなければならないためです。

**Independent Test**: 親EventまたはOccurrenceのどちらか一方がcancelledの場合、およびどちらもcancelledではない場合に各status遷移を試し、データの不在と
読み取り失敗を比較します。

**Acceptance Scenarios**:

1. **Given** EventまたはOccurrenceがeffectively cancelledされた状態で、**when** Participationのない利用者がいずれかの
   保存可能なstatusを選ぶと、**then** 新しいParticipationは拒否される。
2. **Given** effectively cancelledされたOccurrenceで`considering`の場合、**when** 利用者が`attending`を選ぶと、
   **then** 遷移は拒否される。
3. **Given** effectively cancelledされたOccurrenceで`attending`の場合、**when** 利用者が`considering`を選ぶと、
   **then** 遷移は引き続き可能で、成功する。
4. **Given** effectively cancelledされたOccurrenceに既存Participationがある状態で、**when** 利用者が取り消すと、
   **then** 取り消しは引き続き可能で、成功する。
5. **Given** effectively cancelledされたOccurrenceに既存Participationがある状態で、**when** 利用者が保存済みと同じstatusを
   選ぶと、**then** 操作はsemantic no-opとなり、Participation rowは変更されない。
6. **Given** effectively cancelledされたOccurrenceに既存Participationがある状態で、**when** 現行behaviorで許可されたvisibilityのみの
   更新を行うと、**then** Participation statusは変わらずvisibilityが変わる。
7. **Given** Participationの読み取りに失敗した状態で、**when** Event detailを表示すると、**then** UIはParticipationが存在しない
   ものとして扱わず、読み取り失敗を表示する。
8. **Given** EventまたはOccurrenceがcancelledされた状態で、**when** detail viewを表示すると、**then** cancelled状態を表示しつつ、
   有効なdowngradeと取り消しの操作を引き続き行える。

---

### User Story 3 - Invitationに応答し、personal calendarの状態を確認する (Priority: P2)

authenticated userとして、他の利用者のprivate stateを公開せずに、Invitationへの応答と自分のcalendar表示が同じ
Participationの意味に収束してほしい。

**Why this priority**: Invitationは参加を調整し、calendarは利用者自身のParticipation stateを確認する主要な場所だからです。

**Independent Test**: pending Invitationを受信、decline、acceptした後、Personal Schedule entryとは独立してEvent detailと
利用者のcalendarを確認します。

**Acceptance Scenarios**:

1. **Given** pending Invitationを受信した状態で、**when** 利用者がまだ応答していないと、**then** Invitationが存在することだけを
   理由にParticipationは作成されない。
2. **Given** pending Invitationと既存の`considering` Participationがある状態で、**when** 利用者がdeclineすると、**then** Invitationは
   解決され、既存の`considering` intentionは変更されない。
3. **Given** pending Invitationがある状態で、**when** 利用者がacceptすると、**then** systemは通常のParticipation interactionで
   可能なものと同じ`attending`遷移を試みる。Invitationは、その遷移がeffective cancellation ruleで許可される場合に限り収束する。
   それ以外はruleを迂回せずに遷移が拒否される。effectively cancelledされたOccurrenceではParticipation statusは変わらず、
   pending Invitationも解決されない。
4. **Given** あるOccurrenceへのpending Invitationが1件以上ある状態で、**when** inviteeがサポートされているいずれかのpathで
   `attending`になると、**then** そのOccurrenceとinviteeに対するすべてのpending Invitationが解決される。
5. **Given** あるOccurrenceに利用者自身のParticipationがある状態で、**when** 利用者がMy Calendarを開くと、**then** そのOccurrenceは
   Personal ScheduleではなくParticipationを元に表示される。
6. **Given** あるOccurrenceにParticipationがない状態で、**when** My Calendarを表示すると、**then** Participationのcalendar itemは
   作られない。

### Edge Cases

以下の境界を明示します。

- Eventのcancelled状態とOccurrenceのcancelled状態は、どちらも新しいParticipationを無効にします。
- 読み取り失敗は、Participationが存在しない状態と同じではありません。
- Invitationへの応答によって`not_attending` statusは作られません。
- 利用者はeffectively cancelled中でも既存のParticipationを取り消せます。

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Participationは、ちょうど1つのOccurrenceと1人のauthenticated userにスコープされなければならない。
- **FR-002**: productはevent-levelのParticipation objectを提供してはならない。
- **FR-003**: 保存可能なstatusは`considering`と`attending`だけでなければならない。
- **FR-004**: `not_attending`を保存済みParticipation statusとして表してはならない。
- **FR-005**: Participationの不在は、利用者が参加していないことを意味しなければならない。不在を3つ目の保存済みstatusとして
  表示してはならない。

### Lifecycle要件

- **FR-006**: ParticipationがなくOccurrenceがeffectively cancelledされていない場合、利用者はどちらの保存可能なstatusも
  作成できなければならない。
- **FR-007**: 現行のcancellation ruleで遷移が許可される場合、利用者は自身の既存statusを更新できなければならない。
- **FR-008**: 保存済みのstatusを選択した場合、semantic no-opでなければならない。
- **FR-009**: 利用者はOccurrenceがeffectively cancelled中でも、自身のParticipationを取り消せなければならない。
- **FR-010**: 取り消しの結果は不在となり、`not_attending`を作成してはならない。
- **FR-011**: EventまたはOccurrenceがcancelledになったとき、既存Participationを自動削除または書き換えしてはならない。

### Cancellation要件

- **FR-012**: 親Event、Occurrence、または両方がcancelledの場合、effective cancellationが適用されなければならない。
- **FR-013**: Effective cancellation中は、どちらの保存可能statusについても新しいParticipationの作成を拒否しなければならない。
- **FR-014**: Effective cancellation中は`considering → attending`を拒否しなければならない。
- **FR-015**: Effective cancellation中も`attending → considering`と取り消しは引き続き許可されなければならない。
- **FR-016**: UIはcancelled状態を表示し、有効なdowngradeと取り消しの操作を隠してはならない。

### Invitation要件

以下は Participation から見た Invitation convergence の contract です。Invitation
自身の lifecycle、targeting、pending list、re-invite、opacity は Spec 006 を参照します。

- **FR-017**: Invitationを受信しても、それだけでParticipationを作成または変更してはならない。
- **FR-018**: Invitationをdeclineした場合、`not_attending`を作成せずInvitationを解決しなければならない。
- **FR-019**: Invitationをdeclineしても、別に存在する`considering` Participationを変更してはならない。
- **FR-020**: Invitationをacceptした場合、通常のParticipation interactionと同じ`attending`遷移を試みなければならず、
  effective cancellation ruleがその遷移を許可する場合に限って`attending`へ収束しなければならない。ruleを迂回したり、
  Invitation由来の別の保存statusを作成したりしてはならない。
- **FR-021**: サポートされるいずれかのpathで`attending`に到達した場合、同じOccurrenceとinviteeへのすべてのpending
  Invitationを解決しなければならない。

### Visibilityとownershipの要件

- **FR-022**: Participation visibilityのdefaultはprivateでなければならない。
- **FR-023**: Private Participationを読み取れるのはownerだけでなければならない。
- **FR-024**: Public Participationはauthenticated userから読み取り可能でなければならず、anonymous userから
  読み取り可能であってはならない。
- **FR-025**: そのParticipationのownerだけが作成、更新、取り消しをできなければならない。
- **FR-026**: Event ownershipによって他の利用者のprivate Participationへのaccessを付与してはならない。
- **FR-027**: 現行first-party UIでpublic participantの一覧表示またはParticipation visibility toggleを公開してはならない。
- **FR-028**: Public Participationのdata-access capabilityと、visibilityを閲覧または変更するUI capabilityは別の概念として
  維持しなければならない。

### 表示要件

- **FR-029**: Event detailは`attending`を「参加する」、`considering`を「気になる」と表示しなければならない。
- **FR-030**: Event detailは既存Participationの取り消しを「参加をやめる」と表示しなければならない。
- **FR-031**: 不在とParticipationの読み取り失敗を区別できなければならない。
- **FR-032**: My Calendarには呼び出し元自身のParticipation由来Occurrence itemだけを表示し、Personal Scheduleは別のsourceとして
  維持しなければならない。
- **FR-033**: Participationが存在しない場合、Participation calendar itemを作成してはならない。
- **FR-034**: 現行の即時選択型Participation interactionでは、選択成功を反映してSheetを閉じ、単独のsuccess notificationを
  表示しません。これはこのauthority cutoverにおける現行runtime behaviorを記録するもので、global success-notice要件を
  緩和するものではなく、現時点ではその要件から逸脱しています。

### Cross-domain境界

- **FR-035**: ParticipationとTicketOpportunityのpersonal planning state（`planned` / `applied`）は独立していなければ
  ならない。一方のstateを変更しても、もう一方を自動的に作成、更新、削除してはならない。

### Key Entities

- **Occurrence Participation**: 1つのOccurrenceに対する利用者の現在の参加状態。`considering`、`attending`、またはrecordなしの
  いずれかです。
- **Pending Invitation**: 応答待ちの一時的なInvitation。Participation自体を表すものではなく、decline時またはinviteeが
  `attending`になった時点で解決されます。
- **Event / Occurrence**: event catalog objectと、その具体的な開催Occurrence。cancellationはどちらの階層にも独立して存在できます。

## 対象範囲の境界

- この仕様は、現行Occurrence Participation behaviorと、それに直接関係するInvitation、cancellation、presentation、calendarの
  境界を対象とします。
- ticket planning、Personal Scheduleのsemantics、Event作成、moderation、public participant discovery UX、将来のParticipation
  statusは定義しません。
- 機械的なdatabase enforcementとregression testの実装責務はこの文書ではなく、現行migration、schema、test、CIにあります。

## Success Criteria

### Measurable Outcomes

- **SC-001**: User Story 1の各lifecycle scenarioで、作成、更新、no-op、取り消しそれぞれの結果を1つずつ観測できます。
- **SC-002**: User Story 2の各cancellation遷移は、既存Participationの自動削除や書き換えを伴わず、許可または拒否の結果が
  一意に定まります。
- **SC-003**: Invitationの受信、decline、accept、attendingへの収束は、どのentry pathでも同じuser-visibleなParticipationの
  意味になります。
- **SC-004**: access scenarioでprivate、public、anonymousのvisibility結果を区別でき、first-partyのpublic browse/toggle UIが
  存在しないことも明示されています。
- **SC-005**: Event detailとMy Calendarは、データ不在と読み取り失敗を一貫して区別し、ParticipationをPersonal Scheduleと
  分けて扱います。

## Assumptions

- 利用者はauthenticated accountを持ち、Occurrenceは既存Eventに属します。
- 現行productではoffline Participation mutationを提供しません。
- Participation recordは現在のstateのみを表し、acceptまたはdeclineしたInvitationのhistoryを保持しません。
- productの日付/時刻表示はrepository既存のAsia/Tokyo behaviorに従います。
