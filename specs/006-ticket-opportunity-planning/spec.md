# Feature Specification: TicketOpportunity planning model / personal state current behavior

**Feature Branch**: `006-ticket-opportunity-planning`

**Created**: 2026-09-19

**Status**: Current behavior contract

**Input**: GitHub Issue #562 と、Issue #548 の inventory report #5740442409、current `main` の実装・schema・tests・画面

## Authority Boundary

この文書は、TicketOpportunity の broader planning model と personal state に
ついて、current product behavior を定義するLiving Specである。sharedな販売機会の
identity、Eventとの関係、target scope、milestone precision、source provenance、
およびユーザーごとの planning state を扱う。

TicketOpportunity の timeline における relevant date、月の所有、ordering、month
label は [`003-ticket-opportunity-timeline`](../003-ticket-opportunity-timeline/spec.md)
だけが定義する。この文書ではtimelineの計算規則を再定義しない。

Occurrence Participation の lifecycle、cancellation、Invitationとの直接の境界は
[`001-occurrence-participation`](../001-occurrence-participation/spec.md) が定義する。
この文書は、TicketOpportunity の personal state が Participation と独立である
こと、およびTicketOpportunity自身のeffective cancellationがOccurrenceの
cancellationをどう集約するかだけをcross-boundaryとして定める。

architecture、schema、RLS、data-access、UI implementation、tests、CIはそれぞれの
current artifactが責務を持ち、この文書はmechanicsを複製しない。

## User Scenarios & Testing _(mandatory)_

### User Story 1 - 販売機会の意味を理解する (Priority: P1)

利用者として、同じEventに複数ある販売機会を、それぞれの対象範囲、milestone、
source provenanceとともに区別して理解したい。そうすれば、Event全体向けの機会と
特定の公演回向けの機会を取り違えない。

**Why this priority**: sharedなplanning dataのidentityと対象範囲が崩れると、
全ユーザーの表示とpersonal stateの対象が同時に誤るため。

**Independent Test**: 1つのEventに複数のOpportunityを用意し、Event-wide、selected
occurrence、source固有のdisplay name、date/datetime/window milestoneを確認する。

**Acceptance Scenarios**:

1. **Given** 1つのEventに複数のOpportunityがある、**When** 利用者が表示する、
   **Then** 各Opportunityは別の販売機会として区別される。
2. **Given** target scopeが`event_wide`である、**When** 対象を解釈する、
   **Then** そのOpportunityはEvent全体を対象とし、現在存在するOccurrenceのsnapshot
   へ暗黙に変換されない。
3. **Given** target scopeが`selected_occurrences`である、**When** 対象を解釈する、
   **Then** 明示された1つ以上のOccurrenceだけが対象で、各Occurrenceは同じEventに属する。
4. **Given** sourceが時刻を示していないmilestoneである、**When** 利用者が確認する、
   **Then** productは時刻を推測して補完しない。
5. **Given** source固有のdisplay nameまたはsource provenanceがある、**When** 利用者が確認する、
   **Then** sourceの識別情報は別のOpportunityやEventのsource identityと混同されない。

### User Story 1a - 中止状態を販売機会の意味として読む (Priority: P1)

利用者として、Eventと対象Occurrenceの中止状態からOpportunityの中止状態を正しく読めるように
したい。そうすれば、対象の取りこぼしを「全対象が中止」と誤読せず、Event-wideの意味も
Occurrence一覧のsnapshotへ変えてしまわない。

**Independent Test**: Event-level cancellation、activeなEventのevent-wide Opportunity、
selected occurrencesの全対象中止・一部中止・未解決対象を比較し、Opportunityの中止表示と
timeline rowの保持を確認する。

**Acceptance Scenarios**:

1. **Given** 親Eventが中止である、**When** Opportunityを表示する、**Then** target scopeに
   関係なくOpportunityは中止として扱われる。
2. **Given** Eventがactiveでtarget scopeが`event_wide`である、**When** 一部のOccurrenceが
   中止になる、**Then** OpportunityはOccurrence側だけを理由に中止へ変わらない。
3. **Given** Eventがactiveでtarget scopeが`selected_occurrences`である、**When** 明示対象が
   すべて解決済みで全件中止になる、**Then** Opportunityは中止として扱われる。
4. **Given** selected targetの一部が未解決、または一部だけが中止である、**When** Opportunityを
   表示する、**Then** 不完全な対象集合から全件中止を推測しない。
5. **Given** Opportunityが中止として扱われる、**When** timeline projectionを表示する、
   **Then** timelineから暗黙に削除せず、中止の表示を受付終了やpersonal stateより優先する。

### User Story 2 - 自分のplanning stateを管理する (Priority: P1)

利用者として、Opportunityごとに自分の申込予定を`planned`または`applied`として
管理し、不要になったものはpersonal trackingから外したい。

**Why this priority**: current MVPが提供するpersonal planning valueは、実際の申込記録
ではなく、販売機会に対する自分の次の行動を管理することだから。

**Independent Test**: `/tickets`で1つのOpportunityのstateを未登録、`planned`、
`applied`、未登録へ順に変更し、他のOpportunityやshared dataが変わらないことを確認する。

**Acceptance Scenarios**:

1. **Given** personal state rowがない、**When** 利用者が`planned`を選ぶ、**Then**
   そのOpportunityの自分のstateは`planned`になる。
2. **Given** personal state rowがない、**When** 利用者が`applied`を選ぶ、**Then**
   そのOpportunityの自分のstateは`applied`になる。
3. **Given** personal stateが`planned`または`applied`である、**When** 利用者が別の
   stateを選ぶ、**Then** 自分のstateだけが選択したstateに変わる。
4. **Given** personal state rowがある、**When** 利用者がtracking解除を選ぶ、**Then**
   そのOpportunityについてpersonal stateは不在になる。
5. **Given** personal state rowがない、**When** 利用者がOpportunityを確認する、**Then**
   row不在は「個人的にtrackingしていない」を意味し、第三のstatusや申込結果を意味しない。

### User Story 3 - Participationと混同せずにplanningを読む (Priority: P2)

利用者として、TicketOpportunityのplanning stateと、自分が公演回へ参加するかどうか
を別々に扱いたい。そうすれば、申込予定を記録しても参加状態が自動で変わらず、参加
状態を変えてもticket planningが消えない。

**Why this priority**: TicketOpportunityはEventまたはOccurrenceに紐づくsharedな販売
機会であり、ParticipationはOccurrenceごとの別のpersonal stateだから。

**Independent Test**: 同じEventに対してTicketOpportunity stateとOccurrence Participation
をそれぞれ変更し、もう一方が作成・更新・削除されないことを確認する。

**Acceptance Scenarios**:

1. **Given** `planned`または`applied`のpersonal stateがある、**When** Participationを
   `considering`または`attending`へ変更する、**Then** TicketOpportunity stateは変わらない。
2. **Given** Participationがある、**When** TicketOpportunity stateを設定または解除する、
   **Then** Participationは作成・更新・削除されない。
3. **Given** `/tickets`またはHomeのdeadline blockがこのmodelを読む、**When** 利用者が確認する、
   **Then** shared Opportunityと自分のstateは同じplanning modelから表示され、Participationの
   lifecycleを代用しない。

### Edge Cases

- `event_wide` Opportunityに、暗黙のOccurrence一覧snapshotを割り当てない。
- `selected_occurrences`で対象外のEventに属するOccurrenceを対象として扱わない。
- sourceにないresult dateやconditional phaseについて、「不明」を表す架空のmilestoneを作らない。
- date-only、exact datetime、windowを同じprecisionとして扱わず、sourceにない時刻を付けない。
- selected targetの関係が全件失われた場合、`event_wide`へ暗黙変換せず、空のtarget集合を
  有効なselected opportunityや全件中止の証拠として扱わない。current readerがinvalidとして
  扱うこの状態を、product上の別のtarget scopeで補完しない。
- selected targetの一部が解決できない場合、解決できた対象だけを全対象とみなさず、全件中止を
  推測しない。
- `/tickets`ではOpportunityの最後のmilestoneが過ぎても、その最終日から7日目までは
  retained historyとして残し、8日目には落とす。Homeのdeadline blockはretained historyを
  表示対象に含めず、受付中のdeadlineに限定する。中止でも`/tickets`のretentionは維持し、
  中止表示を優先する。
- row不在、`planned`、`applied`を相互に別の意味として扱い、row不在をerrorやthird statusと混同しない。
- TicketOpportunity stateとParticipationの片方のread/write失敗を、もう片方のstateの変更として扱わない。

## Requirements _(mandatory)_

### Shared TicketOpportunity

- **FR-001**: 1つのTicketOpportunity MUST 1つのEventに属し、1つのEventは複数のOpportunityを持てる。
- **FR-002**: Opportunityのsource display name MUST source固有の表現を保ち、productが閉じた分類へ正規化してはならない。
- **FR-003**: source provenance MUST Opportunityのidentityとして扱える情報を持ち、Event自身のsource identityやsource URL単体と同一視してはならない。
- **FR-004**: target scope MUST `event_wide`または`selected_occurrences`のいずれかとして解釈される。
- **FR-005**: `event_wide` MUST Event全体を意味し、当時のOccurrence一覧のsnapshotを意味してはならない。
- **FR-006**: `selected_occurrences` MUST 明示された1つ以上のOccurrenceを対象とし、対象OccurrenceはOpportunityのEventに属さなければならない。
- **FR-007**: `selected_occurrences`の登録後に対象関係が空になった場合、current readはそれをvalidなOpportunityとして再解釈せず、`event_wide`や全件中止へfallbackしてはならない。

### Milestone and provenance

- **FR-008**: Opportunityのmilestone MUST date-only、exact datetime、windowのprecisionを区別する。
- **FR-009**: product MUST sourceが与えていない時刻を推測してmilestoneへ追加してはならない。
- **FR-010**: sourceに存在しないmilestone MUST 架空のrow、値、または「不明」statusによって表現してはならない。
- **FR-011**: application open、application close、result announcement、sale start、payment/settlement windowなどのmilestoneは、sourceが示す範囲で表現する。

### Effective cancellation and retained history

- **FR-012**: 親Eventが中止なら、TicketOpportunityはtarget scopeに関係なくeffectiveに中止である。
- **FR-013**: 親Eventがactiveな`event_wide` Opportunityは、Occurrence側の中止だけではeffectiveに中止にならない。
- **FR-014**: 親Eventがactiveな`selected_occurrences` Opportunityは、対象Occurrence集合が完全に解決済みで非空、かつ全対象が中止の場合だけeffectiveに中止である。未解決・空集合・部分中止は全件中止の根拠にならない。
- **FR-015**: effective cancellationはtimeline rowの削除を意味せず、cancellationの表示は受付終了およびpersonal stateの表示より優先される。relevant date、past判定、month ownership、ordering、month labelingはSpec 003へ委譲する。
- **FR-016**: `/tickets`では最後のmilestoneの最終日から7日目まではpost-final retained historyとして表示対象に残し、8日目以降は表示対象から外す。Homeのdeadline blockはこのretained historyを表示対象に含めない。effective cancellationであっても`/tickets`のretentionは短縮せず、中止表示を優先する。

### Personal state

- **FR-017**: UserTicketOpportunityStateのstatus vocabulary MUST `planned`と`applied`だけである。
- **FR-018**: personal state rowの不在 MUST そのユーザーがOpportunityを個人的にtrackingしていないことを意味し、`not_applied`等のthird statusやactual application recordを意味してはならない。
- **FR-019**: personal state MUST user × Opportunity単位の本人のstateであり、本人だけがそのstateをread/writeできる。他ユーザーのstateやshared Opportunityのidentityを変更してはならない。
- **FR-020**: `TicketOpportunity`、target scope、milestoneはauthenticated userがreadできるshared catalog dataであり、ordinary authenticated userはshared dataを直接mutationできない。shared writeのoperator procedureはこの文書で定義しない。
- **FR-021**: actionableな非retained rowについて、利用者はcurrent UIでpersonal stateを`planned`、`applied`、未登録のいずれかへ収束できる。retained rowではstate controlが表示されず、8日目以降はrow自体が表示されないため、この文書は別のcleanup surfaceを定義しない。
- **FR-022**: personal state MUST 実際の申込内容、希望順位、枚数、席種、当落詳細、seat、ticket inventory、assignment、transferを表現してはならない。

### Cross-domain and surface boundary

- **FR-023**: TicketOpportunity personal state（`planned`/`applied`）とOccurrence Participation（`considering`/`attending`）は独立し、一方の変更が他方を自動的に作成・更新・削除してはならない。
- **FR-024**: `/tickets`とHomeのdeadline blockはこのTicketOpportunity planning modelを利用するが、timelineのrelevant date、month ownership、ordering、month labelingはSpec 003へ委譲する。
- **FR-025**: Participationのlifecycle、cancellation、Invitationとの直接の意味はSpec 001へ委譲し、Ticket semantics全体をSpec 001へ移してはならない。

## Key Entities

- **TicketOpportunity**: 1つのEventに属するsharedな販売機会。source固有のdisplay name、target scope、source provenance、milestoneを持つ。
- **Target scope**: Event全体（`event_wide`）または明示したOccurrence集合（`selected_occurrences`）を示すplanning上の対象範囲。
- **Milestone**: 販売機会に関するdate-only、exact datetime、またはwindowの時点・期間。sourceが提供したprecisionを保つ。
- **UserTicketOpportunityState**: 1ユーザーと1 Opportunityの間のpersonal planning state。statusは`planned`または`applied`で、row不在は未trackingを示す。
- **Effective cancellation**: Eventと対象Occurrenceのcurrent cancellation stateを、target scopeに応じてOpportunityへ集約した表示上の状態。TicketOpportunity cancellationはParticipation cancellationとは別である。

## Scope Boundaries

この文書がcurrent authorityとして扱うのは、TicketOpportunityのshared identity、
Event relation、target scope、milestone precision、source provenance、personal
`planned`/`applied` state、row absence、shared/personal read/write boundary、
effective cancellation、post-final retention、Participationとの独立性、および
それらが`/tickets`とHomeで消費される境界である。

次の事項はこの文書に含めない。

- timelineのrelevant date、cross-month window ownership、ordering、month labelingの詳細（003）。ただし、003が明示的に除外するpost-final retentionとTicketOpportunityのeffective cancellation集約はこの文書で扱う。
- DB columns、SQL、RLS、RPC、typed read/writeのimplementation mechanics
- import operator procedureやimport process redesign
- 実際の申込結果、seat、acquired-ticket inventory、assignment、transfer
- UI component、route layout、copy、data-accessのrefactor
- 未実装のfuture ticket modelや将来機能のcurrent化

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Event-wide、selected-occurrence、source provenance、date-only、exact datetime、windowの各current caseについて、利用者がshared Opportunityの意味を一意に判定できる。
- **SC-002**: すべてのcurrent personal stateが`planned`、`applied`、row不在のいずれかとして解釈でき、third statusやactual application detailを必要としない。
- **SC-003**: `/tickets`とHomeのdeadline blockで、同じOpportunityに対するpersonal stateの表示が一貫し、shared dataの意味を変えない。
- **SC-004**: TicketOpportunity stateとParticipation stateをそれぞれ変更する検証で、相手側のstateに自動変更が0件である。
- **SC-005**: timelineの日付・月・orderingの検証はSpec 003で完結し、この文書との重複するtimeline ruleが0件である。
- **SC-006**: shared dataのreadとpersonal stateのread/write境界が区別され、ordinary authenticated userによるshared mutationと他ユーザーのpersonal state参照が0件である。
- **SC-007**: Event cancellation、event-wide、全対象中止、部分・未解決対象のcurrent casesを区別し、取りこぼしから全件中止を推測するケースが0件である。
- **SC-008**: post-final retentionは7日目を含めて維持し、8日目に落ちる。cancellationによってこのretentionが短縮されるケースが0件である。

## Assumptions

- 利用者は既存のauthenticated accountを持ち、EventとOpportunityはcurrent catalogに存在する。
- 利用者向けの日付・時刻の解釈は、timeline authorityであるSpec 003の既存のAsia/Tokyo conventionに従う。
- TicketOpportunityは販売機会の発見とpersonal planningを表すcurrent MVPであり、実際の申込・当落・ticket possessionを表すrecordではない。
- schema、RLS、runtime、testsはこのauthority cutoverで変更せず、現行behaviorのmechanical evidenceとして参照する。
