import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildInstructions,
  buildRealtimeCallsMultipart,
  buildRealtimeSession,
  denormalizeQuestionnaire,
  realtimeNetworkErrorBody
} from "../server.js";
import { normalizeQuestionnaire } from "../public/schema.js";

test("denormalizeQuestionnaire preserves raw item fields and removes scoring type", () => {
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
            scoringNotes: "Score 1 point for the correct date.",
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
  assert.deepEqual(item.scoring, { expected_answer: "current_date" });
  assert.equal(item.scoringNotes, "Score 1 point for the correct date.");
});

test("denormalizeQuestionnaire saves edited expected answers under scoring", () => {
  const rawQuestionnaire = {
    questionnaire_id: "test-mmse",
    title: "Test MMSE",
    sections: [
      {
        id: "orientation_time",
        title: "Orientation to Time",
        items: [
          {
            id: "time_year",
            type: "spoken_response",
            prompt: { en: "What is the year?", zh: "" },
            max_score: 1,
            scoring: { expected_answer: "current_year" }
          }
        ]
      }
    ]
  };

  const normalized = normalizeQuestionnaire(rawQuestionnaire);
  normalized.sections[0].items[0].expectedAnswer = "2026";
  const nested = denormalizeQuestionnaire(normalized);
  const item = nested.sections[0].items[0];

  assert.equal(item.scoring.expected_answer, "2026");
  assert.equal(Object.hasOwn(item, "expected_answer"), false);
});

test("buildInstructions exposes clinic and date facts and defers item details to the client", () => {
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
            scoring: { expected_answer: "clinic_state_or_province" }
          },
          {
            id: "time_date",
            type: "spoken_response",
            capability: "voice",
            prompt: { en: "What is the date?", zh: "" },
            maxScore: 1,
            scoring: { expected_answer: "current_date" }
          }
        ]
      }
    ]
  };
  const context = {
    resolvedAnswers: {
      place_state: "Singapore",
      time_date: "8"
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

  assert.match(instructions, /Today \(Asia\/Singapore\): Wednesday, 8 July 2026/);
  assert.match(instructions, /state\/province Singapore/);
  assert.match(instructions, /county\/district Central/);
  assert.match(instructions, /source of truth for the active item/);
});

test("buildRealtimeSession requires model-assigned scores", () => {
  const session = buildRealtimeSession(
    {
      title: "Test MMSE",
      sections: []
    },
    {
      resolvedAnswers: {},
      clinic: {},
      dateFacts: {}
    }
  );

  const recordTool = session.tools.find((tool) => tool.name === "record_question_result");

  assert.equal(session.type, "realtime");
  assert.equal(session.model, "gpt-realtime-2.1-mini");
  assert.ok(recordTool.parameters.required.includes("score"));
  assert.equal(Object.hasOwn(recordTool.parameters.properties, "extracted"), false);
});

test("buildRealtimeCallsMultipart sends session as a JSON form field", () => {
  const multipart = buildRealtimeCallsMultipart("v=0", { type: "realtime", model: "gpt-realtime-2.1-mini" }, "test-boundary");

  assert.equal(multipart.contentType, "multipart/form-data; boundary=test-boundary");
  assert.match(multipart.body, /Content-Disposition: form-data; name="sdp"\r\nContent-Type: application\/sdp\r\n\r\nv=0/);
  assert.match(multipart.body, /Content-Disposition: form-data; name="session"\r\nContent-Type: application\/json\r\n\r\n\{"type":"realtime","model":"gpt-realtime-2.1-mini"\}/);
  assert.doesNotMatch(multipart.body, /filename=/);
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
