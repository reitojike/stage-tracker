# Vercel標準observability

このrunbookはIssue #717で導入されたstage-tracker Productionのbaselineを扱います。Vercel Runtime / Build Logs、Web Analytics、Speed Insightsを
使用します。plan limitやcommand syntaxは変わる可能性があるため、使用前にlink先のVercel documentationを確認してください。

## 有効化とデータ取り込み

1. project ownerはVercel Dashboardでstage-tracker projectの**Web Analytics**と**Speed Insights**を有効にします。[Web Analytics setup](https://vercel.com/docs/analytics/quickstart)にはDashboardでの有効化とその後のdeploymentが必要です。[Speed Insights setup](https://vercel.com/docs/speed-insights/quickstart)にはpackageとdeploymentの手順が記載されています。
2. review済みcodeをmergeし、Production deploymentを待ちます。このprojectがdeployするのはPR headではなく`main`です。
3. ownerはauthenticatedなProduction pageへアクセスします。Web Analyticsでpage view、Speed Insightsで初回のdata pointを確認します。trafficが少ないと、有用な集計が得られるまで時間がかかる場合があります。

2026-09-25時点の確認では、[Web Analytics Hobby pricing](https://vercel.com/docs/analytics/limits-and-pricing)には月間50,000 eventが含まれ、[Speed Insights free pricing](https://vercel.com/docs/speed-insights/limits-and-pricing)にはteam内で共有されるrolling 30-day windowあたり10,000 eventが含まれます。無料版Speed Insights DashboardではReal Experience Scoreが中心です。[CLI documentation](https://vercel.com/docs/speed-insights/accessing-metrics-with-vercel-cli)にはObservability PlusなしでLCP、INP、CLS、FCP、TTFBをqueryする方法も別途記載されています。いずれの上限もproject固有のevidenceとして扱う前に、Vercelで実際のplanと有効tierを確認してください。sampling overrideは設定されていません。

## URL privacyの棚卸し

App Router pageは2026-09-25に確認しました。2つのVercel packageは、`apps/web/src/app/vercel-observability-url.ts`にある範囲を限定した共通の`beforeSend` URL ruleを使用します。

| 対象                                                                      | 現在のURL値                                                                                 | 送信時のrule                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `/auth/confirm`                                                           | `token_hash`、`type`、`next`。Route Handlerはpageをrenderせずredirectする                   | eventが生成された場合は破棄する            |
| `/sign-in`                                                                | `error` / `requested` stateは固定。form emailはbodyで送信する                               | 想定外のemail値も含めてqueryを削除する     |
| `/catalog/invitations`                                                    | authenticated user向けのInvitation dataを読み込む。routeまたはqueryにinvitation tokenはない | 変更なし                                   |
| `/notifications`                                                          | `cursor`、`before`、`snapshot`はprivate pagination stateを含む                              | queryを削除する                            |
| `/catalog/events/[eventId]` and `/edit`                                   | path内のEvent ID。queryにはoptional occurrence IDがある                                     | IDを`[eventId]`に置き換え、queryを削除する |
| `/schedule/[entryId]` and `/edit`                                         | path内のprivate entry ID                                                                    | IDを`[entryId]`に置き換え、queryを削除する |
| Other pages (`/`, `/calendar`, `/catalog`, new, imports, tickets, mypage) | app生成URLにuser emailやsecretは含まれない。calendar navigationではmonth/dateを使う         | 変更なし                                   |
| `/api/official-import/*`                                                  | server endpointであり、renderされるpageではない                                             | browserでのcollectionなし                  |

magic-link templateでは`next=/`に固定されています。callbackはserver-sideでtokenを処理してredirectします。Invitation formとshare formはemailをURLではなくaction bodyで送信します。URLを含む新しいrouteまたはquery parameterをdeploymentする前に、同じ棚卸しが必要です。[Vercelのredaction guidance](https://vercel.com/docs/analytics/redacting-sensitive-data)と[Speed Insights `beforeSend`](https://vercel.com/docs/speed-insights/package)がcollection boundaryを定めます。

## Codexからの読み取り経路

Codex CLIで[Vercelの公式MCP endpoint](https://vercel.com/docs/agent-resources/vercel-mcp)を使用します。

```text
codex mcp add vercel --url https://mcp.vercel.com
```

browser OAuth promptが表示された場合、ownerが承認します。credentialをrepositoryやIssueへ記載しないでください。Codex sessionでは`list_projects`と`list_deployments`でprojectとProduction deploymentを特定し、上限を設けたbuild outputには`get_deployment_build_logs`を使用します。`get_runtime_logs`は`environment: production`、短い`since`期間、小さい`limit`で実行します。調査ではlevelまたはstatusでfilterします。[現在のMCP tool一覧](https://vercel.com/docs/agent-resources/vercel-mcp/tools)には`visits` countまたはaggregateを取得する`get_web_analytics`もあるため、主なprogrammatic page-view read pathにAPI tokenは不要です。Vercel MCPにはwrite toolもありますが、ここでのqueryはread-onlyです。

Vercel CLIで認証済みのsessionがある場合、公式の[Speed Insights](https://vercel.com/docs/speed-insights/accessing-metrics-with-vercel-cli)と[Web Analytics](https://vercel.com/docs/analytics/accessing-metrics-with-vercel-cli)のschemaおよびqueryを使用します。`<project>`は実際のproject名に置き換えます。

```text
vercel metrics schema vercel.speed_insights
vercel metrics vercel.speed_insights.lcp_ms --aggregation p75 --since 7d --project <project> --prod
vercel metrics vercel.speed_insights.inp_ms --aggregation p75 --since 7d --project <project> --prod
vercel metrics vercel.speed_insights.cls --aggregation p75 --since 7d --project <project> --prod
vercel metrics vercel.speed_insights.fcp_ms --aggregation p75 --since 7d --project <project> --prod
vercel metrics vercel.speed_insights.ttfb_ms --aggregation p75 --since 7d --project <project> --prod
vercel metrics schema vercel.analytics
vercel metrics vercel.analytics.page_view.count --since 7d --project <project> --prod
```

[Web Analytics REST API](https://vercel.com/docs/analytics/web-analytics-api)も読み取り経路の1つですが、公式手順ではVercel access tokenが必要です。MCPまたは認証済みCLI contextを優先し、このbaselineのために長期tokenを作成しないでください。
