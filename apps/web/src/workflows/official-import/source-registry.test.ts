import { describe, expect, it } from "vitest";
import {
  OfficialSourceRegistryError,
  assertAllowedSourceUrl,
  getOfficialSource,
  isScheduledShadowSource,
  listOfficialSources,
  listScheduledShadowSources,
  requireEnabledShadowSource,
} from "./source-registry";

describe("official source registry", () => {
  it("resolves a code-owned enabled shadow source by id", () => {
    const source = requireEnabledShadowSource("event.kabuki-bito.schedule");
    expect(source.domainKind).toBe("event");
    expect(source.adapter).toBe("http_html");
    expect(source.extractor).toBe("kabuki_bito");
    expect(source.canonicalUrl).toBe("https://www.kabuki-bito.jp/schedule/");
  });

  it("keeps every source out of Cron until its separate operator gate clears", () => {
    expect(listScheduledShadowSources()).toEqual([]);
    expect(
      listOfficialSources().every((source) => !source.scheduledEnabled),
    ).toBe(true);
    expect(
      getOfficialSource("event.kabuki-bito.schedule")?.fetchCadenceHint,
    ).toBe("weekly");
    expect(getOfficialSource("event.takarazuka.revue")?.fetchCadenceHint).toBe(
      "weekly",
    );
    const approved = requireEnabledShadowSource("event.kabuki-bito.schedule");
    expect(isScheduledShadowSource(approved)).toBe(false);
    expect(
      isScheduledShadowSource({ ...approved, scheduledEnabled: true }),
    ).toBe(true);
    expect(
      isScheduledShadowSource({
        ...approved,
        scheduledEnabled: true,
        policyState: "planned",
      }),
    ).toBe(false);
    const held = getOfficialSource("event.meme-tokyo.calendar");
    if (held === null) throw new Error("test source missing");
    expect(isScheduledShadowSource({ ...held, scheduledEnabled: true })).toBe(
      false,
    );
  });

  it("rejects arbitrary ids and policy-held sources", () => {
    expect(() =>
      requireEnabledShadowSource("https://attacker.example/source"),
    ).toThrow(OfficialSourceRegistryError);
    expect(() =>
      requireEnabledShadowSource("ticket.vpass.takarazuka-east"),
    ).toThrow(/not enabled for shadow runs/);
  });

  it("keeps the PDF and Vpass sources disabled until their gates clear", () => {
    const pdf = getOfficialSource("ticket.takarazuka-friends.schedule-pdf");
    const vpass = getOfficialSource("ticket.vpass.takarazuka-east");
    expect(pdf).toMatchObject({
      enabled: false,
      policyState: "planned",
      adapter: "pdf",
      extractor: "takarazuka_friends_pdf",
    });
    expect(vpass).toMatchObject({ enabled: false, policyState: "hold" });
  });

  it("keeps WordPress API sources disabled until source-specific rollout gates clear", () => {
    for (const id of ["event.kyurushite.schedule", "event.chumtoto.schedule"]) {
      expect(getOfficialSource(id)).toMatchObject({
        enabled: false,
        policyState: "planned",
        adapter: "http_json",
        extractor: "wordpress_tribe_events",
      });
      expect(() => requireEnabledShadowSource(id)).toThrow(
        OfficialSourceRegistryError,
      );
    }
  });

  it("keeps new SKIYAKI sources disabled pending source-specific rollout gates", () => {
    for (const id of [
      "event.meme-tokyo.calendar",
      "event.arcana-project.calendar",
    ]) {
      expect(getOfficialSource(id)).toMatchObject({
        enabled: false,
        policyState: "planned",
        extractor: "skiyaki_calendar",
      });
      expect(() => requireEnabledShadowSource(id)).toThrow(
        OfficialSourceRegistryError,
      );
    }
  });

  it("allowlists only the known Shochiku schedule pages", () => {
    const source = getOfficialSource("ticket.shochiku.schedule");
    if (source === null) throw new Error("test source is missing");
    expect(
      assertAllowedSourceUrl(
        source,
        "https://www1.ticket-web-shochiku.com/t/info/sale_schedule_east.html",
      ),
    ).toContain("sale_schedule_east.html");
    expect(() =>
      assertAllowedSourceUrl(
        source,
        "https://www1.ticket-web-shochiku.com/t/other.html",
      ),
    ).toThrow(OfficialSourceRegistryError);
  });

  it.each([
    "http://www.kabuki-bito.jp/schedule/",
    "https://www.kabuki-bito.jp.attacker.example/schedule/",
    "https://www.kabuki-bito.jp/not-schedule/",
    "https://user@www.kabuki-bito.jp/schedule/",
  ])("rejects URL outside the bounded origin/path: %s", (url) => {
    const source = getOfficialSource("event.kabuki-bito.schedule");
    expect(source).not.toBeNull();
    if (source === null) throw new Error("test source is missing");
    expect(() => assertAllowedSourceUrl(source, url)).toThrow(
      OfficialSourceRegistryError,
    );
  });

  it("accepts only a URL under the registered path and removes fragments", () => {
    const source = getOfficialSource("event.kabuki-bito.schedule");
    if (source === null) throw new Error("test source is missing");
    expect(
      assertAllowedSourceUrl(
        source,
        "https://www.kabuki-bito.jp/schedule/2026/#oct",
      ),
    ).toBe("https://www.kabuki-bito.jp/schedule/2026/");
  });
});
