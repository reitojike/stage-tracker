# Installable standalone Web App 現行仕様

**Feature Branch**: `codex/issue-566-installable-standalone`

**Status**: Current behavior contract
**Scope**: browser に加わる installable / standalone Web App delivery surface

## Authority Boundary

この文書は、stage-tracker を通常の browser 利用に加えて Android / iOS の
home screen から利用する現行の delivery surface における normative authority
です。install、standalone launch、installed application identity、installability
に必要な bounded public resources、および offline / Push / native packaging を
current behavior としない境界を定義します。

認証、account access、authenticated application route の default-deny と
security semantics は
[`specs/009-authentication-account-access/spec.md`](../009-authentication-account-access/spec.md)
が担います。manifest の生成、exact asset path、proxy matcher、public-path
実装、HTTP enforcement は
[`docs/architecture/authentication.md`](../../docs/architecture/authentication.md)
と runtime / test が担い、この文書で mechanism を再定義しません。

## User Scenarios & Testing

### Scenario 1: browser に加えて home screen から利用する

stage-tracker は通常の browser で利用できることに加えて、Android では home
screen に install し、iOS では Home Screen Web App として追加して利用できる
supported delivery surface を提供します。installed surface は browser 利用を
置き換えるものではなく、同じ authenticated application を別の supported な
起動 context から利用する形です。

### Scenario 2: standalone Web App として起動する

home screen から起動した installed surface は `standalone` Web App mode で
起動します。standalone context でも、認証済み application の account access と
各 domain の user-visible semantics は変わりません。

### Scenario 3: installed application identity を維持する

installed application identity は stable に扱います。通常の refactor や route
整理の都合で identity を不用意に変更し、既に install 済みの application を別の
application として扱わせることは current behavior と両立しません。

### Scenario 4: 認証前に install resource を評価する

installability の評価に必要な manifest と bounded application icon resources は
未認証で取得できます。この例外は install resource の bounded availability に
限られ、authenticated application route の公開や、未認証での application
利用を意味しません。

### Scenario 5: installed context で各 domain を利用する

standalone surface は同じ authenticated application の delivery context です。
Calendar、Catalog、Event / Occurrence、Invitation、Personal Schedule、
TicketOpportunity、account access などの domain semantics は、それぞれの
Living Spec が定義し、この文書では再定義しません。

## Requirements

### Supported delivery surface

- **PWA-001**: Android home-screen install は current の supported behavior である。
- **PWA-002**: iOS Home Screen Web App としての追加・起動は current の supported behavior である。
- **PWA-003**: installed surface は `standalone` Web App として起動する。
- **PWA-004**: standalone surface は通常の browser 利用に追加された delivery context であり、別の product account や別の domain semantics を作らない。

### Stable identity

- **PWA-005**: installed application identity は stable に扱い、実装都合で不用意に変更しない。

### Install resources and authentication boundary

- **PWA-006**: installability の評価に必要な manifest / application icon resources は bounded な範囲で未認証取得できる。
- **PWA-007**: PWA resource の公開例外は authenticated application route の default-deny を緩めず、application route を public resource として扱わない。

### Explicit non-current capability

- **PWA-008**: installability は offline capability を意味しない。
- **PWA-009**: Service Worker、offline cache、offline read、offline write、Background Sync、Web Push は current behavior ではない。
- **PWA-010**: native packaging / native distribution（TWA、Google Play、Capacitor、React Native 等）は current behavior ではない。

## Cross-domain Boundary

- authenticated application route の default-deny、authentication、account access、
  security semantics は
  [`Spec 009`](../009-authentication-account-access/spec.md) が定義する。この文書は
  PWA-006 / PWA-007 の install-resource boundary だけを参照し、Auth の規則を
  重複所有しない。
- exact manifest / icon path、manifest generation、`PUBLIC_PATHS`、proxy matcher、
  regex / matcher literal、Supabase/session mechanics、HTTP enforcement は
  [`docs/architecture/authentication.md`](../../docs/architecture/authentication.md)
  と runtime / test が定義する。
- Occurrence Participation は [`Spec 001`](../001-occurrence-participation/spec.md)、
  Notifications は [`Spec 002`](../002-notifications-screen/spec.md)、
  TicketOpportunity timeline は [`Spec 003`](../003-ticket-opportunity-timeline/spec.md)、
  Calendar の month-grid semantics は [`Spec 004`](../004-calendar-month-grid/spec.md)、
  Event / Occurrence と Catalog の domain semantics は [`Spec 005`](../005-event-occurrence-lifecycle/spec.md)、
  Invitation は [`Spec 006`](../006-invitation-coordination-opacity/spec.md)、
  Personal Schedule は [`Spec 007`](../007-personal-schedule-lifecycle/spec.md)、
  TicketOpportunity planning / personal state は [`Spec 008`](../008-ticket-opportunity-planning/spec.md)、
  account access は [`Spec 009`](../009-authentication-account-access/spec.md) が担う。
  standalone delivery context を理由にこれらを再定義しない。
- exact filenames、icon sizes、manifest field wiring、route layout、browser platform
  implementation difference は structure / runtime / test evidence であり、この
  Living Spec の product rule ではない。

## Scope Boundaries

この仕様は installable / standalone Web App の現行 user-visible semantics と、
install resource と authenticated application route の境界を扱います。

Service Worker implementation、cache strategy、offline data model、Background
Sync、Web Push subscription / notification lifecycle、native packaging、manifest
生成機構、proxy / matcher の exact syntax、icon asset の作成・変更、Auth provider
や session の redesign は扱いません。

## Success Criteria

- **SC-001**: Android / iOS home-screen support と standalone launch を supported behavior として一意に説明・検証できる。
- **SC-002**: installed application identity を stable に扱う product requirement を一意に説明・検証できる。
- **SC-003**: bounded manifest / icon resource availability と authenticated application route の default-deny を矛盾なく検証できる。
- **SC-004**: installability が offline、Web Push、Background Sync、native packaging を意味しないことを検証できる。
- **SC-005**: domain semantics と exact runtime / authentication mechanics がそれぞれの既存 authority に残り、Spec 010 と重複しないことを差分で確認できる。

## Assumptions

- Issue #304 の completion evidence に記録された Android / iOS 実機確認は、current supported delivery surface の provenance です。
- install resource の bounded public availability は、認証前に installability を評価できるためのものです。未認証の application route を新設するものではありません。
- offline / Web Push の future intent は product planning authority に残り、current behavior としてこの仕様へ昇格しません。
