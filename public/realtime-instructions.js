// Model-facing instruction text for the Realtime session. Behaviour rules here
// must stay in sync with prompts/questionnaire-realtime.md.

export const activeSectionReinforcement = "Use only the active section in the current session instructions; do not ask or score any other section.";

export const completionFarewellInstruction = [
  "All questions are recorded.",
  "Thank the patient warmly for being cooperative, offer brief encouragement, and say goodbye.",
  "Tell the patient they may end the call using the on-screen End call button.",
  "Do not call any tool after the farewell."
].join(" ");

export const readinessStartInstruction = [
  "Start the call with the patient readiness introduction only.",
  "Do not ask, preview, score, or mention the first questionnaire item yet.",
  "After the patient responds that they are ready, continue with the active question using the latest session instructions."
].join(" ");

export function nextQuestionInstruction(questionId) {
  return `The active question has been updated to questionId "${questionId}". Immediately begin guiding the patient through this active question using the current session instructions. Do not stop after a transition phrase or wait for patient confirmation before asking the question.`;
}

export function activeQuestionInstruction(questionId) {
  return `The active question is "${questionId}". Ask only the active section from the current session instructions until it is recorded.`;
}

export function sequenceCorrectionInstruction(questionId) {
  return `The next required question is questionId "${questionId}". Ask only the active section from the current session instructions, and do not repeat any completed question.`;
}

export function buildReadinessIntroductionInstructions(instructions) {
  return [
    "You are a clinical questionnaire assistant starting a medical screening questionnaire by voice.",
    "Begin with a warm, genuine, patient-friendly welcome.",
    "Briefly explain that you will guide the patient through the questionnaire one question at a time and record their answers for the clinical team.",
    "Ask whether the patient is ready to begin.",
    "Stop after asking whether the patient is ready.",
    "Do not ask, preview, score, or mention any questionnaire item yet.",
    "Do not call set_active_question or record_question_result during this readiness introduction.",
    instructions ? `Current turn instruction: ${instructions}` : ""
  ].filter(Boolean).join("\n");
}

// Exposes only the active item to the model; the client UI owns question order.
export function buildFocusedInstructions(question, { questionnaire, completedCount, totalCount, resolvedAnswers }) {
  const objectNamingInstructions = question?.type === "object_naming" ? [
    "For this object-naming item, ask the patient to look at the image on screen and tell you what the item is.",
    "Do not say accepted answers, expected answers, object labels, filenames, material names, or scoring examples aloud.",
    "Use answer-bearing metadata only after the patient responds, and only for scoring."
  ] : [];
  return [
    "You are a clinical questionnaire assistant administering a medical screening questionnaire by voice.",
    "You are not diagnosing, treating, or giving medical advice.",
    "The client UI is the source of truth for questionnaire order and active section.",
    "Administer exactly one active item at a time.",
    activeSectionReinforcement,
    "Do not mention, preview, combine, ask, score, or infer any other questionnaire item.",
    "If the patient discusses another item, briefly redirect to the active item.",
    "Personalize phrasing to the patient context if provided, but do not change the scoring requirement.",
    "Ask the patient all aspects needed from the active item to fully assess it.",
    "Avoid spoonfeeding the patient with the examples.",
    "Do not move on until the current answer is complete enough to score.",
    "Ask focused follow-ups only for the active item.",
    "For observation, reading, writing, and copying tasks, instruct the patient to use the on-screen camera or canvas controls when relevant.",
    "If the patient asks to stop or end the call, respond empathetically, say you understand, say goodbye, and tell them they may use the on-screen End call button.",
    "Call set_active_question before asking the active question if it has not already been set.",
    "Call record_question_result only when the active item is complete enough to score.",
    "Assign the numeric score yourself using the active item's scoring notes, expected answer, accepted answers, target items, expected sequence, and observed media when available. Never exceed the item maximum score.",
    "Include brief clinician notes explaining the score.",
    "Include the exact response or behavior you relied on when available.",
    "If media was required, mention whether the camera or canvas artifact was reviewed.",
    ...objectNamingInstructions,
    "",
    `Selected questionnaire: ${questionnaire?.title || ""}`,
    `Questionnaire ID: ${questionnaire?.id || ""}`,
    `Completed count: ${completedCount} of ${totalCount}`,
    "Active item JSON:",
    JSON.stringify(focusedItemPayload(question, questionnaire, resolvedAnswers))
  ].join("\n");
}

export function focusedItemPayload(item, questionnaire, resolvedAnswers) {
  const section = (questionnaire?.sections || []).find((entry) => entry.id === item.sectionId);
  const isObjectNaming = item.type === "object_naming";
  const payload = {
    questionId: item.id,
    section: section?.title || item.sectionId,
    type: item.type,
    prompt: isObjectNaming
      ? { ...item.prompt, en: "Please look at the image on screen and tell me what this item is." }
      : item.prompt,
    maxScore: item.maxScore,
    capability: item.capability,
    scoringNotes: isObjectNaming
      ? "Ask the patient to name the visible item without naming it for them. After the patient responds, score against scoringOnlyAcceptedAnswers."
      : item.scoringNotes || ""
  };
  const resolvedAnswer = resolvedAnswers?.[item.id];
  if (resolvedAnswer !== undefined) {
    payload.resolvedExpectedAnswer = resolvedAnswer;
  }
  if (item.expectedAnswer !== undefined) {
    payload.expectedAnswer = item.expectedAnswer;
  }
  if (item.expectedSequence !== undefined) {
    payload.expectedSequence = item.expectedSequence;
  }
  if (item.targetItems !== undefined) {
    payload.targetItems = item.targetItems;
  }
  if (item.acceptedAnswers !== undefined && isObjectNaming) {
    payload.scoringOnlyAcceptedAnswers = item.acceptedAnswers;
  } else if (item.acceptedAnswers !== undefined) {
    payload.acceptedAnswers = item.acceptedAnswers;
  }
  if (item.observableSteps !== undefined) {
    payload.observableSteps = item.observableSteps;
  }
  if (item.visualStimulus !== undefined && !isObjectNaming) {
    payload.visualStimulus = item.visualStimulus;
  }
  if (item.administerOnlyIf) {
    payload.administerOnlyIf = item.administerOnlyIf;
  }
  if (item.fallbackIfUnable) {
    payload.fallbackIfUnable = item.fallbackIfUnable;
  }
  if (item.postItemInstruction) {
    payload.postItemInstruction = item.postItemInstruction;
  }
  if (item.requiresMaterials !== undefined && !isObjectNaming) {
    payload.requiresMaterials = item.requiresMaterials;
  }
  return payload;
}
