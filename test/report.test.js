import { test } from "node:test";
import assert from "node:assert/strict";
import { reportItemDetails, reportMediaArtifacts, restoreMediaArtifacts, reportPage, reportSections } from "../public/report.js";

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

test("reportSections returns all scored sections for the administered items", () => {
  const sections = [
    {
      title: "Orientation to Time",
      items: [
        { id: "time_year", maxScore: 1 },
        { id: "time_season", maxScore: 1 },
        { id: "time_date", maxScore: 1 }
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

  assert.deepEqual(reportSections(sections, responses, new Set(["time_year", "time_date", "place_state"])), [
    {
      title: "Orientation to Time",
      score: 1,
      maxScore: 2,
      items: [sections[0].items[0], sections[0].items[2]]
    },
    {
      title: "Orientation to Place",
      score: 1,
      maxScore: 1,
      items: sections[1].items
    }
  ]);
});

test("reportItemDetails formats model score source, answer, expected answer, and notes", () => {
  const item = {
    expectedAnswer: "2026",
    maxScore: 1
  };
  const response = {
    scoredBy: "model",
    response: "The patient said twenty twenty-six.",
    notes: "Patient responded with the year 2026."
  };

  assert.deepEqual(reportItemDetails(item, response), {
    scoredBy: "Model",
    patientAnswer: "The patient said twenty twenty-six.",
    expectedAnswer: "2026",
    aiText: "Patient responded with the year 2026."
  });
});

test("reportMediaArtifacts keeps image data so report rows can display submitted copying images", () => {
  assert.deepEqual(reportMediaArtifacts([
    {
      questionId: "copying_pentagons",
      type: "copying",
      dataUrl: "data:image/png;base64,abc123",
      createdAt: "2026-07-08T03:00:00.000Z"
    }
  ]), [
    {
      questionId: "copying_pentagons",
      type: "copying",
      dataUrl: "data:image/png;base64,abc123",
      hasImageData: true,
      createdAt: "2026-07-08T03:00:00.000Z"
    }
  ]);
});

test("restoreMediaArtifacts returns only saved artifacts with image data", () => {
  assert.deepEqual(restoreMediaArtifacts([
    {
      questionId: "copying_pentagons",
      type: "copying",
      dataUrl: "data:image/png;base64,abc123",
      hasImageData: true
    },
    {
      questionId: "naming_watch",
      type: "camera",
      hasImageData: true
    }
  ]), [
    {
      questionId: "copying_pentagons",
      type: "copying",
      dataUrl: "data:image/png;base64,abc123",
      hasImageData: true
    }
  ]);
});
