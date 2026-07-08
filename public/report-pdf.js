const pageWidth = 612;
const pageHeight = 792;
const margin = 48;
const textWidth = pageWidth - margin * 2;
const encoder = new TextEncoder();

export async function createReportPdf(reportDocument) {
  const pages = await buildPages(reportDocument || {});
  const bytes = writePdf(pages);
  return new Blob([bytes], { type: "application/pdf" });
}

async function buildPages(reportDocument) {
  const pages = [];
  let page = newPage();
  let y = pageHeight - margin;

  const addPage = () => {
    pages.push(page);
    page = newPage();
    y = pageHeight - margin;
  };
  const ensureSpace = (height) => {
    if (y - height < margin) {
      addPage();
    }
  };
  const writeLine = (text, options = {}) => {
    const size = options.size || 10;
    const lineHeight = options.lineHeight || Math.ceil(size * 1.45);
    for (const line of wrapText(text, options.maxChars || charsForSize(size))) {
      ensureSpace(lineHeight);
      page.content.push(textOperation(line, margin + (options.indent || 0), y, size, options.bold));
      y -= lineHeight;
    }
  };
  const writeGap = (height) => {
    ensureSpace(height);
    y -= height;
  };
  const writeArtifact = async (artifact) => {
    const image = await normalizeArtifactImage(artifact);
    if (!image) {
      writeLine(`Submitted image: ${artifact?.type || "media"} artifact`, { indent: 12 });
      return;
    }

    const maxWidth = 220;
    const maxHeight = 160;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    ensureSpace(height + 28);
    writeLine(`Submitted image: ${artifact?.type || "media"} artifact`, { indent: 12 });
    const name = `Im${page.images.length + 1}`;
    page.images.push({ ...image, name });
    page.content.push(`q\n${width} 0 0 ${height} ${margin + 12} ${y - height} cm\n/${name} Do\nQ\n`);
    y -= height + 10;
  };

  writeLine(reportDocument.title || "Questionnaire report", { size: 18, bold: true, lineHeight: 24 });
  writeLine(`Created: ${formatDate(reportDocument.createdAt)}`);
  writeLine(`Total score: ${Number(reportDocument.totalScore || 0)} / ${Number(reportDocument.maxScore || 0)}`, { bold: true });
  if (reportDocument.status) {
    writeLine(`Status: ${reportDocument.status}`);
  }
  writeGap(10);

  for (const section of reportDocument.sections || []) {
    writeLine(`${section.title || "Section"} (${Number(section.score || 0)} / ${Number(section.maxScore || 0)})`, {
      size: 13,
      bold: true,
      lineHeight: 19
    });
    for (const item of section.items || []) {
      const details = item.details || {};
      writeLine(item.prompt?.en || "Untitled item", { bold: true, indent: 12 });
      writeLine(`Scored by: ${details.scoredBy || "-"}`, { indent: 24 });
      writeLine(`Expected Answer: ${details.expectedAnswer || "-"}`, { indent: 24 });
      writeLine(`Patient's Answer: ${details.patientAnswer || "No response recorded."}`, { indent: 24 });
      writeLine(details.aiText || "No AI-generated scoring note was recorded for this item.", { indent: 24 });
      for (const artifact of item.artifacts || []) {
        await writeArtifact(artifact);
      }
      writeGap(8);
    }
    writeGap(8);
  }

  if ((reportDocument.transcript || []).length) {
    writeLine("Transcript", { size: 13, bold: true, lineHeight: 19 });
    for (const entry of reportDocument.transcript) {
      writeLine(`${entry.role || "unknown"}: ${entry.text || ""}`, { indent: 12 });
    }
  }

  pages.push(page);
  return pages;
}

function newPage() {
  return {
    content: [],
    images: []
  };
}

function writePdf(pages) {
  const objects = [];
  const catalogId = addObject(objects, "");
  const pagesId = addObject(objects, "");
  const fontRegularId = addObject(objects, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fontBoldId = addObject(objects, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pageIds = [];

  for (const page of pages) {
    const imageRefs = page.images.map((image) => ({
      name: image.name,
      objectId: addObject(objects, imageObject(image))
    }));
    const contentId = addObject(objects, streamObject(encoder.encode(page.content.join(""))));
    const xObjects = imageRefs.length
      ? ` /XObject << ${imageRefs.map((image) => `/${image.name} ${image.objectId} 0 R`).join(" ")} >>`
      : "";
    const pageId = addObject(objects, [
      "<< /Type /Page",
      `/Parent ${pagesId} 0 R`,
      "/MediaBox [0 0 612 792]",
      `/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >>${xObjects} >>`,
      `/Contents ${contentId} 0 R`,
      ">>"
    ].join(" "));
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = stringObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  objects[pagesId - 1] = stringObject(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);

  return assemblePdf(objects);
}

function addObject(objects, value) {
  objects.push(typeof value === "string" ? stringObject(value) : value);
  return objects.length;
}

function stringObject(value) {
  return encoder.encode(value);
}

function streamObject(bytes) {
  return concatBytes(
    encoder.encode(`<< /Length ${bytes.length} >>\nstream\n`),
    bytes,
    encoder.encode("\nendstream")
  );
}

function imageObject(image) {
  return concatBytes(
    encoder.encode([
      "<< /Type /XObject",
      "/Subtype /Image",
      `/Width ${image.width}`,
      `/Height ${image.height}`,
      "/ColorSpace /DeviceRGB",
      "/BitsPerComponent 8",
      "/Filter /DCTDecode",
      `/Length ${image.bytes.length}`,
      ">>\nstream\n"
    ].join(" ")),
    image.bytes,
    encoder.encode("\nendstream")
  );
}

function assemblePdf(objects) {
  const chunks = [encoder.encode("%PDF-1.4\n")];
  const offsets = [0];
  let offset = chunks[0].length;

  objects.forEach((object, index) => {
    offsets.push(offset);
    const header = encoder.encode(`${index + 1} 0 obj\n`);
    const footer = encoder.encode("\nendobj\n");
    chunks.push(header, object, footer);
    offset += header.length + object.length + footer.length;
  });

  const xrefOffset = offset;
  const rows = ["xref", `0 ${objects.length + 1}`, "0000000000 65535 f "];
  for (let index = 1; index < offsets.length; index += 1) {
    rows.push(`${String(offsets[index]).padStart(10, "0")} 00000 n `);
  }
  const trailer = [
    rows.join("\n"),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF"
  ].join("\n");
  chunks.push(encoder.encode(trailer));

  return concatBytes(...chunks);
}

async function normalizeArtifactImage(artifact) {
  if (!artifact?.dataUrl) {
    return undefined;
  }

  const parsed = parseDataUrl(artifact.dataUrl);
  if (!parsed) {
    return undefined;
  }
  if (parsed.mime === "image/jpeg" || parsed.mime === "image/jpg") {
    return {
      bytes: parsed.bytes,
      ...jpegDimensions(parsed.bytes)
    };
  }

  return convertDataUrlToJpeg(artifact.dataUrl);
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;,]+);base64,(.*)$/);
  if (!match) {
    return undefined;
  }
  return {
    mime: match[1].toLowerCase(),
    bytes: base64ToBytes(match[2])
  };
}

async function convertDataUrlToJpeg(dataUrl) {
  if (typeof fetch === "undefined" || typeof createImageBitmap === "undefined") {
    return undefined;
  }

  const response = await fetch(dataUrl);
  const sourceBlob = await response.blob();
  const bitmap = await createImageBitmap(sourceBlob);
  const canvas = makeCanvas(bitmap.width, bitmap.height);
  if (!canvas) {
    return undefined;
  }

  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, bitmap.width, bitmap.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  const jpegBlob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: "image/jpeg", quality: 0.88 })
    : await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  if (!jpegBlob) {
    return undefined;
  }

  return {
    bytes: new Uint8Array(await jpegBlob.arrayBuffer()),
    width: canvas.width,
    height: canvas.height
  };
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return undefined;
}

function jpegDimensions(bytes) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: (bytes[offset + 5] << 8) + bytes[offset + 6],
        width: (bytes[offset + 7] << 8) + bytes[offset + 8]
      };
    }
    offset += 2 + length;
  }
  return { width: 320, height: 180 };
}

function textOperation(text, x, y, size, bold) {
  return `BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET\n`;
}

function wrapText(value, maxChars) {
  const words = String(value ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) {
    return [""];
  }

  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars) {
      line = candidate;
      continue;
    }
    if (line) {
      lines.push(line);
    }
    line = word.length > maxChars ? word.slice(0, maxChars) : word;
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

function charsForSize(size) {
  return Math.max(36, Math.floor(textWidth / (size * 0.52)));
}

function escapePdfText(value) {
  return String(value ?? "")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : new Date().toLocaleString();
}

function base64ToBytes(value) {
  if (typeof atob === "function") {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function concatBytes(...chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
