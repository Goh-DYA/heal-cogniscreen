const CAPABILITY_BY_TYPE = {
  physical_command: "camera",
  written_instruction_response: "reading",
  drawing_copy: "copying",
  written_response: "writing"
};

const CODE_SCORING_TYPES = new Set([
  "context_match",
  "session_context_match",
  "count_correct_items_first_trial",
  "count_correct_sequence_items",
  "letters_in_correct_order",
  "count_correct_recalled_items"
]);

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function deriveCapability(type) {
  return CAPABILITY_BY_TYPE[type] || "voice";
}

export function deriveScoringMode(scoringType) {
  return CODE_SCORING_TYPES.has(scoringType) ? "code" : "model";
}

export function hasExpectedAnswer(item) {
  const value = item?.expectedAnswer;
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function questionnaireIdentity(questionnaire) {
  return questionnaire?.id || questionnaire?.questionnaire_id;
}

export function questionnaireById(questionnaires, questionnaireId) {
  return (questionnaires || []).find((item) => questionnaireIdentity(item) === questionnaireId) || questionnaires?.[0];
}

export function replaceQuestionnaire(questionnaires, questionnaire) {
  const questionnaireId = questionnaireIdentity(questionnaire);
  const existingIndex = (questionnaires || []).findIndex((item) => questionnaireIdentity(item) === questionnaireId);
  if (existingIndex < 0) {
    return [...(questionnaires || []), questionnaire];
  }

  return (questionnaires || []).map((item, index) => index === existingIndex ? questionnaire : item);
}

export function normalizeItem(rawItem, sectionId) {
  const scoring = rawItem.scoring || {};
  return {
    source: cloneJson(rawItem),
    id: String(rawItem.id),
    sectionId,
    type: String(rawItem.type || ""),
    capability: deriveCapability(rawItem.type),
    prompt: {
      en: String(rawItem.prompt?.en || ""),
      zh: String(rawItem.prompt?.zh || "")
    },
    maxScore: Number(rawItem.max_score || 0),
    scoring: { ...scoring, mode: deriveScoringMode(scoring.type) },
    targetItems: rawItem.target_items,
    targetItemsFrom: rawItem.target_items_from,
    expectedSequence: rawItem.expected_sequence,
    stopAfterResponses: rawItem.stop_after_responses,
    acceptedAnswers: scoring.accepted_answers,
    expectedAnswer: rawItem.expected_answer ?? scoring.expected_answer,
    observableSteps: rawItem.observable_steps,
    visualStimulus: rawItem.visual_stimulus,
    administerOnlyIf: rawItem.administer_only_if,
    fallbackIfUnable: rawItem.fallback_if_unable,
    postItemInstruction: rawItem.post_item_instruction,
    requiresMaterials: rawItem.requires_materials
  };
}

export function normalizeQuestionnaire(raw) {
  const sections = (raw.sections || []).map((section) => {
    const items = (section.items || []).map((item) => normalizeItem(item, section.id));
    return {
      id: String(section.id),
      title: String(section.title || ""),
      maxScore: items.reduce((sum, item) => sum + item.maxScore, 0),
      items
    };
  });

  return {
    id: String(raw.questionnaire_id || raw.id || "questionnaire"),
    title: String(raw.title || "Untitled questionnaire"),
    version: String(raw.version || ""),
    defaultLanguage: String(raw.default_language || ""),
    totalMaxScore: Number(raw.total_max_score || sections.reduce((s, sec) => s + sec.maxScore, 0)),
    globalRules: raw.global_rules || {},
    materialsRequired: raw.materials_required || [],
    sections
  };
}
