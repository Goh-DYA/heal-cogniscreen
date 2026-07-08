# Heal Realtime Questionnaire

Heal Realtime Questionnaire is a local web application for administering medical questionnaires through an OpenAI Realtime voice session. The first bundled questionnaire is the Mini-Mental State Examination (MMSE), loaded from `docs/mmse_en_zh.md`.

The app is designed around a telehealth-style workflow: a patient starts a voice call, speaks with a static AI avatar, completes one question at a time, uses camera or canvas tools when a question requires observation or writing/drawing, and then a clinician reviews a separate report screen.

## What Is Implemented

- Patient call screen at `/`
  - Starts an OpenAI Realtime WebRTC session with `gpt-realtime-2.1-mini`.
  - Shows a static AI avatar placeholder.
  - Tracks active question, completion count, and total score.
  - Displays the current task and transcript.
  - Provides `Finish` and `Exit` controls.

- Realtime questionnaire administration
  - Server creates Realtime sessions through `POST /api/realtime/session`.
  - The model receives the selected questionnaire as structured JSON.
  - The model is instructed to administer exactly one question at a time.
  - Tool calls let the model set the active question, record scored answers, and finish or exit the questionnaire.
  - Tool outputs return progress state so the model can track completed items.

- MMSE support
  - The default MMSE questionnaire is parsed from `docs/mmse_en_zh.md`.
  - `docs/mmse_picture_copying.png` is served for the copying task.
  - Total MMSE score is 30 across 11 rows from the source table.

- Modality-specific task support
  - Voice-first questions use the Realtime audio conversation.
  - Reading and observation tasks can use the webcam snapshot workflow.
  - Writing and copying tasks use an interactive canvas.
  - Submitted camera/canvas artifacts are shown in the clinician report.

- Admin editor at `/admin`
  - Creates or edits questionnaires.
  - Supports the required fields: Section, Question, Question (Chinese), Scoring Notes, Maximum Score.
  - Supports capability selection: `voice`, `camera`, `canvas`, `reading`, `writing`, `copying`.
  - Saves edited questionnaires to `data/questionnaires.json`.

- Clinician report at `/report`
  - Shows total score, per-question scores, responses, scoring notes, transcript, and submitted media artifacts.
  - Provides a PDF report download.

## Architecture

```text
Browser UI
  public/index.html
  public/app.js
  public/styles.css
        |
        | HTTP routes and WebRTC SDP offer
        v
Node server
  server.js
        |
        | POST multipart SDP + session config
        v
OpenAI Realtime API
  /v1/realtime/calls
  model: gpt-realtime-2.1-mini
```

Key files:

- `server.js` - dependency-free Node HTTP server, static file hosting, questionnaire API, Realtime session creation, MMSE markdown parsing.
- `public/app.js` - browser state machine for routes, WebRTC, Realtime events, tool-call handling, progress tracking, camera, canvas, admin editing, and report rendering.
- `public/index.html` - single-page shell for patient, admin, and report views.
- `public/styles.css` - responsive clinical workflow UI.
- `prompts/questionnaire-realtime.md` - system instructions for voice administration, probing incomplete answers, scoring, and tool-call behavior.
- `docs/mmse_en_zh.md` - MMSE source questionnaire.
- `docs/mmse_picture_copying.png` - MMSE copying reference image.

## Setup

Prerequisites:

- Node.js 20 or newer.
- An `OPENAI_API_KEY` with access to the Realtime API.

No dependency installation is required. This app uses only Node.js built-in modules and browser APIs, so there is no `npm install` step.

The server reads `OPENAI_API_KEY` from these locations, in order:

1. Existing process environment.
2. Root `.env`.
3. Root `.env.local`.

The app runs from the repository root and does not depend on the deleted reference implementation.

Example `.env.local`:

```text
OPENAI_API_KEY=sk-proj-...
REALTIME_MODEL=gpt-realtime-2.1-mini
REALTIME_VOICE=marin
```

`REALTIME_MODEL` and `REALTIME_VOICE` are optional. The defaults are `gpt-realtime-2.1-mini` and `marin`.

## Run

From the repository root:

```powershell
node server.js
```

If port 3000 is already in use, either stop the existing server process or run on another port:

```powershell
$env:PORT=3001
node server.js
```

Open:

- Patient app: `http://localhost:3000/`
- Admin editor: `http://localhost:3000/admin`
- Clinician report: `http://localhost:3000/report`
- Health check: `http://localhost:3000/health`

## Using The App

1. Open `/`.
2. Select a questionnaire.
3. Click `Start Questionnaire`.
4. Allow microphone access when the browser asks.
5. Speak naturally with the AI assistant.
6. Use the camera or canvas controls when the active question requires them.
7. Click `Finish` or `Exit`, or allow the assistant to finish after all questions are scored.
8. Review the clinician report at `/report`.

For camera tasks, click `Start camera`, then `Send snapshot`. For writing/copying tasks, draw or write on the canvas, then click `Send canvas`.

## Admin Workflow

Open `/admin` to edit the active questionnaire or create a new one.

Each question has:

- Section
- Capability
- Question
- Question (Chinese)
- Scoring Notes
- Maximum Score

Click `Save` to persist changes. Saved questionnaires are stored in `data/questionnaires.json`, which is intentionally ignored by Git because it is local editable content.

## API Reference

### `GET /health`

Returns server status, configured model, and whether an API key was found.

### `GET /api/questionnaires`

Returns all available questionnaires.

### `PUT /api/questionnaires/:id`

Creates or updates a questionnaire.

Request body shape:

```json
{
  "id": "mmse",
  "title": "Mini-Mental State Examination",
  "description": "Screening questionnaire for cognitive impairment and dementia risk.",
  "language": "English and Chinese",
  "questions": [
    {
      "id": "mmse-q1",
      "section": "Orientation to Time",
      "question": "What is the year? Season? Date? Day of the week? Month?",
      "questionChinese": "...",
      "scoringNotes": "Score 1 point for each correct answer.",
      "maxScore": 5,
      "capability": "voice"
    }
  ]
}
```

### `POST /api/realtime/session?questionnaireId=mmse`

Accepts a WebRTC SDP offer as `application/sdp`, creates an OpenAI Realtime session, and returns an SDP answer.

## Verification

Syntax checks:

```powershell
node --check server.js
node --check public/app.js
```

Manual smoke checks:

```powershell
node server.js
```

Then verify:

- `http://localhost:3000/health` returns `ok: true`.
- `/api/questionnaires` returns the MMSE with 11 questions and total maximum score 30.
- `/`, `/admin`, and `/report` render without browser console errors.
- The admin editor can create a new questionnaire, add a question, select a capability, and save it.
- The patient screen shows `0 of 11 complete` and `0 / 30` before starting MMSE.
- The report screen shows per-question rows and updates when tool-call results are recorded.

End-to-end Realtime verification requires browser microphone permission and a valid OpenAI API key.

## Safety Notes

- This app administers and records questionnaire responses. It does not diagnose, treat, or provide medical advice.
- The clinician report should be reviewed by a qualified clinician.
- Local questionnaire edits and report state are not encrypted.
- This prototype has no user authentication or production persistence layer.
