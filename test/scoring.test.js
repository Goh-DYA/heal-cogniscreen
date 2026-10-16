import { test } from "node:test";
import assert from "node:assert/strict";
import { countAnswered, sumMaxScores, sumScores } from "../public/scoring.js";

const items = [
  { id: "time_year", maxScore: 1 },
  { id: "registration_three_words", maxScore: "3" },
  { id: "time_month" }
];

test("sumScores adds recorded scores and treats missing responses as zero", () => {
  const responses = new Map([
    ["time_year", { score: 1 }],
    ["registration_three_words", { score: "2" }]
  ]);

  assert.equal(sumScores(items, responses), 3);
});

test("sumMaxScores coerces numeric strings and treats missing maxScore as zero", () => {
  assert.equal(sumMaxScores(items), 4);
});

test("countAnswered counts items with a recorded response", () => {
  const responses = new Map([["time_month", { score: 0 }]]);

  assert.equal(countAnswered(items, responses), 1);
});
