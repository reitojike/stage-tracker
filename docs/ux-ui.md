# stage-tracker UX/UI baseline

この document は、stage-tracker の screen / feature 横断で適用する global
UX/UI rule の canonical source です。個別 screen の状態・権限・実文言は
[`docs/screens.md`](./screens.md) を正本とします。

## Canonical ownership と current implementation pointer

- smartphone-first、information hierarchy、interaction principle、visual
  semantics、accessibility baseline など、screen 横断の UX/UI rule は本書で
  固定します。
- 画面ごとの状態・権限・実文言は [`docs/screens.md`](./screens.md) を参照します。
  Occurrence Participation の current behavior は
  [`specs/001-occurrence-participation/spec.md`](../specs/001-occurrence-participation/spec.md)、
  未移行 domain の semantics は temporary static authority である
  `.ai-dev-foundation/product-rules.md` を参照します。
  本書はそれらを画面単位・domain 単位で再掲しません。
- Storybook は rendered examples / states catalog です。Storybook や実装の
  class 名は本書の design rule の正本ではありません。
- current runtime の実装参照先は `apps/web/`、shared UI ownership は
  `packages/ui/` です。`AppShell` / `AppBar` / `PrimaryNav` は
  `packages/ui/src/` が所有し、authenticated route の shell composition は
  `apps/web` の app route group が行います。screen / domain semantics を持つ
  component は `apps/web` 側の feature boundary に残します。
- styling は Tailwind CSS v4 と shadcn の component conventions を使います。
  app-wide の theme / semantic styling values は `apps/web/src/app/globals.css`
  とその `@theme` composition が所有し、shared component はそれを utility
  class と shadcn primitive 経由で利用します。本書は CSS custom-property 名、
  class 名、component inventory、pixel 値の一覧を別の implementation authority
  として複製しません。
- current rendered examples は `packages/ui/src/*.stories.tsx` と
  `packages/ui/src/ui/*.stories.tsx` にあります。Storybook の a11y check は
  QA aid であり、本書の意味規則や WCAG 適合そのものの証明ではありません。

本書に implementation reference が必要な場合も、上記の package / app / theme
boundary を pointer として使います。migration-era の styling / token mechanics を
current rule として参照しません。

## Origin

ここに記載する global decision は、Issue #10 Phase 1 の PO checkpoint を起点に、
その後の Design Wave と v2 cutover で current runtime に採用された UX/UI semantics
を整理したものです。過去の handoff、parity evidence、migration record は
historical context であり、本書の current implementation authority ではありません。
実装と rule が食い違う場合は、UI behavior を変更せずに fresh な implementation
cross-check と product checkpoint を行います。

## Platform priority

stage-tracker は **smartphone-first** です。desktop では secondary information、
list density、補助 controls のために余白を使えますが、mobile experience を
desktop 版の縮小として扱いません。

content は単一の bounded column とし、広い画面で無制限に伸ばしません。各 page が
top-level margin を個別に持つのではなく、shell が content の幅・padding・section
間隔を統一します。shell は mobile viewport の可視領域を優先し、bottom navigation
や safe-area が content を隠さない構成にします。

## Product personality

Native-feeling で calm な mobile organizer とします。iOS / Android 標準の
convention から大きく逸脱せず、派手な motion、glass effect、oversized card を
global default にしません。特定 OS 専用ではなく cross-platform の体験を狙います。

## Primary interaction pattern

primary time granularity は day-level です。month view を primary view とし、
hourly timeline / week scheduler を global center にしません。

global な primary interaction pattern は次です。

```text
month calendar → selected-day list → event detail
```

この pattern は次の context で共通に使います。ただし query、empty state、action
などの domain semantics は分離し、shared catalog と personal participation を
同じ意味として混在させません。

1. **Event Catalog** (`/catalog`) — authenticated users 間の shared catalog を見る・探す
2. **My Calendar** (`/calendar`) — participation 登録した occurrence と、
   event-independent な personal schedule entry を見る

## Navigation principle

mobile で shared catalog と personal schedule の間を自然に移動できる IA とします。
current PrimaryNav は **ホーム / イベント / チケット / カレンダー** の4項目です。
現在地は色だけに依存せず、label の強調、上辺の indicator、`aria-current="page"`
を併用します。My Page とお知らせは nav の同列に置かず、AppBar から開きます。

AppBar は画面上部に残り、左のお知らせ affordance、中央の logotype、右の My Page
affordance という3領域で構成します。左右の affordance の位置を揃え、本文とは
面を増やさず細い境界で区切ります。お知らせ機能が未提供の間も affordance の
tap target と disabled semantics は維持します。

`/sign-in` は PrimaryNav と AppBar actions を表示しない認証外側の画面です。
Search の独立 tab、Settings の配置、future feature nav は追加の product decision
なしに固定しません。

## Information density

mobile は medium、desktop は medium-high まで許容します。giant card で viewport を
使い切らず、calendar と event list の scanability を優先します。month calendar の
date cell は装飾より情報認識を優先します。

## Typography

system / native UI sans 系を使い、日本語可読性を優先します。UI font のためだけに
webfont dependency を増やしません。heading hierarchy は restrained にし、marketing
向けの巨大な文字を使いません。

typography role は次の ladder に限定します。

| role    | 主な用途                                         |
| ------- | ------------------------------------------------ |
| heading | page-level heading                               |
| title   | list / section / sheet heading、list title       |
| body    | 本文                                             |
| body-sm | 副文、helper text、compact control、write notice |
| label   | 短い項目名                                       |
| caption | weekday、補助情報、bottom navigation label       |

title は body より単純に大きくするのではなく、weight と line-height の組み合わせ
で階層を作ります。現在地の navigation label は非現在地より明確に強調します。
見出しが直下の subordinate な本文より小さくなる構成は作りません。

## 面と区切り

- card 面を global default にせず、罫と縦の間隔で情報を区切ります。
- 画面と overlay の地は neutral な canvas、control / chrome はそれと区別できる
  neutral surface とします。content の card 面を増やして階層を作りません。
- 1px の細罫は list row、AppBar、Sheet、StatePanel の境界に使います。
- 2px の太罫は section heading や section block の境界に限定します。
- destructive section は通常の content と視覚的に分離します。
- spacing は小さい間隔、行内間隔、section 間隔を段階的に使い、任意の値を増やして
  density を調整しません。

## 角丸

箱の大きさに応じた2段階の形状を基本とします。小さい badge / marker / checkbox
と、button / input / sheet などの control-sized box を同じ見え方にしません。
完全な pill は、円形・帯状であること自体が意味になる avatar、dot、chip、marker、
current indicator などに限定し、汎用 surface の default にはしません。

## Control vocabulary

visible fill の高さと tap target を同一視しません。compact な見た目でも、control
または行全体が十分な操作範囲を持つようにします。stage-tracker の通常の tap
target floor は 44px です。これは product usability floor であり、特定の CSS
mechanism や component inventory を意味しません。

control の強調順序は次です。

| variant   | 意味                                              |
| --------- | ------------------------------------------------- |
| primary   | 画面または sheet の主操作。1つのまとまりに原則1つ |
| secondary | 通常の補助操作。neutral な境界を持つ              |
| small     | compact な inline action                          |
| quiet     | 塗り・枠を持たない低強調 action                   |
| icon      | icon 自体が action を表す正方形 control           |
| danger    | hard delete など irreversible な操作だけ          |

cancel / uncancel のような reversible lifecycle action は danger に格上げしません。
Button label は原則折り返さず、入力 control も同じ tap target の考え方を満たします。
touch interaction は scroll、pinch zoom、単発 activation を妨げない形にします。

## Form field vocabulary

Event / Occurrence / Personal Schedule の management form は、required / optional の
表示、label と control の association、fieldset / legend の semantics を共有します。
視覚的な required marker は補助であり、assistive technology には native required
semantics を伝えます。任意であることだけを説明する helper text は増やしません。

form grouping は box を増やすためではなく、関連する入力を意味的にまとめるために
使います。choice group には fieldset semantics を使い、feature-specific な section
の見た目や domain semantics を generic primitive に無理に統合しません。

submit action は footer / action area で到達しやすくし、複数の独立した write unit は
互いの feedback を巻き込みません。

## Sheet

route を持たない独立した表示状態は、current shared Sheet primitive
（`packages/ui/src/components/sheet.tsx`）を使います。新しい overlay vocabulary を
screen ごとに作りません。

- overlay は背後の画面を見せたまま操作対象でなくなったことを示します。
- Sheet は wide screen で横に伸びきらず、bottom sheet は背後の画面を残します。
- heading と header boundary を持ち、body が伸びる場合も submit footer は scroll
  body の外側で到達可能にします。
- submit-based Sheet は header に close action を重ねず、footer の primary action
  で完了します。immediate-choice Sheet は選択せずに離脱できる close affordance を
  持ちます。
- overlay tap と Escape は confirmation Sheet の cancel として扱います。
- Sheet 自体は choice / form / save の domain semantics を所有せず、呼び出し側が
  所有します。

## 書き込みのフィードバック

- 成功は読み上げ対象の notice として、書き込みを起こしたまとまりの先頭に置きます。
  ボタンの隣に置いて action row を崩しません。
- 失敗は StatePanel の error semantics で伝え、同じ試行でも再度読み上げられるよう
  にします。error を赤や icon だけで表現しません。
- 送信中は form を busy として扱い、入力を無効化し、button label だけを action の
  動詞に沿って変えます。label の変化で layout が跳ねないようにします。
- 失敗文言は「権限がない」「対象が見つからない」「入力に問題がある」「通信に
  失敗した」を区別します。screen ごとの実文言は [`docs/screens.md`](./screens.md)
  を参照します。

## 一時的に操作できる行

write notice と undo row は別の語彙です。

- notice は「終わったこと」の控えで、操作を持ちません。
- undo row は「まだ操作できる」ことを示し、tap target を満たす行と1つの action を
  持ちます。client-local な表示差し替えであり、新しい persisted state を作りません。

## 破壊的操作の置き場所

irreversible な操作は本文の下部の独立した destructive section に隔離します。1件の
occurrence を扱う Sheet では、その対象の action を Sheet 内に置けます。

ここでいう削除は Event、Occurrence、Personal Schedule entry の hard delete を指します。
対象を明記した confirmation Sheet とし、close affordance を出さず、footer の danger
action だけで実行します。認証 credential など別の security flow の削除はこの rule の
対象に含めず、その operation-specific rule に従います。overlay tap と Escape は
cancel です。中止・中止解除のような reversible action は確認を出さず、実行結果を
notice で伝えます。native `window.confirm()` は使いません。

## 読み込み中の見せ方

layout が先に決まる calendar 系画面は skeleton を使い、内容量で layout が変わる
画面は spinner を使います。遷移中も AppBar と PrimaryNav は残し、navigation や
avatar の tap 中は control 内の pending state だけを示します。calendar の month
navigation は grid と month context を残したまま、操作した control を pending にします。

loading fallback には、data read や permission check の結果より前から確定している
stable な page chrome（heading や戻る affordance など）を、同じ hierarchy と destination
で残します。data-dependent な chrome を fallback で推測して追加しません。これは
transition 中の layout shift と navigation semantics の変化を防ぐための cross-screen
invariant です。どの chrome が stable かという route 単位の判断は各 route の実装で
行い、screen 固有の状態や文言は [`docs/screens.md`](./screens.md) を参照します。

reduced motion を尊重します。

## List row affordance

chevron は row 全体が tap 可能で destination へ遷移することを示します。static row、
information-only row、calendar cell、row 全体が navigation target ではない surface
には付けません。

## Color と Badge

neutral base と restrained cool accent の low-noise UI とします。色は意味 role に
従って使い、色だけを status の唯一の手がかりにしません。

- accent は操作可能な場所、link、current location、focus の視覚 cue に使います。
- danger は deadline、休日、irreversible action に限定します。読み込み失敗の色には
  使いません。
- terminal は中止や受付終了など、もう行動できない状態に使います。
- neutral は本文、副文、境界、canvas、control surface を階層化します。
- success / warning / info の汎用色を増やして status を色だけで表しません。

Badge は色の名前ではなく、次の固定した意味を持つ semantic variant です。

| variant  | 意味                     | 例                               |
| -------- | ------------------------ | -------------------------------- |
| outline  | 分類                     | 宝塚、月組、一般発売             |
| subtle   | 進行中の状態・意思       | 参加する、気になる、申し込む予定 |
| done     | 自分が終えたこと         | 申し込み済み                     |
| deadline | まだ間に合う期限         | 残り1日                          |
| terminal | もう行動できない終了状態 | 中止、受付終了                   |

text label と必要な非色 cue を併用し、done は check cue と組み合わせます。

## Design token と styling boundary

implementation は primitive value と semantic role を分けて管理します。component /
feature は raw value を個別に再発明せず、current theme の semantic role と Tailwind
utility を使います。実装上の theme values は `apps/web/src/app/globals.css`、shared
component composition は `packages/ui/` が所有します。本書は role の意味を定めますが、
CSS custom-property 名、hex、px、class の一覧を固定しません。

dark mode は semantic role の差し替えで拡張できる構造を保ちますが、dark mode UI 自体と
theme toggle は未実装です。future value を推測して追加しません。

## Shared / feature-local component boundary

domain-independent で実際に複数の screen が使う presentation / interaction primitive
だけを shared 化します。current shared UI の ownership は `packages/ui/` です。
実際の export と rendered example は package の source / Storybook を参照し、本書に
固定 inventory を作りません。

domain semantics、feature-specific query、screen-specific layout、calendar marker、
participation / invitation / filter の state を持つものは `apps/web` の feature-local
boundary に残します。将来の feature component を先行して大量に作りません。

component API sharing と presentation value sharing は別軸です。DOM / state semantics
が異なる control を見た目だけで1つの APIへ統合しません。一方、複数 consumer が同じ
named role や semantic value を持つ場合は、API を統合せずに shared theme / primitive
へ寄せて drift を防ぎます。

同じ宣言が複数箇所にあるだけでは共通化の理由にしません。共通化するのは、意味のある
named role が共有される場合、または変更時に一つの semantic authority が必要な場合
です。未知の見た目の一致を機械的な違反として扱わず、shared boundary を増やす判断は
product quality、consumer semantics、maintenance cost で行います。

## Common states

loading / empty / error / disabled / unavailable は global visual pattern を持ちますが、
meaning と message は feature / domain 側が所有します。current shared StatePanel は
title → description → action と境界線を共有し、error のみ `alert` を使います。empty /
unavailable は現在の component API が ARIA role を固定していないため、本書では role を
追加で要求しません。

次を同じ「何もありません」にしません。

- empty result
- authentication failure
- permission denial
- permission check failure
- data load failure
- unavailable / 未提供

読み込み失敗をデータなしに潰しません。複数の独立した read がある page は block
ごとに結果を持ち、身元確認の失敗以外では成功した block を残します。

補助的な件数だけは、(1) page の主データではなく、(2) 件数が0でも導線が残り、
(3) 導線の先で通常の失敗表示とともに実値を確認できる、の3条件をすべて満たす場合に
限り読み取り失敗を0として表示できます。current 該当は My Page の招待一覧 row の
未対応件数だけです。この例外を画面本体や一覧へ広げません。

### Retry / auth copy

画面横断の再試行 guidance は、原因を確定できる範囲に限って使い分けます。

- 原因不明または一時的な失敗: 「しばらくしてから再度お試しください。」
- network 起因と確定できる失敗: 「通信状況を確認し、もう一度お試しください。」
- re-auth が必要な状態: 「サインインしてからもう一度お試しください。」

原因不明の失敗を network と推測しません。operation-specific な title、入力理由、
権限・対象なしの説明、Passkey の代替手段などは consumer 側に残します。
heading / StatePanel title / button / badge / label は原則として句点を付けず、
description / alert / sentence copy は句点を付けます。web 実装で複数画面が共有する
固定 clause は `apps/web/src/lib/user-facing-copy.ts` が所有します。

## Calendar weekday / Japanese holiday presentation

month calendar の global presentation rule です。feature-specific な event marker
semantics とは分離します。

- Saturday は blue role、Sunday と日本の祝日は red role で示します。
- Saturday と祝日が重なる場合は holiday presentation を優先します。
- date number は固定段、marker row は別段とし、marker の有無で date number を動かしません。
- weekday header、列位置、accessible name を組み合わせ、`土` / `日` の per-cell
  表示に依存しません。
- per-cell の可視な `祝` glyph や `?` cue は使わず、日付の visual cue と accessible
  name、month-level notice を組み合わせます。
- 前後月の日付は subordinate に示し、色だけを唯一の意味表現にしません。
- calendar band、badge、control の shape は別の意味 role として扱います。

Holiday data の authority は内閣府「国民の祝日について」掲載データ / CSV です。
公式に公表されていない将来年を推測しません。product の日付境界は未移行
domain では `.ai-dev-foundation/product-rules.md` を参照します。

## Component-specific treatment

global consistency は product quality の手段です。usability、readability、native-feeling
を優先し、component role に本質的な差がある場合は local treatment を許容します。
一方、screen ごとの無秩序な別 design は避け、例外にはその理由を残します。

calendar marker の geometry、縦積みの layout、補助文の表示、list reset のように、
値が似ているだけで domain / screen semantics が異なるものは無理に一つへ統合しません。
visible focus は focus を受ける control と見える proxy の両方で利用者に確認できるように
し、DOM 形状が異なることだけを理由に keyboard access を失わせません。

## Accessibility baseline

WCAG 2.2 AA 相当を baseline とします。

- semantic HTML
- keyboard access
- visible focus
- sufficient contrast
- zoom / reflow 対応
- `prefers-reduced-motion` の尊重
- 色のみに意味を依存しないこと
- 十分に大きい touch target
- 片手利用しやすい interaction

Storybook の a11y addon や test は QA aid として使いますが、compliance 自体の証明とは
しません。失敗表示、disabled、unavailable を視覚だけで区別しないことも baseline に
含めます。

## Component catalog

Storybook は current shared UI の rendered examples / states catalog として使います。
current framework adapter は `@storybook/nextjs-vite` です。Storybook は app production
runtime と不要に coupling せず、static build と relevant a11y verification を通します。
本書が rule を、`docs/screens.md` が screen decision を、source / tests / Storybook が
implementation と example をそれぞれ担います。

## 本ドキュメントで固定しないもの

次の項目は実装都合で先行確定しません。関連する product task / PO checkpoint で決めます。

- exact accent hue の将来の final decision
- お知らせ (`/notifications`) の trigger、保持期間、既読 domain、完成 UI
- feature-specific calendar marker semantics
- Event range 内で occurrence が存在しない日の表示方法
- event / occurrence / participation / invitation / personal schedule /
  TicketOpportunity planning の persistence shape / table naming
- budget 集計の期間基準
- classification taxonomy の具体形、canonical venue identity、server-side saved filter
- Search tab 化、Settings placement、future navigation item
- dark mode UI と theme toggle
- production hosting の broader scope、PWA offline、Web Push、MCP scope、broader rollout

認証の user-visible behavior は current product rule / screen decision と実装の境界で
扱い、provider protocol の詳細を本書へ増やしません。
