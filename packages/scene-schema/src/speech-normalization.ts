import { z } from "zod";
export const SpeechNormalizationSchema = z.object({ version: z.literal("speech-v1"), language: z.string(), original: z.string().min(1), speech: z.string().min(1),
  segments: z.array(z.object({ originalStart: z.number().int().nonnegative(), originalEnd: z.number().int().positive(), speechStart: z.number().int().nonnegative(), speechEnd: z.number().int().positive() })) }).superRefine((value, ctx) => {
    let original = 0; let speech = 0;
    for (const segment of value.segments) {
      if (segment.originalStart !== original || segment.speechStart !== speech || segment.originalEnd <= original || segment.speechEnd <= speech) ctx.addIssue({ code: "custom", message: "SPEECH_POSITION_COVERAGE_INVALID" });
      original = segment.originalEnd; speech = segment.speechEnd;
    }
    if (original !== value.original.length || speech !== value.speech.length) ctx.addIssue({ code: "custom", message: "SPEECH_POSITION_COVERAGE_INVALID" });
  });
export type SpeechNormalization = z.infer<typeof SpeechNormalizationSchema>;
const englishSmall = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const englishNumber = (n: number): string => n < 20 ? englishSmall[n]! : n < 100 ? ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"][Math.floor(n / 10)]! + (n % 10 ? ` ${englishSmall[n % 10]}` : "") : `${englishSmall[Math.floor(n / 100)]} hundred${n % 100 ? ` ${englishNumber(n % 100)}` : ""}`;
function integer(raw: string, ko: boolean): string {
  const digits = raw.replace(/^0+(?=\d)/, "");
  if (digits.length > 15) return [...digits].map((digit) => ko ? "영일이삼사오육칠팔구"[Number(digit)] : englishSmall[Number(digit)]).join(ko ? "" : " ");
  if (ko) {
    if (Number(digits) === 0) return "영";
    const groups: string[] = []; let remaining = digits;
    while (remaining.length) { groups.unshift(remaining.slice(-4)); remaining = remaining.slice(0, -4); }
    return groups.map((group, index) => {
      const chars = group.padStart(4, "0"); const spoken = [...chars].map((char, place) => Number(char) ? `${char === "1" && place < 3 ? "" : "영일이삼사오육칠팔구"[Number(char)]}${["천", "백", "십", ""][place]}` : "").join("");
      return spoken ? `${spoken}${["", "만", "억", "조"][groups.length - index - 1] ?? ""}` : "";
    }).join("");
  }
  const groups: string[] = []; let remaining = digits;
  while (remaining.length) { groups.unshift(remaining.slice(-3)); remaining = remaining.slice(0, -3); }
  return groups.map((group, index) => Number(group) ? `${englishNumber(Number(group))}${["", " thousand", " million", " billion", " trillion"][groups.length - index - 1] ?? ""}` : "").filter(Boolean).join(" ") || "zero";
}
const units: Record<string, [string, string]> = { km: ["킬로미터", "kilometers"], cm: ["센티미터", "centimeters"], mm: ["밀리미터", "millimeters"], m: ["미터", "meters"], kg: ["킬로그램", "kilograms"], g: ["그램", "grams"], "%": ["퍼센트", "percent"], "°C": ["도씨", "degrees Celsius"], USD: ["달러", "US dollars"], KRW: ["원", "won"] };
export function normalizeNarration(original: string, language: string, pronunciations: Readonly<Record<string, string>> = {}): SpeechNormalization {
  if (!original.trim()) throw new Error("NARRATION_EMPTY");
  const ko = /^ko/i.test(language); const dictionary: Record<string, string> = { ...(ko ? { NASA: "나사", AI: "에이아이", API: "에이피아이", IT: "아이티", SNS: "에스엔에스", OpenAI: "오픈에이아이" } : {}), ...pronunciations };
  const custom = Object.keys(dictionary).sort((a, b) => b.length - a.length).map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const numericPattern = ko || /^en/i.test(language) ? "\\d{4}-\\d{1,2}-\\d{1,2}|(?:[$₩€]\\s*)?-?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?(?:\\s?(?:km|cm|mm|kg|USD|KRW|°C|m|g|%)(?![A-Za-z]))?" : "(?!)";
  const pattern = new RegExp(`${numericPattern}${custom.length ? `|(?<![A-Za-z])(?:${custom.join("|")})(?![A-Za-z])` : ""}`, "gu");
  const result: SpeechNormalization = { version: "speech-v1", language, original, speech: "", segments: [] };
  const append = (start: number, end: number, speech: string) => { const offset = result.speech.length; result.speech += speech; result.segments.push({ originalStart: start, originalEnd: end, speechStart: offset, speechEnd: result.speech.length }); };
  const plain = (start: number, end: number) => { for (const match of original.slice(start, end).matchAll(/\S+|\s+/gu)) append(start + match.index, start + match.index + match[0].length, match[0]); };
  let cursor = 0;
  for (const match of original.matchAll(pattern)) {
    plain(cursor, match.index); const token = match[0]; let speech = dictionary[token];
    if (!speech && /^\d{4}-\d{1,2}-\d{1,2}$/u.test(token)) {
      const [year = "", month = "", day = ""] = token.split("-");
      const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) throw new Error("NARRATION_DATE_INVALID");
      speech = ko ? `${integer(year, true)}년 ${integer(month, true)}월 ${integer(day, true)}일` : `${new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(date)} ${integer(day, false)} ${integer(year, false)}`;
    }
    if (!speech) {
      const numeric = /^([$₩€])?\s*(-?)([\d,]+)(?:\.(\d+))?\s*(.*)$/u.exec(token);
      if (!numeric) throw new Error("NARRATION_NORMALIZATION_UNSUPPORTED");
      speech = `${numeric[2] ? ko ? "마이너스 " : "minus " : ""}${integer(numeric[3]!.replaceAll(",", ""), ko)}${numeric[4] ? `${ko ? "점" : " point "}${[...numeric[4]].map((digit) => ko ? "영일이삼사오육칠팔구"[Number(digit)] : englishSmall[Number(digit)]).join(ko ? "" : " ")}` : ""}`;
      const unit = units[numeric[5] ?? ""]?.[ko ? 0 : 1] ?? (numeric[1] === "$" ? ko ? "달러" : "dollars" : numeric[1] === "₩" ? ko ? "원" : "won" : numeric[1] === "€" ? ko ? "유로" : "euros" : "");
      if (unit) speech += `${ko ? "" : " "}${unit}`;
    }
    append(match.index, match.index + token.length, speech); cursor = match.index + token.length;
  }
  plain(cursor, original.length); return SpeechNormalizationSchema.parse(result);
}

export function displayTimingsFromSpeech(normalization: SpeechNormalization, timings: readonly { text: string; startSeconds: number; endSeconds: number }[]) {
  let cursor = 0;
  const words = timings.map((timing) => {
    const start = normalization.speech.indexOf(timing.text, cursor);
    if (start < cursor) throw new Error("NORMALIZED_ALIGNMENT_TEXT_MISMATCH");
    cursor = start + timing.text.length; return { ...timing, start, end: cursor };
  });
  if (normalization.speech.replace(/\s/gu, "") !== timings.map((timing) => timing.text).join("").replace(/\s/gu, "")) throw new Error("NORMALIZED_ALIGNMENT_COVERAGE_MISMATCH");
  const at = (offset: number, end: boolean) => {
    const word = words.find((word) => end ? offset > word.start && offset <= word.end : offset >= word.start && offset < word.end);
    if (!word) throw new Error("NORMALIZED_ALIGNMENT_POSITION_MISSING");
    return word.startSeconds + (word.endSeconds - word.startSeconds) * (offset - word.start) / (word.end - word.start);
  };
  let previousOriginalEnd = 0;
  return normalization.segments.filter((segment) => /\S/u.test(normalization.original.slice(segment.originalStart, segment.originalEnd))).map((segment) => {
    let start = segment.speechStart; let end = segment.speechEnd;
    while (/\s/u.test(normalization.speech[start] ?? "") && start < end) start++;
    while (/\s/u.test(normalization.speech[end - 1] ?? "") && end > start) end--;
    const joiner = normalization.original.slice(previousOriginalEnd, segment.originalStart); previousOriginalEnd = segment.originalEnd;
    return { text: normalization.original.slice(segment.originalStart, segment.originalEnd), joiner, startSeconds: at(start, false), endSeconds: at(end, true) };
  });
}
