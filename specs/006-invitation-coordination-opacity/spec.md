# Living Spec: Invitation coordination / opacity

**Feature Branch**: `006-invitation-coordination-opacity`

**作成日**: 2026-09-19

**Status**: Current behavior contract

**入力**: GitHub Issue #560、現行の実装・schema・RLS・tests、および Issue #548 の
inventory evidence

## 権限境界

この文書は、Occurrence に対する Invitation の現在の product behavior と privacy
boundary の正本です。Invitation は未回答の coordination state を表す bounded な
domain であり、Participation の代替でも、Notifications の履歴でもありません。

Architecture documents、database migrations、generated schema、tests、CI は、
それぞれ構造・mechanical enforcement・regression safety の責務を持ちます。この
文書は RPC 名、SQLSTATE、RLS implementation、UI layout を仕様として定義しません。

Occurrence Participation との直接的な収束だけは
[`specs/001-occurrence-participation/spec.md`](../001-occurrence-participation/spec.md)
にも記録されています。001 は Participation 側から見た accept / attending
convergence の contract を保持し、Invitation の一覧・decline・re-invite・targeting・
opacity 全体を定義しません。

Notifications の inbox、read state、AppBar、通知からの遷移は
[`specs/002-notifications-screen/spec.md`](../002-notifications-screen/spec.md) の
正本です。この文書は Invitation が通知の source になり得ることを越えて、通知
semantics を定義しません。

## ユーザーシナリオと検証

### ユーザーストーリー 1 - Invitation を送信し、pending state を確認する（優先度: P1）

authenticated user として、対象の公演回に参加する予定の相手へ Invitation を送り、
相手が回答するまでの一時的な coordination state として扱いたい。相手の個人的な
Participation state や、登録者全体の一覧を知りたいわけではない。

**Independent Test**: inviter の eligibility、exact-address targeting、invitee の
各 Participation state、pending list の所有者境界を組み合わせて確認する。

**Acceptance Scenarios**:

1. **Given** inviter が対象 occurrence で `attending`、**when** 自分以外の登録済み
   account を exact な email address で指定して invite する、**then** invitee の
   Participation を変更せず pending Invitation が作成される。
2. **Given** inviter が対象 occurrence の Event owner だが `attending` ではない、
   **when** invite する、**then** inviter は invite できない。
3. **Given** invitee に Participation row がない、**when** Invitation を受ける、
   **then** pending Invitation だけが作成され、`considering` は自動作成されない。
4. **Given** invitee が `considering`、**when** Invitation を受ける、**then** pending
   Invitation が作成され、既存の `considering` は変更されない。
5. **Given** invitee が `attending`、**when** invite を試みる、**then** Invitation
   は新規作成されず、invitee の `attending` は変更されない。inviter はこの invitee
   依存の分岐結果を知ることができない。
6. **Given** 同じ inviter・invitee・occurrence の pending Invitation が既にある、
   **when** 同じ invite を再実行する、**then** pending state は重複せず、inviter に
   invitee 依存の状態差が示されない。
7. **Given** invitee が受信した pending Invitation、**when** invitee が Invitation
   一覧を開く、**then** 自分宛の pending Invitation だけを確認できる。送信済み
   Invitation の一覧や、inviter 向けの Invitation history は提供されない。

### ユーザーストーリー 2 - Invitation に回答する（優先度: P1）

invitee として、pending Invitation に対して参加するか参加しないかを選び、回答が
Participation の現在状態と矛盾しない形で収束してほしい。

**Independent Test**: row なし、`considering`、effective cancellation の各状態で
accept / decline を実行し、Participation と pending row の結果を確認する。

**Acceptance Scenarios**:

1. **Given** pending Invitation がある、**when** invitee が「参加する」を選ぶ、
   **then** 通常の Participation 操作と同じ `attending` transition を試みる。
   成功した場合だけ、同じ occurrence・invitee に残る全ての pending Invitation が
   解消される。
2. **Given** 対象 occurrence が effective cancellation 中、**when** invitee が
   「参加する」を選ぶ、**then** Participation の cancellation rule を迂回せず、
   Participation も pending Invitation もそのまま残る。
3. **Given** pending Invitation がある、**when** invitee が「参加しない」を選ぶ、
   **then** Invitation row は即時に削除されて解消され、`not_attending` Participation は
   作られない。
4. **Given** invitee に別途 `considering` Participation がある、**when** Invitation を
   decline する、**then** その `considering` は変更されない。
5. **Given** decline が完了した、**when** invitee が直後に取り消し操作を探す、
   **then** Invitation の undo 操作や、declined history の復元表示は提供されない。
6. **Given** 以前の Invitation が decline または accept により解消され、invitee が
   現在 `attending` ではない、**when** 同じ inviter が後日 invite する、**then**
   新しい pending Invitation を作成できる。過去の decline は恒久的 opt-out ではない。
7. **Given** invitee が accept 後に自分の Participation を withdraw した、**when**
   同じ inviter が再度 invite する、**then** `attending` でない限り re-invite は
   恒久的に禁止されない。
8. **Given** pending Invitation の occurrence が effective cancellation 中、**when**
   invitee がその pending state を処理する、**then** `attending` への accept は
   できず、Participation を作成せずに pending state を解消できる。

### ユーザーストーリー 3 - private state と account identity の境界を保つ（優先度: P1）

ユーザーとして、Invitation の操作によって別ユーザーの private Participation や
account の存在が不用意に開示されないことを期待する。一方で、Invitation を受信した
本人は自分宛の pending state を確認できる。

**Independent Test**: invitee の Participation が row なし・`considering`・`attending`
の場合、登録済み／未登録 email、inviter read、invitee read を別々に確認する。

**Acceptance Scenarios**:

1. **Given** inviter が invite を実行する、**when** invitee の Participation が
   row なし・`considering`・`attending` のいずれかである、**then** invitee 依存の
   分岐結果は inviter に同じ opaque な成功結果として扱われる。
2. **Given** exact email が未登録である、**when**それ以外の invite 条件を満たして
   invite する、**then** account の有無を示す invitee 依存の差分は返さない。
3. **Given** inviter が自分の送った Invitation を通常 read する、**when**対象 row が
   invitee 宛である、**then** row の有無や invitee の Participation state を確認
   できない。
4. **Given** user-facing の invitee 指定を行う、**when**対象を選ぶ、**then** exact
   な登録 email input を使い、generic user directory、user list、autocomplete、
   partial-match search は提供しない。
5. **Given** Invitation が invitee に届く、**when** invitee が自分の一覧を読む、
   **then**他人宛の Invitation や inviter の送信履歴は見えない。

## 機能要件

### Lifecycle と eligibility

- **INV-001**: Invitation の対象は event ではなく、必ず一つの occurrence でなければ
  ならない。
- **INV-002**: Invitation row の存在は未回答の pending coordination state だけを
  表す。accepted / declined の durable history や Invitation history model は持たない。
- **INV-003**: Invite できるのは対象 occurrence で `attending` の Participation を
  持つ authenticated user だけでなければならない。Event owner であることや
  `considering` であることは invite eligibility を与えない。
- **INV-004**: 自分自身への invite はできてはならない。
- **INV-005**: effective cancellation 中の occurrence には新しい Invitation を作成
  できてはならない。
- **INV-006**: invitee の Participation が row なしまたは `considering` の場合、
  pending Invitation は作成できるが、invite operation が invitee の Participation
  を作成・更新してはならない。
- **INV-007**: invitee が既に `attending` の場合、Invitation を新規作成してはならず、
  既存の Participation を変更してはならない。この invitee 依存の no-op は inviter
  へ開示してはならない。
- **INV-008**: 同じ occurrence・inviter・invitee の pending Invitation は重複せず、
  同じ invite の再実行は既存 pending state を壊してはならない。
- **INV-009**: resolved row の不在は、過去に accept または decline されたことを示す
  history として user-facing に利用してはならない。

### receive、accept、decline、re-invite

- **INV-010**: Invitation を受信しただけでは Participation を作成・更新してはならない。
- **INV-011**: accept は Invitation 専用の別 status を作らず、invitee 自身の通常の
  Participation `attending` transition と同じ意味でなければならない。cancellation
  rule を迂回してはならない。
- **INV-012**: invitee がいずれかの supported path で `attending` に到達した場合、
  同じ occurrence・invitee に残る全ての pending Invitation を解消しなければならない。
- **INV-013**: decline は pending Invitation row を即時に削除して解消しなければならず、
  `not_attending` status、別の Participation、または declined history を作っては
  ならない。
- **INV-014**: decline は invitee の既存の `considering` Participation を変更しては
  ならない。
- **INV-015**: decline 完了後に Invitation を undo する current operation は提供しては
  ならない。過去の decline は後日の re-invite を恒久的に禁止してはならない。
- **INV-016**: invitee が現在 `attending` でなければ、同じ inviter は解消済みの過去の
  Invitation に依存せず、新しい pending Invitation を作成できなければならない。

### targeting と pending list

- **INV-017**: user-facing の invitee targeting は対象 account の exact な登録 email
  address input に限定しなければならない。raw internal user UUID を要求してはならない。
- **INV-018**: generic user directory、user list、autocomplete、partial-match または
  fuzzy search、generic な email-to-user lookup surface を提供してはならない。
- **INV-019**: 未登録 email への external email delivery、pending account invitation、
  contact system は current Invitation scope に含めてはならない。
- **INV-020**: Invitation list は authenticated invitee 自身が受け取った current pending
  Invitation のみを対象とし、送信済み Invitation や inviter 向け history を表示して
  はならない。

### privacy と opacity

- **INV-021**: invite operation の inviter-visible な成功結果は invitee の Participation
  state、Invitation row の有無、account の存在によって変化してはならない。
- **INV-022**: invitee の private Participation state を、invite の結果・list・read・
  error の差分から inviter が推測できる新しい経路を開いてはならない。
- **INV-023**: 通常の Invitation read は invitee 本人に限定されなければならない。
  inviter は、自分が作成した Invitation であっても invitee 宛 row の有無を通常 read
  で確認できてはならない。
- **INV-024**: self-invite、malformed input、inviter の非attending、effective
  cancellation など caller または shared occurrence 自身の条件に関する拒否は、
  invitee の private state を理由にした分岐と混同してはならない。

## ドメイン間の責務境界

### Occurrence Participation（Spec 001）

- Invitation は Participation を表さず、受信だけで Participation を作らない。
- accept は通常の `attending` transition へ収束し、cancellation rule を迂回しない。
- `attending` への到達による pending Invitation の解消は、Invitation UI だけでなく
  通常の Participation path にも適用される。
- decline は Invitation の response だけであり、`not_attending` を作らず、既存の
  `considering` を変更しない。
- Participation の status、visibility、cancellation、calendar presentation の
  詳細は Spec 001 が定義する。この文書はその直接的な Invitation contract を越えて
  001 を拡張しない。

### Notifications（Spec 002）

- Invitation が notification source になる場合でも、Notification の inbox、read
  state、ordering、AppBar、source unavailable 表示は Spec 002 が定義する。
- `/notifications` は accept / decline の場所ではなく、Invitation lifecycle や
  Invitation history の authority でもない。
- この文書は notification kind、通知 retention、read 操作、通知画面のlayoutを定義
  しない。

## スコープ境界

このSpecに含むのは、pending-only lifecycle、received / accept / decline、re-invite
eligibility、inviter eligibility、exact-address targeting、pending list、privacy / opacity、
および Participation / Notifications との直接的な境界です。

次は含めません。

- RPC、SQLSTATE、RLS policy、trigger、schema の implementation detail
- Invitation history model、sent-invitation history、user directory、social graph
- Notifications inbox/read-state/AppBar のsemantics
- UI layout、design system、screen loading の共通規則
- Participation lifecycle 全体、Personal Schedule、generic identity architecture
- historical migration narrative、旧Issueの設計経緯

## 成功基準

- **SC-001**: receive、accept、decline、generic attending convergence の全てで、
  Participation の有無と `considering` / `attending` の結果が一意に説明できる。
- **SC-002**: decline 後に undo 行・declined history・`not_attending` が current product
  state として残らず、非`attending` の invitee には再招待の余地が保たれる。
- **SC-003**: inviter eligibility、effective cancellation、self-invite、duplicate
  pending の各境界で、invitee private state を必要以上に開示しない。
- **SC-004**: Invitation list が受信者本人の pending state に限定され、送信履歴・generic
  directory・他人の row を提供しないことを確認できる。
- **SC-005**: Spec 001 が Participation 側の直接収束だけを持ち、Spec 002 が Notification
  surface だけを持ち、このSpecがInvitation lifecycle / opacityを一意に持つ。
- **SC-006**: current runtime、RPC、RLS、trigger、schema、relevant tests に対して、
  このauthority cutoverによる product behavior change がない。

## 前提

- 利用者は authenticated account を持ち、対象 occurrence は既存の Event に属する。
- 現在の Invitation は current state のみを表し、accept / decline の履歴を保持しない。
- email による account resolution は trusted boundary 内の operation-specific な処理で
  あり、generic な directory capability ではない。
- product の日付・時刻表示は既存の Asia/Tokyo behavior に従う。
