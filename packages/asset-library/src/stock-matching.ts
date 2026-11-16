import { topicTokens } from "@postbot/providers";

export type StockCandidate = { assetId: string; storageKey: string; description: string; tags: string[]; recentUseCount: number };
const generic = new Set(["image", "photo", "vertical", "short", "explainer", "stock", "이미지", "사진", "세로", "설명"]);
export function scoreStockMatch(prompt: string, asset: StockCandidate, currentUses = 0): number {
  const tokens = (text: string) => new Set([...topicTokens(text)].filter((token) => !generic.has(token)));
  const wanted = tokens(prompt); const provided = tokens(`${asset.description} ${asset.tags.join(" ")}`);
  if (!wanted.size || !provided.size) return 0;
  const shared = [...wanted].filter((token) => provided.has(token)).length;
  return shared / Math.sqrt(wanted.size * provided.size) / (1 + Math.min(5, asset.recentUseCount + currentUses) * 0.15);
}
