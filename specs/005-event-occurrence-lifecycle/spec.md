# Event / Occurrence ライフサイクル現行仕様

**Status**: Current behavior contract
**Scope**: shared Event catalog と、その配下の Occurrence の lifecycle / capability

## Authority Boundary

この文書は、authenticated user が利用する Event / Occurrence catalog の現行の
user-visible / domain semantics における normative authority です。

architecture document は構造、schema・RLS・migration は機械的な enforcement、
runtime と tests は supporting / regression evidence、Issue #559 はこのauthority
cutoverの変更意図をそれぞれ担います。これらの実装詳細をこの文書の仕様として
再定義しません。

## User Scenarios & Testing

### Scenario 1: 共有catalogを閲覧する

authenticated user は、他のuserが所有するものを含めて共有Event catalogと
Occurrenceを閲覧できます。anonymous userにはcatalogの閲覧・変更を提供しません。

### Scenario 2: EventとOccurrenceを区別して予定を扱う

Eventは公演・催しそのもの、OccurrenceはそのEventに属する具体的な公演回です。
Occurrenceは必ず1つのEventに属し、Eventから独立したownerを持ちません。Eventなし
では存在できませんが、Occurrence自身のidentityを持ち、単発の公演もOccurrenceが
1件のEventとして表します。

EventはOccurrenceが0件でも成立します。開催期間だけが確定していて具体的な
公演回が未発表・未登録のEventも、共有catalog上の有効なEventです。

指定したcatalog対象期間とEvent rangeが重なるEventは、Occurrenceの有無にかかわらず
その期間の共有catalog上でdiscoverableです。これは0-occurrence Eventをplanning
surface上で発見可能にするEvent rangeベースのvisibilityであり、genre、group、venue
などのclassification / filter semanticsとは独立しています。

### Scenario 3: Event rangeと公演回の時刻を整合させる

Eventは `Asia/Tokyo` のinclusiveな開始日・終了日によるEvent rangeを持ちます。
rangeはEvent自身のproduct dataであり、Occurrence集合から自動導出しません。
Occurrenceの開演日時のTokyo calendar dateは親Eventのrange内でなければなりません。
range内にOccurrenceのない日を、特別な休演日としては扱いません。

Occurrenceは開演日時を必須とし、開場日時と終演日時は未公表なら未設定のまま
扱えます。設定された値の間では、開場日時 <= 開演日時 <= 終演日時の順序を
満たします。終演日時が別の日に及んでも、Event rangeへの所属判定は開演日時の
Tokyo calendar dateだけで行います。同一Event内で同じ開始instantのOccurrenceを
複数持つことはできません。

選択したTokyo calendar dateに実在するOccurrenceは、Event単位へcollapseせず、
それぞれのOccurrenceと時刻を個別にdiscoverableとします。同日に複数のOccurrenceが
ある場合も、各Occurrenceを開始時刻順に扱い、日ごとの件数を一定とみなしません。
EventのOccurrence collectionも開始時刻順に扱います。

選択日がEvent range内で、その日に実在するOccurrenceがない場合は、Event rangeに
基づくEvent-level fallbackとしてEventをdiscoverableとします。このfallbackは架空の
Occurrenceを生成せず、同じEventに選択日の実在Occurrenceがある場合はそのEventを
fallbackとして重複表示しません。

### Scenario 4: designated catalog creatorがEventを作成する

現行MVPでは、Eventの新規作成は指定されたdesignated catalog creatorに限ります。
作成したauthenticated userがそのEventのownerになります。designationは作成能力
だけを与え、他のuserが所有するEventの管理能力やcatalog全体の権限を与えません。
Event ownerであることは管理能力の境界であり、それだけでParticipation stateや
Invitation eligibilityを意味しません。

### Scenario 5: ownerがEvent / Occurrenceを管理する

Event ownerはEventの記述情報（title、venue、参照URL、memo）、Event range、および
配下のOccurrenceの時刻を更新できます。Occurrenceに独立したownerはなく、
Occurrenceの作成・更新・削除権限は
親Event ownerから導出されます。Event owner以外はこれらを管理できません。
owner transferやOccurrenceを別Eventへ付け替える操作は提供しません。
venueはcurrent modelではEvent-levelの情報であり、Occurrence独自のvenueは持ちません。
独立したvenue / time identityが必要な並行公演は、別Eventとして表現します。
識別子、作成日時、ownerなどのsystem-managed identityは通常の管理対象では
ありません。

Event ownerは、Event rangeと影響するOccurrenceの時刻を、最終状態が
containment invariantを満たす別期間へcoordinatedに移動できます。どちらか一方の
中間状態が一時的にinvariant違反となることだけを理由に、正当なcoordinated
rescheduleを恒久的に不可能にしてはなりません。ここではrescheduleを実現する
特定のwrite mechanismや、特定UIがこの操作全体を公開していることは定義しません。

### Scenario 6: cancellationとdeletionを区別する

Cancellationは、公演を中止扱いにする可逆な状態変更です。Event-levelと
Occurrence-levelのcancellationは独立しており、Eventがcancelされる、または
Occurrence自身がcancelされると、そのOccurrenceはeffective cancellation状態に
なります。Eventをuncancelしても、Occurrence自身のcancellationは解除しません。
ownerはcancel / uncancelを行えます。

effective cancellation状態のOccurrenceでは、新規Invitationを作成できません。
これはEvent / Occurrence cancellationがInvitation作成をgateするcross-domain invariant
であり、Invitationのpending lifecycleや送信者・対象者のeligibility全体を定義するもの
ではありません。

Deletionは誤登録を除去するhard deleteです。soft delete、trash、restore、監査履歴
としてのDeletionをこのcatalog lifecycleは提供しません。Cancellationによって
既存のdownstream stateを削除・書き換えません。

### Scenario 7: 依存状態があるEvent / Occurrenceを安全に削除する

Occurrenceはownerだけが削除できます。対象OccurrenceにParticipation、Invitation、
またはselected TicketOpportunity targetが1件でも存在する場合、standaloneな削除は
拒否され、これらの状態をcascadeで削除しません。selected targetを削除対象から外す
場合は、official target scopeを先にreconcileします。最後のOccurrenceを削除してEvent
が0件の状態になることは許可されます。

Eventはownerだけが削除できます。OccurrenceがないEventは削除できます。子
Occurrenceがある場合は、Participation / Invitationによる削除blockerがない子を
対象にEventと子を一体として削除します。削除できない子が1件でもあれば全体を拒否し、
部分削除を発生させません。selected TicketOpportunity targetの存在だけではwhole-Event
削除をblockせず、TicketOpportunityとpersonal planning stateを含むEvent lifecycleの
cross-domain consequenceはSpec 008が定義します。Participation / Invitationの
downstream stateをEvent削除がcascadeで消すことはありません。

## Requirements

### Catalog and identity

- **EV-001**: Event catalogはauthenticated user間で共有され、anonymous userには
  catalog read/writeを提供しない。
- **EV-002**: Eventは興行そのもの、OccurrenceはEventに属する具体的な公演回として
  区別される。
- **EV-003**: Occurrenceは必ず1つのEventに属し、親Eventなしでは存在できないが、
  Occurrence自身のidentityを持ち、独立したownerは持たない。
- **EV-004**: EventはOccurrenceが0件でも有効であり、単発の公演はOccurrence 1件の
  Eventで表す。指定したcatalog対象期間とEvent rangeが重なるEventは、Occurrenceの
  有無にかかわらずその期間の共有catalog上でdiscoverableである。このvisibilityは
  genre、group、venueなどのclassification / filter semanticsとは独立する。

### Temporal invariants

- **EV-005**: Event rangeは必須のinclusiveなTokyo calendar date rangeで、開始日 <=
  終了日を満たす。
- **EV-006**: Event rangeはOccurrenceから導出せず、Occurrenceの開演日時のTokyo
  calendar dateは親Eventのrange内にある。
- **EV-007**: 開場日時と終演日時はnullableで、設定値は開場日時 <= 開演日時 <=
  終演日時を満たす。未設定値に暗黙の時刻を補わない。
- **EV-008**: 同一Event内のOccurrenceは開始instantが一意である。

### Creation, ownership, and update

- **EV-009**: Eventの新規作成はdesignated catalog creatorに限られ、作成者がownerに
  なる。
- **EV-010**: Event ownerだけがEventのtitle、venue、参照URL、memo、rangeと配下
  Occurrenceの時刻を更新・管理できる。
- **EV-011**: owner transferおよびOccurrenceの別Eventへの付け替えは提供しない。
- **EV-012**: catalog creator designationは作成能力であり、他ownerのEventの更新権限
  やgenericなadmin / directory能力を意味しない。

### Cancellation and deletion

- **EV-013**: Event-level / Occurrence-level cancellationは独立して可逆であり、
  effective cancellationは両者のいずれかがcancelされた状態である。
- **EV-014**: EventまたはOccurrenceがeffective cancellation状態にある場合、その
  Occurrenceへの新規Invitation作成は許可しない。これはEvent / Occurrence側の
  cancellation gateであり、Invitation lifecycle全体の定義ではない。
- **EV-015**: cancellationはdeletionと異なり、既存のParticipation / Invitationを
  保持し、cascadeで削除・書き換えない。
- **EV-016**: Event / Occurrenceのhard deletionはowner-onlyで、依存Participation /
  Invitation、またはselected TicketOpportunity targetがあるOccurrenceのstandalone
  削除を拒否する。selected targetを対象範囲から外す場合は、official target scopeを
  先にreconcileする。
- **EV-017**: Event削除は0件のEventを許可し、子を含む場合はParticipation / Invitation
  によるblockerがない子が全件そろったときにatomicに行い、Participation / Invitationを
  cascadeしない。selected TicketOpportunity targetの存在だけを理由にwhole-Event削除を
  拒否せず、そのTicketOpportunityとpersonal planning stateのlifecycle consequenceは
  Spec 008に委譲する。

### Catalog read semantics

- **EV-018**: 選択したTokyo calendar dateに実在するOccurrenceは、Occurrence単位で
  個別にdiscoverableであり、その時刻を扱える。実在しないOccurrenceを生成しない。
- **EV-019**: 選択日の実在OccurrenceとEvent detailのOccurrence collectionは、
  開始時刻順に扱う。
- **EV-020**: 選択日に実在Occurrenceがなくても、選択日がEvent range内ならEventは
  Event-level fallbackとしてdiscoverableである。このfallbackは架空のOccurrenceを
  生成せず、選択日の実在OccurrenceがあるEventを重複させない。
- **EV-021**: 同日に複数のOccurrenceを持つことができ、各Occurrenceはdistinctなまま
  扱う。日ごとのOccurrence件数を一定とせず、Event単位へcollapseしない。
- **EV-022**: Event ownerであることはEvent / Occurrenceのmanagement capabilityを
  与えるが、それだけでParticipation stateやInvitation eligibilityを与えない。
- **EV-023**: venueはEvent-level product informationであり、Occurrenceは独立した
  venueを持たない。独立したvenue / time identityが必要な並行公演は別Eventで表す。
- **EV-024**: Event ownerは、Event rangeと影響するOccurrenceの時刻を、最終状態が
  containment invariantを満たす別期間へcoordinatedに移動できる。中間状態の一時的な
  invariant違反だけを理由に、正当なcoordinated rescheduleを恒久的に拒否しない。

## Cross-domain Boundary

- Participationのstatus・visibility・参加操作、および既存Invitationからの参加状態遷移は
  [`specs/001-occurrence-participation/spec.md`](../001-occurrence-participation/spec.md)
  がauthorityとして維持する。この文書は、Participation / Invitationが存在する場合の
  Event / Occurrence deletion safety、cancellationによる既存stateの保持、および
  effective cancellationが新規Invitation作成をgateするEvent / Occurrence側の境界だけを
  定義する。Event ownerであること自体はParticipation stateを決めない。
- Invitationのpending lifecycle、招待資格、targeting、opacityは、#560で専用Living
  Specへcut overするまで[temporary static product rules](../../.ai-dev-foundation/product-rules.md)
  のInvitation / identity boundaryがauthorityです。この文書は、Invitation lifecycle
  全体を定義せず、effective cancellation中のOccurrenceへの新規Invitation作成を拒否する
  cancellation gateと、InvitationがOccurrence deletionを阻止するdependent stateで
  あることだけを扱います。Event ownerであること自体はInvitation eligibilityを決めません。
- Event rangeとcatalog対象期間のoverlapによるEvent visibilityはこの文書が定義する。
  genre、group、venueのclassification、facet / filter composition、option universe、
  filter persistenceはこの文書に含めず、後続のclassification / filter authorityが扱う。
- Personal Schedule、Calendar / Homeの各domain lifecycleはこの文書に含めない。
  TicketOpportunityについては、selected targetによるstandalone Occurrence削除の
  safety boundaryだけを定義し、official target integrityとEvent deletion consequence
  はSpec 008に委譲する。各domainのauthorityと合成ルールを横断的に再定義しない。

## Scope Boundaries

この仕様は、共有Event catalogにおけるEvent / Occurrenceのidentity、temporal
invariant、creation / ownership / update capability、selected-date / Event-detail catalog
read semantics、cancellation、cancellation-side Invitation gate、Event rangeによるcatalog
visibility、deletion safety
の現行semanticsを扱います。

route、file、SQL、RPC、RLS、Supabase client、UI layout、data-access architecture、
migration history、classification/filter、Participation lifecycleの実装詳細は
扱いません。

## Success Criteria

- **SC-001**: EventとOccurrenceのidentity / temporal / ownership boundaryが、0件の
  Occurrence、nullableな時刻、Tokyo date rangeを含めて一意に説明できる。
- **SC-002**: designated creatorによる作成、ownerによる更新、owner以外の非管理という
  capability結果が、EventとOccurrenceの両方で検証可能である。
- **SC-003**: cancellationとhard deletionが、可逆性・依存stateの保持・削除拒否の
  観点で混同なく検証可能である。
- **SC-004**: 依存Participation / Invitationまたはselected TicketOpportunity targetが
  ある場合のstandalone Occurrence削除安全性が、部分削除やdownstream cascadeを許さない
  結果として検証可能である。
- **SC-005**: Catalog classification/filterとParticipation lifecycleをこの文書へ
  重複して取り込まず、各authorityへの境界参照だけで現行責務を追跡できる。
- **SC-006**: effective cancellation中のOccurrenceへの新規Invitation作成拒否が、
  Spec 001のParticipation transition semanticsと、#560完了まではtemporary static
  product rulesが定義するInvitationのpending lifecycle / eligibility / targeting /
  opacityを吸収せず検証可能である。#560完了後はInvitation Living Specへcut overする。
- **SC-007**: Event rangeとcatalog対象期間が重なるEventが、Occurrence 0件を含めて
  discoverableであり、classification / filter semanticsとは別のauthorityであることを
  検証可能である。
- **SC-008**: 選択日の実在Occurrenceが個別・開始時刻順にdiscoverableであり、複数件を
  collapseせず、実在しない日はEvent-level fallbackだけを表示して架空Occurrenceを
  生成しないことを検証可能である。
- **SC-009**: Event detailのOccurrence collectionも開始時刻順であり、Event ownerの
  management capabilityとParticipation / Invitationのstatus・eligibility、および
  Event-level venueとOccurrence-level identityの境界を混同しないことを検証可能である。
- **SC-010**: Event rangeと影響するOccurrenceの時刻を同時に別期間へ移す正当な
  coordinated rescheduleが、最終状態のcontainment invariantを満たす限り、中間状態の
  一時的な違反だけを理由に恒久的に不可能とされないことを検証可能である。
- **SC-011**: selected TicketOpportunity targetがstandalone Occurrence削除を阻止し、
  target scopeのreconciliation後に削除可能となる一方、selected targetの存在だけでは
  whole-Event削除を阻止しないことを検証可能である。

## Assumptions

- 利用者はauthenticated accountを持ち、Eventは共有catalogに属する。
- date/timeの表示・解釈はrepositoryのAsia/Tokyoの現行挙動に従う。
- Event / Occurrenceの機械的なenforcementは、現行schema・RLS・runtime・testsが担う。
- ownership transfer、Occurrence-levelの別Event移動、削除履歴は現行scopeに含まない。
