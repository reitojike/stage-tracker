# Specification Quality Checklist: TicketOpportunity planning model / personal state

**Purpose**: #562のcurrent behavior Living Specが、既存のSpec 001/003と責務を分け、future modelをcurrent化していないことを確認する。
**Created**: 2026-09-19
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] 実装mechanicsではなく、current user-visible semanticsを記述している
- [x] TicketOpportunity planning modelのbounded scopeに集中している
- [x] Spec 001/003のauthority boundaryを保持し、Participation independenceはSpec 001 FR-035へ委譲している
- [x] mandatory sectionsをすべて記述している

## Requirement Completeness

- [x] `[NEEDS CLARIFICATION]` markerが残っていない
- [x] requirementsがtestableで、status vocabularyとrow absenceが曖昧でない
- [x] success criteriaがcurrent behaviorに対して検証可能である
- [x] schema/SQL/RLSの実装詳細をnormative ruleとして追加していない
- [x] shared identity、target scope、milestone、personal state、cross-boundaryのacceptance scenariosがある
- [x] row absence、source precision、scope mismatch、state independenceのedge caseがある
- [x] scope boundaryとout of scopeが明示されている
- [x] current source evidenceをAssumptionsとAuthority Boundaryで位置付けている
- [x] shared catalogのread、personal stateのowner-only read/write、shared mutation禁止の境界が明示されている
- [x] deadline urgency semanticsをSpec 003のdate semanticsと重複せず記述している
- [x] shared read成功・personal state read失敗時のdegradationとunknown-vs-untrackedを記述している
- [x] milestone windowのstart <= endをproduct invariantとして記述している
- [x] user × Opportunityのcurrent personal state最大1件を記述している
- [x] stable source identityとrefresh後の同一planning identity / personal state保持を記述している
- [x] Event-wide、selected-occurrences、全件中止、部分・未解決targetのcancellation semanticsが明示されている
- [x] effective cancellationがpersonal stateを自動変更せず、known non-retained stateのplanning capabilityを自動禁止しない境界を記述している
- [x] post-final retentionの7日目/8日目境界とcancellationとの独立性が明示されている
- [x] Opportunityごとのmilestone type cardinalityとshared refresh時のpersonal state保持が明示されている
- [x] Event deletion operationはSpec 005、TicketOpportunity / personal stateのcross-domain consequenceはSpec 008としてownerが一意である
- [x] zero-milestone Opportunityはfabricated rowなしでHome / `/tickets`のplanning projectionから除外され、identityの削除やinvalid化と混同していない
- [x] `/tickets`のsemantic priorityがeffective cancellation > retained history > personal planning stateとして明示され、retained rowのpersonal state削除を意味していない
- [x] current `/tickets` planning projectionにrowとして現れ、validなofficial source URLがある場合のsource access capabilityを、非投影Opportunity向けの別surface・Opportunity identity・exact UI implementationと混同せず記述している

## Boundary Readiness

- [x] Spec 003をtimeline projectionのbounded authorityとして保持している
- [x] Spec 001をParticipation lifecycleのauthorityとして保持している
- [x] Spec 005をEvent / Occurrence lifecycleとそのcancellation/deletion authorityとして保持している
- [x] acquired-ticket inventory、seat、assignment、transfer、import redesignをcurrent化していない
- [x] `/tickets`とHomeはconsuming surfaceとして扱い、UI implementationをこのSpecのauthorityにしていない
- [x] Homeのnon-retained primary milestone表示と`/tickets`のcancellation表示をsurface境界として区別している
- [x] Homeのexact 5-row capをdomain invariantにしていない
- [x] Badge variant、exact copy、CSS、component/helper名、read-state mechanicsをLiving Specへ追加していない
- [x] Event deletionのDB mechanism、zero-milestoneのplaceholder実装、retained-historyのexact copy / Badge / componentをLiving Specへ追加していない
- [x] official source accessのexact copy / link component / styling / browser mechanicsをLiving Specへ追加していない
- [x] Spec 003が除外するretentionとTicketOpportunity cancellationのauthorityを新Specへ集約している

## Notes

- このchecklistの`[x]`はrequirements qualityの確認済みを示し、runtime implementationの完了を示さない。
