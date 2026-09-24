import { describe, expect, it } from "vitest";
import { withKabukiPerformanceEnds } from "./kabuki-performance-times";

const occurrences = [
  { startsAt: "2026-09-02T11:00:00+09:00", endsAt: null },
  { startsAt: "2026-09-02T16:00:00+09:00", endsAt: null },
  { startsAt: "2026-09-03T11:00:00+09:00", endsAt: null },
  { startsAt: "2026-09-03T16:00:00+09:00", endsAt: null },
];
const headlineParts = [
  { name: "昼の部", clock: { hour: 11, minute: 0 } },
  { name: "夜の部", clock: { hour: 16, minute: 0 } },
];

const timetable = `<section id="timetable">
  <h3>上演時間</h3>
  <dl class="list type-part"><dt><span>昼の部</span></dt><dd>
    <ul class="list type-program">
      <li class="item"><time class="time">11：00－11：41</time></li>
      <li class="item type-interlude"><span class="span">幕間 20分</span></li>
      <li class="item"><time class="time">12：00－12：51</time></li>
      <li class="item"><time class="time">1：26－3：12</time></li>
    </ul>
  </dd></dl>
  <dl class="list type-part"><dt><span>夜の部</span></dt><dd>
    <ul class="list type-program">
      <li class="item"><time class="time">4：00－4：19</time></li>
      <li class="item"><time class="time">4：39－6：27</time></li>
      <li class="item"><time class="time">7：02－7：32</time></li>
      <li class="item"><time class="time">7：52－8：49</time></li>
    </ul>
  </dd></dl>
  <div>※上演時間は変更になる可能性があります</div>
</section>`;

describe("Kabuki act-by-act performance ends", () => {
  it("uses the final act end for each matching opening across the period", () => {
    const result = withKabukiPerformanceEnds(
      timetable,
      occurrences,
      headlineParts,
    );
    expect(result.verified).toBe(true);
    expect(result.occurrences).toEqual([
      {
        startsAt: "2026-09-02T11:00:00+09:00",
        endsAt: "2026-09-02T15:12:00+09:00",
      },
      {
        startsAt: "2026-09-02T16:00:00+09:00",
        endsAt: "2026-09-02T20:49:00+09:00",
      },
      {
        startsAt: "2026-09-03T11:00:00+09:00",
        endsAt: "2026-09-03T15:12:00+09:00",
      },
      {
        startsAt: "2026-09-03T16:00:00+09:00",
        endsAt: "2026-09-03T20:49:00+09:00",
      },
    ]);
  });

  it("does not infer an end when the source has no act-by-act timetable", () => {
    expect(
      withKabukiPerformanceEnds(
        "<p>開演 午前11時</p>",
        occurrences,
        headlineParts,
      ),
    ).toEqual({
      occurrences,
      verified: false,
    });
  });

  it("requires each named timetable part to match its verified headline opening", () => {
    const mismatched = [
      { name: "昼の部", clock: { hour: 16, minute: 0 } },
      { name: "夜の部", clock: { hour: 11, minute: 0 } },
    ];
    expect(() =>
      withKabukiPerformanceEnds(timetable, occurrences, mismatched),
    ).toThrow();
  });

  it("holds an unrecognized timetable instead of keeping approximate ends", () => {
    const approximate = [
      {
        startsAt: "2026-09-02T11:00:00+09:00",
        endsAt: "2026-09-02T15:05:00+09:00",
      },
      {
        startsAt: "2026-09-02T16:00:00+09:00",
        endsAt: "2026-09-02T20:35:00+09:00",
      },
    ];
    const annotated = timetable.replace(
      "</ul>\n  </dd>",
      "</ul><p>※2日は終演予定時刻が異なります</p></dd>",
    );
    expect(() =>
      withKabukiPerformanceEnds(annotated, approximate, headlineParts),
    ).toThrow();
  });

  it.each([
    timetable.replace("7：52－8：49", "7：52－終演未定"),
    timetable.replace(
      /<dl class="list type-part"><dt><span>夜の部<\/span><\/dt>[\s\S]*?<\/dl>/u,
      "",
    ),
    timetable + timetable,
    timetable.replace('id="timetable"', 'id="new-format"'),
    timetable.replace("</section>", "<h3>別の案内</h3></section>"),
  ])("holds a timetable outside the supported structure", (html) => {
    expect(() =>
      withKabukiPerformanceEnds(html, occurrences, headlineParts),
    ).toThrow();
  });

  it("does not apply a uniform end to a page with a daily calendar", () => {
    expect(
      withKabukiPerformanceEnds(
        timetable + '<table class="type-calendar"></table>',
        occurrences,
        headlineParts,
      ),
    ).toEqual({ occurrences, verified: false });
  });
});
