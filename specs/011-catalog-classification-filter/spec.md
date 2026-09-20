# Catalog classification / filter 現行仕様

**Status**: Current behavior contract

**Scope**: shared Event catalog の classification と `/catalog` filter semantics

## Authority Boundary

この文書は、shared Event catalog における genre、group、Event の venue text を
filter dimension として扱う現行の product / domain semantics の normative authority
です。

Event / Occurrence の identity、range、ownership、通常の Event update、venue value
そのものの lifecycle は [Event / Occurrence lifecycle Living Spec](../005-event-occurrence-lifecycle/spec.md)
が authority です。Event range による base catalog discoverability も Spec 005 が
定義します。cancellation の month-grid projection と count は
[Calendar month-grid Living Spec](../004-calendar-month-grid/spec.md) が定義します。

この文書は filter の意味を定義しますが、画面の layout、copy、loading / empty
feedback、draft / applied interaction は [`docs/screens.md`](../../docs/screens.md)
が presentation authority です。schema、RLS、read boundary、import procedure、
runtime implementation、tests は mechanics / deterministic evidence であり、この
文書へ再定義しません。

## User Scenarios & Testing

### Scenario 1: classification のない Event を含む shared catalog を絞り込む

Event は primary genre を持たなくても valid です。genre がない Event は
「すべて」では表示されますが、specific genre filter には hit しません。
`その他` や `未分類` を表す fabricated classification を作りません。

classification が明示されていない Event を title、venue、表示文言その他から
推測して genre / group filter に hit させません。

### Scenario 2: genre と generic group を扱う

Event は optional な primary genre を 0..1 持ち、genre identity は extensible な
canonical lookup identity です。現行 Gate-A の代表的 identity は次のとおりです。

| genre    | current identity |
| -------- | ---------------- |
| 宝塚     | `takarazuka`     |
| 歌舞伎   | `kabuki`         |
| アイドル | `idol`           |

この一覧は永久的な closed enum ではありません。将来の genre 追加を妨げない一方、
将来 need だけを理由に multi-genre Event を current behavior として約束しません。

Event と generic group の関連は 0..N です。宝塚の「組」とアイドルの「グループ」
は同じ generic group concept であり、group identity 自体を genre-specific concept
へ hard-bind しません。選択した group のいずれかと Event の明示的な group
association が一致した場合に、その Event は group facet に hit します。

### Scenario 3: venue を filter dimension として扱う

venue は Event-level product information です。Venue value、Event owner による
通常の venue update、venue が Occurrence-level ではないことは Spec 005 の責務で
あり、この文書は変更しません。

この文書が定義するのは venue filter の意味だけです。current venue value は nullable
text として扱い、venue filter は exact text match です。canonical venue master、
alias、normalization は current behavior ではありません。現行 Gate-A では歌舞伎の
選択時に venue facet が active になります。

### Scenario 4: current facet topology で filter を組み合わせる

genre は single-select です。選択中の genre は current UI で高々 1 つの secondary
facet を active にします。

| selected genre | active secondary facet |
| -------------- | ---------------------- |
| 宝塚           | group                  |
| 歌舞伎         | venue                  |
| アイドル       | group                  |

したがって、current behavior で複数の secondary facet が同時に active になるとは
扱いません。filter model が将来拡張可能であることや、別の genre に facet を追加
できることは、current UI が複数 facet を同時に提供することを意味しません。

同じ active secondary facet 内の複数 selection は OR です。genre と、現在 active な
secondary facetの selection は AND です。secondary selection がない場合はその
facetで絞り込みません。catalog-wide の known options をその facet で全選択した
場合も、絞り込みなしと同じ意味です。

明示的な classification がない row は推測で hit しません。genre がない Event は
specific genre に、group association がない Event は group selection に、venue が
null または不一致の Event は venue selection に hit しません。

### Scenario 5: option universe と filter state を保持する

secondary facet の option universe は表示中の月だけから構成しません。関連する
genre に明示的に関連付けられた、catalog-wide の known group values または venue
values から構成します。月を移動しただけで option universe が変わる意味には
しません。

filter selection は browser-local に persist します。server-side の per-user filter
preference は current behavior ではありません。この文書は persistence の product
boundary だけを定義し、localStorage key、serialization、version、React state shape
は固定しません。

### Scenario 6: classification の write boundary

genre / group association は shared Event catalog data です。authenticated user は
classification を read できますが、ordinary authenticated user 向けの generic な
classification edit capability はありません。Event owner であっても通常の Event
write path から genre / group association を変更できません。current の classification
association write は operator/import-owned です。

既存 Event を title、venue、その他の machine heuristic から一括推論して分類しません。
明示的な operator-reviewed import data がない Event は、classification のない valid
Event として扱います。

ここでいう operator/import-owned は genre / group association に限ります。Event の
venue text の value と owner write capability を operator-only とする意味ではありません。

## Requirements

### Classification identity

- **CF-001**: Event の primary genre は optional な 0..1 であり、genre なしの
  Event は valid である。
- **CF-002**: genre なしの Event は「すべて」では discoverable だが、specific genre
  filter には hit しない。「その他 / 未分類」の fabricated classification を作らない。
- **CF-003**: current Gate-A genre identity は extensible な canonical lookup identity
  として扱い、宝塚、歌舞伎、アイドルを永久的な closed enum として固定しない。
- **CF-004**: Event の group association は 0..N で、group identity は genre-specific
  concept ではない。group filter は明示的な association の一致だけで hit する。
- **CF-005**: genre / group classification は explicit data のみで判定し、title、venue
  その他の heuristic で unclassified / unassociated Event を補完しない。

### Current facet and matching semantics

- **CF-006**: genre は single-select であり、current selected genre が active にする
  secondary facet は高々 1 つである。current topology は 宝塚→group、歌舞伎→venue、
  アイドル→group である。
- **CF-007**: 同じ active secondary facet 内の複数 selection は OR、genre とその
  active secondary facet は AND である。
- **CF-008**: secondary selection がない、または catalog-wide の known options を
  全選択している場合、その facet では絞り込まない。
- **CF-009**: venue filter は nullable な current Event venue text の exact text match
  であり、venue master、alias、normalization を current behavior としない。
- **CF-010**: filter matching は明示的な classification / venue value のみを使い、
  推測による hit を許さない。

### Option universe and persistence

- **CF-011**: secondary option universe は表示中の月に限定せず、関連 genre に
  scoped した catalog-wide known values から構成する。
- **CF-012**: filter selection は browser-local に persist し、server-side per-user
  preference は current behavior としない。具体的な browser storage format は
  この仕様の対象外である。

### Write authority

- **CF-013**: authenticated user は shared classification data を read できるが、
  ordinary Event owner を含む user-facing write capability は持たない。
- **CF-014**: genre / group association の current write boundary は operator/import-owned
  であり、既存 Event への heuristic 一括分類を行わない。
- **CF-015**: Event venue value と owner による通常の venue update は Spec 005 の
  Event management capabilityであり、genre / group classification の operator/import
  boundaryへ含めない。

## Cross-domain Boundary

- Event / Occurrence の identity、range、ownership、update、cancellation、deletion、
  Event range による base catalog discoverability、および Event-level venue value / owner
  write は [Spec 005](../005-event-occurrence-lifecycle/spec.md) が authority です。
- cancellation の month-grid count、range projection、selected-day cancellation
  presentation は [Spec 004](../004-calendar-month-grid/spec.md) が authority です。
  classification/filter matching は Spec 004 に委譲しません。
- `/catalog` の summary row、icon dot、draft / applied state、loading、metadata
  failure、empty state、exact copy、layout / state feedback は
  [`docs/screens.md`](../../docs/screens.md) が presentation authority です。
- catalog import の reviewed seed、operator procedure、schema、RLS、RPC、typed read
  boundary、loader、component state は runbook / architecture / implementation / tests
  の責務です。この文書は「誰が classification を書けるか」という product boundary
  だけを定義します。

## Scope Boundaries

この仕様は current Catalog classification / filter semantics のみを扱います。

次は current behavior として扱いません。

- canonical venue master、venue alias / normalization
- favorites、recommendation / ranking
- classification-derived visual / color cue と raw color domain persistence
- occurrence-level classification
- multi-genre Event
- generic group hierarchy / alias platform
- future additional facets（例: 宝塚の venue facet）
- server-side per-user filter preference

Event / Occurrence lifecycle、cancellation month-grid projection、screen presentation、
import procedure、schema / RLS / RPC / SQL、migration、generated types、data-access
helper、localStorage key / version、React state shape はこの仕様の実装詳細・別authority
です。

## Success Criteria

- **SC-001**: optional primary genre、valid な unclassified Event、0..N generic group
  association、current Gate-A genre identity が、closed enum や fabricated classification
  を導入せず説明できる。
- **SC-002**: current facet topology が 宝塚→group、歌舞伎→venue、アイドル→group で、
  selected genre が同時に複数 secondary facet を active にするとは説明していない。
- **SC-003**: secondary facet 内 OR、genre との AND、空選択 / 全選択の no-narrowing、
  explicit-only matching を検証可能である。
- **SC-004**: option universe が relevant genre に scoped された catalog-wide known
  valuesであり、表示月の移動だけで変化しないことを検証可能である。
- **SC-005**: filter state の browser-local persistence と、server-side per-user
  preference が current behavior ではないことを検証可能である。
- **SC-006**: genre / group association write が operator/import-owned であり、ordinary
  Event owner が classification を変更できないことを検証可能である。
- **SC-007**: Event venue value / owner write が Spec 005、venue filter meaning が
  この仕様、cancellation month-grid projection が Spec 004 に分離されている。
- **SC-008**: future classification ideas、screen presentation、import / schema / RLS /
  data-access mechanics がこの仕様へ current semantics として混入していない。
