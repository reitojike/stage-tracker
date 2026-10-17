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

cross-screen UX convention は [`docs/ux-ui.md`](../../docs/ux-ui.md) が所有します。
Share Sheet、recipient list、loading / error / empty state、成功・失敗の exact presentation
と copy は current runtime と tests が所有します。runtime、schema、RLS、read / write
boundary、migration、RPC、action、component、route、tests は current behavior を裏付ける
supporting evidence であり、この文書へ mechanics として再定義しません。

## User Scenarios & Testing

### 段階移行中の画面操作

新しい共有は、owner が登録済みの相手を選んで追加します。共有相手登録の申請・承認・
呼び名・登録解除は [Spec 013](../013-schedule-contact-registration/spec.md) が所有します。
利用可能な状態を確認できなければ新操作を止め、旧email入力による共有へ戻しません。

登録導入前の既存共有は、owner による確認・個別解除とrecipient の閲覧・自己離脱を維持します。
既存共有を登録世代へ一括移行し、すべての読取でその関係を必須とする後続段階は未採用です。
この移行中の既存可視性を、相互承認の成立や全readの登録必須化とみなしません。

### Scenario 1: private entry を特定の recipient と共有する

Personal Schedule entry は private by default です。sharing は entry 単位かつ recipient
単位の visibility grant であり、share によって entry の owner、identity、時間表現、
blocking、lifecycle は変わりません。recipient は owner にはなりません。

sharing を開始できるのは entry の owner だけです。新しい共有では、本人が参加する有効な
登録関係から相手を選択します。メールやraw internal user UUIDを共有先キーとして入力させず、
generic directory、全利用者の一覧、partial / fuzzy lookup、generic email-to-user lookup を提供しません。
初回の登録申請にだけ使う完全一致メールと、その存在推測を抑える受付は Spec 013 の責務です。

registered account だけが recipient になれます。self-share、pending account、external
share、external email delivery は current behavior ではありません。

### Scenario 2: share は即時の visibility grant である

登録済みrecipient への successful share は即時に visibility を付与します。
登録時の相手本人の承認と、予定ごとの明示共有は別です。予定ごとのrecipient approval、
Invitation、pending acceptance state machine はありません。登録だけでは予定を公開しません。

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
同じ entry を、有効な登録関係に基づき再共有できます。

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
- **PSH-003**: sharing を開始できるのはowner だけであり、新しい共有は本人が参加する有効な登録関係から相手を選ぶ。
- **PSH-004**: メールやraw internal user UUIDの入力、generic directory、全利用者の一覧、partial /
  fuzzy lookup、generic email-to-user lookup を新規共有先の指定に使わない。
- **PSH-005**: registered account だけが recipient になり、self-share、pending account、
  external share、external email delivery を作成しない。
- **PSH-006**: 初回の完全一致メールによる登録申請と存在推測を抑える受付は Spec 013 に従う。
  旧email共有経路をaccount existence query や新規共有のfallback として利用できない。

### Grant and owner management

- **PSH-007**: 登録済み相手へのsuccessful share は予定ごとの追加承認なしに即時visibility grant になる。
  登録時の相手本人の承認は必要であり、登録だけでは予定を公開しない。
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
- **PSH-014**: self-leave は自分の share relation と visibility だけを解除して登録関係を維持し、entry delete、
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
- **PSH-019**: 共有相手登録が利用可能でない場合は画面から新しい共有を追加せず、
  確認できない状態を利用可能や空の成功として扱わない。既存共有の確認・個別解除・閲覧・
  自己離脱は維持する。登録済み相手への新しい共有を従来の email 入力へ fallback しない。
- **PSH-020**: Home・Calendar・共有された予定の詳細へ履歴で戻る場合やタブを再表示する場合、
  共有予定は新しい認証付き読取結果を確認してから表示する。確認中、低速応答、通信断、読取失敗では
  過去の共有予定を再表示しない。自分の予定と入力中の状態は維持し、共有予定の件数・帯・補助ラベルも
  同じ確認結果に従う。共有失効後の詳細と存在しない詳細は区別させない。
- **PSH-021**: 登録解除はSpec 013 に従い二者間の両方向の既存共有を失効させる。
  予定本体と第三者共有は維持し、再登録で過去の共有を復活させない。
- **PSH-022**: 登録導入前の既存共有のread・個別解除・自己離脱を維持し、自動承認・一括失効を行わない。
  既存共有の登録世代への一括移行と全readの登録必須化を、実装済みとして扱わない。

## Cross-domain Boundary

- Entry identity、Event / Occurrence からの独立性、creator / owner、ownership transfer が
  current operation でないこと、title / memo、all-day / multi-day / time-bounded、blocking
  自体の意味、owner create / edit / delete、hard-delete lifecycle、Calendar / Home composition
  は [Spec 007](../007-personal-schedule-lifecycle/spec.md) が authority です。この文書は
  sharing がそれらを変えないことだけを定義します。
- 共有相手の登録・申請・承認・呼び名・登録解除とメール変更時の本人境界は
  [Spec 013](../013-schedule-contact-registration/spec.md) が authority です。
- Invitation の pending coordination、exact email targeting、invitee private state の
  opacity、Invitation row の opacity は [Spec 006](../006-invitation-coordination-opacity/spec.md)
  が authority です。共有相手登録や予定共有を公演Invitation と同じ同意関係として扱いません。
- Magic Link request の registered / unregistered、send success / failure を enumeration
  oracle にしない保証は [Spec 009](../009-authentication-account-access/spec.md) が authority
  です。共有相手登録を「authenticated ならaccount lookup 可能」という一般則にしません。
- Share Sheet、recipient list、button placement、owner / shared UI state、empty / loading /
  error / success presentation と exact copy は current runtime と tests が所有し、
  cross-screen UX convention は [`docs/ux-ui.md`](../../docs/ux-ui.md) に従います。

## Scope Boundaries

この仕様は Personal Schedule sharing / recipient privacy の finite current semantics を
扱います。次は current behavior として扱いません。

- collaborative editing、recipient edit capability、予定ごとのrecipient approval、pending share
- external share、external email delivery、generic user directory、people search、公開SNS・group
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
- **SC-002**: owner-onlyの登録済み相手選択、self-share 禁止、registered-only boundary、
  初回登録のexact-email指定とgeneric lookup 禁止を区別できる。
- **SC-003**: 登録時の相互承認、予定ごとのimmediate grant と追加承認の不在、entry × recipient の
  idempotency を区別して検証できる。
- **SC-004**: bounded owner recipient projection、owner revoke、recipient read-only capability、
  self-leave と他 recipient privacy を検証できる。
- **SC-005**: current full content、blocking override の不在、non-visible / nonexistent の
  indistinguishable detail outcome、owner delete 後の share consequence を検証できる。
- **SC-006**: Spec 006 / 007 / 009 / 013、screens presentation、runtime / DB / RLS mechanics の
  authority boundary が混線していない。
- **SC-007**: future semantics や implementation mechanics が current product behavior として
  昇格していない。

## Assumptions

- 対象利用者は authenticated account を持ち、recipient は registered account です。
- existing share relation は visibility grant そのものであり、pending invitation の代替では
  ありません。
- runtime、schema、RLS、tests はこの current behavior を機械的に enforce / verify する
  supporting evidence です。
