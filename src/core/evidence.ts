export function compactEvidenceLine(text: string, terms: string[] = [], maxLength = 96): string {
  const normalizedTerms = terms.map(normalizeTerm).filter((term) => term.length >= 2);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const selected = bestEvidenceLine(lines, normalizedTerms);
  return truncateSingleLine(selected.replace(/\s+/gu, " "), maxLength);
}

function bestEvidenceLine(lines: string[], normalizedTerms: string[]): string {
  let bestLine = lines[0] ?? "";
  let bestScore = 0;
  for (const line of lines) {
    const normalizedLine = normalizeTerm(line);
    const score = normalizedTerms.filter((term) => normalizedLine.includes(term)).length;
    if (score > bestScore || (score === bestScore && isBetterEvidenceLine(line, bestLine))) {
      bestLine = line;
      bestScore = score;
    }
  }
  return bestLine;
}

function isBetterEvidenceLine(candidate: string, current: string): boolean {
  if (isSignatureLine(current) && !isSignatureLine(candidate)) {
    return true;
  }
  return false;
}

function isSignatureLine(line: string): boolean {
  return /^(?:async\s+def|def|class)\s/u.test(line);
}

function truncateSingleLine(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeTerm(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.\/]+/g, " ")
    .toLowerCase();
}
