# Authentication / account-access 現行仕様

**Status**: Current behavior contract
**Scope**: provisioned account の認証、日常の credential、application route へのアクセス境界

## Authority Boundary

この文書は、stage-tracker の利用者が account にアクセスするときの現行
user-visible / security semantics における normative authority です。account の
provisioning、Magic Link、Passkey、account enumeration 防止、protected route の
default-deny、redirect state の安全境界を定義します。

[`docs/architecture/authentication.md`](../../docs/architecture/authentication.md) は
provider、runtime、browser/server capability、cookie、route、設定および検証の
mechanism / structure を担います。runtime、schema、RLS、E2E / unit test は
この仕様の機械的な enforcement と回帰検証を担い、Issue #563 は authority cutover
の変更意図を担います。これらの実装詳細をこの文書で再定義しません。

## User Scenarios & Testing

### Scenario 1: provisioned account が利用を開始する

利用できる account は、あらかじめ provision された account に限ります。
利用者向けの public self-signup は提供しません。未登録のメールアドレスを
入力しても、その要求をきっかけに account が作成されたり、利用資格が与えられ
たりしません。

### Scenario 2: Magic Link で bootstrap / recovery する

Magic Link は provisioned account の bootstrap / recovery と、Passkeyを利用
できない場合の sign-in fallback を担います。Passkeyを追加しても Magic Link
は廃止されず、利用者はこの経路を引き続き利用できます。

メールアドレスの登録有無やメール送信の成否は、sign-inを要求した利用者が
画面、redirect、応答の差から判別できない形で扱います。要求の受付を示す
中立的な案内は、登録済みaccountの存在や送信成功を保証しません。

### Scenario 3: Passkey を日常の primary credential として使う

provisioned account の利用者は、対応する browser / device で Passkey を
登録し、次回以降の日常 sign-in に利用できます。Passkey は current の
optional credential であり、全利用者への登録や利用を必須にしません。

Passkey が未登録、非対応、利用不能または失敗した場合も、利用者は Magic Link
へ fallback できます。Passkey の登録・削除・利用は、操作した本人の account
に属する credential の範囲に限られます。

### Scenario 4: application route へアクセスする

authenticated application route は default-deny です。未認証の利用者は、明示的
に公開された認証入口以外の application route を利用できません。新しい
application route は、公開を明示する product/security 判断がない限り認証必須
として扱います。

installability の評価に必要な manifest / icon などの bounded public resource は
認証境界の狭い例外です。これは authenticated application route を公開する意味
ではありません。installable / standalone Web App の利用者向け semantics は
後続の #566 が定義し、この仕様ではその内容を定義しません。

### Scenario 5: 認証後の遷移先を安全に扱う

protected route から sign-in へ送るとき、元 route の query string を任意に
転送しません。認証後の遷移先を受け付ける場合も、同一 application 内の安全な
内部 path に限定し、外部 URL、scheme-relative URL、制御文字を含む値または
不正な値は既定の安全な入口へ戻します。

`error` や `requested` などの sign-in UI state は、それを発生させた認証 flow
だけが明示します。protected-route redirect が任意の query をそのまま持ち回る
ことはありません。

### Scenario 6: My Page で自分の account を管理する

authenticated user は My Page で自分の account identity と sign-out の導線を
利用でき、必要に応じて自分の Passkey credential を管理できます。未認証の
利用者には、認証済み application surface と account credential management を
提供しません。

## Requirements

### Account eligibility and provisioning

- **AUTH-001**: 利用資格を持つ account は provisioned account に限られ、public self-signup は提供しない。
- **AUTH-002**: 未登録のメールアドレスによる sign-in request は account を作成せず、account eligibility を付与しない。
- **AUTH-003**: Passkey の登録・削除・利用は、認証済みの本人 account に属する credential だけを対象にする。

### Magic Link

- **AUTH-004**: Magic Link は provisioned account の bootstrap / recovery と、Passkeyが利用できない場合の fallback を担い、Passkeyによって置き換えられない。
- **AUTH-005**: Magic Link request は、登録済み・未登録、送信成功・失敗の違いを利用者または外部観測者へ account enumeration oracle として提供しない。
- **AUTH-006**: sign-in request の中立的な受付案内は account の存在、メール送信成功、session 確立を意味しない。

### Passkey

- **AUTH-007**: Passkey は current daily primary credential になり得る optional capability であり、登録や利用を必須にしない。
- **AUTH-008**: browser / device が Passkey ceremony を提供できない場合や ceremony が失敗した場合も、provisioned account は Magic Link fallback を利用できる。
- **AUTH-009**: Passkey の利用可能性は account eligibility を拡張せず、未認証の credential management を許可しない。

### Protected access and redirect safety

- **AUTH-010**: authenticated application route は default-deny とし、明示された認証入口と bounded public resource 以外を未認証で利用可能にしない。
- **AUTH-011**: protected-route redirect は元 route の query string を任意に forward せず、外部 URL や任意の redirect state を正当化しない。
- **AUTH-012**: 認証後の遷移先は安全な同一 application 内部 path に限定し、不正・外部・制御文字を含む値は安全な既定先へ戻す。
- **AUTH-013**: 認証 flow が生成した UI state と protected-route redirect の state を混同せず、前者だけが明示的な Auth UI state を付与できる。

## Cross-domain Boundary

- 認証の provider、cookie、proxy / middleware 相当の構造、public path の exact-match、
  browser / server client の分割、環境・secret・hosted provider の設定は
  [`docs/architecture/authentication.md`](../../docs/architecture/authentication.md)
  と code / test が担い、この仕様はその機構を規定しない。
- manifest、application icon、standalone launch、offline、Service Worker、Web Push
  は #566 の Installable standalone Web App authorityに属する。この仕様は、
  authenticated application route が default-deny であることと、bounded public
  resource exception が認証境界を広げないことだけを扱う。
- Event、Occurrence Participation、Invitation、Personal Schedule、TicketOpportunity
  の lifecycle / privacy semantics は各domainのLiving Specが定義し、この仕様で
  再定義しない。
- screen layout、exact copy、loading / error presentation は screen / UX authority
  と runtimeが担う。ただし、copyやpresentationが account existence を漏らさない
  という security invariantにはこの仕様を優先する。

## Scope Boundaries

この仕様は、provisioned account の利用資格、Magic Link と Passkey の product
role、enumeration safety、authenticated application access、redirect state safety
という現行 semantics を扱います。

SDK API、cookie implementation、proxy file layout、provider configuration、secret /
environment provisioning、RLS / SQL / RPC、manifest mechanics、public icon file、
offline / Push、browser platform の実装差分、hosted provider の運用手順は扱い
ません。

## Success Criteria

- **SC-001**: provisioned account / no public self-signup と、未登録メールアドレスが account を作成しない境界を一意に説明・検証できる。
- **SC-002**: Magic Link が bootstrap / recovery / fallback として残り、Passkey が optional daily primary credential に留まることを検証できる。
- **SC-003**: known / unknown account の Magic Link request が account enumeration を許さない中立的な user-visible / observable outcomeになることを検証できる。
- **SC-004**: 認証必須の application route、明示された認証入口、bounded public resource exception の境界を区別して検証できる。
- **SC-005**: protected-route redirect が arbitrary query / external destination を無条件に forward せず、安全な内部 pathだけを扱うことを検証できる。
- **SC-006**: この仕様への切替が provider、runtime、route、secret、environment、RLS、public path 実装を変更していないことを差分で確認できる。

## Assumptions

- account provisioning は利用者向け sign-up flow ではなく、既存の運用・管理境界で行われる。
- account eligibility と credential ownership の機械的 enforcement は、current runtime、Auth provider、schema / RLS、unit / E2E testが担う。
- #563 は current semantics の authority cutoverであり、新しい認証方法、account lifecycle、redirect featureを追加しない。
- 後続の #566 は installable / standalone Web App の user-visible semantics を定義するが、認証 provider や authenticated route boundary は変更しない。
