import { test } from "node:test";
import assert from "node:assert/strict";
import { codeEvidenceLines, reportItemDetails, reportPage } from "../public/report.js";

test("codeEvidenceLines includes extracted answer and matched context", () => {
  const lines = codeEvidenceLines({
    scoredBy: "code",
    extracted: "18",
    matchedAgainst: "8"
  });

  assert.deepEqual(lines, [
    { label: "Extracted answer", value: "18" },
    { label: "Matched against", value: "8" }
  ]);
});

test("reportPage returns one scored section for the selected page", () => {
  const sections = [
    {
      title: "Orientation to Time",
      items: [
        { id: "time_year", maxScore: 1 },
        { id: "time_season", maxScore: 1 }
      ]
    },
    {
      title: "Orientation to Place",
      items: [
        { id: "place_state", maxScore: 1 }
      ]
    }
  ];
  const responses = new Map([
    ["time_year", { score: 1 }],
    ["place_state", { score: 1 }]
  ]);

  assert.deepEqual(reportPage(sections, responses, new Set(["time_year", "time_season", "place_state"]), 9), {
    currentPage: 1,
    pageCount: 2,
    section: {
      title: "Orientation to Place",
      score: 1,
      maxScore: 1,
      items: sections[1].items
    }
  });
});

test("reportItemDetails formats scored-by, answer, expected answer, and notes", () => {
  const item = {
    expectedAnswer: "2026",
    maxScore: 1
  };
  const response = {
    scoredBy: "code",
    response: "The patient said twenty twenty-six.",
    extracted: "2026",
    matchedAgainst: "2026",
    notes: "Patient responded with the year 2026."
  };

  assert.deepEqual(reportItemDetails(item, response), {
    scoredBy: "Code",
    patientAnswer: "The patient said twenty twenty-six.",
    extractedAnswer: "2026",
    expectedAnswer: "2026",
    aiText: "Patient responded with the year 2026."
  });
});
