# Vercel native observability

This runbook covers the stage-tracker Production baseline introduced by Issue #717. It uses Vercel Runtime / Build Logs, Web Analytics, and Speed Insights. Check the linked Vercel documentation before use because plan limits and command syntax can change.

## Enablement and intake

1. The project owner enables **Web Analytics** and **Speed Insights** for the stage-tracker project in the Vercel Dashboard. [Web Analytics setup](https://vercel.com/docs/analytics/quickstart) requires Dashboard enablement and a subsequent deployment; [Speed Insights setup](https://vercel.com/docs/speed-insights/quickstart) documents the package and deployment path.
2. Merge the reviewed code and wait for its Production deployment. The project deploys `main`, not PR heads.
3. The owner visits an authenticated Production page. Check Web Analytics for a page view and Speed Insights for an initial data point. Low traffic may delay useful aggregates.

As checked on 2026-09-25, [Web Analytics Hobby pricing](https://vercel.com/docs/analytics/limits-and-pricing) includes 50,000 monthly events, and [Speed Insights free pricing](https://vercel.com/docs/speed-insights/limits-and-pricing) includes 10,000 events in a rolling 30-day window shared by the team. The free Speed Insights Dashboard emphasizes Real Experience Score; the [CLI documentation](https://vercel.com/docs/speed-insights/accessing-metrics-with-vercel-cli) separately documents LCP, INP, CLS, FCP, and TTFB queries without Observability Plus. Confirm the project's actual plan and enabled tier in Vercel before treating either allowance as project-specific evidence. No sampling override is configured.

## URL privacy census

The App Router pages were checked on 2026-09-25. The two Vercel packages share one narrowly scoped `beforeSend` URL rule in `apps/web/src/app/vercel-observability-url.ts`:

| Surface                                                                   | Current URL values                                                                              | Sending rule                                           |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `/auth/confirm`                                                           | `token_hash`, `type`, `next`; Route Handler redirects without rendering a page                  | Drop an event if one is emitted                        |
| `/sign-in`                                                                | Fixed `error` / `requested` state; form email is submitted in the body                          | Remove the query, including any unexpected email value |
| `/catalog/invitations`                                                    | Invitation data is loaded for the authenticated user; no invitation token in the route or query | No change                                              |
| `/notifications`                                                          | `cursor`, `before`, and `snapshot` encode private pagination state                              | Remove the query                                       |
| `/catalog/events/[eventId]` and `/edit`                                   | Event ID in the path; optional occurrence ID in the query                                       | Replace the ID with `[eventId]` and remove the query   |
| `/schedule/[entryId]` and `/edit`                                         | Private entry ID in the path                                                                    | Replace the ID with `[entryId]` and remove the query   |
| Other pages (`/`, `/calendar`, `/catalog`, new, imports, tickets, mypage) | No user email or secret in app-generated URLs; calendar navigation uses month/date              | No change                                              |
| `/api/official-import/*`                                                  | Server endpoints, not rendered pages                                                            | No browser collection                                  |

The magic-link template fixes `next=/`; the callback consumes the token server-side and redirects. Invitation and share forms send email in action bodies, not URLs. New URL-bearing routes or query parameters need the same census before deployment. [Vercel's redaction guidance](https://vercel.com/docs/analytics/redacting-sensitive-data) and [Speed Insights `beforeSend`](https://vercel.com/docs/speed-insights/package) define the collection boundary.

## Codex read paths

Use [Vercel's official MCP endpoint](https://vercel.com/docs/agent-resources/vercel-mcp) with Codex CLI:

```text
codex mcp add vercel --url https://mcp.vercel.com
```

The owner approves the browser OAuth prompt if shown. Do not put credentials in the repository or Issue. In a Codex session, use `list_projects` and `list_deployments` to identify the project and Production deployment, then `get_deployment_build_logs` for bounded build output and `get_runtime_logs` with `environment: production`, a short `since` window, and a small `limit`. Filter by level or status for investigations. The [current MCP tool list](https://vercel.com/docs/agent-resources/vercel-mcp/tools) also provides `get_web_analytics` for `visits` counts or aggregates, so an API token is unnecessary for the primary programmatic page-view read path. These queries are read-only even though Vercel MCP also exposes write tools.

With an already authenticated Vercel CLI session, use the official [Speed Insights](https://vercel.com/docs/speed-insights/accessing-metrics-with-vercel-cli) and [Web Analytics](https://vercel.com/docs/analytics/accessing-metrics-with-vercel-cli) schemas and queries. Replace `<project>` with the actual project name:

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

The [Web Analytics REST API](https://vercel.com/docs/analytics/web-analytics-api) is another read path, but its official instructions require a Vercel access token. Prefer MCP or the authenticated CLI context; do not create a long-lived token for this baseline.
