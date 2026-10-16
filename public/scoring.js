export function sumScores(items, responses) {
  return items.reduce((sum, item) => sum + Number(responses.get(item.id)?.score || 0), 0);
}

export function sumMaxScores(items) {
  return items.reduce((sum, item) => sum + Number(item.maxScore || 0), 0);
}

export function countAnswered(items, responses) {
  return items.filter((item) => responses.has(item.id)).length;
}
