/**
 * autoMapColumns: suggests a schema column for each imported file header
 * (see plan "Task 6").
 */
import { isImportable } from "../internal/access";
import type { Access, ColumnDef, GridSchema } from "../internal/core";
import { columnsOf } from "../internal/core";
import { isAbbreviation, levenshtein, normalizeLabel, tokenize } from "./normalize";
import type { ColumnMapping } from "./types";

export interface AutoMapColumnsOptions {
  /** Minimum score for a candidate to be considered. Default 0.6. */
  minConfidence?: number;
}

/**
 * Score of one header word against one column word:
 * 1 equal; near-miss (edit distance 1, both ≥ 5 chars, same first letter)
 * scaled by length and capped at 0.9; the HEADER word abbreviating the column
 * word (same first and last letter, letters in order) 0.8, or 0.7 for a
 * 3-letter abbreviation.
 */
function wordScore(headerWord: string, candidateWord: string): number {
  if (headerWord === candidateWord) return 1;
  const maxLen = Math.max(headerWord.length, candidateWord.length);
  if (
    headerWord.length >= 5 &&
    candidateWord.length >= 5 &&
    headerWord[0] === candidateWord[0] &&
    levenshtein(headerWord, candidateWord, 1) <= 1
  ) {
    return Math.min(0.9, 0.95 * (1 - 1 / maxLen));
  }
  if (
    headerWord.length < candidateWord.length &&
    headerWord[headerWord.length - 1] === candidateWord[candidateWord.length - 1] &&
    isAbbreviation(headerWord, candidateWord)
  ) {
    return headerWord.length === 3 ? 0.7 : 0.8;
  }
  return 0;
}

/**
 * Pairs header words with column words one-to-one (each column word used at
 * most once), then scores average-of-pairs × coverage, capped at 0.9.
 */
function wordByWordScore(headerTokens: string[], candidateTokens: string[]): number {
  if (headerTokens.length === 0 || candidateTokens.length === 0) return 0;
  const used = new Set<number>();
  let matched = 0;
  let sumBest = 0;
  for (const hWord of headerTokens) {
    let best = 0;
    let bestIdx = -1;
    candidateTokens.forEach((cWord, idx) => {
      if (used.has(idx)) return;
      const s = wordScore(hWord, cWord);
      if (s > best) {
        best = s;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) {
      used.add(bestIdx);
      matched += 1;
      sumBest += best;
    }
  }
  if (matched === 0) return 0;
  const avg = sumBest / matched;
  const coverage = matched / Math.max(headerTokens.length, candidateTokens.length);
  return Math.min(0.9, avg * coverage);
}

/** Best score of `header` against one candidate string (a label or a key). */
function scoreHeaderAgainstString(
  headerNorm: string,
  headerTokens: string[],
  candidate: string,
): number {
  const candidateNorm = normalizeLabel(candidate);
  if (headerNorm.length > 0 && headerNorm === candidateNorm) return 1;

  let best = 0;
  const shorterLen = Math.min(headerNorm.length, candidateNorm.length);
  if (shorterLen >= 4) {
    const maxLen = Math.max(headerNorm.length, candidateNorm.length);
    // Two edits only on long strings (on 6–7 letters d=2 confuses real
    // headers: "Status"/"State", "Course"/"Source"); one edit needs ≥ 5
    // letters ("Data"/"Date").
    const allowed = maxLen >= 8 ? 2 : maxLen >= 5 ? 1 : 0;
    const d = levenshtein(headerNorm, candidateNorm, allowed);
    if (allowed > 0 && d <= allowed) {
      best = Math.max(best, 0.95 * (1 - d / maxLen));
    }
  }

  const candidateTokens = tokenize(candidate);
  best = Math.max(best, wordByWordScore(headerTokens, candidateTokens));

  return best;
}

interface Candidate {
  headerIndex: number;
  columnIndex: number;
  score: number;
}

/**
 * Suggests a schema column for each header. Hidden, read-only, and formula
 * columns are never candidates. Assignment is globally greedy: the highest
 * scoring (header, column) pairs win, one header per column and vice versa.
 */
export function autoMapColumns(
  headers: string[],
  schema: GridSchema | ColumnDef[],
  access: ReadonlyMap<string, Access>,
  opts: AutoMapColumnsOptions = {},
): ColumnMapping[] {
  const minConfidence = opts.minConfidence ?? 0.6;
  const columns = columnsOf(schema).filter((c) => isImportable(c, access));

  const headerNorms = headers.map((h) => normalizeLabel(h));
  const headerToks = headers.map((h) => tokenize(h));

  const candidates: Candidate[] = [];
  for (let headerIndex = 0; headerIndex < headers.length; headerIndex++) {
    const hNorm = headerNorms[headerIndex] ?? "";
    const hToks = headerToks[headerIndex] ?? [];
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
      const column = columns[columnIndex];
      if (!column) continue;
      const scoreLabel = scoreHeaderAgainstString(hNorm, hToks, column.label);
      const scoreKey = scoreHeaderAgainstString(hNorm, hToks, column.key);
      const score = Math.max(scoreLabel, scoreKey);
      if (score > 0 && score >= minConfidence) {
        candidates.push({ headerIndex, columnIndex, score });
      }
    }
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.headerIndex !== b.headerIndex) return a.headerIndex - b.headerIndex;
    return a.columnIndex - b.columnIndex;
  });

  const result: ColumnMapping[] = headers.map((header, headerIndex) => ({
    header,
    headerIndex,
    columnId: null,
    confidence: 0,
  }));

  const takenHeaders = new Set<number>();
  const takenColumns = new Set<number>();

  for (const candidate of candidates) {
    if (takenHeaders.has(candidate.headerIndex) || takenColumns.has(candidate.columnIndex)) {
      continue;
    }
    const column = columns[candidate.columnIndex];
    if (!column) continue;
    takenHeaders.add(candidate.headerIndex);
    takenColumns.add(candidate.columnIndex);
    result[candidate.headerIndex] = {
      header: headers[candidate.headerIndex] ?? "",
      headerIndex: candidate.headerIndex,
      columnId: column.id,
      confidence: candidate.score,
    };
  }

  return result;
}
