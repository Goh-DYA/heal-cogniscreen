const CAPABILITY_BY_TYPE = {
  physical_command: "camera",
  written_instruction_response: "reading",
  drawing_copy: "copying",
  written_response: "writing"
};

export const ITEM_TYPES = [
  "spoken_response", "spoken_memory_encoding", "spoken_memory_recall",
  "spoken_calculation_sequence", "spoken_spelling", "object_naming",
  "spoken_repetition", "physical_command", "written_instruction_response",
  "written_response", "drawing_copy"
];

export function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function deriveCapability(type) {
  return CAPABILITY_BY_TYPE[type] || "voice";
}

export function normalizeItem(rawItem, sectionId) {
  const scoring = rawItem.scoring || {};
  const normalizedScoring = { ...scoring };
  delete normalizedScoring.type;
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
    scoring: normalizedScoring,
    scoringNotes: String(rawItem.scoringNotes || ""),
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
