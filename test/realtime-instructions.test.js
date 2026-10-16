import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFocusedInstructions,
  buildReadinessIntroductionInstructions,
  focusedItemPayload,
  sequenceCorrectionInstruction
} from "../public/realtime-instructions.js";

const questionnaire = {
  id: "mmse",
  title: "Mini-Mental State Examination",
  sections: [{ id: "naming", title: "Naming" }]
};

const namingItem = {
  id: "naming_watch",
  sectionId: "naming",
  type: "object_naming",
  prompt: { en: "What is this called?", zh: "" },
  maxScore: 1,
  capability: "voice",
  scoringNotes: "Accept watch.",
  acceptedAnswers: ["watch", "wristwatch"],
  visualStimulus: "/images/naming_wristwatch.png",
  requiresMaterials: ["wristwatch"]
};

test("focusedItemPayload hides object-naming answers behind scoring-only fields", () => {
  const payload = focusedItemPayload(namingItem, questionnaire, {});

  assert.equal(payload.section, "Naming");
  assert.equal(payload.prompt.en, "Please look at the image on screen and tell me what this item is.");
  assert.deepEqual(payload.scoringOnlyAcceptedAnswers, ["watch", "wristwatch"]);
  assert.equal(Object.hasOwn(payload, "acceptedAnswers"), false);
  assert.equal(Object.hasOwn(payload, "visualStimulus"), false);
  assert.equal(Object.hasOwn(payload, "requiresMaterials"), false);
});

test("focusedItemPayload passes through resolved answers and type-specific fields", () => {
  const item = {
    id: "serial_sevens",
    sectionId: "attention",
    type: "spoken_calculation_sequence",
    prompt: { en: "Count backward from 100 by 7.", zh: "" },
    maxScore: 5,
    capability: "voice",
    expectedSequence: [93, 86, 79, 72, 65],
    acceptedAnswers: ["93"],
    fallbackIfUnable: "world_backwards"
  };

  const payload = focusedItemPayload(item, questionnaire, { serial_sevens: [93, 86] });

  assert.equal(payload.section, "attention");
  assert.equal(payload.scoringNotes, "");
  assert.deepEqual(payload.resolvedExpectedAnswer, [93, 86]);
  assert.deepEqual(payload.expectedSequence, [93, 86, 79, 72, 65]);
  assert.deepEqual(payload.acceptedAnswers, ["93"]);
  assert.equal(payload.fallbackIfUnable, "world_backwards");
});

test("buildFocusedInstructions reports progress and embeds only the active item", () => {
  const instructions = buildFocusedInstructions(namingItem, {
    questionnaire,
    completedCount: 4,
    totalCount: 30,
    resolvedAnswers: {}
  });

  assert.match(instructions, /Selected questionnaire: Mini-Mental State Examination/);
  assert.match(instructions, /Completed count: 4 of 30/);
  assert.match(instructions, /For this object-naming item/);
  assert.ok(instructions.endsWith(JSON.stringify(focusedItemPayload(namingItem, questionnaire, {}))));
});

test("buildReadinessIntroductionInstructions appends the current turn instruction only when given", () => {
  assert.doesNotMatch(buildReadinessIntroductionInstructions(""), /Current turn instruction/);
  assert.match(buildReadinessIntroductionInstructions("Say hello."), /\nCurrent turn instruction: Say hello\.$/);
});

test("sequenceCorrectionInstruction names the required question", () => {
  assert.match(sequenceCorrectionInstruction("time_year"), /^The next required question is questionId "time_year"\./);
});
