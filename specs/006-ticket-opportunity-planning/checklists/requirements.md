# Specification Quality Checklist: TicketOpportunity planning model / personal state

**Purpose**: #562のcurrent behavior Living Specが、既存のSpec 001/003と責務を分け、future modelをcurrent化していないことを確認する。
**Created**: 2026-09-19
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] 実装mechanicsではなく、current user-visible semanticsを記述している
- [x] TicketOpportunity planning modelのbounded scopeに集中している
- [x] 既存Spec 001/003のauthority boundaryを保持している
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
- [x] Event-wide、selected-occurrences、全件中止、部分・未解決targetのcancellation semanticsが明示されている
- [x] post-final retentionの7日目/8日目境界とcancellationとの独立性が明示されている

## Boundary Readiness

- [x] Spec 003をtimeline projectionのbounded authorityとして保持している
- [x] Spec 001をParticipation lifecycleのauthorityとして保持している
- [x] acquired-ticket inventory、seat、assignment、transfer、import redesignをcurrent化していない
- [x] `/tickets`とHomeはconsuming surfaceとして扱い、UI implementationをこのSpecのauthorityにしていない
- [x] Spec 003が除外するretentionとTicketOpportunity cancellationのauthorityを新Specへ集約している

## Notes

- このchecklistの`[x]`はrequirements qualityの確認済みを示し、runtime implementationの完了を示さない。
