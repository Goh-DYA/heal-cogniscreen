import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveStaticRoutePath } from "./public/routes.js";
import { normalizeQuestionnaire } from "./public/schema.js";

export { resolveStaticRoutePath } from "./public/routes.js";

const serverPath = fileURLToPath(import.meta.url);
const rootDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(rootDir, "public");
const docsDir = resolve(rootDir, "docs");
const imagesDir = resolve(rootDir, "images");
const dataDir = resolve(rootDir, "data");
const questionnaireDataPath = resolve(dataDir, "questionnaires.json");
const promptPath = resolve(rootDir, "prompts", "questionnaire-realtime.md");

export function resolveImageAssetPath(pathname) {
  if (!pathname.startsWith("/images/")) {
    return undefined;
  }

  const imagePath = decodeURIComponent(pathname.slice("/images/".length));
  if (imagePath.split(/[\\/]/).includes("..")) {
    return undefined;
  }
  const safePath = normalize(imagePath);
  const filePath = resolve(join(imagesDir, safePath));
  if (filePath !== imagesDir && !filePath.startsWith(`${imagesDir}/`)) {
    return undefined;
  }
  return filePath;
}

loadEnvFile(resolve(rootDir, ".env"));
loadEnvFile(resolve(rootDir, ".env.local"));

const port = Number(process.env.PORT || "3000");
const model = process.env.REALTIME_MODEL || "gpt-realtime-2.1-mini";
const voice = process.env.REALTIME_VOICE || "marin";
const transcriptionModel = process.env.REALTIME_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";
const apiKey = process.env.OPENAI_API_KEY;
const safetyIdentifier = process.env.OPENAI_SAFETY_IDENTIFIER || "local-questionnaire-demo";
const baseInstructions = readFileSync(promptPath, "utf8");

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"]
]);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, model, hasApiKey: Boolean(apiKey) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/questionnaires") {
      sendJson(res, 200, { questionnaires: loadQuestionnaires() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/session-context") {
      const questionnaire = loadQuestionnaire(url.searchParams.get("questionnaireId"));
      sendJson(res, 200, resolveSessionContext(questionnaire));
      return;
    }

    if (req.method === "PUT" && url.pathname.startsWith("/api/questionnaires/")) {
      await saveQuestionnaire(req, res, decodeURIComponent(url.pathname.split("/").pop() || ""));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/realtime/session") {
      await createRealtimeSession(req, res, url.searchParams.get("questionnaireId") || "mmse");
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res, url.pathname);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

if (process.argv[1] && resolve(process.argv[1]) === serverPath) {
  server.listen(port, () => {
    console.log(`Heal Realtime Questionnaire listening at http://localhost:${port}`);
  });
}

async function createRealtimeSession(req, res, questionnaireId) {
  if (!apiKey) {
    sendJson(res, 500, { error: "OPENAI_API_KEY is not configured" });
    return;
  }

  const sdp = await readTextBody(req, 2_000_000);
  if (!sdp.trim()) {
    sendJson(res, 400, { error: "Missing SDP offer" });
    return;
  }

  const questionnaire = loadQuestionnaire(questionnaireId);
  const context = resolveSessionContext(questionnaire);
  const session = buildRealtimeSession(questionnaire, context);

  const multipart = buildRealtimeCallsMultipart(sdp, session);

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": multipart.contentType,
        "OpenAI-Safety-Identifier": safetyIdentifier
      },
      body: multipart.body
    });
  } catch (error) {
    console.error(error);
    sendJson(res, 502, realtimeNetworkErrorBody(error));
    return;
  }

  const responseText = await response.text();
  if (!response.ok) {
    res.writeHead(response.status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Realtime session failed", detail: responseText }));
    return;
  }

  res.writeHead(200, { "Content-Type": "application/sdp" });
  res.end(responseText);
}

export function buildRealtimeSession(questionnaire, context) {
  const session = {
    type: "realtime",
    model,
    instructions: buildInstructions(questionnaire, context),
    audio: {
      output: {
        voice
      }
    },
    tools: [
      {
        type: "function",
        name: "record_question_result",
        description: "Record a completed questionnaire item once the patient response is sufficient for scoring.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            questionId: { type: "string" },
            extracted: {
              description: "Structured patient answer for code-scored items. String for orientation; array of spoken words for registration/recall; array of numbers for serial sevens; the spelled string for WORLD backwards.",
              type: ["string", "array", "number", "null"],
              items: { type: ["string", "number"] }
            },
            score: { type: ["number", "null"], description: "Only used for model-scored items; ignored for code-scored items." },
            response: { type: "string" },
            notes: { type: "string" },
            complete: { type: "boolean" },
            unable: { type: "boolean", description: "Set true only when the patient cannot or will not attempt serial-7s, to trigger the WORLD-backwards fallback." }
          },
          required: ["questionId", "response", "notes", "complete"]
        }
      },
      {
        type: "function",
        name: "set_active_question",
        description: "Tell the UI which questionnaire item is currently being administered.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            questionId: { type: "string" }
          },
          required: ["questionId"]
        }
      }
    ],
    tool_choice: "auto"
  };

  if (transcriptionModel) {
    session.audio.input = {
      transcription: {
        model: transcriptionModel
      }
    };
  }

  return session;
}

export function buildRealtimeCallsMultipart(sdp, session, boundary = `----heal-realtime-${randomUUID()}`) {
  const body = [
    `--${boundary}`,
    "Content-Disposition: form-data; name=\"sdp\"",
    "Content-Type: application/sdp",
    "",
    sdp,
    `--${boundary}`,
    "Content-Disposition: form-data; name=\"session\"",
    "Content-Type: application/json",
    "",
    JSON.stringify(session),
    `--${boundary}--`,
    ""
  ].join("\r\n");

  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

export function realtimeNetworkErrorBody(error) {
  const cause = error?.cause;
  if (cause?.code === "ENOTFOUND" && cause.hostname === "api.openai.com") {
    return {
      error: "OpenAI network unavailable",
      detail: "Could not resolve api.openai.com. Check your internet connection, DNS, VPN, proxy, or firewall settings."
    };
  }

  return {
    error: "OpenAI network unavailable",
    detail: "Could not reach the OpenAI Realtime API. Check your internet connection, VPN, proxy, or firewall settings."
  };
}

async function saveQuestionnaire(req, res, questionnaireId) {
  const body = await readJsonBody(req, 1_000_000);
  const nested = denormalizeQuestionnaire(body);

  const questionnaires = loadRawQuestionnaires();
  const existingIndex = questionnaires.findIndex(
    (item) => item.questionnaire_id === (questionnaireId || nested.questionnaire_id)
  );
  if (existingIndex >= 0) {
    questionnaires[existingIndex] = nested;
  } else {
    questionnaires.push(nested);
  }

  mkdirSync(dirname(questionnaireDataPath), { recursive: true });
  writeFileSync(questionnaireDataPath, `${JSON.stringify({ questionnaires }, null, 2)}\n`, "utf8");
  sendJson(res, 200, { questionnaire: normalizeQuestionnaire(nested) });
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function cleanScoring(scoring) {
  const cleaned = { ...(scoring || {}) };
  delete cleaned.mode;
  return cleaned;
}

function setIfPresent(target, key, value) {
  if (value !== undefined) {
    target[key] = value;
  }
}

export function denormalizeQuestionnaire(model) {
  return {
    questionnaire_id: model.id,
    title: model.title,
    version: model.version || "1.0",
    default_language: model.defaultLanguage || "",
    total_max_score: (model.sections || [])
      .flatMap((section) => section.items || [])
      .reduce((sum, item) => sum + Number(item.maxScore || 0), 0),
    global_rules: model.globalRules || {},
    materials_required: model.materialsRequired || [],
    sections: (model.sections || []).map((section) => ({
      id: section.id,
      title: section.title,
      max_score: (section.items || []).reduce((sum, item) => sum + Number(item.maxScore || 0), 0),
      items: (section.items || []).map(denormalizeItem)
    }))
  };
}

function denormalizeItem(item) {
  const output = cloneJson(item.source) || {};
  output.id = item.id;
  output.type = item.type;
  output.prompt = item.prompt;
  output.max_score = Number(item.maxScore || 0);
  output.scoring = cleanScoring(item.scoring);
  if (item.expectedAnswer !== undefined) {
    output.scoring.expected_answer = item.expectedAnswer;
  }
  setIfPresent(output, "target_items", item.targetItems);
  setIfPresent(output, "target_items_from", item.targetItemsFrom);
  setIfPresent(output, "expected_sequence", item.expectedSequence);
  setIfPresent(output, "stop_after_responses", item.stopAfterResponses);
  setIfPresent(output, "observable_steps", item.observableSteps);
  setIfPresent(output, "visual_stimulus", item.visualStimulus);
  setIfPresent(output, "administer_only_if", item.administerOnlyIf);
  setIfPresent(output, "fallback_if_unable", item.fallbackIfUnable);
  setIfPresent(output, "post_item_instruction", item.postItemInstruction);
  setIfPresent(output, "requires_materials", item.requiresMaterials);
  return output;
}

function loadRawQuestionnaires() {
  const raw = JSON.parse(readFileSync(questionnaireDataPath, "utf8"));
  if (Array.isArray(raw?.questionnaires)) {
    return raw.questionnaires;
  }
  if (Array.isArray(raw)) {
    return raw;
  }
  return raw ? [raw] : [];
}

function loadQuestionnaires() {
  return loadRawQuestionnaires().map(normalizeQuestionnaire);
}

function loadQuestionnaire(questionnaireId) {
  const questionnaires = loadQuestionnaires();
  return questionnaires.find((item) => item.id === questionnaireId) || questionnaires[0];
}

export function buildInstructions(questionnaire, context) {
  return [
    baseInstructions,
    "",
    `Selected questionnaire: ${questionnaire.title}`,
    `Questionnaire ID: ${questionnaire.id}`,
    `Today (Asia/Singapore): ${context.dateFacts.current_day_of_week}, ${context.dateFacts.current_date} ${context.dateFacts.current_month} ${context.dateFacts.current_year}`,
    `Clinic: ${context.clinic.clinic_or_hospital_name}, floor ${context.clinic.clinic_floor}, ${context.clinic.clinic_city}, state/province ${context.clinic.clinic_state_or_province}, county/district ${context.clinic.clinic_county_or_district}`,
    "The client UI is the source of truth for the active item.",
    "Item details will be provided through session updates.",
    "Use only the active item details from the latest session instructions."
  ].join("\n");
}

const SEASON_ACCEPTED = ["wet", "ne monsoon", "dry", "sw monsoon"];

function clinicConfig() {
  return {
    clinic_state_or_province: process.env.CLINIC_STATE_OR_PROVINCE || "Singapore",
    clinic_county_or_district: process.env.CLINIC_COUNTY_OR_DISTRICT || "Singapore",
    clinic_city: process.env.CLINIC_CITY || "Singapore",
    clinic_or_hospital_name: process.env.CLINIC_OR_HOSPITAL_NAME || "Tan Tock Seng Hospital",
    clinic_floor: process.env.CLINIC_FLOOR || "3"
  };
}

function dateFacts() {
  const timeZone = "Asia/Singapore";
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-SG", {
    timeZone, year: "numeric", month: "long", day: "numeric", weekday: "long"
  }).formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return {
    current_year: parts.year,
    current_month: parts.month,
    current_date: parts.day,
    current_day_of_week: parts.weekday
  };
}

function resolveToken(token, clinic, facts) {
  if (token === "current_season") {
    return SEASON_ACCEPTED;
  }
  if (token in facts) {
    return facts[token];
  }
  if (token in clinic) {
    return clinic[token];
  }
  return token;
}

function resolveSessionContext(questionnaire) {
  const clinic = clinicConfig();
  const facts = dateFacts();
  const resolvedAnswers = {};
  for (const section of questionnaire.sections) {
    for (const item of section.items) {
      if (item.scoring.mode !== "code") {
        continue;
      }
      if (item.type === "spoken_memory_recall") {
        // recall compares against the registration target items
        const reg = questionnaire.sections
          .flatMap((s) => s.items)
          .find((i) => i.id === "registration_three_words");
        resolvedAnswers[item.id] = reg?.targetItems || [];
      } else if (item.expectedAnswer && typeof item.expectedAnswer === "string" && !item.expectedSequence) {
        resolvedAnswers[item.id] = resolveToken(item.expectedAnswer, clinic, facts);
      }
    }
  }
  return { resolvedAnswers, clinic, dateFacts: facts };
}

function serveStatic(req, res, pathname) {
  const imagePath = resolveImageAssetPath(pathname);
  if (imagePath && existsSync(imagePath)) {
    res.writeHead(200, {
      "Content-Type": contentTypes.get(extname(imagePath)) || "application/octet-stream"
    });
    createReadStream(imagePath).pipe(res);
    return;
  }

  if (pathname === "/mmse_picture_copying.png") {
    res.writeHead(200, { "Content-Type": "image/png" });
    createReadStream(resolve(docsDir, "mmse_picture_copying.png")).pipe(res);
    return;
  }

  const routePath = resolveStaticRoutePath(pathname);
  const safePath = normalize(decodeURIComponent(routePath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(publicDir, safePath));

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": contentTypes.get(extname(filePath)) || "application/octet-stream"
  });
  createReadStream(filePath).pipe(res);
}

function readJsonBody(req, maxLength) {
  return readTextBody(req, maxLength).then((body) => JSON.parse(body || "{}"));
}

function readTextBody(req, maxLength) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxLength) {
        rejectBody(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolveBody(body));
    req.on("error", rejectBody);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function loadEnvFile(path) {
  if (!existsSync(path)) {
    return;
  }

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) {
      continue;
    }
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
