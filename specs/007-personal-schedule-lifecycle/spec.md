# Personal Schedule ライフサイクル現行仕様

**Status**: Current behavior contract
**Scope**: Eventから独立したPersonal Schedule entryのidentity、時間表現、blocking、owner lifecycle、Calendar / Homeへの合成境界

## Authority Boundary

この文書は、Personal Schedule entryの現行のuser-visible / domain semanticsにおける
normative authorityです。既存のruntime、schema、RLS、testsはこの仕様を実装・検証する
supporting evidenceであり、implementation detailをこの文書で再定義しません。

Calendar / Homeは、このentryを既存の計画情報と合成して表示するcomposition surfaceです。
それらの画面構成や読み取り方法を、この文書の仕様として定義しません。

## User Scenarios & Testing

### Scenario 1: Eventから独立した個人予定を持つ

利用者は、EventやOccurrenceを作成・選択しなくても、自分の予定をPersonal Schedule
entryとして登録できます。entryは固有のidentityを持ち、Event / Occurrenceへの従属や
自動的な紐付けを持ちません。

entryの作成者がそのentryのownerです。entryのlifecycle identityは、後からCalendarや
Homeに表示されたこと、または他の利用者へ共有されたことによって変わりません。

### Scenario 2: 自由な件名と予定内容を登録する

entryには、利用者が入力する空でないfree-formのtitleがあります。固定されたカテゴリや
固定された種別の語彙を選択しないと登録できないモデルではありません。必要に応じて
memoも保持できます。

### Scenario 3: all-dayの予定を登録する

entryは、Asia/Tokyoのcalendar dateによるall-dayの時間表現を持てます。開始日と終了日
は両端を含む範囲で、開始日と終了日が同じsingle-dayと、終了日が後の日付になる
multi-dayの両方を表現できます。終了日は開始日より前にはなりません。

### Scenario 4: time-boundedの予定を登録する

entryは、開始instantを持つtime-boundedの時間表現を持てます。終了instantは未確定の
ままでもよく、その場合に暗黙の終了時刻を補いません。終了instantを持つ場合は、開始
instantと同じ時刻または後の時刻です。

all-dayとtime-boundedはentryが持つ時間表現の別々の形であり、1つのentryを両方の形で
同時に扱いません。

### Scenario 5: blockingを予定の時間表現から独立して扱う

entryは、時間表現から導出されないblocking属性を持ちます。

- blockingがtrueのentryは、その時間帯を空き時間として扱わず、event予定を入れたくない
  時間として扱います。
- blockingがfalseのentryはCalendar等に予定として表示できますが、空き時間をblockする
  予定としては扱いません。

all-dayでもtime-boundedでも、blockingのtrue / falseを選択できます。

### Scenario 6: ownerがentryを管理する

ownerは自分のentryを作成、編集、削除できます。編集ではtitle、memo、blocking、時間表現
を更新できます。owner以外の利用者はentryのlifecycleを編集・削除できません。

削除はentryを完全に取り除く不可逆な操作です。削除済みのentryを復元したり、削除履歴を
Personal Scheduleの現行lifecycleとして扱ったりしません。

この文書は、別の利用者にentryを見せるためのsharing、recipientのprivacy、共有相手の
操作については定義しません。現行のsharing / recipient privacy authorityは
[Personal Schedule sharing / recipient privacy Living Spec](../012-personal-schedule-sharing-privacy/spec.md)
です。

## Requirements

### Identity and independence

- **PS-001**: Personal Schedule entryはEvent / Occurrenceとは独立したidentityを持ち、
  Event / Occurrenceの存在、選択、変更に依存しない。
- **PS-002**: entryの作成者がownerであり、Calendar / Homeへの表示やsharingによって
  entryのownerまたはidentityは変化しない。ownership transferはcurrent Personal Schedule
  lifecycle operationではない。
- **PS-003**: entryは固定カテゴリや固定種別を持たず、空でないfree-form titleを持つ。
- **PS-004**: memoはentryに付随する任意の内容として扱い、entryのidentityや時間表現を
  置き換えない。

### Temporal forms

- **PS-005**: entryはall-dayまたはtime-boundedのいずれか1つの時間表現を持つ。
- **PS-006**: all-dayはAsia/Tokyoのcalendar dateによるinclusiveな開始日・終了日範囲で、
  single-dayとmulti-dayを表現できる。開始日は終了日以前である。
- **PS-007**: time-boundedは開始instantを必須とし、終了instantを未確定のまま保持できる。
  終了instantがある場合は開始instantより前にならない。
- **PS-008**: time-boundedの終了instantが未確定の場合、製品は暗黙の終了時刻を補わない。

### Blocking and ownership

- **PS-009**: blockingは時間表現から独立したentry属性であり、all-day / time-boundedの
  どちらにも設定できる。
- **PS-010**: blocking=trueはentryの時間を空き時間として扱わない意味を持ち、
  blocking=falseは表示されても空き時間をblockしない意味を持つ。
- **PS-011**: ownerは自分のentryを作成、編集、削除できる。
- **PS-012**: owner以外の利用者はentryのlifecycleを編集・削除できない。
- **PS-013**: entryの削除は不可逆な完全削除であり、復元や削除履歴をcurrent lifecycleへ
  導入しない。

## Calendar / Home Boundary

- **PS-014**: CalendarはParticipationとPersonal Scheduleを同じ予定表示面へ合成するが、
  Personal Schedule entryをEvent / OccurrenceまたはParticipationへ変換しない。
- **PS-015**: Calendar上のentry表示は、entry自身のall-day / multi-day / time-boundedの
  時間表現とblockingを反映する。Calendarへの表示はentryのlifecycle操作権限を拡張しない。
- **PS-016**: Homeは、Personal ScheduleとParticipationを「直近の予定」として合成できるが、
  その合成はentryのidentity、owner、時間表現、blockingを変更しない。
- **PS-017**: Calendar / Homeの合成は、Personal Schedule entryとEvent / Occurrenceの
  product concept上の独立性を保つ。どちらのsurfaceもEventに紐付かないentryへEvent由来の
  lifecycle意味を付与しない。

## Cross-domain Boundary

Personal Scheduleのsharing、recipient privacy、共有相手のcapabilityは、この文書の
scope外です。現行semanticsは
[Personal Schedule sharing / recipient privacy Living Spec](../012-personal-schedule-sharing-privacy/spec.md)
がauthorityです。この文書は、sharingの有無がentryのidentity、owner、時間表現、blocking、
Calendar / Homeでの合成境界を変えないことだけを前提とします。

ParticipationのstatusやvisibilityはParticipationのLiving Specが定義します。Event /
Occurrenceのlifecycleは[Event / Occurrence Living Spec](../../specs/005-event-occurrence-lifecycle/spec.md)
がauthorityです。この文書は、Personal Schedule entryをそれらのdomainのstateとして再定義
しません。

## Scope Boundaries

この仕様は、Event-independent Personal Schedule entryのcurrent lifecycle semanticsを
扱います。entry identity、free-form title、memo、all-day / multi-day all-day /
time-bounded、blocking、owner capability、Calendar / Homeとの意味上のboundaryを対象と
します。

sharing / recipient privacy、data read strategy、paging、entryLookup、RPC、SQLSTATE、
RLS、schema、form / UI implementation、route、file pathはこの文書の仕様として扱いません。

## Success Criteria

- **SC-001**: Event / Occurrenceに依存しないentry identityとowner境界を、Calendar / Home
  への表示有無と混同せず説明・検証できる。
- **SC-002**: free-form title、all-dayのsingle-day / multi-day、time-boundedの未確定終了を
  含む全てのcurrent temporal formを、暗黙の固定種別や終了時刻なしに検証できる。
- **SC-003**: blockingのtrue / falseが時間表現から独立し、空き時間の扱いの違いとして検証
  できる。
- **SC-004**: ownerのcreate / edit / deleteと、owner以外のlifecycle非変更を検証できる。
- **SC-005**: Calendar / HomeがPersonal Scheduleを他の予定情報と合成して表示しても、
  entryのidentity、ownership、時間表現、blockingを変更しないことを検証できる。
- **SC-006**: sharing / recipient privacyとdata-access / transport / implementation詳細が
  この文書に混入せず、別のauthority境界へ追跡できる。

## Assumptions

- 利用者はauthenticated accountを持ち、entryの作成者がownerになります。
- date / timeの解釈は、現行のAsia/Tokyo calendar dateとabsolute instantの境界に従います。
- schema、RLS、runtime、testsはこのcurrent behaviorを機械的にenforce / verifyする supporting
  evidenceです。
- sharing / recipient privacyの専用Living Specは、Personal Schedule lifecycleとは別の
  bounded semantics boundaryとして materializeされます。
