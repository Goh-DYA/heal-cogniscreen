const routes = {
  "/": "patient",
  "/admin": "admin",
  "/report": "report",
  "/log": "log"
};

const reportStorageKey = "heal-questionnaire-report";
const activeSectionReinforcement = "Use only the active section in the current session instructions; do not ask or score any other section.";
const completionFarewellInstruction = [
  "All questions are recorded.",
  "Thank the patient warmly for being cooperative, offer brief encouragement, and say goodbye.",
  "Tell the patient they may end the call using the on-screen End call button.",
  "Do not call any tool after the farewell."
].join(" ");

const els = {
  appStatus: document.querySelector("#appStatus"),
  connectionStatus: document.querySelector("#connectionStatus"),
  questionnaireSelect: document.querySelector("#questionnaireSelect"),
  startButton: document.querySelector("#startButton"),
  microphoneButton: document.querySelector("#microphoneButton"),
  finishButton: document.querySelector("#finishButton"),
  resetProgressButton: document.querySelector("#resetProgressButton"),
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
  cameraStatus: document.querySelector("#cameraStatus"),
  canvasBlock: document.querySelector("#canvasBlock"),
  clearCanvasButton: document.querySelector("#clearCanvasButton"),
  sendCanvasButton: document.querySelector("#sendCanvasButton"),
  canvasStatus: document.querySelector("#canvasStatus"),
  copyingReference: document.querySelector("#copyingReference"),
  responseCanvas: document.querySelector("#responseCanvas"),
  readingBlock: document.querySelector("#readingBlock"),
  adminQuestionnaireSelect: document.querySelector("#adminQuestionnaireSelect"),
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
  logTranscript: document.querySelector("#logTranscript"),
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
  microphoneMuted: false,
  cameraStream: undefined,
  assistantMessage: undefined,
  handledToolCalls: new Set(),
  loggedInputTranscripts: new Set(),
  drawing: false,
  lastReportSummary: ""
};

els.startButton.addEventListener("click", startQuestionnaire);
els.microphoneButton.addEventListener("click", toggleMicrophone);
els.finishButton.addEventListener("click", () => {
  setAppStatus("Ending call...");
  finishQuestionnaire("completed", "Questionnaire manually finished.");
});
els.resetProgressButton.addEventListener("click", resetProgress);
els.reportButton.addEventListener("click", () => {
  setAppStatus("Opening clinician report.");
  navigate("/report");
});
els.questionnaireSelect.addEventListener("change", selectQuestionnaire);
els.adminQuestionnaireSelect.addEventListener("change", selectEditorQuestionnaire);
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
  els.adminQuestionnaireSelect.innerHTML = "";
  for (const questionnaire of state.questionnaires) {
    const option = document.createElement("option");
    option.value = questionnaire.id;
    option.textContent = questionnaire.title;
    els.questionnaireSelect.append(option);

    const adminOption = option.cloneNode(true);
    els.adminQuestionnaireSelect.append(adminOption);
  }

  if (state.activeQuestionnaire) {
    els.questionnaireSelect.value = state.activeQuestionnaire.id;
  }
  if (state.editorQuestionnaire) {
    els.adminQuestionnaireSelect.value = state.editorQuestionnaire.id;
  }
}

function selectQuestionnaire() {
  state.activeQuestionnaire = state.questionnaires.find((item) => item.id === els.questionnaireSelect.value);
  state.editorQuestionnaire = cloneQuestionnaire(state.activeQuestionnaire);
  resetSessionState();
  setAppStatus(`Selected ${state.activeQuestionnaire?.title || "questionnaire"}.`);
  renderQuestionnaire();
  renderEditor();
}

function selectEditorQuestionnaire() {
  const questionnaire = state.questionnaires.find((item) => item.id === els.adminQuestionnaireSelect.value);
  state.editorQuestionnaire = cloneQuestionnaire(questionnaire);
  setAppStatus(`Editing ${state.editorQuestionnaire?.title || "questionnaire"}.`);
  renderEditor();
}

async function startQuestionnaire() {
  setConnectionStatus("Connecting");
  setAppStatus("Starting questionnaire session...");
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
    setMicrophoneMuted(false);
    els.microphoneButton.disabled = false;

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
    appendTranscript("system", "Call connected. The assistant will administer one item at a time.");
    setConnectionStatus("Live");
    setAppStatus("Questionnaire session is live.");
  } catch (error) {
    console.error(error);
    appendTranscript("system", "Could not start the call. Check microphone permission and server configuration.");
    setAppStatus("Could not start the call. Check microphone permission and server configuration.");
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

  if (payload.type === "conversation.item.input_audio_transcription.completed" || payload.type === "conversation.item.input_audio_transcription.segment") {
    appendInputTranscript(payload.item_id || payload.item?.id || payload.event_id, payload.transcript || payload.text || "");
  }

  if (payload.type === "conversation.item.input_audio_transcription.failed") {
    appendTranscript("system", "Could not transcribe patient audio for the log.");
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
  const isFunctionCall = item?.type === "function_call" || item?.type === "response.function_call_arguments.done";
  if (!isFunctionCall) {
    return;
  }

  const callKey = item.call_id || `${item.name}:${item.arguments || ""}`;
  if (state.handledToolCalls.has(callKey)) {
    return;
  }
  state.handledToolCalls.add(callKey);

  let args = {};
  try {
    args = JSON.parse(item.arguments || "{}");
  } catch (error) {
    console.error(error);
  }

  appendTranscript("system", `Calling tool: ${formatToolName(item.name)}.`);
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
    appendTranscript("system", `Tool complete: ${formatToolName(item.name)}.`);
    if (!output.finished) {
      sendRealtimeResponse(output.continueInstruction || "Continue the questionnaire immediately.");
    }
  }
}

function handleToolCall(name, args) {
  if (name === "set_active_question") {
    const activeResult = setActiveQuestionFromTool(args.questionId);
    return {
      ok: activeResult.ok,
      error: activeResult.error,
      activeQuestionId: state.activeQuestionId,
      expectedQuestionId: activeResult.expectedQuestionId,
      progress: progressSnapshot(),
      continueInstruction: activeResult.continueInstruction
    };
  }

  if (name === "record_question_result") {
    const result = recordResponse(args);
    const nextQuestion = getNextIncompleteQuestion();
    return {
      ok: result.ok,
      error: result.error,
      recordedQuestionId: result.recordedQuestionId || null,
      nextQuestionId: nextQuestion?.id || null,
      progress: progressSnapshot(),
      continueInstruction: result.continueInstruction
    };
  }

  return { ok: false, error: `Unknown tool: ${name}` };
}

function recordResponse(args) {
  const question = getQuestion(args.questionId);
  if (!question) {
    return {
      ok: false,
      error: `Unknown questionId "${args.questionId}".`,
      continueInstruction: getSequenceCorrectionInstruction()
    };
  }

  const currentQuestion = getNextIncompleteQuestion();
  if (!currentQuestion) {
    return {
      ok: false,
      error: "All questions have already been recorded.",
      continueInstruction: completionFarewellInstruction
    };
  }

  if (question.id !== currentQuestion.id) {
    setActiveQuestion(currentQuestion.id);
    return {
      ok: false,
      error: `Question "${question.id}" is not the active unanswered question.`,
      continueInstruction: getSequenceCorrectionInstruction()
    };
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
  setAppStatus(`Recorded ${question.section}.`);
  const nextQuestion = getNextIncompleteQuestion();
  if (nextQuestion) {
    setActiveQuestion(nextQuestion.id);
  }
  renderQuestionnaire();
  persistReport(args.summary || "");
  return {
    ok: true,
    recordedQuestionId: question.id,
    continueInstruction: nextQuestion
      ? `The active question has been updated to questionId "${nextQuestion.id}". Ask only the active section from the current session instructions.`
      : completionFarewellInstruction
  };
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
  setAppStatus(`Active task: ${question.section}.`);
  renderQuestionnaire();
  updateRealtimeSessionInstructions(question);
}

function setActiveQuestionFromTool(questionId) {
  const expectedQuestion = getNextIncompleteQuestion();
  if (!expectedQuestion) {
    return {
      ok: false,
      error: "All questions have already been recorded.",
      expectedQuestionId: null,
      continueInstruction: completionFarewellInstruction
    };
  }

  const question = getQuestion(questionId);
  if (!question) {
    setActiveQuestion(expectedQuestion.id);
    return {
      ok: false,
      error: `Unknown questionId "${questionId}".`,
      expectedQuestionId: expectedQuestion.id,
      continueInstruction: getSequenceCorrectionInstruction()
    };
  }

  if (question.id !== expectedQuestion.id) {
    setActiveQuestion(expectedQuestion.id);
    return {
      ok: false,
      error: `Question "${question.id}" is out of sequence or already complete.`,
      expectedQuestionId: expectedQuestion.id,
      continueInstruction: getSequenceCorrectionInstruction()
    };
  }

  setActiveQuestion(question.id);
  return {
    ok: true,
    expectedQuestionId: question.id,
    continueInstruction: `The active question is "${question.id}". Ask only the active section from the current session instructions until it is recorded.`
  };
}

function renderQuestionnaire() {
  const questions = state.activeQuestionnaire?.questions || [];
  const completeCount = questions.filter((question) => state.responses.has(question.id)).length;
  const progress = questions.length ? Math.round((completeCount / questions.length) * 100) : 0;

  els.progressText.textContent = `${completeCount} of ${questions.length} complete`;
  els.scoreText.textContent = `${completeCount} / ${questions.length}`;
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
    if (state.sessionStatus !== "live") {
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.setAttribute("aria-label", `Select ${question.section}`);
    }
    item.addEventListener("click", () => {
      if (state.sessionStatus !== "live") {
        setActiveQuestion(question.id);
      }
    });
    item.addEventListener("keydown", (event) => {
      if (state.sessionStatus === "live" || !["Enter", " "].includes(event.key)) {
        return;
      }
      event.preventDefault();
      setActiveQuestion(question.id);
    });
    els.questionList.append(item);
  }

  renderReport();
}

function renderModality(capability) {
  els.cameraBlock.hidden = !["camera", "reading"].includes(capability);
  els.canvasBlock.hidden = !["writing", "copying"].includes(capability);
  els.readingBlock.hidden = capability !== "reading";
  els.copyingReference.hidden = capability !== "copying";
  resetTaskFeedback(capability);
}

async function startCamera() {
  if (state.cameraStream) {
    stopCamera();
    return;
  }

  setCameraStatus("Requesting camera permission...");
  els.cameraButton.disabled = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access is not supported by this browser.");
    }

    state.cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
    els.cameraPreview.srcObject = state.cameraStream;
    els.cameraButton.textContent = "Stop camera";
    els.cameraButton.title = "Turn the camera off";
    els.snapshotButton.disabled = false;
    setCameraStatus("Camera on. Send a snapshot when the item or action is visible.");
  } catch (error) {
    console.error(error);
    setCameraStatus("Could not start camera. Allow camera access, then try again.");
    appendTranscript("system", "Could not start camera. Allow camera access, then try again.");
  } finally {
    els.cameraButton.disabled = false;
  }
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
  els.cameraButton.title = "Turn the camera on";
  els.snapshotButton.disabled = true;
  setCameraStatus("Camera is off.");
}

function sendCameraSnapshot() {
  if (!state.cameraStream) {
    setCameraStatus("Start the camera before sending a snapshot.");
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = els.cameraPreview.videoWidth || 640;
  canvas.height = els.cameraPreview.videoHeight || 480;
  canvas.getContext("2d").drawImage(els.cameraPreview, 0, 0, canvas.width, canvas.height);
  sendImageArtifact(canvas.toDataURL("image/jpeg", 0.88), "Camera snapshot submitted for observation.");
  setCameraStatus("Snapshot sent for scoring.");
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
  setCanvasStatus("Canvas cleared. Write or draw the response when ready.");
}

function sendCanvas() {
  sendImageArtifact(els.responseCanvas.toDataURL("image/png"), "Canvas response submitted for scoring.");
  setCanvasStatus("Canvas sent for scoring.");
}

function sendImageArtifact(dataUrl, message) {
  state.mediaArtifacts.push({
    questionId: state.activeQuestionId,
    type: getQuestion(state.activeQuestionId)?.capability || "media",
    dataUrl,
    createdAt: new Date().toISOString()
  });
  appendTranscript("user", message);
  setAppStatus(message);
  sendRealtimeContent([
    { type: "input_text", text: `${message} Please evaluate it for the active question.` },
    { type: "input_image", image_url: dataUrl }
  ]);
  persistReport("");
}

function updateRealtimeSessionInstructions(question) {
  if (!state.dataChannel || state.dataChannel.readyState !== "open") {
    return;
  }

  state.dataChannel.send(JSON.stringify({
    type: "session.update",
    session: {
      instructions: buildFocusedInstructions(question)
    }
  }));
}

function sendRealtimeResponse(instructions) {
  if (!state.dataChannel || state.dataChannel.readyState !== "open") {
    appendTranscript("system", "Realtime connection is not ready.");
    return;
  }

  const response = {
    output_modalities: ["audio"],
    instructions: buildResponseInstructions(instructions)
  };

  state.dataChannel.send(JSON.stringify({
    type: "response.create",
    response
  }));
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
  sendRealtimeResponse();
}

function finishQuestionnaire(status, summary) {
  state.sessionStatus = status;
  state.lastReportSummary = summary;
  appendTranscript("system", summary);
  endRealtimeConnection();
  persistReport(summary);
  renderReport();
  setAppStatus("Call ended. Use Report to open the clinician report.");
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
  state.microphoneMuted = false;
  els.microphoneButton.disabled = true;
  updateMicrophoneButton(false);
  els.startButton.disabled = false;
  els.finishButton.disabled = true;
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
  els.adminQuestionnaireSelect.value = "";
  setAppStatus("New questionnaire draft created.");
  renderEditor();
}

function renderEditor() {
  const questionnaire = state.editorQuestionnaire;
  els.adminQuestionnaireSelect.value = questionnaire?.id || "";
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
      <button class="secondary" data-move="up" type="button" ${index === 0 ? "disabled" : ""}>Move up</button>
      <button class="secondary" data-move="down" type="button" ${index === state.editorQuestionnaire.questions.length - 1 ? "disabled" : ""}>Move down</button>
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
  for (const button of wrapper.querySelectorAll("[data-move]")) {
    button.addEventListener("click", () => {
      moveQuestion(index, button.dataset.move);
    });
  }
  return wrapper;
}

function moveQuestion(index, direction) {
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= state.editorQuestionnaire.questions.length) {
    return;
  }

  const [question] = state.editorQuestionnaire.questions.splice(index, 1);
  state.editorQuestionnaire.questions.splice(targetIndex, 0, question);
  renderEditor();
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
  setAppStatus("Question row added.");
  renderEditor();
}

async function saveQuestionnaire() {
  const originalLabel = els.saveQuestionnaireButton.textContent;
  els.saveQuestionnaireButton.disabled = true;
  els.saveQuestionnaireButton.textContent = "Saving...";
  setAppStatus("Saving questionnaire...");
  try {
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
      setAppStatus("Could not save questionnaire.");
      return;
    }

    await loadQuestionnaires();
    els.questionnaireSelect.value = savedId;
    selectQuestionnaire();
    setAppStatus("Questionnaire saved.");
    navigate("/");
  } catch (error) {
    console.error(error);
    setAppStatus("Could not save questionnaire.");
  } finally {
    els.saveQuestionnaireButton.disabled = false;
    els.saveQuestionnaireButton.textContent = originalLabel;
  }
}

function renderReport() {
  const questions = state.activeQuestionnaire?.questions || [];
  const maxScore = questions.reduce((sum, question) => sum + Number(question.maxScore || 0), 0);
  const score = [...state.responses.values()].reduce((sum, response) => sum + response.score, 0);
  els.reportTotal.textContent = `${score} / ${maxScore}`;
  els.reportStatus.textContent = state.lastReportSummary || `${state.responses.size} of ${questions.length} questions recorded.`;
  els.reportResponses.innerHTML = "";
  els.reportTranscript.innerHTML = "";
  renderLog();

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

function renderLog() {
  if (!els.logTranscript) {
    return;
  }

  els.logTranscript.innerHTML = "";
  for (const entry of state.transcript) {
    const item = document.createElement("div");
    item.className = `utterance ${entry.role}`;
    item.innerHTML = `
      <span class="log-meta">${escapeHtml(entry.role)} ${escapeHtml(formatTime(entry.at))}</span>
      <span>${escapeHtml(entry.text)}</span>
    `;
    els.logTranscript.append(item);
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
  setAppStatus("Report JSON downloaded.");
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
  localStorage.setItem(reportStorageKey, JSON.stringify(buildReport()));
}

function restoreReport() {
  const raw = localStorage.getItem(reportStorageKey);
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
      renderLog();
    }
  } catch (error) {
    console.error(error);
  }
}

function resetProgress() {
  if (!window.confirm("Reset all saved questionnaire progress?")) {
    setAppStatus("Reset cancelled.");
    return;
  }

  localStorage.removeItem(reportStorageKey);
  endRealtimeConnection();
  resetSessionState();
  renderModality("");
  renderQuestionnaire();
  renderLog();
  setAppStatus("Progress reset.");
}

function resetSessionState() {
  state.activeQuestionId = undefined;
  state.responses = new Map();
  state.transcript = [];
  state.mediaArtifacts = [];
  state.sessionStatus = "idle";
  state.lastReportSummary = "";
  state.handledToolCalls = new Set();
  state.loggedInputTranscripts = new Set();
  els.transcript.innerHTML = "";
  els.activeQuestionTitle.textContent = "Not started";
  els.activeQuestionText.textContent = "Start the questionnaire when the patient is ready.";
}

function appendInputTranscript(id, text) {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) {
    return;
  }

  const key = id || normalizedText;
  if (state.loggedInputTranscripts.has(key)) {
    return;
  }

  state.loggedInputTranscripts.add(key);
  appendTranscript("user", normalizedText);
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
  persistReport("");
  renderLog();
}

function appendTranscript(role, text) {
  const item = document.createElement("div");
  item.className = `utterance ${role}`;
  item.textContent = text;
  els.transcript.append(item);
  els.transcript.scrollTop = els.transcript.scrollHeight;
  state.transcript.push({ role, text, at: new Date().toISOString() });
  renderReport();
  persistReport("");
  renderLog();
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
  renderLog();
}

function setConnectionStatus(value) {
  els.connectionStatus.textContent = value;
}

function setAppStatus(value) {
  els.appStatus.textContent = value;
}

function toggleMicrophone() {
  const muted = !state.microphoneMuted;
  setMicrophoneMuted(muted);
  setAppStatus(muted ? "Microphone muted." : "Microphone on.");
}

function setMicrophoneMuted(muted) {
  state.microphoneMuted = muted;
  for (const track of state.localAudioStream?.getAudioTracks() || []) {
    track.enabled = !muted;
  }
  updateMicrophoneButton(muted);
}

function updateMicrophoneButton(muted) {
  const label = muted ? "Unmute microphone" : "Mute microphone";
  els.microphoneButton.setAttribute("aria-label", label);
  els.microphoneButton.title = label;
  els.microphoneButton.classList.toggle("active", muted);
}

function resetTaskFeedback(capability) {
  if (capability === "camera" || capability === "reading") {
    setCameraStatus(state.cameraStream ? "Camera on. Send a snapshot when ready." : "Camera is off.");
  }
  if (capability === "writing" || capability === "copying") {
    setCanvasStatus("Canvas is ready.");
  }
}

function setCameraStatus(value) {
  els.cameraStatus.textContent = value;
}

function setCanvasStatus(value) {
  els.canvasStatus.textContent = value;
}

function getQuestion(questionId) {
  return state.activeQuestionnaire?.questions.find((question) => question.id === questionId);
}

function getNextIncompleteQuestion() {
  return state.activeQuestionnaire?.questions.find((question) => !state.responses.has(question.id));
}

function getSequenceCorrectionInstruction() {
  const nextQuestion = getNextIncompleteQuestion();
  if (!nextQuestion) {
    return completionFarewellInstruction;
  }

  return `The next required question is questionId "${nextQuestion.id}". Ask only the active section from the current session instructions, and do not repeat any completed question.`;
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

function buildResponseInstructions(instructions) {
  if (!getNextIncompleteQuestion()) {
    return [
      completionFarewellInstruction,
      instructions || ""
    ].filter(Boolean).join("\n");
  }

  const question = getQuestion(state.activeQuestionId);
  const focusedInstructions = question ? buildFocusedInstructions(question) : activeSectionReinforcement;
  return [
    focusedInstructions,
    "",
    activeSectionReinforcement,
    instructions ? `Current turn instruction: ${instructions}` : ""
  ].filter(Boolean).join("\n");
}

function buildFocusedInstructions(question) {
  const questions = state.activeQuestionnaire?.questions || [];
  const completedCount = questions.filter((item) => state.responses.has(item.id)).length;
  return [
    "You are a clinical questionnaire assistant administering a medical screening questionnaire by voice.",
    "You are not diagnosing, treating, or giving medical advice.",
    "The client UI is the source of truth for questionnaire order and active section.",
    "Administer exactly one active section at a time.",
    activeSectionReinforcement,
    "Do not mention, preview, combine, ask, score, or infer any other questionnaire section.",
    "If the patient discusses another section, briefly redirect to the active section.",
    "Personalize phrasing to the patient context if provided, but do not change the scoring requirement.",
    "Ask the patient all aspects needed from the active section notes to fully assess the active section.",
    "Avoid spoonfeeding the patient with the examples.",
    "Do not move on until the current answer is complete enough to assign a score.",
    "Ask focused follow-ups only for the active section.",
    "For observation, reading, writing, and copying tasks, instruct the patient to use the on-screen camera or canvas controls when relevant.",
    "If the patient asks to stop or end the call, respond empathetically, say you understand, say goodbye, and tell them they may use the on-screen End call button.",
    "Call set_active_question before asking the active question if it has not already been set.",
    "Call record_question_result only when the active section is complete enough to score.",
    "Use numeric scores and never exceed the active section maximum score.",
    "Include brief clinician notes explaining the score.",
    "Include the exact response or behavior you relied on when available.",
    "If media was required, mention whether the camera or canvas artifact was reviewed.",
    "",
    `Selected questionnaire: ${state.activeQuestionnaire?.title || ""}`,
    `Questionnaire ID: ${state.activeQuestionnaire?.id || ""}`,
    `Completed count: ${completedCount} of ${questions.length}`,
    "Active section JSON:",
    JSON.stringify({
      questionId: question.id,
      section: question.section,
      question: question.question,
      questionChinese: question.questionChinese,
      scoringNotes: question.scoringNotes,
      maxScore: question.maxScore,
      capability: question.capability
    })
  ].join("\n");
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

function formatToolName(name) {
  return String(name || "unknown").replace(/_/g, " ");
}

function formatTime(value) {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "questionnaire";
}
