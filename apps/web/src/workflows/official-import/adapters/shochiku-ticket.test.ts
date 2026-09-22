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
      parseShochikuSaleMilestone(
        "9月29日 10:00～17：30まで",
        "2026-10-01",
      ),
    ).toEqual({
      type: "sale_start",
      precision: "window",
      startsAt: "2026-09-29T10:00:00+09:00",
      endsAt: "2026-09-29T17:30:00+09:00",
    });
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
});
