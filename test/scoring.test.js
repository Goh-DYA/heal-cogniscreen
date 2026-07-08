import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInstructions, denormalizeQuestionnaire, realtimeNetworkErrorBody } from "../server.js";
import { normalizeQuestionnaire } from "../public/schema.js";
import { normalizeAnswer, matchesAny, scoreItem } from "../public/scoring.js";

test("normalizeAnswer lowercases, trims, strips punctuation", () => {
  assert.equal(normalizeAnswer("  Tan Tock Seng Hospital!  "), "tan tock seng hospital");
  assert.equal(normalizeAnswer("D.L.R.O.W"), "dlrow");
});

test("normalizeAnswer maps english and chinese number words to digits", () => {
  assert.equal(normalizeAnswer("twenty twenty-six"), "2026");
  assert.equal(normalizeAnswer("ninety three"), "93");
  assert.equal(normalizeAnswer("二零二六"), "2026");
});

test("matchesAny compares normalized forms", () => {
  assert.equal(matchesAny("手表", ["watch", "wristwatch", "手表"]), true);
  assert.equal(matchesAny("a WATCH.", ["watch"]), true);
  assert.equal(matchesAny("pen", ["pencil"]), false);
});

test("context_match scores 1 when extracted equals resolved answer", () => {
  const item = { maxScore: 1, scoring: { mode: "code", type: "context_match" } };
  const ctx = { resolvedAnswers: { time_year: "2026" } };
  item.id = "time_year";
  assert.equal(scoreItem(item, "twenty twenty-six", ctx), 1);
  assert.equal(scoreItem(item, "2025", ctx), 0);
});

test("context_match requires exact normalized equality for dates", () => {
  const item = { id: "time_date", maxScore: 1, scoring: { mode: "code", type: "context_match" } };
  const ctx = { resolvedAnswers: { time_date: "8" } };
  assert.equal(scoreItem(item, "18", ctx), 0);
  assert.equal(scoreItem(item, "8", ctx), 1);
});

test("context_match season accepts either monsoon season", () => {
  const item = { id: "time_season", maxScore: 1, scoring: { mode: "code", type: "context_match" } };
  const ctx = { resolvedAnswers: { time_season: ["wet", "ne monsoon", "dry", "sw monsoon"] } };
  assert.equal(scoreItem(item, "the wet season", ctx), 1);
  assert.equal(scoreItem(item, "dry", ctx), 1);
  assert.equal(scoreItem(item, "winter", ctx), 0);
});

test("session_context_match uses contains match against clinic value", () => {
  const item = { id: "place_hospital", maxScore: 1, scoring: { mode: "code", type: "session_context_match" } };
  const ctx = { resolvedAnswers: { place_hospital: "Tan Tock Seng Hospital" } };
  assert.equal(scoreItem(item, "this is Tan Tock Seng Hospital", ctx), 1);
  assert.equal(scoreItem(item, "Singapore General", ctx), 0);
});

test("letters_in_correct_order counts positional matches", () => {
  const item = { id: "world_backwards", maxScore: 5, expectedAnswer: "DLROW", scoring: { mode: "code", type: "letters_in_correct_order" } };
  assert.equal(scoreItem(item, "DLROW", {}), 5);
  assert.equal(scoreItem(item, "DLORW", {}), 3);
  assert.equal(scoreItem(item, "WORLD", {}), 1);
});

test("count_correct_sequence_items counts positional matches", () => {
  const item = { id: "serial_sevens", maxScore: 5, expectedSequence: [93, 86, 79, 72, 65], scoring: { mode: "code", type: "count_correct_sequence_items" } };
  assert.equal(scoreItem(item, [93, 86, 79, 72, 65], {}), 5);
  assert.equal(scoreItem(item, [93, 86, 79, 65], {}), 3);
  assert.equal(scoreItem(item, [90, 80, 70], {}), 0);
});

test("count_correct_items_first_trial counts matched target items", () => {
  const item = {
    id: "registration_three_words",
    maxScore: 3,
    targetItems: [{ en: "ball", zh: "皮球" }, { en: "national flag", zh: "国旗" }, { en: "tree", zh: "树木" }],
    scoring: { mode: "code", type: "count_correct_items_first_trial" }
  };
  assert.equal(scoreItem(item, ["ball", "tree", "national flag"], {}), 3);
  assert.equal(scoreItem(item, ["皮球", "tree"], {}), 2);
  assert.equal(scoreItem(item, [], {}), 0);
});

test("count_correct_recalled_items resolves target items from context", () => {
  const item = {
    id: "recall_three_words",
    maxScore: 3,
    scoring: { mode: "code", type: "count_correct_recalled_items" }
  };
  const ctx = { resolvedAnswers: { recall_three_words: [{ en: "ball", zh: "皮球" }, { en: "national flag", zh: "国旗" }, { en: "tree", zh: "树木" }] } };
  assert.equal(scoreItem(item, ["ball", "flag"], ctx), 1);
  assert.equal(scoreItem(item, ["皮球", "国旗", "树木"], ctx), 3);
});

test("denormalizeQuestionnaire preserves raw item fields and omits derived scoring mode", () => {
  const rawQuestionnaire = {
    questionnaire_id: "test-mmse",
    title: "Test MMSE",
    sections: [
      {
        id: "orientation_time",
        title: "Orientation to Time",
        items: [
          {
            id: "time_date",
            type: "spoken_response",
            prompt: { en: "What is the date?", zh: "" },
            max_score: 1,
            pause_for_reply: true,
            max_trials: 2,
            scoring: { type: "context_match", expected_answer: "current_date" }
          }
        ]
      }
    ]
  };

  const nested = denormalizeQuestionnaire(normalizeQuestionnaire(rawQuestionnaire));
  const item = nested.sections[0].items[0];

  assert.equal(item.pause_for_reply, true);
  assert.equal(item.max_trials, 2);
  assert.deepEqual(item.scoring, { type: "context_match", expected_answer: "current_date" });
  assert.equal(Object.hasOwn(item.scoring, "mode"), false);
});

test("buildInstructions attaches known answers from scoring type and exposes clinic facts", () => {
  const questionnaire = {
    id: "test-mmse",
    title: "Test MMSE",
    sections: [
      {
        title: "Orientation to Place",
        items: [
          {
            id: "place_state",
            type: "spoken_response",
            capability: "voice",
            prompt: { en: "What state or province are we in?", zh: "" },
            maxScore: 1,
            scoring: { mode: "code", type: "session_context_match" }
          },
          {
            id: "time_date",
            type: "spoken_response",
            capability: "voice",
            prompt: { en: "What is the date?", zh: "" },
            maxScore: 1,
            scoring: { mode: "code", type: "context_match" }
          },
          {
            id: "time_season",
            type: "spoken_response",
            capability: "voice",
            prompt: { en: "What season is it?", zh: "" },
            maxScore: 1,
            scoring: { mode: "code", type: "context_match" }
          }
        ]
      }
    ]
  };
  const context = {
    resolvedAnswers: {
      place_state: "Singapore",
      time_date: "8",
      time_season: ["wet", "dry"]
    },
    clinic: {
      clinic_state_or_province: "Singapore",
      clinic_county_or_district: "Central",
      clinic_city: "Singapore",
      clinic_or_hospital_name: "Tan Tock Seng Hospital",
      clinic_floor: "3"
    },
    dateFacts: {
      current_day_of_week: "Wednesday",
      current_date: "8",
      current_month: "July",
      current_year: "2026"
    }
  };

  const instructions = buildInstructions(questionnaire, context);
  const items = JSON.parse(instructions.split("Item list JSON:\n")[1]);

  assert.equal(items.find((item) => item.id === "place_state").knownAnswer, "Singapore");
  assert.equal(items.find((item) => item.id === "time_date").knownAnswer, "8");
  assert.equal(Object.hasOwn(items.find((item) => item.id === "time_season"), "knownAnswer"), false);
  assert.match(instructions, /state\/province Singapore/);
  assert.match(instructions, /county\/district Central/);
});

test("realtimeNetworkErrorBody describes OpenAI DNS failures", () => {
  const error = new TypeError("fetch failed", {
    cause: Object.assign(new Error("getaddrinfo ENOTFOUND api.openai.com"), {
      code: "ENOTFOUND",
      hostname: "api.openai.com"
    })
  });

  assert.deepEqual(realtimeNetworkErrorBody(error), {
    error: "OpenAI network unavailable",
    detail: "Could not resolve api.openai.com. Check your internet connection, DNS, VPN, proxy, or firewall settings."
  });
});
