const EN_NUMBER_WORDS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000
};

const EN_YEAR_PREFIX_WORDS = new Set(["nineteen", "twenty"]);
const EN_TENS_WORDS = new Set(["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]);
const EN_TEEN_WORDS = new Set([
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen"
]);
const ZH_DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function isEnglishNumberWord(token) {
  return Object.prototype.hasOwnProperty.call(EN_NUMBER_WORDS, token);
}

function parseEnglishNumberWords(tokens) {
  let total = 0;
  let current = 0;

  for (const token of tokens) {
    const value = EN_NUMBER_WORDS[token];

    if (value === 100) {
      current = (current || 1) * value;
    } else if (value === 1000) {
      total += (current || 1) * value;
      current = 0;
    } else {
      current += value;
    }
  }

  return total + current;
}

function formatEnglishNumberWords(tokens) {
  const first = tokens[0];
  const second = tokens[1];
  const canReadAsYear =
    tokens.length >= 2 &&
    EN_YEAR_PREFIX_WORDS.has(first) &&
    (EN_TENS_WORDS.has(second) || EN_TEEN_WORDS.has(second));

  if (canReadAsYear) {
    return `${EN_NUMBER_WORDS[first]}${String(parseEnglishNumberWords(tokens.slice(1))).padStart(2, "0")}`;
  }

  return String(parseEnglishNumberWords(tokens));
}

function collapseEnglishNumberWords(text) {
  const tokens = text.split(/\s+/);
  const out = [];
  let numberTokens = [];

  for (const token of tokens) {
    if (isEnglishNumberWord(token)) {
      numberTokens.push(token);
    } else {
      if (numberTokens.length > 0) {
        out.push(formatEnglishNumberWords(numberTokens));
        numberTokens = [];
      }
      out.push(token);
    }
  }

  if (numberTokens.length > 0) {
    out.push(formatEnglishNumberWords(numberTokens));
  }

  return out.join(" ");
}

function collapseChineseDigits(text) {
  let result = "";
  for (const char of text) {
    result += Object.prototype.hasOwnProperty.call(ZH_DIGITS, char) ? String(ZH_DIGITS[char]) : char;
  }
  return result;
}

export function normalizeAnswer(value) {
  let text = String(value ?? "").toLowerCase().trim();
  text = collapseChineseDigits(text);
  text = text.replace(/[.,!?;:'"“”‘’。，！？、]/g, "");
  text = text.replace(/-/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  text = collapseEnglishNumberWords(text);
  return text.replace(/\s+/g, " ").trim();
}

export function matchesAny(candidate, accepted) {
  const normalizedCandidate = normalizeAnswer(candidate);
  return (accepted || []).some((option) => {
    const normalizedOption = normalizeAnswer(option);
    return normalizedOption.length > 0 && normalizedCandidate.includes(normalizedOption);
  });
}

function matchesExact(candidate, accepted) {
  const normalizedCandidate = normalizeAnswer(candidate);
  return (accepted || []).some((option) => {
    const normalizedOption = normalizeAnswer(option);
    return normalizedOption.length > 0 && normalizedCandidate === normalizedOption;
  });
}

function matchesSeason(candidate, accepted) {
  const normalizedCandidate = normalizeAnswer(candidate);
  const candidateTokens = new Set(normalizedCandidate.split(/\s+/).filter(Boolean));
  const seasonTokens = new Set(["wet", "dry", "monsoon"]);
  const acceptedTokens = new Set(
    (accepted || [])
      .flatMap((option) => normalizeAnswer(option).split(/\s+/))
      .filter((token) => seasonTokens.has(token))
  );

  return matchesExact(candidate, accepted) || [...candidateTokens].some((token) => acceptedTokens.has(token));
}

function targetLabels(target) {
  if (typeof target === "string") {
    return [target];
  }
  return [target.en, target.zh].filter(Boolean);
}

function countMatchedTargets(spoken, targets) {
  const said = (spoken || []).map((entry) => normalizeAnswer(entry)).filter(Boolean);
  let count = 0;
  for (const target of targets) {
    const labels = targetLabels(target).map((label) => normalizeAnswer(label)).filter(Boolean);
    if (labels.some((label) => said.some((s) => s.includes(label)))) {
      count += 1;
    }
  }
  return count;
}

export function scoreItem(item, extracted, context) {
  const resolved = context?.resolvedAnswers?.[item.id];
  const type = item.scoring?.type;

  if (type === "context_match") {
    const accepted = Array.isArray(resolved) ? resolved : [resolved];
    const matches = item.id === "time_season"
      ? matchesSeason(extracted, accepted)
      : matchesExact(extracted, accepted);
    return matches ? item.maxScore : 0;
  }

  if (type === "session_context_match") {
    return matchesAny(extracted, [resolved]) ? item.maxScore : 0;
  }

  if (type === "letters_in_correct_order") {
    const expected = normalizeAnswer(item.expectedAnswer).replace(/\s+/g, "");
    const actual = normalizeAnswer(extracted).replace(/\s+/g, "");
    let count = 0;
    for (let i = 0; i < expected.length; i += 1) {
      if (actual[i] === expected[i]) {
        count += 1;
      }
    }
    return Math.min(count, item.maxScore);
  }

  if (type === "count_correct_sequence_items") {
    const expected = item.expectedSequence || [];
    const actual = Array.isArray(extracted) ? extracted : [];
    let count = 0;
    for (let i = 0; i < expected.length; i += 1) {
      if (Number(actual[i]) === Number(expected[i])) {
        count += 1;
      }
    }
    return Math.min(count, item.maxScore);
  }

  if (type === "count_correct_items_first_trial") {
    return Math.min(countMatchedTargets(extracted, item.targetItems || []), item.maxScore);
  }

  if (type === "count_correct_recalled_items") {
    const targets = Array.isArray(resolved) ? resolved : (item.targetItems || []);
    return Math.min(countMatchedTargets(extracted, targets), item.maxScore);
  }

  return 0;
}
