import { test } from "node:test";
import assert from "node:assert/strict";
import { createReportPdf } from "../public/report-pdf.js";

const onePixelJpeg = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9k=";

test("createReportPdf returns readable PDF bytes with report content", async () => {
  const blob = await createReportPdf({
    title: "Mini-Mental State Examination",
    createdAt: "2026-07-08T03:00:00.000Z",
    totalScore: 1,
    maxScore: 2,
    status: "1 of 2 items recorded.",
    sections: [
      {
        title: "Orientation to Time",
        score: 1,
        maxScore: 2,
        items: [
          {
            prompt: { en: "What is the year?" },
            details: {
              scoredBy: "Model",
              expectedAnswer: "2026",
              patientAnswer: "Twenty twenty-six",
              aiText: "Patient answered correctly."
            },
            artifacts: []
          }
        ]
      }
    ],
    transcript: [
      { role: "assistant", text: "What is the year?" },
      { role: "user", text: "Twenty twenty-six." }
    ]
  });

  const text = await blob.text();

  assert.equal(blob.type, "application/pdf");
  assert.ok(text.startsWith("%PDF-"));
  assert.match(text, /\/Type \/Page/);
  assert.match(text, /Mini-Mental State Examination/);
  assert.match(text, /Orientation to Time/);
  assert.match(text, /Twenty twenty-six/);
});

test("createReportPdf embeds JPEG artifacts as image XObjects", async () => {
  const blob = await createReportPdf({
    title: "MMSE",
    createdAt: "2026-07-08T03:00:00.000Z",
    totalScore: 0,
    maxScore: 1,
    status: "0 of 1 items recorded.",
    sections: [
      {
        title: "Copying",
        score: 0,
        maxScore: 1,
        items: [
          {
            prompt: { en: "Copy the diagram." },
            details: {
              scoredBy: "Model",
              expectedAnswer: "-",
              patientAnswer: "Image submitted.",
              aiText: "Artifact reviewed."
            },
            artifacts: [
              {
                type: "copying",
                dataUrl: `data:image/jpeg;base64,${onePixelJpeg}`,
                createdAt: "2026-07-08T03:00:00.000Z"
              }
            ]
          }
        ]
      }
    ],
    transcript: []
  });

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = new TextDecoder("latin1").decode(bytes);

  assert.match(text, /\/Subtype \/Image/);
  assert.match(text, /\/XObject/);
  assert.match(text, /\/DCTDecode/);
});
