"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { redactObservabilityUrl } from "./vercel-observability-url";

/** The two Vercel callbacks must live on the client side of the layout boundary. */
export function VercelObservability() {
  return (
    <>
      <Analytics
        beforeSend={(event) => {
          const url = redactObservabilityUrl(event.url);
          return url === null ? null : { ...event, url };
        }}
      />
      <SpeedInsights
        beforeSend={(event) => {
          const url = redactObservabilityUrl(event.url);
          return url === null ? null : { ...event, url };
        }}
      />
    </>
  );
}
