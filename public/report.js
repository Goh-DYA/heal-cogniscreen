export function codeEvidenceLines(response) {
  if (response?.scoredBy !== "code") {
    return [];
  }

  return [
    ["Extracted answer", response.extracted],
    ["Matched against", response.matchedAgainst]
  ]
    .filter(([, value]) => hasReportValue(value))
    .map(([label, value]) => ({ label, value: formatReportValue(value) }));
}

export function reportPage(sections, responses, itemIds, pageIndex) {
  const visibleSections = (sections || [])
    .map((section) => {
      const items = (section.items || []).filter((item) => itemIds.has(item.id));
      return {
        title: section.title || section.id,
        score: scoreItems(items, responses),
        maxScore: maxScoreItems(items),
        items
      };
    })
    .filter((section) => section.items.length > 0);
  const pageCount = visibleSections.length;
  const currentPage = pageCount ? Math.min(Math.max(Number(pageIndex) || 0, 0), pageCount - 1) : 0;

  return {
    currentPage,
    pageCount,
    section: visibleSections[currentPage]
  };
}

export function reportItemDetails(item, response) {
  const extractedAnswer = formatOptionalValue(response?.extracted);
  const expectedAnswer = formatOptionalValue(response?.matchedAgainst ?? item.expectedAnswer ?? item.expectedSequence ?? item.targetItems);

  return {
    scoredBy: scoredByLabel(response?.scoredBy),
    patientAnswer: response?.response || "No response recorded.",
    extractedAnswer,
    expectedAnswer,
    aiText: response?.notes || fallbackAiText(extractedAnswer, expectedAnswer)
  };
}

export function reportMediaArtifacts(mediaArtifacts) {
  return (mediaArtifacts || []).map((artifact) => ({
    ...artifact,
    hasImageData: Boolean(artifact.dataUrl)
  }));
}

export function restoreMediaArtifacts(mediaArtifacts) {
  return (mediaArtifacts || []).filter((artifact) => Boolean(artifact.dataUrl));
}

export function pagerPages(pageCount, currentPage) {
  if (pageCount <= 0) {
    return [];
  }
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const activePage = Math.min(Math.max(Number(currentPage) + 1 || 1, 1), pageCount);
  if (activePage <= 4) {
    return [1, 2, 3, 4, 5, "…", pageCount];
  }
  if (activePage >= pageCount - 3) {
    return [1, "…", pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount];
  }
  return [1, "…", activePage - 1, activePage, activePage + 1, "…", pageCount];
}

function hasReportValue(value) {
  return value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);
}

function formatOptionalValue(value) {
  return hasReportValue(value) ? formatReportValue(value) : "-";
}

function formatReportValue(value) {
  if (Array.isArray(value)) {
    return value.map(formatReportValue).join(", ");
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).filter(Boolean).join(" / ");
  }
  return String(value);
}

function scoreItems(items, responses) {
  return items.reduce((sum, item) => sum + Number(responses.get(item.id)?.score || 0), 0);
}

function maxScoreItems(items) {
  return items.reduce((sum, item) => sum + Number(item.maxScore || 0), 0);
}

function scoredByLabel(scoredBy) {
  if (scoredBy === "code") {
    return "Code";
  }
  if (scoredBy === "model") {
    return "Model";
  }
  return "-";
}

function fallbackAiText(extractedAnswer, expectedAnswer) {
  if (extractedAnswer !== "-" || expectedAnswer !== "-") {
    return "Generated scoring evidence is available above for clinician review.";
  }
  return "No AI-generated scoring note was recorded for this item.";
}
