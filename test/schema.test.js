import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { deriveCapability, normalizeQuestionnaire } from "../public/schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(here, "../data/questionnaires.json"), "utf8"))
  .questionnaires.find((questionnaire) => questionnaire.questionnaire_id === "mmse");

test("deriveCapability maps types to modalities", () => {
  assert.equal(deriveCapability("object_naming"), "voice");
  assert.equal(deriveCapability("physical_command"), "camera");
  assert.equal(deriveCapability("written_instruction_response"), "reading");
  assert.equal(deriveCapability("drawing_copy"), "copying");
  assert.equal(deriveCapability("written_response"), "writing");
  assert.equal(deriveCapability("spoken_response"), "voice");
  assert.equal(deriveCapability("anything_else"), "voice");
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
  assert.equal(Object.hasOwn(year.scoring, "type"), false);
  assert.equal(year.expectedAnswer, year.scoring.expected_answer);
  assert.match(year.scoringNotes, /current year/);
});

test("normalizeQuestionnaire preserves type-specific fields", () => {
  const q = normalizeQuestionnaire(raw);
  const items = q.sections.flatMap((s) => s.items);
  const serial = items.find((i) => i.id === "serial_sevens");
  assert.deepEqual(serial.expectedSequence, [93, 86, 79, 72, 65]);
  assert.equal(serial.fallbackIfUnable, "world_backwards");
  assert.match(serial.scoringNotes, /count backward/);
  const world = items.find((i) => i.id === "world_backwards");
  assert.equal(world.administerOnlyIf, "serial_sevens_unable_or_refused");
  const naming = items.find((i) => i.id === "naming_watch");
  assert.equal(naming.acceptedAnswers.length, 3);
  assert.equal(naming.acceptedAnswers[0], "watch");
  assert.equal(Object.hasOwn(naming.scoring, "type"), false);
  assert.equal(naming.capability, "voice");
  assert.equal(naming.visualStimulus, "/images/naming_wristwatch.png");
  assert.match(naming.scoringNotes, /watch/);
  const pencil = items.find((i) => i.id === "naming_pencil");
  assert.equal(pencil.visualStimulus, "/images/naming_pencil.png");
  const command = items.find((i) => i.id === "three_stage_command");
  assert.equal(command.capability, "camera");
  assert.match(command.scoringNotes, /camera evidence/);
  const reg = items.find((i) => i.id === "registration_three_words");
  assert.equal(reg.targetItems.length, 3);
});
