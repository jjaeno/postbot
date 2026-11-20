import { describe, expect, it } from "vitest";
import { assessResearch, fairCandidatePool, researchQuery } from "./research.js";
import type { TopicSourceCandidate } from "./index.js";
const roman = { id: "rome", question: "로마는 왜 멸망했는가?", subtopic: "history", origin: "AUDIENCE", status: "INVESTIGATE" };
const egypt = { ...roman, id: "egypt", question: "이집트인은 왜 피라미드를 만들었는가?" };
const candidate = (body: string, questionId = "rome", scope = "FULL_TEXT"): TopicSourceCandidate => ({ title: "history", summary: body, body, url: "https://www.loc.gov/item/rome", sourceName: "LOC", sourceKind: "OFFICIAL", publishedAt: null, reliabilityScore: 0.8, reliabilityMetadata: { contentScope: scope, researchRequests: [{ questionId, query: questionId }] } });
describe("question-specific research and bounded fair candidate pools", () => {
  it("keeps same-category questions distinct and rejects category-only and untracked text", () => {
    expect(researchQuery(roman)).not.toBe(researchQuery(egypt));
    expect(assessResearch(roman, [candidate("history에 대한 자료입니다")]).state).toBe("INSUFFICIENT_EVIDENCE");
    const material = candidate("로마는 내부 문제 때문에 멸망했다.");
    expect(assessResearch(roman, [material]).state).toBe("ANSWER_EVIDENCE_AVAILABLE");
    expect(assessResearch(egypt, [material]).state).toBe("INSUFFICIENT_EVIDENCE");
    expect(assessResearch(roman, [{ ...material, reliabilityMetadata: { contentScope: "FULL_TEXT" } }]).sources).toHaveLength(0);
  });
  it("distinguishes material, quoted answer evidence, conflicts and excluded subjects without claiming truth", () => {
    const body = "이집트인은 파라오의 무덤을 위해 피라미드를 만들었다.";
    expect(assessResearch(egypt, [candidate(body, "egypt", "SUMMARY")]).state).toBe("MATERIAL_FOUND");
    const answer = assessResearch(egypt, [candidate(body, "egypt")]);
    expect(answer.state).toBe("ANSWER_EVIDENCE_AVAILABLE"); expect(answer.sources[0]).toMatchObject({ verification: "CLAIM_VERIFICATION_REQUIRED", quote: body });
    expect(assessResearch(egypt, [candidate(`${body} 이 주장에는 반증과 상충 자료가 있다.`, "egypt")]).state).toBe("CONFLICTING_EVIDENCE");
    expect(assessResearch(egypt, [candidate(body, "egypt")], { language: "ko", audience: "students", exclusions: ["파라오"], storyStyles: ["question"] }).state).toBe("INSUFFICIENT_EVIDENCE");
  });
  it("shares the pool across source families and queries, deduplicates and ignores completion order", () => {
    const loc = candidate("record"); const items = [loc, ...Array.from({ length: 25 }, (_, i) => ({ ...candidate("discovery"), sourceName: "YouTube", url: `https://www.youtube.com/watch?v=${i}`, reliabilityMetadata: { sourceFamily: "YOUTUBE", searchQuery: i % 2 ? "one" : "two" } }))];
    expect(fairCandidatePool(items, 20).some((item) => item.sourceName === "LOC")).toBe(true);
    expect(fairCandidatePool([...items].reverse(), 20).map((item) => item.url)).toEqual(fairCandidatePool(items, 20).map((item) => item.url));
    expect(fairCandidatePool([...items, loc], 100)).toHaveLength(26);
    const duplicate = { ...loc, title: "Another title", reliabilityMetadata: { ...loc.reliabilityMetadata, researchRequests: [{ questionId: "egypt" }] } };
    expect(fairCandidatePool([duplicate, loc], 10)).toEqual(fairCandidatePool([loc, duplicate], 10));
  });
});
