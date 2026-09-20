# Personal Schedule sharing / recipient privacy 現行仕様

**Status**: Current behavior contract

**Scope**: Personal Schedule entry の sharing、recipient capability、visibility と
recipient privacy boundary

## Authority Boundary

この文書は、Personal Schedule entry を owner が特定の recipient へ共有するときの
current product behavior と recipient privacy boundary の normative authority です。
sharing は entry の lifecycle や identity を置き換えず、entry 単位・recipient 単位の
visibility grant として扱います。

[Personal Schedule lifecycle Living Spec](../007-personal-schedule-lifecycle/spec.md) は、
entry identity、Event / Occurrence からの独立性、時間表現、blocking の意味、owner の
create / edit / delete、および Calendar / Home composition の authority です。この文書は
それらを再定義せず、sharing がそれらを変えない境界だけを定義します。

画面の layout、copy、Share Sheet、recipient list、loading / error / empty state、成功・
失敗 feedback は [`docs/screens.md`](../../docs/screens.md) が presentation authority です。
runtime、schema、RLS、read / write boundary、migration、RPC、action、component、route、
tests は current behavior を裏付ける supporting evidence であり、この文書へ mechanics と
して再定義しません。

## User Scenarios & Testing

### Scenario 1: private entry を特定の recipient と共有する

Personal Schedule entry は private by default です。sharing は entry 単位かつ recipient
単位の visibility grant であり、share によって entry の owner、identity、時間表現、
blocking、lifecycle は変わりません。recipient は owner にはなりません。

sharing を開始できるのは entry の owner だけです。user-facing な target は exact な
registered email address であり、raw internal user UUID を入力させません。generic directory、
user list、autocomplete、partial / fuzzy lookup、generic email-to-user lookup は current
behavior ではありません。

対象 email が registered account でない場合、owner が自分の entry に対して行うこの
operation-specific な bounded flow では、その exact email が未登録であることを知らせて
よい。ただしこれは generic account existence query、people search、directory、または
arbitrary account enumeration API ではありません。

registered account だけが recipient になれます。self-share、pending account、external
share、external email delivery は current behavior ではありません。

### Scenario 2: share は即時の visibility grant である

registered recipient への successful share は即時に visibility を付与します。recipient の
approval、invitation、pending acceptance state machine はありません。

同じ entry と recipient の active share は一つです。supported な再共有は idempotent で、
duplicate grant や share-history event を作りません。

### Scenario 3: owner が recipient を確認・revoke する

owner は自分が管理する entry について、existing shared recipients を bounded に確認でき、
recipient email を識別できます。この projection は対象 entry の existing share relation
だけに限定され、global user directory、whole-account list、arbitrary email lookup では
ありません。

owner は recipient を revoke できます。revoke は対象 recipient の visibility だけを解除し、
entry 本体、owner、他の recipient には影響しません。revoke は entry deletion ではありません。

### Scenario 4: recipient は read と self-leave だけを行う

recipient は shared entry の current content を read できますが、entry content の edit、
entry lifecycle の変更、recipient の追加、他 recipient の revoke はできません。

recipient は自分自身の share relation だけを self-leave のために resolve / read できます。
他 recipient の relation を enumerate したり、owner 向けの recipient email projection を
利用したり、arbitrary share relation を選択して管理したりはできません。

self-leave は自分の visibility と share relation だけを外す operation です。entry の
delete ではなく、owner や他 recipient に影響しません。durable な rejection、decline、
opt-out、share-history は作らず、permanent opt-out でもありません。owner は later に
同じ entry を再共有できます。

### Scenario 5: recipient が読む内容と privacy boundary

recipient に見えるのは busy-only projection ではなく、entry 自身の current schedule content
です。recipient 別の field subset や permission set は current behavior ではありません。

blocking は entry 自身の既存 state をそのまま共有結果として読みます。この sharing model
は recipient 別の blocking override や recipient 独自の blocking value を導入しません。

normal detail read では、non-owner に existing but non-visible entry と nonexistent entry
を区別させません。owner は自分の entry の bounded recipient projection を読めますが、
recipient および unrelated user は他 recipient や unrelated な share relation を enumerate
できません。

owner が entry を hard-delete した場合、entry 自体が存在しなくなるため、visibility grant は
source entry より長く存続しません。recipient はその entry を見続けられません。この文書は
その sharing consequence を定義しますが、削除の FK や share-row cleanup の mechanics は
定義しません。

## Requirements

### Visibility and targeting

- **PSH-001**: Personal Schedule entry は private by default であり、sharing は entry 単位・
  recipient 単位の visibility grant である。
- **PSH-002**: sharing によって entry の identity、owner、時間表現、blocking、lifecycle は
  変化せず、recipient は owner にならない。
- **PSH-003**: sharing を開始できるのは owner だけであり、user-facing target は exact な
  registered email address である。
- **PSH-004**: raw internal user UUID、generic directory、user list、autocomplete、partial /
  fuzzy lookup、generic email-to-user lookup は current targeting surface ではない。
- **PSH-005**: registered account だけが recipient になり、self-share、pending account、
  external share、external email delivery を作成しない。
- **PSH-006**: owner が自分の entry に対して exact email で行う bounded share operation では、
  未登録 email であることを知らせてよい。ただし generic account existence query や account
  enumeration API へ一般化しない。

### Grant and owner management

- **PSH-007**: successful share は recipient approval なしに即時 visibility grant になる。
- **PSH-008**: active share は entry と recipient の組ごとに一つであり、supported な再共有は
  idempotent で duplicate grant / share-history event を作らない。
- **PSH-009**: owner は自分の entry の existing recipients を bounded な email projection
  で確認できる。この projection は対象 entry の existing share relation に限られる。
- **PSH-010**: owner の revoke は対象 recipient の visibility だけを解除し、entry、owner、
  他 recipient を変更しない。

### Recipient capability

- **PSH-011**: recipient は shared entry の current content を read できるが、entry content
  を edit したり entry lifecycle を変更したりできない。
- **PSH-012**: recipient は recipient を追加したり、他 recipient を revoke したりできない。
- **PSH-013**: recipient は self-leave に必要な自分自身の share relation だけを resolve / read
  でき、他 recipient の relation、owner の email projection、arbitrary share relation を
  enumerate / manage できない。
- **PSH-014**: self-leave は自分の share relation と visibility だけを解除し、entry delete、
  owner・他 recipientへの影響、durable rejection / decline / opt-out history、permanent
  opt-out を導入しない。later re-share を禁止しない。

### Shared content and read privacy

- **PSH-015**: recipient は busy-only projection ではなく current schedule content を読み、
  recipient 別 field subset や permission set は current behavior ではない。
- **PSH-016**: recipient は entry に既に存在する blocking state を読み、sharing は per-recipient
  blocking override や recipient 独自の blocking value を導入しない。
- **PSH-017**: normal detail read は existing but non-visible entry と nonexistent entry を
  non-owner に区別させない。
- **PSH-018**: owner hard-delete の後は source entry が存在しないため、share visibility grant
  が recipient に残ってその entry を見せ続けることはない。

## Cross-domain Boundary

- Entry identity、Event / Occurrence からの独立性、creator / owner、ownership transfer が
  current operation でないこと、title / memo、all-day / multi-day / time-bounded、blocking
  自体の意味、owner create / edit / delete、hard-delete lifecycle、Calendar / Home composition
  は [Spec 007](../007-personal-schedule-lifecycle/spec.md) が authority です。この文書は
  sharing がそれらを変えないことだけを定義します。
- Invitation の pending coordination、exact email targeting、invitee private state の
  opacity、Invitation row の opacity は [Spec 006](../006-invitation-coordination-opacity/spec.md)
  が authority です。Invitation の opacity を Schedule sharing へコピーせず、Schedule
  sharing の narrow unregistered-email disclosure を Invitation へ一般化しません。
- Magic Link request の registered / unregistered、send success / failure を enumeration
  oracle にしない保証は [Spec 009](../009-authentication-account-access/spec.md) が authority
  です。authenticated owner の自分の entry に対する operation-specific な share flow を、
  「authenticated なら account lookup 可能」という一般則にしません。
- Share Sheet、recipient list、button placement、owner / shared UI state、empty / loading /
  error / success presentation と exact copy は [`docs/screens.md`](../../docs/screens.md) の
  presentation authority です。

## Scope Boundaries

この仕様は Personal Schedule sharing / recipient privacy の finite current semantics を
扱います。次は current behavior として扱いません。

- collaborative editing、recipient edit capability、recipient approval、pending share
- external share、external email delivery、generic user directory、people search、social graph
- profiles subsystem、field-level permission、per-recipient permission set、busy-only privacy
- per-recipient blocking override、permanent never-share-again、durable rejection、share / revoke /
  rejection history
- ownership transfer

table、FK、unique constraint、RLS policy、SECURITY DEFINER、RPC、Server Action、helper、SQLSTATE、
PostgREST error mapping、raw-message fallback、ON CONFLICT、query shape、generated type、branded
ID、paging、route、file path、redirect、schema、migration、UI implementation はこの仕様の
product authority ではありません。

## Success Criteria

- **SC-001**: private default、entry × recipient grant、owner / recipient の identity と
  lifecycle の分離を説明・検証できる。
- **SC-002**: owner-only exact registered-email targeting、self-share 禁止、registered-only
  boundary、narrow unregistered-email disclosure と generic lookup 禁止を区別できる。
- **SC-003**: immediate grant、approval / pending state machine の不在、entry × recipient の
  idempotency を検証できる。
- **SC-004**: bounded owner recipient projection、owner revoke、recipient read-only capability、
  self-leave と他 recipient privacy を検証できる。
- **SC-005**: current full content、blocking override の不在、non-visible / nonexistent の
  indistinguishable detail outcome、owner delete 後の share consequence を検証できる。
- **SC-006**: Spec 006 / 007 / 009、screens presentation、runtime / DB / RLS mechanics の
  authority boundary が混線していない。
- **SC-007**: future semantics や implementation mechanics が current product behavior として
  昇格していない。

## Assumptions

- 対象利用者は authenticated account を持ち、recipient は registered account です。
- existing share relation は visibility grant そのものであり、pending invitation の代替では
  ありません。
- runtime、schema、RLS、tests はこの current behavior を機械的に enforce / verify する
  supporting evidence です。
