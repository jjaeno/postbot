import type { CaptionTiming } from "./scene-math.js";

export const textUnits = (text: string): number => Array.from(text).reduce((sum, char) => sum + (/\s/u.test(char) ? 0.3 : (char.codePointAt(0) ?? 0) <= 0x024f ? 0.58 : 1), 0);
export const fittedFontSize = (text: string, width: number, height: number, preferred: number, minimum: number): number | null => {
  for (let size = preferred; size >= minimum; size -= 2) {
    const lines = Math.max(1, Math.ceil(textUnits(text) * size / width));
    // Reserve one extra line for real font/word boundary differences.
    if ((lines + 1) * size * 1.22 <= height) return size;
  }
  return null;
};

// Preserve all characters and proportional TTS time; never trim audio or text.
export function splitDisplayCaptions(captions: readonly CaptionTiming[]): CaptionTiming[] {
  return captions.flatMap((caption) => {
    const chars = Array.from(caption.text); const chunks: string[] = [];
    let start = 0;
    while (start < chars.length) {
      let end = start; let units = 0;
      while (end < chars.length && units + textUnits(chars[end]!) <= 48) { units += textUnits(chars[end]!); end++; }
      if (end === start) end++;
      if (end < chars.length) {
        const space = chars.slice(start, end).lastIndexOf(" ");
        if (space >= (end - start) / 2) end = start + space + 1;
      }
      chunks.push(chars.slice(start, end).join("")); start = end;
    }
    let offset = 0;
    return chunks.map((text) => {
      const startSeconds = caption.startSeconds + (caption.endSeconds - caption.startSeconds) * offset / chars.length;
      offset += Array.from(text).length;
      return { text, startSeconds, endSeconds: caption.startSeconds + (caption.endSeconds - caption.startSeconds) * offset / chars.length };
    });
  });
}
