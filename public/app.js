const routes = {
  "/": "patient",
  "/admin": "admin",
  "/report": "report"
};

const els = {
  connectionStatus: document.querySelector("#connectionStatus"),
  questionnaireSelect: document.querySelector("#questionnaireSelect"),
  startButton: document.querySelector("#startButton"),
  finishButton: document.querySelector("#finishButton"),
  exitButton: document.querySelector("#exitButton"),
  reportButton: document.querySelector("#reportButton"),
  activeQuestionTitle: document.querySelector("#activeQuestionTitle"),
  activeQuestionText: document.querySelector("#activeQuestionText"),
  transcript: document.querySelector("#transcript"),
  progressText: document.querySelector("#progressText"),
  scoreText: document.querySelector("#scoreText"),
  progressFill: document.querySelector("#progressFill"),
  questionList: document.querySelector("#questionList"),
  cameraBlock: document.querySelector("#cameraBlock"),
  cameraButton: document.querySelector("#cameraButton"),
  cameraPreview: document.querySelector("#cameraPreview"),
  snapshotButton: document.querySelector("#snapshotButton"),
  canvasBlock: document.querySelector("#canvasBlock"),
  clearCanvasButton: document.querySelector("#clearCanvasButton"),
  sendCanvasButton: document.querySelector("#sendCanvasButton"),
  copyingReference: document.querySelector("#copyingReference"),
  responseCanvas: document.querySelector("#responseCanvas"),
  readingBlock: document.querySelector("#readingBlock"),
  newQuestionnaireButton: document.querySelector("#newQuestionnaireButton"),
  saveQuestionnaireButton: document.querySelector("#saveQuestionnaireButton"),
  addQuestionButton: document.querySelector("#addQuestionButton"),
  editorTitle: document.querySelector("#editorTitle"),
  editorId: document.querySelector("#editorId"),
  editorDescription: document.querySelector("#editorDescription"),
  editorLanguage: document.querySelector("#editorLanguage"),
  questionEditorList: document.querySelector("#questionEditorList"),
  reportTotal: document.querySelector("#reportTotal"),
  reportStatus: document.querySelector("#reportStatus"),
  reportResponses: document.querySelector("#reportResponses"),
  reportTranscript: document.querySelector("#reportTranscript"),
  downloadReportButton: document.querySelector("#downloadReportButton")
};

const state = {
  questionnaires: [],
  activeQuestionnaire: undefined,
  editorQuestionnaire: undefined,
  activeQuestionId: undefined,
  responses: new Map(),
  transcript: [],
  mediaArtifacts: [],
  sessionStatus: "idle",
  peerConnection: undefined,
  dataChannel: undefined,
  localAudioStream: undefined,
  cameraStream: undefined,
  assistantMessage: undefined,
  drawing: false,
  lastReportSummary: ""
};

els.startButton.addEventListener("click", startQuestionnaire);
els.finishButton.addEventListener("click", () => finishQuestionnaire("completed", "Questionnaire manually finished."));
els.exitButton.addEventListener("click", () => finishQuestionnaire("exited", "Questionnaire exited before all items were completed."));
els.reportButton.addEventListener("click", () => navigate("/report"));
els.questionnaireSelect.addEventListener("change", selectQuestionnaire);
els.cameraButton.addEventListener("click", startCamera);
els.snapshotButton.addEventListener("click", sendCameraSnapshot);
els.clearCanvasButton.addEventListener("click", clearCanvas);
els.sendCanvasButton.addEventListener("click", sendCanvas);
els.newQuestionnaireButton.addEventListener("click", createNewQuestionnaire);
els.saveQuestionnaireButton.addEventListener("click", saveQuestionnaire);
els.addQuestionButton.addEventListener("click", addQuestionEditorRow);
els.downloadReportButton.addEventListener("click", downloadReport);
window.addEventListener("popstate", renderRoute);

setupCanvas();
await loadQuestionnaires();
renderRoute();

async function loadQuestionnaires() {
  const response = await fetch("/api/questionnaires");
  if (!response.ok) {
    throw new Error("Could not load questionnaires");
  }

  const body = await response.json();
  state.questionnaires = body.questionnaires;
  state.activeQuestionnaire = state.questionnaires[0];
  state.editorQuestionnaire = cloneQuestionnaire(state.activeQuestionnaire);
  renderQuestionnaireSelect();
  renderQuestionnaire();
  renderEditor();
  restoreReport();
}

function renderQuestionnaireSelect() {
  els.questionnaireSelect.innerHTML = "";
  for (const questionnaire of state.questionnaires) {
    const option = document.createElement("option");
    option.value = questionnaire.id;
    option.textContent = questionnaire.title;
    els.questionnaireSelect.append(option);
  }
}

function selectQuestionnaire() {
  state.activeQuestionnaire = state.questionnaires.find((item) => item.id === els.questionnaireSelect.value);
  state.editorQuestionnaire = cloneQuestionnaire(state.activeQuestionnaire);
  resetSessionState();
  renderQuestionnaire();
  renderEditor();
}

async function startQuestionnaire() {
  setConnectionStatus("Connecting");
  els.startButton.disabled = true;

  try {
    state.peerConnection = new RTCPeerConnection();
    state.dataChannel = state.peerConnection.createDataChannel("oai-events");
    state.dataChannel.addEventListener("open", beginRealtimeAdministration);
    state.dataChannel.addEventListener("message", handleRealtimeEvent);

    const remoteAudio = document.createElement("audio");
    remoteAudio.autoplay = true;
    state.peerConnection.addEventListener("track", (event) => {
      remoteAudio.srcObject = event.streams[0];
    });

    state.localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.peerConnection.addTrack(state.localAudioStream.getAudioTracks()[0], state.localAudioStream);

    const offer = await state.peerConnection.createOffer();
    await state.peerConnection.setLocalDescription(offer);

    const response = await fetch(`/api/realtime/session?questionnaireId=${encodeURIComponent(state.activeQuestionnaire.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: offer.sdp
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    await state.peerConnection.setRemoteDescription({
      type: "answer",
      sdp: await response.text()
    });

    state.sessionStatus = "live";
    els.finishButton.disabled = false;
    els.exitButton.disabled = false;
    appendTranscript("system", "Call connected. The assistant will administer one item at a time.");
    setConnectionStatus("Live");
  } catch (error) {
    console.error(error);
    appendTranscript("system", "Could not start the call. Check microphone permission and server configuration.");
    endRealtimeConnection();
  }
}

function beginRealtimeAdministration() {
  const firstQuestion = state.activeQuestionnaire.questions[0];
  if (firstQuestion) {
    setActiveQuestion(firstQuestion.id);
  }

  sendRealtimeContent([
    {
      type: "input_text",
      text: [
        "Begin administering the selected questionnaire now.",
        "Introduce yourself briefly, confirm the patient is ready, then ask the first question.",
        "Use set_active_question before asking each question and record_question_result when complete."
      ].join(" ")
    }
  ]);
}

function handleRealtimeEvent(event) {
  const payload = JSON.parse(event.data);

  if (payload.type === "response.output_text.delta" || payload.type === "response.text.delta" || payload.type === "response.audio_transcript.delta") {
    appendAssistantDelta(payload.delta || "");
  }

  if (payload.type === "response.done") {
    state.assistantMessage = undefined;
  }

  if (payload.type === "conversation.item.input_audio_transcription.completed") {
    appendTranscript("user", payload.transcript || "");
  }

  if (payload.type === "response.output_item.done") {
    maybeHandleFunctionCall(payload.item);
  }

  if (payload.type === "response.function_call_arguments.done") {
    maybeHandleFunctionCall(payload);
  }

  if (payload.type === "error") {
    appendTranscript("system", payload.error?.message || "Realtime API returned an error.");
  }
}

function maybeHandleFunctionCall(item) {
  if (!item || item.type !== "function_call") {
    return;
  }

  let args = {};
  try {
    args = JSON.parse(item.arguments || "{}");
  } catch (error) {
    console.error(error);
  }

  const output = handleToolCall(item.name, args);
  if (item.call_id && state.dataChannel?.readyState === "open") {
    state.dataChannel.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: item.call_id,
        output: JSON.stringify(output)
      }
    }));
    if (!output.finished) {
      state.dataChannel.send(JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["text", "audio"]
        }
      }));
    }
  }
}

function handleToolCall(name, args) {
  if (name === "set_active_question") {
    setActiveQuestion(args.questionId);
    return {
      ok: true,
      activeQuestionId: state.activeQuestionId,
      progress: progressSnapshot()
    };
  }

  if (name === "record_question_result") {
    recordResponse(args);
    return {
      ok: true,
      recordedQuestionId: args.questionId,
      nextQuestionId: getNextIncompleteQuestion()?.id || null,
      progress: progressSnapshot()
    };
  }

  if (name === "finish_questionnaire") {
    finishQuestionnaire(args.status || "completed", args.summary || "Questionnaire finished.");
    return {
      ok: true,
      finished: true,
      status: state.sessionStatus,
      progress: progressSnapshot()
    };
  }

  return { ok: false, error: `Unknown tool: ${name}` };
}

function recordResponse(args) {
  const question = getQuestion(args.questionId);
  if (!question) {
    return;
  }

  const score = clampScore(Number(args.score), question.maxScore);
  state.responses.set(question.id, {
    questionId: question.id,
    section: question.section,
    question: question.question,
    score,
    maxScore: question.maxScore,
    response: String(args.response || ""),
    notes: String(args.notes || ""),
    complete: Boolean(args.complete)
  });

  appendTranscript("system", `Recorded ${question.section}: ${score} / ${question.maxScore}.`);
  const nextQuestion = getNextIncompleteQuestion();
  if (nextQuestion) {
    setActiveQuestion(nextQuestion.id);
  }
  renderQuestionnaire();
  persistReport(args.summary || "");
}

function setActiveQuestion(questionId) {
  const question = getQuestion(questionId);
  if (!question) {
    return;
  }

  state.activeQuestionId = question.id;
  els.activeQuestionTitle.textContent = question.section;
  els.activeQuestionText.textContent = question.question;
  renderModality(question.capability);
  renderQuestionnaire();
}

function renderQuestionnaire() {
  const questions = state.activeQuestionnaire?.questions || [];
  const completeCount = questions.filter((question) => state.responses.has(question.id)).length;
  const maxScore = questions.reduce((sum, question) => sum + Number(question.maxScore || 0), 0);
  const score = [...state.responses.values()].reduce((sum, response) => sum + response.score, 0);
  const progress = questions.length ? Math.round((completeCount / questions.length) * 100) : 0;

  els.progressText.textContent = `${completeCount} of ${questions.length} complete`;
  els.scoreText.textContent = `${score} / ${maxScore}`;
  els.progressFill.style.width = `${progress}%`;
  els.questionList.innerHTML = "";

  for (const question of questions) {
    const response = state.responses.get(question.id);
    const item = document.createElement("li");
    item.className = "question-card";
    if (question.id === state.activeQuestionId) {
      item.classList.add("active");
    }
    if (response) {
      item.classList.add("complete");
    }
    item.innerHTML = `
      <div>
        <h4>${escapeHtml(question.section)}</h4>
        <p>${escapeHtml(question.capability)} · max ${escapeHtml(question.maxScore)}</p>
      </div>
      <span class="score-pill">${response ? `${response.score}/${question.maxScore}` : "-"}</span>
    `;
    item.addEventListener("click", () => setActiveQuestion(question.id));
    els.questionList.append(item);
  }

  renderReport();
}

function renderModality(capability) {
  els.cameraBlock.hidden = !["camera", "reading"].includes(capability);
  els.canvasBlock.hidden = !["writing", "copying"].includes(capability);
  els.readingBlock.hidden = capability !== "reading";
  els.copyingReference.hidden = capability !== "copying";
}

async function startCamera() {
  if (state.cameraStream) {
    stopCamera();
    return;
  }

  state.cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
  els.cameraPreview.srcObject = state.cameraStream;
  els.cameraButton.textContent = "Stop camera";
  els.snapshotButton.disabled = false;
}

function stopCamera() {
  if (state.cameraStream) {
    for (const track of state.cameraStream.getTracks()) {
      track.stop();
    }
  }
  state.cameraStream = undefined;
  els.cameraPreview.srcObject = undefined;
  els.cameraButton.textContent = "Start camera";
  els.snapshotButton.disabled = true;
}

function sendCameraSnapshot() {
  if (!state.cameraStream) {
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = els.cameraPreview.videoWidth || 640;
  canvas.height = els.cameraPreview.videoHeight || 480;
  canvas.getContext("2d").drawImage(els.cameraPreview, 0, 0, canvas.width, canvas.height);
  sendImageArtifact(canvas.toDataURL("image/jpeg", 0.88), "Camera snapshot submitted for observation.");
}

function setupCanvas() {
  const canvas = els.responseCanvas;
  const context = canvas.getContext("2d");
  context.lineWidth = 4;
  context.lineCap = "round";
  context.strokeStyle = "#172026";
  clearCanvas();

  canvas.addEventListener("pointerdown", (event) => {
    state.drawing = true;
    const point = canvasPoint(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!state.drawing) {
      return;
    }
    const point = canvasPoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  });

  canvas.addEventListener("pointerup", () => {
    state.drawing = false;
  });
}

function clearCanvas() {
  const context = els.responseCanvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, els.responseCanvas.width, els.responseCanvas.height);
}

function sendCanvas() {
  sendImageArtifact(els.responseCanvas.toDataURL("image/png"), "Canvas response submitted for scoring.");
}

function sendImageArtifact(dataUrl, message) {
  state.mediaArtifacts.push({
    questionId: state.activeQuestionId,
    type: getQuestion(state.activeQuestionId)?.capability || "media",
    dataUrl,
    createdAt: new Date().toISOString()
  });
  appendTranscript("user", message);
  sendRealtimeContent([
    { type: "input_text", text: `${message} Please evaluate it for the active question.` },
    { type: "input_image", image_url: dataUrl }
  ]);
  persistReport("");
}

function sendRealtimeContent(content) {
  if (!state.dataChannel || state.dataChannel.readyState !== "open") {
    appendTranscript("system", "Realtime connection is not ready.");
    return;
  }

  state.dataChannel.send(JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content
    }
  }));
  state.dataChannel.send(JSON.stringify({
    type: "response.create",
    response: {
      modalities: ["text", "audio"]
    }
  }));
}

function finishQuestionnaire(status, summary) {
  state.sessionStatus = status;
  state.lastReportSummary = summary;
  appendTranscript("system", summary);
  endRealtimeConnection();
  persistReport(summary);
  renderReport();
  navigate("/report");
}

function endRealtimeConnection() {
  state.dataChannel?.close();
  state.peerConnection?.close();
  if (state.localAudioStream) {
    for (const track of state.localAudioStream.getTracks()) {
      track.stop();
    }
  }
  stopCamera();
  state.dataChannel = undefined;
  state.peerConnection = undefined;
  state.localAudioStream = undefined;
  els.startButton.disabled = false;
  els.finishButton.disabled = true;
  els.exitButton.disabled = true;
  setConnectionStatus("Idle");
}

function createNewQuestionnaire() {
  state.editorQuestionnaire = {
    id: "new-questionnaire",
    title: "New Questionnaire",
    description: "",
    language: "English",
    questions: []
  };
  renderEditor();
}

function renderEditor() {
  const questionnaire = state.editorQuestionnaire;
  els.editorTitle.value = questionnaire?.title || "";
  els.editorId.value = questionnaire?.id || "";
  els.editorDescription.value = questionnaire?.description || "";
  els.editorLanguage.value = questionnaire?.language || "";
  els.questionEditorList.innerHTML = "";

  for (const [index, question] of (questionnaire?.questions || []).entries()) {
    els.questionEditorList.append(createQuestionEditor(question, index));
  }
}

function createQuestionEditor(question, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "question-editor";
  wrapper.innerHTML = `
    <label>
      Section
      <input data-field="section" value="${escapeAttribute(question.section)}">
    </label>
    <label>
      Capability
      <select data-field="capability">
        ${["voice", "camera", "canvas", "reading", "writing", "copying"].map((capability) => (
          `<option value="${capability}" ${question.capability === capability ? "selected" : ""}>${capability}</option>`
        )).join("")}
      </select>
    </label>
    <label class="wide">
      Question
      <textarea data-field="question" rows="3">${escapeHtml(question.question)}</textarea>
    </label>
    <label class="wide">
      Question (Chinese)
      <textarea data-field="questionChinese" rows="2">${escapeHtml(question.questionChinese)}</textarea>
    </label>
    <label class="wide">
      Scoring Notes
      <textarea data-field="scoringNotes" rows="3">${escapeHtml(question.scoringNotes)}</textarea>
    </label>
    <label>
      Maximum Score
      <input data-field="maxScore" type="number" min="0" step="1" value="${escapeAttribute(question.maxScore)}">
    </label>
    <div class="row-actions">
      <button class="danger" data-remove type="button">Remove</button>
    </div>
  `;

  wrapper.addEventListener("input", (event) => {
    const field = event.target.dataset.field;
    if (!field) {
      return;
    }
    state.editorQuestionnaire.questions[index][field] = field === "maxScore" ? Number(event.target.value) : event.target.value;
  });
  wrapper.querySelector("[data-remove]").addEventListener("click", () => {
    state.editorQuestionnaire.questions.splice(index, 1);
    renderEditor();
  });
  return wrapper;
}

function addQuestionEditorRow() {
  state.editorQuestionnaire.questions.push({
    id: `q-${Date.now()}`,
    section: "",
    question: "",
    questionChinese: "",
    scoringNotes: "",
    maxScore: 1,
    capability: "voice"
  });
  renderEditor();
}

async function saveQuestionnaire() {
  state.editorQuestionnaire.title = els.editorTitle.value.trim();
  state.editorQuestionnaire.id = slugify(els.editorId.value.trim() || state.editorQuestionnaire.title);
  state.editorQuestionnaire.description = els.editorDescription.value.trim();
  state.editorQuestionnaire.language = els.editorLanguage.value.trim();
  const savedId = state.editorQuestionnaire.id;

  const response = await fetch(`/api/questionnaires/${encodeURIComponent(state.editorQuestionnaire.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state.editorQuestionnaire)
  });

  if (!response.ok) {
    appendTranscript("system", "Could not save questionnaire.");
    return;
  }

  await loadQuestionnaires();
  els.questionnaireSelect.value = savedId;
  selectQuestionnaire();
  navigate("/");
}

function renderReport() {
  const questions = state.activeQuestionnaire?.questions || [];
  const maxScore = questions.reduce((sum, question) => sum + Number(question.maxScore || 0), 0);
  const score = [...state.responses.values()].reduce((sum, response) => sum + response.score, 0);
  els.reportTotal.textContent = `${score} / ${maxScore}`;
  els.reportStatus.textContent = state.lastReportSummary || `${state.responses.size} of ${questions.length} questions recorded.`;
  els.reportResponses.innerHTML = "";
  els.reportTranscript.innerHTML = "";

  for (const question of questions) {
    const response = state.responses.get(question.id);
    const media = state.mediaArtifacts.filter((artifact) => artifact.questionId === question.id);
    const row = document.createElement("div");
    row.className = "response-row";
    row.innerHTML = `
      <h4>${escapeHtml(question.section)} <span class="score-pill">${response ? `${response.score}/${question.maxScore}` : `-/${question.maxScore}`}</span></h4>
      <p>${escapeHtml(response?.response || "No response recorded.")}</p>
      <p>${escapeHtml(response?.notes || question.scoringNotes)}</p>
    `;
    for (const artifact of media) {
      const image = document.createElement("img");
      image.src = artifact.dataUrl;
      image.alt = `${artifact.type} artifact for ${question.section}`;
      image.className = "report-artifact";
      row.append(image);
    }
    els.reportResponses.append(row);
  }

  for (const entry of state.transcript) {
    const item = document.createElement("div");
    item.className = `utterance ${entry.role}`;
    item.textContent = entry.text;
    els.reportTranscript.append(item);
  }
}

function downloadReport() {
  const blob = new Blob([JSON.stringify(buildReport(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `questionnaire-report-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildReport() {
  return {
    questionnaire: state.activeQuestionnaire,
    status: state.sessionStatus,
    summary: state.lastReportSummary,
    responses: [...state.responses.values()],
    transcript: state.transcript,
    mediaArtifacts: state.mediaArtifacts.map(({ dataUrl, ...artifact }) => ({
      ...artifact,
      hasImageData: Boolean(dataUrl)
    })),
    createdAt: new Date().toISOString()
  };
}

function persistReport(summary) {
  if (summary) {
    state.lastReportSummary = summary;
  }
  localStorage.setItem("heal-questionnaire-report", JSON.stringify(buildReport()));
}

function restoreReport() {
  const raw = localStorage.getItem("heal-questionnaire-report");
  if (!raw) {
    return;
  }

  try {
    const report = JSON.parse(raw);
    if (report.questionnaire?.id === state.activeQuestionnaire?.id) {
      state.sessionStatus = report.status || "idle";
      state.lastReportSummary = report.summary || "";
      state.transcript = report.transcript || [];
      state.responses = new Map((report.responses || []).map((response) => [response.questionId, response]));
      renderQuestionnaire();
    }
  } catch (error) {
    console.error(error);
  }
}

function resetSessionState() {
  state.activeQuestionId = undefined;
  state.responses = new Map();
  state.transcript = [];
  state.mediaArtifacts = [];
  state.lastReportSummary = "";
  els.transcript.innerHTML = "";
  els.activeQuestionTitle.textContent = "Not started";
  els.activeQuestionText.textContent = "Start the questionnaire when the patient is ready.";
}

function appendAssistantDelta(delta) {
  if (!delta) {
    return;
  }

  if (!state.assistantMessage) {
    state.assistantMessage = appendTranscript("assistant", "");
  }

  state.assistantMessage.textContent += delta;
  const last = state.transcript[state.transcript.length - 1];
  if (last?.role === "assistant") {
    last.text = state.assistantMessage.textContent;
  }
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function appendTranscript(role, text) {
  const item = document.createElement("div");
  item.className = `utterance ${role}`;
  item.textContent = text;
  els.transcript.append(item);
  els.transcript.scrollTop = els.transcript.scrollHeight;
  state.transcript.push({ role, text, at: new Date().toISOString() });
  renderReport();
  return item;
}

function navigate(path) {
  history.pushState({}, "", path);
  renderRoute();
}

function renderRoute() {
  const route = routes[location.pathname] || "patient";
  for (const view of document.querySelectorAll(".view")) {
    view.hidden = view.id !== `${route}View`;
  }
  for (const link of document.querySelectorAll("nav a")) {
    link.classList.toggle("active", link.dataset.route === route);
  }
  renderReport();
}

function setConnectionStatus(value) {
  els.connectionStatus.textContent = value;
}

function getQuestion(questionId) {
  return state.activeQuestionnaire?.questions.find((question) => question.id === questionId);
}

function getNextIncompleteQuestion() {
  return state.activeQuestionnaire?.questions.find((question) => !state.responses.has(question.id));
}

function progressSnapshot() {
  const questions = state.activeQuestionnaire?.questions || [];
  const completed = questions.filter((question) => state.responses.has(question.id)).length;
  return {
    completed,
    total: questions.length,
    activeQuestionId: state.activeQuestionId,
    completedQuestionIds: [...state.responses.keys()]
  };
}

function clampScore(score, maxScore) {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.max(0, Math.min(score, Number(maxScore || 0)));
}

function canvasPoint(event) {
  const rect = els.responseCanvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * els.responseCanvas.width,
    y: ((event.clientY - rect.top) / rect.height) * els.responseCanvas.height
  };
}

function cloneQuestionnaire(questionnaire) {
  return JSON.parse(JSON.stringify(questionnaire));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "questionnaire";
}
