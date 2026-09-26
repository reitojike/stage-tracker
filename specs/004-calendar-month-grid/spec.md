# Feature Specification: Calendar Month-Gridのcancellation semantics

**Feature Branch**: `004-calendar-month-grid`

**Created**: 2026-09-18

**Status**: Current behavior contract

**Input**: GitHub Issue #505、およびIssue #493で記録された確定済みのCatalog / My Calendar product decision。

## 権限境界

この文書はCatalogとMy Calendarのmonth gridにおけるcancellationの意味を定める、現行product behavior authorityです。
Issue #505は引き続きcanonicalな変更意図です。architecture文書、実装、test、data schema、CIはそれぞれの責務を維持し、この文書では
重複して記述しません。

My CalendarのParticipation境界とeffective-cancellation lifecycleは、引き続き
[`specs/001-occurrence-participation/spec.md`](../001-occurrence-participation/spec.md)が管轄します。このtopicではmonth-gridへの
projectionとdetail visibilityの境界だけを記録します。

## User Scenarios & Testing _(mandatory)_

### User Story 1 - 公開されたCatalog情報を閲覧する (Priority: P1)

Catalogを閲覧する利用者として、公開されたEvent情報をmonth gridに表示したい。これにより、cancellationによってEventがcatalogから
ひそかに消えないようにします。

**Independent Test**: canceledされた単日Event、Occurrenceがcancelledの単日Event、cancelledされた複数日Eventを表示し、月ごとのcount、
band、cancellation cueを比較します。

**Acceptance Scenarios**:

1. **Given** 単日Eventがcancelledされた状態で、**when** その月を表示すると、**then** Catalog publication countに含まれたままである。
2. **Given** activeなEventのOccurrenceがcancelledされた状態で、**when** その月を表示すると、**then** EventはCatalog publication countに
   含まれたままである。countはOccurrenceごとではなくEventごとである。
3. **Given** 複数日Eventがcancelledされた状態で、**when** rangeを表示すると、**then** bandは表示され続け、cancelled状態を識別できる。
4. **Given** cancelledされたEventまたはOccurrenceがselected-day detailで利用可能な状態で、**when** 利用者がdetailを開くと、**then**
   cancelled状態を引き続き識別できる。

### User Story 2 - My Calendarでactiveな参加を計画する (Priority: P1)

My Calendarを確認する利用者として、month markerとcountにactive planningを表したい。cancelledされたParticipationがactiveなcommitmentに
見えないようにするためです。

**Independent Test**: event-levelとoccurrence-levelのcancellationをmonth marker/count projectionに反映し、その後、対応するselected-day
detailを開きます。

**Acceptance Scenarios**:

1. **Given** event-levelまたはoccurrence-levelでeffectively cancelledされたOccurrenceの場合、**when** My Calendarを表示すると、**then**
   active dotにもactive participation countにも加算されない。
2. **Given** cancelledされたOccurrenceがsource/detail dataに残っている状態で、**when** そのselected dayを表示すると、**then** detailは
   引き続き利用可能で、cancelled状態を識別できる。
3. **Given** cancelledされていないOccurrenceまたはPersonal Schedule itemの場合、**when** 月を表示すると、**then** 確立済みのactive
   marker/countの意味は変わらない。

### 共有product境界

Cancellationはdeletionではありません。Catalog publicationとMy Calendarのactive planningは意図的に異なるsurfaceであるため、month gridの
count semanticsも意図的に異なります。

## Requirements _(mandatory)_

- **FR-001**: Catalog month gridは、cancelled Eventとcancelled Occurrenceに関連するEventを含む公開済みEventを表さなければならない。
- **FR-002**: Catalogの単日countはEventごとに1回Eventを数えなければならず、activeのみを対象とするcancellation filterを適用したり、
  Occurrence countにしたりしてはならない。
- **FR-003**: cancelledされたCatalogの複数日Eventは、そのrangeで表され続け、識別可能なcancelled状態を示さなければならない。
- **FR-004**: Catalog selected-day detailはmonth-grid countまたはband projectionとは独立して引き続き利用可能でなければならず、該当時には
  cancellationを識別できなければならない。
- **FR-005**: My Calendarのmonth participation markerとcountはactive planningのみを表さなければならない。
- **FR-006**: My Calendarはevent-levelおよびoccurrence-levelでeffectively cancelledされたOccurrenceをactive participation markerとcountから
  除外しなければならない。
- **FR-007**: cancelledされたOccurrenceをMy Calendarのmonth markerまたはcountから除外しても、selected-day source/detail dataから取り除いては
  ならない。
- **FR-008**: My Calendarのselected-day itemがeffectively cancelledされている場合、selected-day detailはcancelled状態を識別できなければならない。
- **FR-009**: CatalogとMy Calendarは、意図的に非対称なcancellation count semanticsを維持しなければならない。両surfaceでcancellationをdeletionと
  扱ってはならない。

## 対象範囲の境界

この仕様が対象とするのは、CatalogとMy Calendarにおけるuser-visibleなmonth-grid publication、active planning marker/count、cancellation cue、
月表示とselected-day detailの関係だけです。

EventまたはOccurrence schema、cancellation write、Participation lifecycle、Personal Schedule semantics、calendar navigation、weekday convention、
実装構造は定義しません。

## Success Criteria _(mandatory)_

- **SC-001**: 代表的なすべてのmonth-grid caseで、cancelledされたCatalog Eventはpublication countまたはrange bandに引き続き表示されます。
- **SC-002**: effectively cancelledされたMy Calendar Occurrenceはactive participation dot/countに加算されず、selected-day detailからは引き続き
  到達可能です。
- **SC-003**: CatalogとMy Calendarは異なるcancellationの意味を維持し、どちらのsurfaceも他方のfilterを暗黙に採用しません。
- **SC-004**: 代表的なCatalog bandとselected-day detail、およびMy Calendar selected-day detailで、cancelled状態を引き続き識別できます。

## Assumptions

- product calendar dateは既存のAsia/Tokyo conventionに従います。
- 既存のeffective-cancellation ruleが、引き続きMy Calendar participation projectionのauthorityです。
- month gridは引き続きtap targetを限定したcalendarです。この仕様はkeyboard grid navigationや新しいcalendar interaction modelを追加しません。
