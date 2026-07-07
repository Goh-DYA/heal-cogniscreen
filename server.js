import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(rootDir, "public");
const docsDir = resolve(rootDir, "docs");
const dataDir = resolve(rootDir, "data");
const questionnaireDataPath = resolve(dataDir, "questionnaires.json");
const promptPath = resolve(rootDir, "prompts", "questionnaire-realtime.md");

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

server.listen(port, () => {
  console.log(`Heal Realtime Questionnaire listening at http://localhost:${port}`);
});

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

  const questionnaire = loadQuestionnaires().find((item) => item.id === questionnaireId) || loadQuestionnaires()[0];
  const session = {
    type: "realtime",
    model,
    instructions: buildInstructions(questionnaire),
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
            score: { type: "number" },
            maxScore: { type: "number" },
            response: { type: "string" },
            notes: { type: "string" },
            complete: { type: "boolean" }
          },
          required: ["questionId", "score", "maxScore", "response", "notes", "complete"]
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

  const form = new FormData();
  form.set("sdp", sdp);
  form.set("session", JSON.stringify(session));

  const response = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Safety-Identifier": safetyIdentifier
    },
    body: form
  });

  const responseText = await response.text();
  if (!response.ok) {
    res.writeHead(response.status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Realtime session failed", detail: responseText }));
    return;
  }

  res.writeHead(200, { "Content-Type": "application/sdp" });
  res.end(responseText);
}

async function saveQuestionnaire(req, res, questionnaireId) {
  const body = await readJsonBody(req, 1_000_000);
  const nextQuestionnaire = normalizeQuestionnaire({ ...body, id: questionnaireId || body.id });
  const questionnaires = loadQuestionnaires();
  const existingIndex = questionnaires.findIndex((item) => item.id === nextQuestionnaire.id);

  if (existingIndex >= 0) {
    questionnaires[existingIndex] = nextQuestionnaire;
  } else {
    questionnaires.push(nextQuestionnaire);
  }

  mkdirSync(dirname(questionnaireDataPath), { recursive: true });
  writeFileSync(questionnaireDataPath, `${JSON.stringify(questionnaires, null, 2)}\n`, "utf8");
  sendJson(res, 200, { questionnaire: nextQuestionnaire });
}

function loadQuestionnaires() {
  if (existsSync(questionnaireDataPath)) {
    return JSON.parse(readFileSync(questionnaireDataPath, "utf8")).map(normalizeQuestionnaire);
  }
  return [loadMmseQuestionnaire()];
}

function loadMmseQuestionnaire() {
  const sourcePath = resolve(docsDir, "mmse_en_zh.md");
  const source = readFileSync(sourcePath, "utf8");
  const questions = [];
  let rowIndex = 0;

  for (const line of source.split(/\r?\n/)) {
    if (!line.startsWith("|") || line.includes("---") || line.includes("Section | Question")) {
      continue;
    }

    const cells = splitMarkdownTableRow(line);
    if (cells.length < 5 || cells[0].includes("**Total**")) {
      continue;
    }

    rowIndex += 1;
    questions.push(normalizeQuestion({
      id: `mmse-q${rowIndex}`,
      section: stripMarkdown(cells[0]),
      question: stripMarkdown(cells[1]),
      questionChinese: stripMarkdown(cells[2]),
      scoringNotes: stripMarkdown(cells[3]),
      maxScore: Number(stripMarkdown(cells[4])) || 0,
      capability: inferCapability(cells[0], cells[1], cells[3])
    }));
  }

  return normalizeQuestionnaire({
    id: "mmse",
    title: "Mini-Mental State Examination",
    description: "Screening questionnaire for cognitive impairment and dementia risk.",
    language: "English and Chinese",
    questions
  });
}

function buildInstructions(questionnaire) {
  return [
    baseInstructions,
    "",
    `Selected questionnaire: ${questionnaire.title}`,
    `Questionnaire ID: ${questionnaire.id}`,
    "The client UI is the source of truth for the active section.",
    "Question details will be provided through session updates.",
    "Use only the active question details from the latest session instructions."
  ].join("\n");
}

function normalizeQuestionnaire(questionnaire) {
  const id = String(questionnaire.id || slugify(questionnaire.title || "questionnaire"));
  return {
    id,
    title: String(questionnaire.title || "Untitled questionnaire"),
    description: String(questionnaire.description || ""),
    language: String(questionnaire.language || ""),
    questions: Array.isArray(questionnaire.questions) ? questionnaire.questions.map(normalizeQuestion) : []
  };
}

function normalizeQuestion(question) {
  const maxScore = Number(question.maxScore);
  return {
    id: String(question.id || randomUUID()),
    section: String(question.section || ""),
    question: String(question.question || ""),
    questionChinese: String(question.questionChinese || ""),
    scoringNotes: String(question.scoringNotes || ""),
    maxScore: Number.isFinite(maxScore) && maxScore >= 0 ? maxScore : 0,
    capability: normalizeCapability(question.capability)
  };
}

function normalizeCapability(value) {
  const allowed = new Set(["voice", "camera", "canvas", "reading", "writing", "copying"]);
  return allowed.has(value) ? value : "voice";
}

function inferCapability(section, question, scoringNotes) {
  const text = `${section} ${question} ${scoringNotes}`.toLowerCase();
  if (text.includes("close your eyes") || text.includes("reading")) {
    return "reading";
  }
  if (text.includes("write a sentence") || text.includes("writing")) {
    return "writing";
  }
  if (text.includes("copy this picture") || text.includes("pentagon") || text.includes("copying")) {
    return "copying";
  }
  if (text.includes("show the patient") || text.includes("takes paper") || text.includes("folds it")) {
    return "camera";
  }
  return "voice";
}

function splitMarkdownTableRow(line) {
  return line.slice(1, -1).split("|").map((cell) => cell.trim());
}

function stripMarkdown(value) {
  return String(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\*\*/g, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function serveStatic(req, res, pathname) {
  if (pathname === "/mmse_picture_copying.png") {
    res.writeHead(200, { "Content-Type": "image/png" });
    createReadStream(resolve(docsDir, "mmse_picture_copying.png")).pipe(res);
    return;
  }

  const routePath = pathname === "/" || pathname === "/admin" || pathname === "/report" || pathname === "/log" ? "/index.html" : pathname;
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

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "questionnaire";
}
