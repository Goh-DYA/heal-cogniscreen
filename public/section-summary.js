export function summarizeSections(sections, responses, activeQuestionId) {
  return (sections || []).map((section) => {
    const items = section.items || [];
    const completeCount = items.filter((item) => responses.has(item.id)).length;
    const itemCount = items.length;
    const score = items.reduce((sum, item) => sum + Number(responses.get(item.id)?.score || 0), 0);
    const maxScore = items.reduce((sum, item) => sum + Number(item.maxScore || 0), 0);
    const nextItem = items.find((item) => !responses.has(item.id)) || items[0];

    return {
      id: section.id,
      title: section.title || section.id,
      items,
      completeCount,
      itemCount,
      score,
      maxScore,
      progress: itemCount ? Math.round((completeCount / itemCount) * 100) : 0,
      isActive: items.some((item) => item.id === activeQuestionId),
      isComplete: itemCount > 0 && completeCount === itemCount,
      nextItemId: nextItem?.id
    };
  });
}
