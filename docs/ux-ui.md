# stage-tracker UX/UI baseline

このdocumentは、stage-trackerの screen / feature 横断で適用する **global
UX/UI ruleのcanonical source** です。個別screenの状態・権限・文言のdecisionは
[`docs/screens.md`](./screens.md) に分けています。

## Canonical ownership

- global UX/UI principle・responsive baseline・visual foundation・design
  token semantics・shared UI patternのnormativeなruleは、本ファイルのみを
  正本とします。`docs/prd.md` / `docs/roadmap.md` /
  `.ai-dev-foundation/product-rules.md` へ同じruleの別正本を作りません。
- 画面ごとの状態・権限・実文言のdecisionは
  [`docs/screens.md`](./screens.md) を正本とします。本ファイルはそれらを
  screen横断のruleとして総論的に固定し、画面別の分岐と文言は繰り返しません。
- product domain semantics（event / participation / TicketOpportunity /
  personal schedule等）の正本は引き続き
  `.ai-dev-foundation/product-rules.md` です。本ファイルは domain semantics
  を固定しません。
- component catalog（Storybook）はこのruleの **rendered examples / states
  catalog** であり、rule自体の正本にはしません。
- **repository外のdesign handoff artifact（`design_handoff_stage_tracker/`
  / `design_handoff_v2/` / `design_handoff_v3/` / `design_refactor/` の
  `README.md`・`RULES.md`・`.dc.html` canvas・参照PNG）は、materialize済み
  decisionのhistorical evidenceであり、ruleのauthorityではありません。**
  `design_handoff_v3/RULES.md` は「デザインルール（正本）」と自称して
  いますが、repository内のruleの正本は本ファイルです。どのhandoffで何を決め、
  どのIssue / PRでmaterializeしたかという経緯（flow情報）は
  [Issue #280](https://github.com/reitojike/stage-tracker/issues/280) に
  集約しており、repositoryでは管理しません。
- 本ファイルに書くruleは、artifactの記述をそのまま写したものではなく、
  `src/ui/`・`src/ui/tokens.css`・`src/app/**/_components/`・
  `src/domain/*Formatting.ts` のcurrent implementationと突き合わせた上で
  確定した内容です。ruleと実装が食い違う場合は、勝手にどちらかへ寄せず
  checkpointします。

## Origin

ここに記載するglobal decisionは、Issue #10 Phase 1のPO checkpoint
（2026-08-21）で承認された範囲を起点とし、Design Wave 1（Issue #136系）・
Design Wave 2（Issue #184系）・Design handoff v3（Issue #244以降）で
materializeされたdecisionを反映しています。checkpointで
**intentionally unresolved** とされた項目（下記「本ドキュメントで固定
しないもの」参照）は、実装都合で決定済みにはしません。

## Platform priority

stage-trackerは **smartphone-first** です。desktopはsecondary information /
density / wider list / supplemental controlsに追加spaceを使ってよいですが、
mobile experienceをdesktop版の縮小版にはしません。

現行のcontent columnは、単一カラムを `max-width: 640px` で中央寄せし、
`padding: 16px` / section間 `gap: 20px` を `AppShell` 側が持ちます
（各pageは自前のtop-level marginを持ちません）。shellの高さは `100dvh`
です。

## Product personality

Native-feeling / calmな mobile organizerとします。iOS / Android標準のUI
conventionから大きく逸脱しません。派手なmotion / glass effect /
oversized cardsをglobal defaultにしません。特定OS専用のUIではなく、
cross-platformでnative-feelingな体験を狙います。

## Primary interaction pattern

Primary time granularityはday-levelです。month viewをprimary viewとし、
hourly timeline / week schedulerをglobal centerにしません。

以下のpatternをglobalなprimary interaction patternとします。

```text
month calendar → selected-day list → event detail
```

このpatternは次の2つのcontextで共通利用します。ただし各contextの domain
semantics（query / empty state / actions）は分離し、shared catalogと
personal participationを同一semanticとして混在させません。

1. **Event Catalog**（`/catalog`） — authenticated users間のshared catalogを
   見る / 探す
2. **My Calendar**（`/calendar`） — 自分がparticipation登録したoccurrenceと、
   event-independentなpersonal schedule entryを合わせた自分のpersonal
   schedule

## Navigation principle

Shared catalogとpersonal scheduleの間をmobileで自然に移動できるIA
（情報設計）とします。current PrimaryNavは画面に表示するlabelとして
**ホーム / イベント / チケット / カレンダー** の4項目です（Issue #140、#188）。
現在地は「labelをsemiboldにする＋上辺に2pxの藍のバー」という
色以外の手がかりで示し、`aria-current="page"` を併記します。My Pageと
お知らせはnavの同列に置かず、AppBarから開きます。

AppBarは48pxのsticky topで、`40px / 1fr / 40px` の3カラムgridです
（左＝お知らせベル、中央＝ロゴタイプ、右＝My Pageのアバター）。背景は
canvas色で、下辺のみ1px罫です。

`/sign-in` はPrimaryNavとAppBarのactionを出さない唯一の画面です
（遷移先がすべて認証の内側にあるため）。

Searchの独立tab化、Settings配置、future feature navはfreezeしません
（「本ドキュメントで固定しないもの」参照）。

## Information density

mobileはmedium、desktopはmedium-highまで許容します。giant cardで
viewportを使い切る構成は避け、calendarとevent listのscanabilityを
優先します。month calendarのdate cellは装飾よりinformation recognitionを
優先します。

## Typography

System / native UI sans系フォントを使います。日本語可読性を優先し、
restrained heading hierarchyとします。Giant marketing typographyは
使わず、UI fontのためだけにwebfont dependencyを増やしません。

font stackは次のとおりです。

```css
--font-family-base:
  -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Kaku Gothic ProN', 'Hiragino Sans',
  Meiryo, system-ui, sans-serif;
```

font sizeは **11 / 12 / 14 / 16 / 20px** の5段、weightは **400 / 500 /
600** の3段だけを使います。typography roleは次のladderで分離します。値は
`src/ui/tokens.css` とcurrent component CSSに対応します。

- **heading** — 20px / 600 / 1.3（PageHeading等のpage-level heading）
- **title** — 16px / 600 / 1.35（list / card title、section heading、
  Sheetのheading）
- **body** — 16px / 400 / 1.5
- **body-sm** — 14px（副文、compact control、書き込み通知）
- **label** — 12px / 600（短い項目名）
- **caption** — 11px（weekday、補助情報、PrimaryNavのbottom-nav label、
  Badge。現在地のnav labelは600、非現在地は400）

見出しが、その直下でhierarchy上 subordinateな本文より小さくなる構成は作りません。
例えばPersonal Schedule detailの「共有」は16px / 600のsection headingとして、
直下の本文より小さくならない階層を保ちます。

## 面と区切り

- **カード面を使いません。** 面で囲うのではなく、罫と縦の間隔で区切ります。
  白面のcard（`--color-surface` + `--radius-surface`）はcurrent app
  runtimeでは使っていません。
- canvasは `--color-canvas`（`#eef0f1`）です。`--color-surface`（白）は
  input・checkbox・PrimaryNavといったcontrol / chrome側の塗りとして残り、
  contentのcard面としては使いません。
- 区切りは次の3種です。
  - **1px 細罫**（`--color-border`） — 一覧の行の区切り、AppBarの下辺、
    Sheetのheader下辺、StatePanelの上下
  - **2px 太罫**（`--color-text`） — section headingの下線
    （My Page / Event write / Personal Schedule detail）
  - **2px 太罫**（`--color-border`） — section blockの上端の区切り
    （Personal Schedule detailの各section）

  破壊的操作のsection headingだけは `--color-danger` の2px 太罫を使います
  （「破壊的操作の置き場所」参照）。

- 縦の間隔は 2 / 4 / 8 / 12 / 14 / 16 / 20 / 24 / 32 / 48px のscaleです。
  行の `padding-block` は、一覧の行が12px、card相当の行が14px
  （`--space-card-block`）です。

## 角丸

**箱の角丸は、roleではなく箱の大きさで2値に分けます。**

| 値  | 箱の大きさ                 | 該当                                                                   |
| --- | -------------------------- | ---------------------------------------------------------------------- |
| 2px | 18〜20px程度の小さな箱と印 | Badge、calendarのEvent range band、checkboxの箱（18px）                |
| 4px | 27〜44px程度の箱           | Button全variant、genre chip、input / textarea、Sheetの上端、取り消し行 |

同じradiusでも箱が大きいほど丸みの印象は弱くなるため、「触れるもの」と
いったroleで分けるより、この2値のほうが揃って見えます。checkboxのtap範囲は
箱ではなく44pxの行全体なので、44px ruleとも矛盾しません。

**丸い印はこの2値の対象外です。** 完全なpill（`--radius-pill`）は、円形・
帯状であることそのものが形の意味になるものにだけ使います。現行の該当は
未読ドット / marker dot（7px）、アバター（30px）、calendarの日付の丸
（22px）、件数chip、spinner、PrimaryNavの現在地バーです。

汎用surfaceのdefault形状としてpillを使いません。3つ目の箱用radius値を
増やしません。

## Control vocabulary

controlでは、**visible fill heightとtap targetを同一視しません**。compactな
塗り箱を使っても、透明なtap target expansion（`tapTarget.module.css` の
`expand44`）により操作範囲を保ちます。

`Button` と `LinkButton` は同じ `ButtonVariant` を使います。静止時（rest）の
見た目までvariantの規約に含めます。

| variant   | visible fill |    tap target | 静止時の見た目                                 |
| --------- | -----------: | ------------: | ---------------------------------------------- |
| primary   |         35px |      44px以上 | 藍の塗り。**1画面（1シート）に1つだけ**        |
| secondary |         35px |      44px以上 | 透明＋`--color-control-border` の枠            |
| small     |         31px |      44px以上 | 透明＋枠。compactなinline action               |
| quiet     |         27px |      44px以上 | **塗りなし・枠なし。文字だけ**                 |
| icon      |    40px×40px | 44px×44px以上 | 透明・枠なし。藍のグリフ                       |
| danger    |         35px |      44px以上 | **透明**＋赤の枠と文字。irreversibleな操作のみ |

- `danger` はhard delete等のirreversibleな操作専用です。cancel / uncancel
  のようなreversibleなlifecycle操作は `secondary` のままとし、危険度で
  tierを分けます。
- **quietの例外** — 行全体がlinkになっている行の中だけ、静止時に淡い面
  （`--color-surface-subtle`）を許します。current該当はチケット行の状態
  変更controlのみです。理由は「行全体がlinkなので、押せる場所がどこかを
  示す必要がある」ことであり、quietだからではありません。この例外は
  呼び出し側のclassにscopeし、`Button` の共有defaultを戻しません。
- **Buttonのlabelは折り返しません。** 縮む文字と縮まないButtonが同居する
  `space-between` の行では、文字側に `min-width: 0`、Button側に
  `flex-shrink: 0` と `white-space: nowrap` を置きます。現状この宣言は
  各screenの `*.module.css` に個別に書かれています
  （[Issue #270](https://github.com/reitojike/stage-tracker/issues/270) /
  [#271](https://github.com/reitojike/stage-tracker/issues/271) が共通化
  対象）。
- `input` / `textarea` の `min-height` 44pxは、入力対象として維持します。

## Form field vocabulary

Event / Occurrence / Personal Scheduleのmanagement formが共有する
presentation vocabularyです。個別fieldのrequired/optionalの一覧等、product
domain semanticsの正本は引き続き
[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
であり、本節では重複記載しません。

- **必須/任意の表示** — `src/ui/RequirementIndicator.tsx`が、必須fieldのlabel/
  legend直後に赤い`*`を表示します（PO決定、2026-08-26）。任意fieldには何も
  表示しません（`*`の不在で任意と分かる、という一般的なWeb form慣習に従います）。
  `*`は`aria-hidden`とし、assistive technologyへのrequired伝達は native
  `required`属性に委ねます（`*`はその視覚的な補助であり、唯一の手段にしません）。
  `TextInput`/`TextArea`はlabelに渡された`required`から自動的にこれを表示し、
  native `required`属性・`aria-*`・label associationは変更しません。「任意です。」
  のような、任意であること自体だけを説明するhelper textは書きません。
- **section / fieldsetの既定** — `src/ui/FormSection.tsx`が既定の
  section/fieldset primitiveです。`as="section"`（既定）はboxなしのheading +
  contentで、purely organizationalなgroupingに使います。`as="fieldset"`は
  実際にrelatedなinputのgroupingがある場合（choice group等）にのみ使い、
  `<fieldset>`/`<legend>`のaccessibility semanticsを保ちながら、prototype的な
  border/padding boxは持たせません。
- **action area** — actionの並びは`src/ui/ActionRow.tsx`を使います。
- 1つの画面に独立した書き込み単位が複数並ぶ場合（Event編集画面）、
  それぞれが自分のfeedbackを持ち、1つの失敗が他を巻き込みません。

## Sheet

画面としてのrouteを持たないが独立した表示状態を持つ面は、共通の
`src/ui/Sheet.tsx`（native `<dialog>`ベースのbottom sheet）を使います。
新しいoverlay vocabularyを別に作りません。

- 覆いは `rgb(23 25 27 / 45%)`、面は `--color-canvas`、上端の角丸のみ4px、
  `max-width: 480px` / `max-height: 85vh`。
- headingは16px / 600で、下に1px 細罫。
- **footerを持つSheetは、headerに「閉じる」を出しません。footerを持たない
  Sheetは出します。** footerがないSheetでは、「閉じる」が画面に見えている
  唯一の離脱手段だからです。
- 覆いのtapとEscapeはどちらでも効きます。confirmation Sheetでは、この2つが
  「取り消し」に当たります。
- 藍の塗り（`primary`）はSheet内の実行ボタン1つだけです。
- Sheet自体はchoice / form / save・confirm semanticsを持ちません。それらは
  呼び出し側が所有します。

## 書き込みのフィードバック

- **成功** — 読み上げ対象の通知（`src/ui/WriteNotice.tsx`）で伝えます。
  通知は、その書き込みを起こしたまとまり（form全体、またはSheet 1枚）の
  **先頭** に置きます。ボタンの隣には置きません（横並びのボタン行に入れる
  と行が崩れるため）。
- 通知の見た目は、淡い面（`--color-surface-subtle`）・角丸4px・14pxです。
  live regionは常時mountし、message側を試行回数（`attempt`）でkeyします
  （同じ文言の2回目も読み上げさせるため）。
- **失敗** — `StatePanel` で伝えます。同じ失敗が続いたときも試行ごとに
  panelを作り直し（`key={attempt}`）、再度読み上げられるようにします。
- 送信中はform全体を `aria-busy` にして入力を無効化し、送信ボタンのlabel
  だけを差し替えます。ボタン幅は最長のlabelで固定してあるため、押しても
  行の高さや幅が動きません。
- **処理中の語は、その操作の動詞をそのまま「〜中…」にします。** 送信ボタンの
  labelから機械的に作ります（「予定を保存」→「保存中…」、「公演回を追加」→
  「追加中…」、「招待する」→「送信中…」）。「処理中…」のような汎用語は、
  動詞が特定できない場合だけです。
- 書き込みの失敗文言は「権限がない / 対象が見つからない / 入力に問題がある /
  通信に失敗した」の4分類を持ち、同じ「できませんでした」で済ませません。
  分類ごとの実文言は [`docs/screens.md`](./screens.md) を参照します。

## 一時的に操作できる行（取り消し行）

書き込み通知とは **別語彙** です。見た目が似ているため、取り消し行には
必ず操作を1つ置いて区別します。

- **通知** ＝「終わったこと」の控え。淡い面のtextのみで、操作を持ちません。
- **取り消し行** ＝「まだ操作できる」。淡い面・角丸4px・`min-height: 44px`
  の行に、右揃えで下線付きのtext操作を1つ置きます。current該当は招待一覧の
  8秒の「取り消す」だけです。

取り消し行はclient-localな表示の差し替えであり、新しいpersisted stateを
作りません。

## 破壊的操作の置き場所

- 原則：本文の最下部に、赤の見出し＋2px 太罫（`--color-danger`）で隔離します。
  current該当はEvent編集画面の「中止と削除」sectionと、Personal Schedule
  詳細の削除sectionです。
- 例外：**Sheetが1件だけを扱っている場合、その1件の中止・削除はSheetの中に
  置きます。** 公演回のSheetがこれにあたります（listの行に赤を並べると誤tap
  の危険があるため）。event全体の中止・削除は編集画面の最下部のままです。
- 確認は **元に戻せるかどうか** で2つに分けます。
  - **削除（元に戻せない3件：event / 公演回 / personal schedule entry）** —
    自作の確認Sheet。`Sheet` を使い、titleはその操作名、bodyは確認文、
    footerに `danger` の実行ボタンを置き、headerに「閉じる」は出しません。
    覆いのtapとEscapeが取り消しに当たります。
  - **中止・解除（元に戻せる2件）** — 確認を出しません。押した時点で実行し、
    結果は通知で伝えます。
- native `window.confirm()` は使いません。

## 読み込み中の見せ方

2系統を意図的に使い分けます（PO確定、2026-08-31）。

- **skeleton** — layoutが先に決まっている画面。current該当はcalendarの
  2 route（`/catalog` / `/calendar`）で、`CalendarSkeleton` が枠組みを
  先に出して跳ねを防ぎます。
- **spinner** — 中身の量でlayoutが変わる画面。`LoadingIndicator` の `md`
  をpage / section levelのdefaultとし、controlのlabelに並べるinlineは
  `sm` を使います。

迷ったらspinnerです。skeletonは「実物と同じ骨組みが描ける」ときだけ使います。

- 各routeの `loading.tsx` は、本物のpageと同じ `PageHeading` を先に置きます
  （pendingの間だけtitleが消えて、commit時に押し戻される layout shiftを
  避けるため）。逆に、本物のpageが持たない要素（ActionRow等）を
  fallbackで足しません。
- 遷移中もAppBarとPrimaryNavは画面に残ります。navやアバターのtap中は
  iconをspinnerに差し替え、行の高さを増やしません。
- calendarのmonth navigationのpending中は、tapしたcontrol自身だけが
  spinnerになり、spinnerとchevronを併記しません。month labelはcontextとして
  残し、calendar gridも消さずにpending stateを表現します。
- reduced motionを尊重します。

## List row affordance

chevronは、**row全体がtap可能でdestinationへ遷移する**ことを示すaffordanceです。
したがって、tappable navigation rowには付けますが、static surface、information-only
row、calendar cell、または内部にactionがあってもrow全体がnavigation targetで
ない面には付けません。

## Color

Neutral base + single restrained cool accentのlow-noise UIとします。

**色の役割は3つに固定します。**

| 役割                        | token              | 値        |
| --------------------------- | ------------------ | --------- |
| 藍 — 操作できる場所と現在地 | `--color-accent`   | `#2f4a7a` |
| 赤 — まだ間に合う期限と休日 | `--color-danger`   | `#a13b2e` |
| 墨 — もう行動できないもの   | `--color-terminal` | `#2b3033` |

これに、面と文字のneutral roleが付きます。

| 用途                   | token                                       | 値                                |
| ---------------------- | ------------------------------------------- | --------------------------------- |
| 紙                     | `--color-canvas`                            | `#eef0f1`                         |
| 細罫                   | `--color-border`                            | `#d7dcde`                         |
| 淡い面                 | `--color-surface-subtle`                    | `#dfe4e7`                         |
| 藍の淡い面（完了・帯） | `--color-band-fill` / `--color-band-text`   | `#dbe2ee` / `#24365c`             |
| 赤・墨の上の文字       | `--color-danger-on` / `--color-terminal-on` | `#f7f5f1` / `#eef0f1`             |
| 本文 / 副文 / 第3      | `--color-text` / `-secondary` / `-tertiary` | `#1f2426` / `#5c6467` / `#454b4e` |
| controlの罫            | `--color-control-border`                    | `#7f878b`                         |

- **赤は期限・休日・破壊的操作だけです。読み込み失敗には使いません。**
  `StatePanel` は上下の細罫と文言だけで `empty` / `error` / `unavailable`
  を区別し、`error` を赤やiconで特別扱いしません（「Common states」参照）。
- **success / warning はUIから外しています。** `--color-success` /
  `--color-warning` / `--color-info` はtokenとしては `tokens.css` に残って
  いますが、`src/` 内に参照はありません。新しい参照を足しません。statusを
  色だけで表現しないというruleは維持し、iconやtext labelを併用します。
- exact accent hueは引き続きintentionally unresolvedであり、本ファイルで
  永久的なfinal hueとして固定しません。現行値はGate Aのcurrent vocabulary
  として実際に使用しています（未使用のplaceholderではありません）。

### Badge

`src/ui/Badge` は色roleではなく **5つの固定した意味** で表現します。共通
サイズは `padding: 3px 8px`、角丸2px、11px / 600 / 1.4です。

| variant    | 意味                     | 例                               |
| ---------- | ------------------------ | -------------------------------- |
| `outline`  | 分類                     | 宝塚 / 月組、一般発売            |
| `subtle`   | 進行中の状態・意思       | 参加する、気になる、申し込む予定 |
| `done`     | 自分が終えたこと         | ✓ 申し込み済み                   |
| `deadline` | まだ間に合う期限         | 残り1日                          |
| `terminal` | もう行動できない終了状態 | 中止、受付終了                   |

`outline` / `subtle` はtext labelで状態を区別します。`done` はtoneに加えて
componentが持つ `✓`（`aria-hidden`）で `subtle` と区別し、色だけに依存
しません。`deadline` / `terminal` のみ塗りを持ちます。

## Design tokens

CSS custom propertiesを使い、**primitive → semantic** の2層構成とします。

- **primitive layer** — 生の値（color scale, spacing scale, radius scale
  等）。他のtokenやcomponentから直接参照しません。
- **semantic layer** — primitiveを参照し、role（`--color-canvas` /
  `--color-text` / `--color-accent` / `--space-md` 等）を表現します。
  componentは常にsemantic tokenを参照し、primitiveを直接参照しません。

必要なsemantic roleだけを先に作り、未使用のroleを先行して作りません。
実装は `src/ui/tokens.css` をtoken値のauthorityとします。

Dark modeは、token構成としては対応可能なarchitecture（semantic tokenの
値を切り替えるだけで成立する構成）にしますが、dark mode UI自体は今回
実装しません。

## Shared / feature-local component boundary

Visual / interaction semanticsがdomain-independentで実際に再利用される
ものだけをshared化します。

- **shared**（`src/ui/`） — Button / LinkButton / TextInput / TextArea /
  Badge / StatePanel / Sheet / WriteNotice / LoadingIndicator /
  CalendarSkeleton / AppShell / AppBar / PrimaryNav / ActionRow /
  FormSection / PageHeading / BackLink / TriStateCheckbox 等。
- **screen-local**（`src/app/**/_components/`） — EventDetail / calendar
  marker / ParticipationSheet / FilterSheet / InvitationCard /
  TicketOpportunityRow 等、domain semanticsを持つもの。

**新しいcontrolはscreen-localのCSS Moduleで始めてよい**（PO確定、
2026-08-31）。2つ目の使い手が出た時点で `src/ui/` へ引き上げます。先に
共有化すると、使い手1つのためにAPIを決めることになるためです。current
該当は18pxのcheckboxと44pxの2択segment（`ScheduleWriteForm.module.css`）
です。引き上げるときも値は変えません。

未来のfeature componentを大量に先行実装しません。

## Common states

loading / empty / error / disabled / unavailableのglobal visual pattern
を持ちます。ただしfeature/domain層がmeaning / messageを所有し、shared層は
presentation primitiveのみを提供します。

`src/ui/StatePanel.tsx` の3つのvariantは「title → description → action」と
上下1px細罫という **同一の構造** を共有します。違いは文言とARIA role
（`error` は `alert`、`empty` / `unavailable` は `status`）だけです。

- **`error` を赤やiconで特別扱いしません**（赤は期限専用のため）。
  `StatePanel` はdanger tokenを参照しません。
- 次の状態を同一の「何もありません」表示にしません。RLS等のsilent failure
  をempty UIとして誤表示する設計を避けます。
  - empty result（該当データなし）
  - auth failure（認証エラー）
  - permission denial（権限拒否）
  - permission check failure（権限の確認自体の失敗）
  - data load failure（読み込み失敗）
  - unavailable（機能未提供・準備中）
- **「読み込み失敗」を「データなし」に紛れ込ませません。** 特に、権限確認
  自体が失敗したときに「権限がない」と言いません（実際には権限を持つ人へ
  誤った説明をすることになるため）。
- 1つのpageが複数の独立した読み取りを持つ場合、blockごとに結果を持ち、
  片方が失敗してももう片方は表示します。page全体の失敗にするのは身元確認の
  失敗だけです。

### 補助的な件数表示の例外

上記「失敗をデータなしとして描かない」ruleの適用対象は、**その状態が
user-facingな主張になる surface** です。行や画面の内容そのものではなく、
既に到達可能な導線へ添えるだけの補助的な件数（badge / chip）に限り、
読み取り失敗を0として描いてよいものとします。

- 適用条件は次の3つを **すべて** 満たすことです。
  1. その件数がそのpageの主データではないこと
  2. 件数が0でも、その先へ辿る導線（行そのもの）が常に残ること
  3. 実際の値はその導線の先（一覧画面）で、通常の失敗表示とともに
     確認できること
- current該当はMy Pageの「招待一覧」行に添える未対応件数だけです。
  0を描いても「招待が0件である」と主張したことにはならず、user は行を
  開いて `docs/screens.md` の招待一覧の失敗表示に到達できます。
- この例外を、画面本体の空表示・一覧・状態表示へ広げません。

画面ごとの分岐と実文言は [`docs/screens.md`](./screens.md) を正本とします。

## Calendar weekday / Japanese holiday presentation

month calendar全体に適用するglobal presentation ruleです。個別feature
screenのcalendar marker semantics（date dot / run period band等）とは
別concernとして扱います。

- Saturdayはblue role（`--color-accent`）で表示します。
- Sundayはred role（`--color-danger`）で表示します。
- 日本の祝日（国民の祝日・休日）はred roleで表示します。
- SaturdayとJapanese holidayが重なる場合は、holiday presentationを
  優先します。
- 日付数字は固定段に置き、marker rowを別段として確保します。markerの有無で
  日付数字の縦位置を変えません。
- weekday headerを表示します。Saturday / Sundayは列位置、weekday header、
  accessible nameを組み合わせて非色cueを成立させ、per-cellの`土` / `日`は
  使いません。
- 実際の祝日は列位置から導出できないため、per-cellの`祝` cueを残します
  （`src/ui/DayRoleText.tsx`）。
- 前後月の日付は`text-secondary`で表示します。色だけを唯一の意味表現にせず、
  accessible name等のsemantic cueを併用します。
- Event rangeのcalendar bandのradiusは、badgeと共通の2pxステップ
  （`--radius-band` = `--radius-scale-badge`）を使い、controlのradiusとは
  混同しません。
- month navigationはicon control vocabularyを使います（visible 40px × 40px、
  tap 44px × 44px以上）。
- `holiday-unconfirmed`はmonth-level noticeだけで表現します。per-cellの`?`や
  `祝日未確認` cueは復活させません。

Holiday dataのauthorityは内閣府「国民の祝日について」掲載データ / CSV
です（[https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html](https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html)）。
公式に公表されていない将来年の祝日を推測し、確定扱いにしません。

product上の日付境界（`Asia/Tokyo`）は
[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
を正本とし、本節では重複記載しません。

## Component-specific treatment

global consistencyは目的ではなく、product qualityのための手段です。まず
usability、readability、product design qualityを優先して検討し、その結果として
再利用可能なruleをglobal vocabularyへ落とします。既存のglobal ruleがproduct
qualityを阻害する場合は、exceptionを足すだけでなくglobal rule自体を見直せます。
一方、screenごとの無秩序な別designは避けます。componentのroleに本質的な差が
ある場合は、component-specific treatmentを許容します。

## Accessibility baseline

WCAG 2.2 AA相当を baselineとします。

- semantic HTML
- keyboard access
- visible focus
- sufficient contrast
- zoom・reflow対応
- reduced motion（`prefers-reduced-motion`を尊重し、motionをglobal
  defaultで多用しない）
- 色のみに意味を依存しない
- sufficiently large touch target
- 片手利用しやすいinteraction

Storybookのa11y addon等はQA aidとして使いますが、compliance自体の証明
とはしません。

## Component catalog

Storybookを採用します。

- 責務分離: 本ファイル（`docs/ux-ui.md`）= global UX/UI ruleのcanonical
  source、`docs/screens.md` = 画面ごとの状態・権限・文言のdecision、
  tokens / shared components = implementation、Storybook =
  rendered examples / states catalog。Storybookをdesign ruleの正本には
  しません。
- Next.js / Reactのcurrent versionに対応する`@storybook/nextjs-vite`
  framework adapterを使用します。
- app production runtimeへ不要なcouplingを持ち込みません
  （`.storybook/**`はapp buildの対象外）。
- local起動用のnpm script、static build検証を用意します。

## 本ドキュメントで固定しないもの

次の項目はintentionally unresolvedであり、実装都合で本ファイルへ先行して
書き込みません。それぞれ関連するproduct task / 追加のPO checkpointで
確定します。

- exact accent hue（current Gate A scaleは使用中だが、futureのexact hue
  decisionはunresolved）
- お知らせ（`/notifications`）のUI。通知trigger / 保持期間 / 既読の
  domainが未決のため、画面自体が未着手です。AppBarのベルは正しいサイズの
  tap領域を保ったまま押せない状態で、未読ドットも呼び出し側が値を持つまで
  出しません（[Issue #231](https://github.com/reitojike/stage-tracker/issues/231)）
- feature-specific calendar marker semantics（同日複数公演の件数表示 /
  overlapping runsのstack / `+N` collapsing）
- Event range内でoccurrenceが存在しない日の表示方法
  （「Event range内でoccurrenceが存在しない日 = 休演日」という旧解釈は
  Issue #87で廃止済みであり、休演日専用の表示conceptは想定しません）
- event / occurrence / participation / invitation / personal schedule /
  TicketOpportunity planning のpersistence shape・table naming。これら
  のdomain persistenceの正本は `.ai-dev-foundation/product-rules.md` と
  current implementationであり、本ドキュメントでは固定しません
- budget集計の期間基準
- classification taxonomyの具体形（classificationのdata boundary自体は
  `.ai-dev-foundation/product-rules.md`で承認済み）、canonical venue
  identityの表示上の扱い、server-sideに永続化するsaved filter preference
  （Gate Aのfilter選択状態はbrowser-local persistence）
- bottom navのSearch tab化 / Settings placement / future feature
  navigation（ホーム / イベント / チケット / カレンダーの4項目label setは
  Issue #140・#188で確定済みだが、これ以上の項目追加や永久的なfinal IAは
  未確定）
- dark mode UI（token構成としては対応可能にするが、UI自体は未実装）
- production hosting（Gate A dogfood限定のVercel Hobby採用を除き
  broader/general production hosting platformは引き続きuncommitted）、
  PWA scope、MCP scope、broader rollout（現時点の実runtimeはGate Aの
  本人 + 妻の bounded 2-user dogfood）

auth providerはEmail magic link + Supabase Auth cookie-based session
（Issue #11、account bootstrap / recovery用）に加え、日常sign-inの
primary pathとしてPasskey（Issue #106、Magic Linkを置換しないoptional
credential）を追加した構成として決定済みです。production hosting等の
他のdeferred項目とは別に扱います。
