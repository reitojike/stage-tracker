"use client";

import { useRef, useState } from "react";
import { Button, SectionHeading } from "@stage-tracker/ui";

function ManualShadowRun({
  sourceId,
  headingId,
  heading,
  label,
  description,
}: {
  sourceId: string;
  headingId: string;
  heading: string;
  label: string;
  description: string;
}) {
  const inFlight = useRef(false);
  const [status, setStatus] = useState<
    "idle" | "starting" | "started" | "failed"
  >("idle");

  async function start() {
    if (inFlight.current || status === "started") return;
    inFlight.current = true;
    setStatus("starting");
    try {
      const response = await fetch("/api/official-import/shadow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId }),
      });
      if (response.status !== 202) throw new Error("shadow start failed");
      setStatus("started");
    } catch {
      inFlight.current = false;
      setStatus("failed");
    }
  }

  return (
    <section className="flex flex-col gap-sm" aria-labelledby={headingId}>
      <div className="flex flex-col gap-2xs">
        <SectionHeading id={headingId}>{heading}</SectionHeading>
        <p className="text-body-sm text-muted-foreground">{description}</p>
      </div>
      <div>
        <Button
          type="button"
          disabled={status === "starting" || status === "started"}
          onClick={start}
        >
          {status === "starting" ? "取得を開始中…" : label}
        </Button>
      </div>
      {status === "started" ? (
        <p role="status" className="text-body-sm">
          取得を開始しました。完了後に画面を更新して結果を確認してください。
        </p>
      ) : null}
      {status === "failed" ? (
        <p role="alert" className="text-body-sm text-destructive">
          取得を開始できませんでした。権限と通信状態を確認してください。
        </p>
      ) : null}
    </section>
  );
}

export function KabukiManualShadowRun() {
  return (
    <ManualShadowRun
      sourceId="event.kabuki-bito.schedule"
      headingId="kabuki-run-heading"
      heading="歌舞伎の手動取得"
      label="歌舞伎を手動取得"
      description="公式情報を一度だけ確認し、解析できた内容を確認待ち候補にします。自動承認・反映はしません。実行後は数分待ってこの画面を更新し、候補と保留ページを確認してください。"
    />
  );
}

export function ShochikuTicketManualShadowRun() {
  return (
    <ManualShadowRun
      sourceId="ticket.shochiku.schedule"
      headingId="shochiku-ticket-run-heading"
      heading="チケット販売情報の手動取得"
      label="チケット販売情報を手動取得"
      description="歌舞伎美人の発売情報とチケットWeb松竹の詳細日程を読み、確認待ち候補にします。Eventとの対応が不明なものは保留され、自動承認・反映はしません。"
    />
  );
}
