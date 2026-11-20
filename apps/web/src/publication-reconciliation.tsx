import { useRef, useState, type ReactElement } from "react";
import type { PublishCalendarItem } from "@postbot/contracts";

export function PublicationReconciliation({ plan, submit }: { plan: PublishCalendarItem; submit: (input: { idempotencyKey: string; externalVideoId?: string; evidenceHash?: string }) => Promise<void> }): ReactElement {
  const [externalVideoId, setExternalVideoId] = useState(""); const [evidenceHash, setEvidenceHash] = useState("");
  const [pending, setPending] = useState(false); const [message, setMessage] = useState(""); const key = useRef<string | null>(null);
  const evidenceVersion = useRef(0);
  const hasPost = Boolean(plan.publicationState);
  return <form className="mt-3 space-y-2 rounded border p-3" onSubmit={(event) => {
    event.preventDefault(); key.current ??= crypto.randomUUID(); setPending(true); setMessage("");
    void submit({ idempotencyKey: key.current, ...(externalVideoId.trim() ? { externalVideoId: externalVideoId.trim(), evidenceHash } : {}) }).then(() => { setMessage("상태 확인 작업을 등록했습니다."); key.current = null; }, (error: unknown) => { setMessage(error instanceof Error ? error.message : "상태 확인을 등록하지 못했습니다."); }).finally(() => setPending(false));
  }}>
    <p>플랫폼 상태를 조회해 이 게시 계획과 연결합니다. 영상을 다시 업로드하지 않습니다.</p>
    {!hasPost ? <>
      <label className="block">확인한 게시물 ID<input aria-label="확인한 게시물 ID" className="mt-1 w-full rounded border p-2" required value={externalVideoId} onChange={(event) => { setExternalVideoId(event.target.value); key.current = null; }} /></label>
      <label className="block">확인 자료<input aria-label="게시 결과 확인 자료" className="mt-1 block w-full" type="file" required onChange={(event) => {
        const version = ++evidenceVersion.current; const file = event.target.files?.[0]; setEvidenceHash(""); key.current = null;
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) { setMessage("확인 자료는 10MB 이하로 선택해 주세요."); return; }
        void file.arrayBuffer().then((bytes) => crypto.subtle.digest("SHA-256", bytes)).then((digest) => { if (version === evidenceVersion.current) setEvidenceHash([...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("")); }, () => { if (version === evidenceVersion.current) setMessage("확인 자료를 읽지 못했습니다."); });
      }} /></label>
      <p className="text-xs text-muted-foreground">확인 자료의 내용은 전송하지 않고 확인 기록을 위한 해시만 남깁니다. 원본 자료는 별도로 보관해 주세요.</p>
    </> : null}
    <button type="submit" className="rounded border px-3 py-2" disabled={pending || !hasPost && (!externalVideoId.trim() || !evidenceHash)}>{pending ? "확인 등록 중" : "플랫폼 상태 확인"}</button>
    {message ? <p role="status">{message}</p> : null}
  </form>;
}
