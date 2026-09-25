import { describe, expect, it } from "vitest";
import {
  parseShochikuSaleMilestone,
  parseShochikuSchedule,
} from "./shochiku-ticket";

const html = `
  <h4 class="page-block__title title3" id="box1">歌舞伎座<br><span>東京都中央区</span></h4>
  <div class="performance__body">
    <h4 class="performance-title title_margin">秀山祭九月大歌舞伎</h4>
    <p class="agenda_size"><strong>2026年9月2日（水）～9月26日（土）</strong></p>
    <table>
      <tr><th>「松竹歌舞伎会」ゴールド会員</th><td>８月11日（火）～</td></tr>
      <tr><th>一般販売</th><td>8月14日～</td></tr>
    </table>
  </div>`;

describe("Shochiku ticket schedule", () => {
  it("preserves source labels and creates one fact per sale row", () => {
    expect(parseShochikuSchedule(html)).toEqual([
      {
        title: "秀山祭九月大歌舞伎",
        venue: "歌舞伎座",
        startsOn: "2026-09-02",
        endsOn: "2026-09-26",
        displayName: "「松竹歌舞伎会」ゴールド会員",
        rowText: "８月11日（火）～",
        milestone: {
          type: "sale_start",
          precision: "date",
          date: "2026-08-11",
        },
      },
      expect.objectContaining({
        displayName: "一般販売",
        milestone: {
          type: "sale_start",
          precision: "date",
          date: "2026-08-14",
        },
      }),
    ]);
  });

  it("preserves exact time precision without inventing a default time", () => {
    expect(
      parseShochikuSaleMilestone("9月29日 10時～17時まで", "2026-10-01"),
    ).toEqual({
      type: "sale_start",
      precision: "window",
      startsAt: "2026-09-29T10:00:00+09:00",
      endsAt: "2026-09-29T17:00:00+09:00",
    });
    expect(
      parseShochikuSaleMilestone("ほうおう10月号到着後～", "2026-10-01"),
    ).toBeNull();
    expect(
      parseShochikuSaleMilestone("9月29日 10:00～17：30まで", "2026-10-01"),
    ).toEqual({
      type: "sale_start",
      precision: "window",
      startsAt: "2026-09-29T10:00:00+09:00",
      endsAt: "2026-09-29T17:30:00+09:00",
    });
    expect(
      parseShochikuSaleMilestone(
        "9月16日（水）10時～9月17日（木）17時まで 電話・Web",
        "2026-10-02",
      ),
    ).toEqual({
      type: "sale_start",
      precision: "window",
      startsAt: "2026-09-16T10:00:00+09:00",
      endsAt: "2026-09-17T17:00:00+09:00",
    });
    expect(
      parseShochikuSaleMilestone(
        "ほうおう10月号到着後～9月13日（日）17時まで Web抽選申込",
        "2026-10-02",
      ),
    ).toBeNull();
  });

  it("does not mix sales rows across adjacent performances", () => {
    const nested = `<h4 class="page-block__title title3">歌舞伎座</h4>
      <div class="performance__body">
        <h4 class="performance-title">九月公演</h4>
        <p class="agenda_size">2026年9月2日（水）～9月26日（土）</p>
        <table><tr><th>一般販売</th><td>8月14日～</td></tr></table>
        <h4 class="performance-title">十月公演</h4>
        <p class="agenda_size">2026年10月26日（月）</p>
        <table><tr><th>一般発売</th><td>9月30日～</td></tr></table>
      </div>`;
    expect(parseShochikuSchedule(nested)).toMatchObject([
      {
        title: "九月公演",
        startsOn: "2026-09-02",
        endsOn: "2026-09-26",
        rowText: "8月14日～",
      },
      {
        title: "十月公演",
        startsOn: "2026-10-26",
        endsOn: "2026-10-26",
        rowText: "9月30日～",
      },
    ]);
  });

  it("accepts observed adjacent-day notation and excludes month-only teasers", () => {
    const page = `<h4 class="page-block__title title3">歌舞伎座ホール</h4>
      <div class="performance__body">
        <h4 class="performance-title">二日間公演</h4>
        <p class="agenda_size">2026年9月5日（土）・6日（日）</p>
        <table><tr><th>一般販売</th><td>8月8日～</td></tr></table>
        <h4 class="performance-title">月だけの予告</h4>
        <p class="agenda_size">2026年9月～12月（詳細は後日）</p>
        <table><tr><th>一般販売</th><td>8月8日～</td></tr></table>
      </div>`;
    expect(parseShochikuSchedule(page)).toMatchObject([
      { title: "二日間公演", startsOn: "2026-09-05", endsOn: "2026-09-06" },
    ]);
  });

  it("does not stage a deadline as the opening of an undated magazine application", () => {
    const page = `<h4 class="page-block__title title3">新橋演舞場</h4>
      <div class="performance__body">
        <h4 class="performance-title">十月公演</h4>
        <p class="agenda_size">2026年10月2(金)～10月28日(水)</p>
        <table>
          <tr><th>松竹歌舞伎会会員</th><td>ほうおう10月号到着後～9月13日（日）17時まで Web抽選申込</td></tr>
          <tr><th>一般販売</th><td>9月20日（日）～</td></tr>
        </table>
      </div>`;
    expect(parseShochikuSchedule(page)).toMatchObject([
      {
        title: "十月公演",
        startsOn: "2026-10-02",
        endsOn: "2026-10-28",
        displayName: "一般販売",
      },
    ]);
  });

  it("uses the previous year for a sale date preceding a January production", () => {
    expect(parseShochikuSaleMilestone("11月30日～", "2027-01-02")).toEqual({
      type: "sale_start",
      precision: "date",
      date: "2026-11-30",
    });
  });

  it("keeps a sale during the performance range in the same year", () => {
    expect(
      parseShochikuSaleMilestone("9月10日～", "2026-09-02", "2026-09-26"),
    ).toEqual({
      type: "sale_start",
      precision: "date",
      date: "2026-09-10",
    });
  });

  it("uses the ending year for an omitted-year sale during a New Year run", () => {
    expect(
      parseShochikuSaleMilestone("1月10日～", "2026-12-20", "2027-01-20"),
    ).toEqual({
      type: "sale_start",
      precision: "date",
      date: "2027-01-10",
    });
  });

  it("fails closed when a recognized performance period is unparseable", () => {
    expect(() =>
      parseShochikuSchedule(`
        <h4 class="page-block__title title3">歌舞伎座</h4>
        <div class="performance__body">
          <h4 class="performance-title">公演</h4>
          <p class="agenda_size">日程調整中</p>
          <table><tr><th>一般販売</th><td>8月14日～</td></tr></table>
        </div>`),
    ).toThrow();
  });

  it("fails closed when any recognized performance has no usable container", () => {
    expect(() =>
      parseShochikuSchedule(`
        ${html}
        <h4 class="performance-title">containerを失った公演</h4>`),
    ).toThrow();
  });

  it("fails closed when a required schedule page has no recognized performances", () => {
    expect(() =>
      parseShochikuSchedule("<main>メンテナンス中です</main>"),
    ).toThrow();
  });
});
