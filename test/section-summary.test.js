import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeSections } from "../public/section-summary.js";

test("summarizeSections reports section progress and score", () => {
  const sections = [
    {
      id: "orientation_time",
      title: "Orientation to Time",
      items: [
        { id: "time_year", maxScore: 1 },
        { id: "time_month", maxScore: 1 }
      ]
    },
    {
      id: "registration",
      title: "Registration",
      items: [
        { id: "registration_three_words", maxScore: 3 }
      ]
    }
  ];
  const responses = new Map([
    ["time_year", { score: 1 }],
    ["registration_three_words", { score: 2 }]
  ]);

  assert.deepEqual(summarizeSections(sections, responses, "time_month"), [
    {
      id: "orientation_time",
      title: "Orientation to Time",
      items: sections[0].items,
      completeCount: 1,
      itemCount: 2,
      score: 1,
      maxScore: 2,
      progress: 50,
      isActive: true,
      isComplete: false,
      nextItemId: "time_month"
    },
    {
      id: "registration",
      title: "Registration",
      items: sections[1].items,
      completeCount: 1,
      itemCount: 1,
      score: 2,
      maxScore: 3,
      progress: 100,
      isActive: false,
      isComplete: true,
      nextItemId: "registration_three_words"
    }
  ]);
});
