import {
  activeQuestionInstruction,
  activeSectionReinforcement,
  buildFocusedInstructions,
  buildReadinessIntroductionInstructions,
  completionFarewellInstruction,
  nextQuestionInstruction,
  readinessStartInstruction,
  sequenceCorrectionInstruction
} from "./realtime-instructions.js";
import { createReportPdf } from "./report-pdf.js";
import { pagerPages, reportItemDetails, reportMediaArtifacts, reportPage, reportSections, restoreMediaArtifacts } from "./report.js";
import { ITEM_TYPES } from "./schema.js";
import { summarizeSections } from "./section-summary.js";
import { viewForPath } from "./routes.js";
import { countAnswered, sumMaxScores, sumScores } from "./scoring.js";

const reportStorageKey = "heal-questionnaire-report";

const els = typeof document !== "undefined" ? {
  appShell: document.querySelector("#appShell"),
  appStatus: document.querySelector("#appStatus"),
  connectionStatus: document.querySelector("#connectionStatus"),
  sidebarToggle: document.querySelector("#sidebarToggle"),
  questionnaireSelect: document.querySelector("#questionnaireSelect"),
  startButton: document.querySelector("#startButton"),
  microphoneButton: document.querySelector("#microphoneButton"),
  finishButton: document.querySelector("#finishButton"),
  resetProgressButton: document.querySelector("#resetProgressButton"),
  reportButton: document.querySelector("#reportButton"),
  callScreen: document.querySelector("#callScreen"),
  callScreenStatus: document.querySelector("#callScreenStatus"),
  activeQuestionTitle: document.querySelector("#activeQuestionTitle"),
  activeQuestionText: document.querySelector("#activeQuestionText"),
  dialoguePanel: document.querySelector("#dialoguePanel"),
  transcriptToggle: document.querySelector("#transcriptToggle"),
  transcriptToggleText: document.querySelector("#transcriptToggleText"),
  transcriptCount: document.querySelector("#transcriptCount"),
  transcript: document.querySelector("#transcript"),
  progressText: document.querySelector("#progressText"),
  progressFill: document.querySelector("#progressFill"),
  questionList: document.querySelector("#questionList"),
  cameraBlock: document.querySelector("#cameraBlock"),
  cameraButton: document.querySelector("#cameraButton"),
  cameraPreview: document.querySelector("#cameraPreview"),
  snapshotButton: document.querySelector("#snapshotButton"),
  cameraStatus: document.querySelector("#cameraStatus"),
  visualStimulusBlock: document.querySelector("#visualStimulusBlock"),
  visualStimulusImage: document.querySelector("#visualStimulusImage"),
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
  addSectionButton: document.querySelector("#addSectionButton"),
  editorTitle: document.querySelector("#editorTitle"),
  editorId: document.querySelector("#editorId"),
  editorDescription: document.querySelector("#editorDescription"),
  editorLanguage: document.querySelector("#editorLanguage"),
  questionEditorList: document.querySelector("#questionEditorList"),
  reportTotal: document.querySelector("#reportTotal"),
  reportStatus: document.querySelector("#reportStatus"),
  reportPagination: document.querySelector("#reportPagination"),
  reportResponses: document.querySelector("#reportResponses"),
  reportTranscript: document.querySelector("#reportTranscript"),
  logTranscript: document.querySelector("#logTranscript"),
  downloadReportButton: document.querySelector("#downloadReportButton")
} : {};

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
  assistantSpeaking: false,
  sidebarCollapsed: false,
  transcriptExpanded: false,
  handledToolCalls: new Set(),
  spokenResponseIds: new Set(),
  loggedInputTranscripts: new Set(),
  drawing: false,
  lastCanvasQuestionId: undefined,
  lastReportSummary: "",
  reportPageIndex: 0,
  editorSectionPage: 0,
  sessionContext: { resolvedAnswers: {} },
  fallbackUnlocked: new Set()
};

if (typeof document !== "undefined" && typeof window !== "undefined") {
  els.sidebarToggle.addEventListener("click", toggleSidebar);
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
  els.transcriptToggle.addEventListener("click", toggleTranscript);
  els.adminQuestionnaireSelect.addEventListener("change", selectEditorQuestionnaire);
  els.cameraButton.addEventListener("click", startCamera);
  els.snapshotButton.addEventListener("click", sendCameraSnapshot);
  els.clearCanvasButton.addEventListener("click", clearCanvas);
  els.sendCanvasButton.addEventListener("click", sendCanvas);
  els.newQuestionnaireButton.addEventListener("click", createNewQuestionnaire);
  els.saveQuestionnaireButton.addEventListener("click", saveQuestionnaire);
  els.addSectionButton.addEventListener("click", addSectionEditorRow);
  els.downloadReportButton.addEventListener("click", downloadReport);
  window.addEventListener("popstate", renderRoute);

  renderSidebarState();
  renderTranscriptPanel();
  setAssistantSpeaking(false);
  setupCanvas();
  await loadQuestionnaires();
  renderRoute();
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  renderSidebarState();
}

function renderSidebarState() {
  els.appShell.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  els.sidebarToggle.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
  els.sidebarToggle.setAttribute("aria-label", state.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar");
  els.sidebarToggle.title = state.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar";
}

function toggleTranscript() {
  state.transcriptExpanded = !state.transcriptExpanded;
  renderTranscriptPanel();
}

function renderTranscriptPanel() {
  const count = state.transcript.length;
  const countLabel = `${count} message${count === 1 ? "" : "s"}`;
  const actionLabel = state.transcriptExpanded ? "Hide messages" : "Show messages";
  const label = `${actionLabel}, ${countLabel}`;
  els.transcriptToggleText.textContent = actionLabel;
  els.transcriptCount.textContent = countLabel;
  els.transcriptToggle.setAttribute("aria-label", label);
  els.transcriptToggle.title = label;
  els.transcriptToggle.setAttribute("aria-expanded", String(state.transcriptExpanded));
  els.dialoguePanel.classList.toggle("expanded", state.transcriptExpanded);
  els.dialoguePanel.classList.toggle("collapsed", !state.transcriptExpanded);
  if (state.transcriptExpanded) {
    els.transcript.scrollTop = els.transcript.scrollHeight;
  }
}

function setAssistantSpeaking(isSpeaking) {
  state.assistantSpeaking = isSpeaking;
  els.callScreen.classList.toggle("ai-speaking", isSpeaking);
  els.callScreenStatus.textContent = isSpeaking ? "AI assistant speaking" : "AI assistant standby";
}

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

async function loadSessionContext(questionnaireId) {
  const response = await fetch(`/api/session-context?questionnaireId=${encodeURIComponent(questionnaireId)}`);
  if (response.ok) {
    state.sessionContext = await response.json();
  }
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
  state.reportPageIndex = 0;
  resetSessionState();
  setAppStatus(`Selected ${state.activeQuestionnaire?.title || "questionnaire"}.`);
  renderQuestionnaire();
  renderEditor();
}

function selectEditorQuestionnaire() {
  const questionnaire = state.questionnaires.find((item) => item.id === els.adminQuestionnaireSelect.value);
  state.editorQuestionnaire = cloneQuestionnaire(questionnaire);
  setAppStatus(`Editing ${state.editorQuestionnaire?.title || "questionnaire"}.`);
  state.reportPageIndex = 0;
  renderEditor();
}

async function startQuestionnaire() {
  setConnectionStatus("Connecting");
  setAppStatus("Starting questionnaire session...");
  els.startButton.disabled = true;

  try {
    await loadSessionContext(state.activeQuestionnaire.id);
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
  const firstItem = allItems()[0];
  if (firstItem) {
    setActiveQuestion(firstItem.id);
  }

  sendRealtimeContent([
    { type: "input_text", text: readinessStartInstruction }
  ], { readinessIntroduction: true });
}

function handleRealtimeEvent(event) {
  const payload = JSON.parse(event.data);

  if (payload.type === "response.audio.delta" || payload.type === "output_audio_buffer.started") {
    setAssistantSpeaking(true);
  }

  if (payload.type === "response.output_text.delta" || payload.type === "response.text.delta" || payload.type === "response.audio_transcript.delta") {
    if (payload.response_id) {
      state.spokenResponseIds.add(payload.response_id);
    }
    setAssistantSpeaking(true);
    appendAssistantDelta(payload.delta || "");
  }

  if (payload.type === "response.done" || payload.type === "response.audio.done" || payload.type === "output_audio_buffer.stopped") {
    state.assistantMessage = undefined;
    setAssistantSpeaking(false);
  }

  if (payload.type === "conversation.item.input_audio_transcription.completed" || payload.type === "conversation.item.input_audio_transcription.segment") {
    appendInputTranscript(payload.item_id || payload.item?.id || payload.event_id, payload.transcript || payload.text || "");
  }

  if (payload.type === "conversation.item.input_audio_transcription.failed") {
    appendTranscript("system", "Could not transcribe patient audio for the log.");
  }

  if (payload.type === "response.output_item.done") {
    maybeHandleFunctionCall(payload.item, payload.response_id);
  }

  if (payload.type === "response.function_call_arguments.done") {
    maybeHandleFunctionCall(payload, payload.response_id);
  }

  if (payload.type === "error") {
    setAssistantSpeaking(false);
    appendTranscript("system", payload.error?.message || "Realtime API returned an error.");
  }
}

function maybeHandleFunctionCall(item, responseId) {
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
  if (item.call_id && isRealtimeChannelOpen()) {
    sendRealtimeEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: item.call_id,
        output: JSON.stringify(output)
      }
    });
    appendTranscript("system", `Tool complete: ${formatToolName(item.name)}.`);
    const spokeInThisResponse = responseId ? state.spokenResponseIds.has(responseId) : false;
    if (!output.finished && (!spokeInThisResponse || output.advancedToNextQuestion)) {
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
    return {
      ok: result.ok,
      error: result.error,
      recordedQuestionId: result.recordedQuestionId || null,
      nextQuestionId: result.nextQuestionId || null,
      advancedToNextQuestion: Boolean(result.advancedToNextQuestion),
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

  if (args.unable && question.fallbackIfUnable) {
    state.fallbackUnlocked.add(question.fallbackIfUnable);
  }

  state.responses.set(question.id, {
    questionId: question.id,
    section: question.sectionId,
    question: question.prompt.en,
    scoredBy: "model",
    score,
    maxScore: question.maxScore,
    response: String(args.response || ""),
    notes: String(args.notes || ""),
    complete: Boolean(args.complete)
  });

  appendTranscript("system", `Recorded ${question.sectionId}: ${score} / ${question.maxScore}.`);
  setAppStatus(`Recorded ${question.sectionId}.`);
  const nextQuestion = getNextIncompleteQuestion();
  if (nextQuestion) {
    setActiveQuestion(nextQuestion.id);
  }
  renderQuestionnaire();
  persistReport(args.summary || "");
  return {
    ok: true,
    recordedQuestionId: question.id,
    nextQuestionId: nextQuestion?.id || null,
    advancedToNextQuestion: Boolean(nextQuestion),
    continueInstruction: nextQuestion
      ? nextQuestionInstruction(nextQuestion.id)
      : completionFarewellInstruction
  };
}

function setActiveQuestion(questionId) {
  const question = getQuestion(questionId);
  if (!question) {
    return;
  }

  state.activeQuestionId = question.id;
  els.activeQuestionTitle.textContent = question.sectionId;
  els.activeQuestionText.textContent = question.prompt.en;
  renderModality(question);
  setAppStatus(`Active task: ${question.sectionId}.`);
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
    continueInstruction: activeQuestionInstruction(question.id)
  };
}

function renderQuestionnaire() {
  const items = administeredScoringItems();
  const itemIds = new Set(items.map((item) => item.id));
  const sections = summarizeSections(state.activeQuestionnaire?.sections, state.responses, state.activeQuestionId, itemIds)
    .filter((section) => section.itemCount > 0);
  const completeCount = sections.filter((section) => section.isComplete).length;
  const progress = sections.length ? Math.round((completeCount / sections.length) * 100) : 0;

  els.progressText.textContent = `${completeCount} of ${sections.length} sections complete`;
  els.progressFill.style.width = `${progress}%`;
  els.questionList.innerHTML = "";

  for (const section of sections) {
    const listItem = document.createElement("li");
    listItem.className = "section-card";
    listItem.style.setProperty("--section-progress", `${section.progress}%`);
    if (section.isActive) {
      listItem.classList.add("active");
    }
    if (section.isComplete) {
      listItem.classList.add("complete");
    }
    listItem.innerHTML = `
      <div>
        <h4>${escapeHtml(section.title)}</h4>
        <p>${escapeHtml(sectionStatusText(section))}</p>
      </div>
      <div class="section-metrics">
        <span class="section-progress" aria-label="${section.progress}% complete">
          <span>${section.progress}%</span>
        </span>
      </div>
    `;
    listItem.addEventListener("click", () => {
      if (state.sessionStatus !== "live" && section.nextItemId) {
        setActiveQuestion(section.nextItemId);
      }
    });
    els.questionList.append(listItem);
  }

  renderReport();
}

function sectionStatusText(section) {
  if (section.isComplete) {
    return "Complete";
  }
  if (section.isActive) {
    return `${section.completeCount} of ${section.itemCount} questions done`;
  }
  return "Pending";
}

function renderModality(questionOrCapability) {
  const question = typeof questionOrCapability === "object" ? questionOrCapability : undefined;
  const capability = question?.capability || questionOrCapability || "";
  const isCanvasTask = ["writing", "copying"].includes(capability);
  els.cameraBlock.hidden = !["camera", "reading"].includes(capability);
  els.canvasBlock.hidden = !isCanvasTask;
  els.readingBlock.hidden = capability !== "reading";
  els.copyingReference.hidden = capability !== "copying";
  renderVisualStimulus(question);
  resetTaskFeedback(capability);
  resetCanvasForNewQuestion(question, isCanvasTask);
}

function renderVisualStimulus(question) {
  const stimulus = question?.type === "object_naming" ? imageVisualStimulus(question.visualStimulus) : "";
  els.visualStimulusBlock.hidden = !stimulus;
  if (!stimulus) {
    els.visualStimulusImage.removeAttribute("src");
    els.visualStimulusImage.removeAttribute("alt");
    return;
  }

  els.visualStimulusImage.src = stimulus;
  els.visualStimulusImage.alt = question.prompt?.en || "Item to name";
}

function imageVisualStimulus(value) {
  return typeof value === "string" && value.startsWith("/images/") ? value : "";
}

function resetCanvasForNewQuestion(question, isCanvasTask) {
  if (!isCanvasTask) {
    return;
  }

  const questionId = question?.id || "";
  if (state.lastCanvasQuestionId === questionId) {
    return;
  }

  state.lastCanvasQuestionId = questionId;
  state.drawing = false;
  clearCanvas();
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
  if (!isRealtimeChannelOpen()) {
    return;
  }

  sendRealtimeEvent({
    type: "session.update",
    session: {
      instructions: focusedInstructionsFor(question)
    }
  });
}

function sendRealtimeResponse(instructions, options = {}) {
  if (!isRealtimeChannelOpen()) {
    appendTranscript("system", "Realtime connection is not ready.");
    return;
  }

  const response = {
    output_modalities: ["audio"],
    instructions: options.readinessIntroduction
      ? buildReadinessIntroductionInstructions(instructions)
      : buildResponseInstructions(instructions)
  };

  sendRealtimeEvent({
    type: "response.create",
    response
  });
}

function sendRealtimeContent(content, options = {}) {
  if (!isRealtimeChannelOpen()) {
    appendTranscript("system", "Realtime connection is not ready.");
    return;
  }

  sendRealtimeEvent({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content
    }
  });
  sendRealtimeResponse(options.instructions, options);
}

function isRealtimeChannelOpen() {
  return state.dataChannel?.readyState === "open";
}

function sendRealtimeEvent(event) {
  state.dataChannel.send(JSON.stringify(event));
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
  setAssistantSpeaking(false);
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
    version: "1.0",
    defaultLanguage: "English, Chinese",
    totalMaxScore: 0,
    globalRules: {},
    materialsRequired: [],
    sections: []
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
  els.editorLanguage.value = questionnaire?.defaultLanguage || "English, Chinese";
  els.questionEditorList.innerHTML = "";

  const sections = questionnaire?.sections || [];
  if (!sections.length) {
    const empty = document.createElement("p");
    empty.className = "editor-derived";
    empty.textContent = "No sections yet. Use \"Add section\" to create one.";
    els.questionEditorList.append(empty);
    return;
  }

  state.editorSectionPage = Math.max(0, Math.min(state.editorSectionPage, sections.length - 1));
  const sectionIndex = state.editorSectionPage;
  els.questionEditorList.append(createSectionEditor(sections[sectionIndex], sectionIndex));
}

function createSectionEditor(section, sectionIndex) {
  section.items = section.items || [];
  const wrapper = document.createElement("div");
  wrapper.className = "section-editor";
  wrapper.innerHTML = `
    <div class="section-editor-head">
      <div class="section-head-fields">
        <label>Section title
          <input data-section-field="title" value="${escapeAttribute(section.title)}">
        </label>
        <label>Section ID
          <input data-section-field="id" value="${escapeAttribute(section.id)}">
        </label>
      </div>
      <div class="section-head-actions">
        <button class="secondary" data-add-item type="button">+ Add Item</button>
        <button class="danger" data-remove-section type="button">Remove Section</button>
      </div>
    </div>
    <div class="section-items"></div>
  `;

  wrapper.addEventListener("input", (event) => {
    const field = event.target.dataset.sectionField;
    if (field) {
      state.editorQuestionnaire.sections[sectionIndex][field] = event.target.value;
    }
  });
  wrapper.querySelector("[data-remove-section]").addEventListener("click", () => {
    state.editorQuestionnaire.sections.splice(sectionIndex, 1);
    const remaining = state.editorQuestionnaire.sections.length;
    state.editorSectionPage = Math.max(0, Math.min(state.editorSectionPage, remaining - 1));
    renderEditor();
  });
  wrapper.querySelector("[data-add-item]").addEventListener("click", () => {
    section.items.push({
      id: `item-${Date.now()}`,
      type: "spoken_response",
      prompt: { en: "", zh: "" },
      maxScore: 1,
      scoring: {},
      scoringNotes: ""
    });
    renderEditor();
  });

  const itemsHost = wrapper.querySelector(".section-items");
  for (const [itemIndex, item] of section.items.entries()) {
    itemsHost.append(createItemEditor(item, sectionIndex, itemIndex));
  }

  wrapper.append(renderSectionPager(state.editorQuestionnaire.sections.length));
  return wrapper;
}

function renderSectionPager(totalSections) {
  const nav = document.createElement("div");
  nav.className = "section-pager";
  if (totalSections < 2) {
    return nav;
  }

  appendPagerControls(nav, totalSections, state.editorSectionPage, "section-page", (pageIndex) => {
    state.editorSectionPage = pageIndex;
    renderEditor();
  });
  return nav;
}

function appendPagerControls(container, pageCount, currentPage, classPrefix, onSelect) {
  container.append(createPageButton("<", currentPage - 1, currentPage === 0, classPrefix, onSelect));
  for (const pageNumber of pagerPages(pageCount, currentPage)) {
    if (pageNumber === "…") {
      const ellipsis = document.createElement("span");
      ellipsis.className = `${classPrefix}-ellipsis`;
      ellipsis.textContent = "..";
      container.append(ellipsis);
      continue;
    }

    const pageButton = createPageButton(String(pageNumber), pageNumber - 1, false, classPrefix, onSelect);
    pageButton.classList.toggle("active", pageNumber - 1 === currentPage);
    container.append(pageButton);
  }
  container.append(createPageButton(">", currentPage + 1, currentPage >= pageCount - 1, classPrefix, onSelect));
}

function createPageButton(label, pageIndex, disabled, classPrefix, onSelect) {
  const button = document.createElement("button");
  button.className = `${classPrefix}-button`;
  button.type = "button";
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", () => onSelect(pageIndex));
  return button;
}

function createItemEditor(item, sectionIndex, itemIndex) {
  const wrapper = document.createElement("div");
  wrapper.className = "question-editor";
  wrapper.innerHTML = `
    <label>Item ID
      <input data-item-field="id" value="${escapeAttribute(item.id)}">
    </label>
    <label>Type
      <select data-item-field="type">
        ${ITEM_TYPES.map((type) => `<option value="${type}" ${item.type === type ? "selected" : ""}>${type}</option>`).join("")}
      </select>
    </label>
    <label class="wide">Prompt (English)
      <textarea data-item-prompt="en" rows="2">${escapeHtml(item.prompt?.en || "")}</textarea>
    </label>
    <label class="wide">Prompt (Chinese)
      <textarea data-item-prompt="zh" rows="2">${escapeHtml(item.prompt?.zh || "")}</textarea>
    </label>
    <label>Maximum score
      <input data-item-field="maxScore" type="number" min="0" step="1" value="${escapeAttribute(item.maxScore)}">
    </label>
    <label>Expected answer
      <input data-item-expected-answer value="${escapeAttribute(item.expectedAnswer || "")}">
    </label>
    <label class="wide">Scoring notes
      <textarea data-item-scoring-notes rows="3">${escapeHtml(item.scoringNotes || "")}</textarea>
    </label>
    <div class="row-actions">
      <button class="danger" data-remove-item type="button">Remove Item</button>
    </div>
  `;

  wrapper.addEventListener("input", (event) => {
    const target = event.target;
    const section = state.editorQuestionnaire.sections[sectionIndex];
    const editing = section.items[itemIndex];
    if (target.dataset.itemField === "maxScore") {
      editing.maxScore = Number(target.value);
    } else if (target.dataset.itemField) {
      editing[target.dataset.itemField] = target.value;
    } else if (target.dataset.itemExpectedAnswer !== undefined) {
      editing.expectedAnswer = target.value;
    } else if (target.dataset.itemScoringNotes !== undefined) {
      editing.scoringNotes = target.value;
    } else if (target.dataset.itemPrompt) {
      editing.prompt = editing.prompt || {};
      editing.prompt[target.dataset.itemPrompt] = target.value;
    }
    if (target.dataset.itemField === "type") {
      renderEditor();
    }
  });
  wrapper.querySelector("[data-remove-item]").addEventListener("click", () => {
    state.editorQuestionnaire.sections[sectionIndex].items.splice(itemIndex, 1);
    renderEditor();
  });
  return wrapper;
}

function addSectionEditorRow() {
  state.editorQuestionnaire.sections.push({
    id: `section-${Date.now()}`,
    title: "New section",
    items: []
  });
  state.editorSectionPage = state.editorQuestionnaire.sections.length - 1;
  setAppStatus("Section added.");
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
    state.editorQuestionnaire.defaultLanguage = els.editorLanguage.value.trim();
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
  const items = administeredScoringItems();
  const itemIds = new Set(items.map((item) => item.id));
  const completeCount = countAnswered(items, state.responses);
  const maxScore = sumMaxScores(items);
  const score = sumScores(items, state.responses);
  els.reportTotal.textContent = `${score} / ${maxScore}`;
  els.reportStatus.textContent = state.lastReportSummary || `${completeCount} of ${items.length} items recorded.`;
  els.reportPagination.innerHTML = "";
  els.reportResponses.innerHTML = "";
  els.reportTranscript.innerHTML = "";
  renderLog();

  const page = reportPage(state.activeQuestionnaire?.sections, state.responses, itemIds, state.reportPageIndex);
  state.reportPageIndex = page.currentPage;
  renderReportPagination(page.pageCount, page.currentPage);
  if (page.section) {
    renderReportSection(page.section);
  }

  for (const entry of state.transcript) {
    els.reportTranscript.append(createUtteranceElement(entry.role, entry.text));
  }
}

function renderReportPagination(pageCount, currentPage) {
  if (!els.reportPagination || pageCount < 2) {
    return;
  }

  appendPagerControls(els.reportPagination, pageCount, currentPage, "report-page", (pageIndex) => {
    state.reportPageIndex = pageIndex;
    renderReport();
  });
}

function renderReportSection(section) {
  const heading = document.createElement("div");
  heading.className = "report-section-heading";
  heading.innerHTML = `
    <h4>${escapeHtml(section.title)}</h4>
    <strong>${section.score}/${section.maxScore}</strong>
  `;
  els.reportResponses.append(heading);

  for (const item of section.items) {
    const response = state.responses.get(item.id);
    const details = reportItemDetails(item, response);
    const row = document.createElement("div");
    row.className = "response-row";
    row.innerHTML = `
      <h5>${escapeHtml(item.prompt.en)}</h5>
      <p><strong>Scored by:</strong> ${escapeHtml(details.scoredBy)}</p>
      <p><strong>Expected Answer:</strong> ${escapeHtml(details.expectedAnswer)}</p>
      <p><strong>Patient's Answer:</strong> ${escapeHtml(details.patientAnswer)}</p>
      <p>${escapeHtml(details.aiText)}</p>
    `;
    const artifacts = state.mediaArtifacts.filter((artifact) => artifact.questionId === item.id && artifact.dataUrl);
    if (artifacts.length) {
      const label = document.createElement("p");
      label.className = "report-artifact-label";
      label.innerHTML = "<strong>Submitted image:</strong>";
      row.append(label);
    }
    for (const artifact of artifacts) {
      const image = document.createElement("img");
      image.src = artifact.dataUrl;
      image.alt = `${artifact.type} artifact for ${item.sectionId}`;
      image.className = "report-artifact";
      row.append(image);
    }
    els.reportResponses.append(row);
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

async function downloadReport() {
  const originalLabel = els.downloadReportButton.textContent;
  els.downloadReportButton.disabled = true;
  els.downloadReportButton.textContent = "Preparing...";
  try {
    const blob = await createReportPdf(buildReportDocument());
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `questionnaire-report-${new Date().toISOString().slice(0, 10)}.pdf`;
    anchor.click();
    URL.revokeObjectURL(url);
    setAppStatus("Report PDF downloaded.");
  } catch (error) {
    console.error(error);
    setAppStatus("Could not download report PDF.");
  } finally {
    els.downloadReportButton.disabled = false;
    els.downloadReportButton.textContent = originalLabel;
  }
}

function buildReportDocument() {
  const items = administeredScoringItems();
  const itemIds = new Set(items.map((item) => item.id));
  return {
    title: state.activeQuestionnaire?.title || "Questionnaire report",
    createdAt: new Date().toISOString(),
    totalScore: sumScores(items, state.responses),
    maxScore: sumMaxScores(items),
    status: state.lastReportSummary || `${countAnswered(items, state.responses)} of ${items.length} items recorded.`,
    sections: reportSections(state.activeQuestionnaire?.sections, state.responses, itemIds).map((section) => ({
      title: section.title,
      score: section.score,
      maxScore: section.maxScore,
      items: section.items.map((item) => ({
        prompt: item.prompt,
        details: reportItemDetails(item, state.responses.get(item.id)),
        artifacts: state.mediaArtifacts.filter((artifact) => artifact.questionId === item.id && artifact.dataUrl)
      }))
    })),
    transcript: state.transcript
  };
}

function buildReport() {
  return {
    questionnaire: state.activeQuestionnaire,
    status: state.sessionStatus,
    summary: state.lastReportSummary,
    responses: [...state.responses.values()],
    fallbackUnlocked: [...state.fallbackUnlocked],
    transcript: state.transcript,
    mediaArtifacts: reportMediaArtifacts(state.mediaArtifacts),
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
      state.fallbackUnlocked = new Set(report.fallbackUnlocked || []);
      state.mediaArtifacts = restoreMediaArtifacts(report.mediaArtifacts);
      renderPatientTranscript();
      renderQuestionnaire();
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
  state.spokenResponseIds = new Set();
  state.loggedInputTranscripts = new Set();
  state.sessionContext = { resolvedAnswers: {} };
  state.fallbackUnlocked = new Set();
  state.lastCanvasQuestionId = undefined;
  state.transcriptExpanded = false;
  els.transcript.innerHTML = "";
  els.activeQuestionTitle.textContent = "Not started";
  els.activeQuestionText.textContent = "Start the questionnaire when the patient is ready.";
  renderTranscriptPanel();
  setAssistantSpeaking(false);
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
  const item = createUtteranceElement(role, text);
  els.transcript.append(item);
  els.transcript.scrollTop = els.transcript.scrollHeight;
  state.transcript.push({ role, text, at: new Date().toISOString() });
  renderTranscriptPanel();
  renderReport();
  persistReport("");
  return item;
}

function createUtteranceElement(role, text) {
  const item = document.createElement("div");
  item.className = `utterance ${role}`;
  item.textContent = text;
  return item;
}

function renderPatientTranscript() {
  els.transcript.innerHTML = "";
  for (const entry of state.transcript) {
    els.transcript.append(createUtteranceElement(entry.role, entry.text));
  }
  renderTranscriptPanel();
}

function navigate(path) {
  history.pushState({}, "", path);
  renderRoute();
}

function renderRoute() {
  const route = viewForPath(location.pathname);
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

function allItems() {
  return (state.activeQuestionnaire?.sections || []).flatMap((section) => section.items);
}

function isLocked(item) {
  return Boolean(item.administerOnlyIf) && !state.fallbackUnlocked.has(item.id);
}

function isFallbackSourceReplaced(item) {
  return Boolean(item.fallbackIfUnable) && state.fallbackUnlocked.has(item.fallbackIfUnable);
}

function administeredScoringItems() {
  return allItems().filter((item) => !isLocked(item) && !isFallbackSourceReplaced(item));
}

function getQuestion(questionId) {
  return allItems().find((item) => item.id === questionId);
}

function getNextIncompleteQuestion() {
  return allItems().find((item) => !isLocked(item) && !state.responses.has(item.id));
}

function getSequenceCorrectionInstruction() {
  const nextQuestion = getNextIncompleteQuestion();
  if (!nextQuestion) {
    return completionFarewellInstruction;
  }

  return sequenceCorrectionInstruction(nextQuestion.id);
}

function progressSnapshot() {
  const items = administeredScoringItems();
  return {
    completed: countAnswered(items, state.responses),
    total: items.length,
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
  const focusedInstructions = question ? focusedInstructionsFor(question) : activeSectionReinforcement;
  return [
    focusedInstructions,
    "",
    activeSectionReinforcement,
    instructions ? `Current turn instruction: ${instructions}` : ""
  ].filter(Boolean).join("\n");
}

function focusedInstructionsFor(question) {
  const items = administeredScoringItems();
  return buildFocusedInstructions(question, {
    questionnaire: state.activeQuestionnaire,
    completedCount: countAnswered(items, state.responses),
    totalCount: items.length,
    resolvedAnswers: state.sessionContext?.resolvedAnswers
  });
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
