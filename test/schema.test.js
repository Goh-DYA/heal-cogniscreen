import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { deriveCapability, deriveScoringMode, normalizeQuestionnaire } from "../public/schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(here, "../data/questionnaires.json"), "utf8"));

test("deriveCapability maps types to modalities", () => {
  assert.equal(deriveCapability("object_naming"), "camera");
  assert.equal(deriveCapability("physical_command"), "camera");
  assert.equal(deriveCapability("written_instruction_response"), "reading");
  assert.equal(deriveCapability("drawing_copy"), "copying");
  assert.equal(deriveCapability("written_response"), "writing");
  assert.equal(deriveCapability("spoken_response"), "voice");
  assert.equal(deriveCapability("anything_else"), "voice");
});

test("deriveScoringMode splits code vs model", () => {
  assert.equal(deriveScoringMode("context_match"), "code");
  assert.equal(deriveScoringMode("session_context_match"), "code");
  assert.equal(deriveScoringMode("count_correct_items_first_trial"), "code");
  assert.equal(deriveScoringMode("count_correct_sequence_items"), "code");
  assert.equal(deriveScoringMode("letters_in_correct_order"), "code");
  assert.equal(deriveScoringMode("count_correct_recalled_items"), "code");
  assert.equal(deriveScoringMode("manual_or_semantic_match"), "model");
  assert.equal(deriveScoringMode("exact_or_clinician_review"), "model");
  assert.equal(deriveScoringMode("manual_observation"), "model");
  assert.equal(deriveScoringMode("manual_observation_per_step"), "model");
  assert.equal(deriveScoringMode("manual_review"), "model");
});

test("normalizeQuestionnaire flattens sections/items with metadata", () => {
  const q = normalizeQuestionnaire(raw);
  assert.equal(q.id, "mmse");
  assert.equal(q.totalMaxScore, 30);
  assert.ok(Array.isArray(q.sections));
  const time = q.sections.find((s) => s.id === "orientation_time");
  assert.equal(time.items.length, 5);
  const year = time.items[0];
  assert.equal(year.id, "time_year");
  assert.equal(year.sectionId, "orientation_time");
  assert.equal(year.capability, "voice");
  assert.equal(year.scoring.mode, "code");
  assert.equal(year.expectedAnswer, "current_year");
});

test("normalizeQuestionnaire preserves type-specific fields", () => {
  const q = normalizeQuestionnaire(raw);
  const items = q.sections.flatMap((s) => s.items);
  const serial = items.find((i) => i.id === "serial_sevens");
  assert.deepEqual(serial.expectedSequence, [93, 86, 79, 72, 65]);
  assert.equal(serial.fallbackIfUnable, "world_backwards");
  const world = items.find((i) => i.id === "world_backwards");
  assert.equal(world.administerOnlyIf, "serial_sevens_unable_or_refused");
  const naming = items.find((i) => i.id === "naming_watch");
  assert.deepEqual(naming.acceptedAnswers, ["watch", "wristwatch", "手表"]);
  assert.equal(naming.scoring.mode, "model");
  assert.equal(naming.capability, "camera");
  const command = items.find((i) => i.id === "three_stage_command");
  assert.equal(command.capability, "camera");
  const reg = items.find((i) => i.id === "registration_three_words");
  assert.equal(reg.targetItems.length, 3);
});
