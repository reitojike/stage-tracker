# Feature Specification: 現行TicketOpportunity Timeline behavior

**Feature Branch**: `003-ticket-opportunity-timeline`

**Created**: 2026-09-18

**Status**: Current behavior contract

**Input**: 現行TicketOpportunity timeline behavior、およびwindowはdeadlineの月に属するという確定済みproduct decision。

## 権限境界

この文書はTicketOpportunity timelineの現行product behavior authorityです。利用者に見える内容とmilestone dateの解釈だけを
記述します。architecture文書、data schema、実装、test、CIはそれぞれの責務を維持し、この文書では重複して記述しません。

## User Scenarios & Testing _(mandatory)_

### User Story 1 - ticket opportunityが重要となる時期を把握する (Priority: P1)

ticket opportunityを確認する利用者として、deadlineと現在のstatusを理解できるように、各milestoneの有効日付をその精度に
応じたものにしたい。

**Why this priority**: 有効日付はdeadlineの表示、過去判定、保持されるhistory、timeline上の月配置の基準となるためです。

**Independent Test**: date、datetime、同月内window、月をまたぐwindowの各milestoneを確認し、表示日付、月、status境界を比較します。

**Acceptance Scenarios**:

1. **Given** date型milestoneの場合、**when** 表示すると、**then** その暦日が有効日付となる。
2. **Given** datetime型milestoneの場合、**when** 表示すると、**then** そのdatetimeを含むTokyo暦日が有効日付となる。
3. **Given** window型milestoneの場合、**when** deadlineまたは最終日を評価すると、**then** windowの終了日が有効日付となり、
   その終了日に達するまではwindowがcurrentのままである。
4. **Given** windowがある月に始まり翌月に終了する場合、**when** timelineを表示すると、**then** 終了日を含む月にそのwindowが表示される。

### User Story 2 - timelineを時系列順に読む (Priority: P1)

ticket opportunityを見渡す利用者として、月labelでdeadlineが属する月を示しつつ、timelineの順序を安定させたい。

**Why this priority**: 月配置は有効なdeadlineを説明しますが、timelineの並びは確立済みの時系列順を維持する必要があるためです。

**Independent Test**: 月をまたぐwindowと前後に始まるmilestoneを比較し、月配置を変えてもtimeline内のrow位置が変わらないことを
確認します。

**Acceptance Scenarios**:

1. **Given** 月をまたぐwindowと他のmilestoneがある場合、**when** timelineを表示すると、**then** rowは確立済みの時系列順を保つ。
2. **Given** 有効日付を適用すると月labelが連続しなくなるrowがある場合、**when** timelineを表示すると、**then** row順を維持し、
   month keyが同じという理由だけで後続rowを先行する月sectionへ統合しない。

### Edge Cases

以下の境界を明示します。

- 同じ月内のwindowはその月にとどまります。
- windowは、開始月より後の月に表示される場合があります。
- row sequenceを維持した結果、ある月が連続しない場合、その月labelは後で再度現れることがあります。
- 深夜に近いdatetimeは、そのTokyo暦日に割り当てられます。

## Requirements _(mandatory)_

### Milestoneの日付semantics

- **FR-001**: date型milestoneは、それ自身の暦日を有効日付として使用しなければならない。
- **FR-002**: datetime型milestoneは、そのdatetimeを含むTokyo暦日を有効日付として使用しなければならない。
- **FR-003**: window型milestoneは、その終了側を含むTokyo暦日をproduct上有効なdeadlineおよび最終日として使用しなければならない。
- **FR-004**: window型milestoneは、終了側が経過するまでは過去扱いになってはならない。
- **FR-005**: deadline表示、過去判定、保持history、最終日のbehaviorは、適用される精度別の日付semanticsと一貫していなければならない。

### Timeline上の月配置

- **FR-006**: timelineの月sectionは、milestoneのproduct上有効なTokyo暦日から決定しなければならない。
- **FR-007**: 月をまたぐwindowは、終了日を含む月に表示しなければならない。
- **FR-008**: date型、datetime型milestone、および開始日と終了日が同月のwindowは、既存の月配置を維持しなければならない。

### 順序の境界

- **FR-009**: windowの月配置を変えても、timeline rowの確立済み時系列順を変えてはならない。
- **FR-010**: rowが表示される月とrowを読む順序は、product上別の概念として維持しなければならない。
- **FR-011**: 有効日付の適用によって月labelが連続しなくなる場合、timelineは月名だけを理由に離れたsectionを統合せず、row順を維持
  しなければならない。

## 対象範囲の境界

- この仕様は現行TicketOpportunity milestoneの日付semanticsとtimeline上の月配置を対象とします。
- user-visibleなfull timelineと、TicketOpportunity surface間で共有されるdeadlineの意味を対象とします。
- TicketOpportunityのdata modeling、import behavior、personal planning state、cancellation rule、保持期間、またはTicketOpportunity milestone
  以外のcalendar/catalog表示は定義しません。

## Success Criteria

### Measurable Outcomes

- **SC-001**: date、datetime、同月内window、月をまたぐwindowの4つすべてのmilestone精度ケースで、期待される有効日付と月を表示します。
- **SC-002**: すべてのTicketOpportunity timeline surfaceで、月をまたぐwindowがdeadlineの月に表示されます。
- **SC-003**: windowが月境界をまたいでも、既存timeline row順は変わりません。
- **SC-004**: deadline、過去判定、保持history、最終日の結果が、同じ精度別product意味に一致します。

## Assumptions

- user-facing calendar dateは、product既存のAsia/Tokyo conventionに従います。
- 月への所属が全体として単調なsequenceにならない場合も、timelineは確立済みのrow sequenceを維持します。
