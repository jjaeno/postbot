import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { BarChart3, CalendarDays, ChevronRight, Clapperboard, Home, Layers3, Lightbulb, LogOut, Menu, Settings2, Plus, X } from "lucide-react";

const pages = [
  { id: "home", label: "홈", description: "오늘의 운영 상황과 다음 할 일을 확인하세요.", icon: Home },
  { id: "channels", label: "채널", description: "운영할 채널과 연결된 SNS 계정을 관리하세요.", icon: Layers3 },
  { id: "ideas", label: "아이디어", description: "채널에 맞는 소재를 찾고 영상 제작을 시작하세요.", icon: Lightbulb },
  { id: "content", label: "콘텐츠", description: "제작한 영상을 확인하고 검토부터 게시 준비까지 진행하세요.", icon: Clapperboard },
  { id: "calendar", label: "캘린더", description: "게시 일정과 예약된 콘텐츠를 한곳에서 확인하세요.", icon: CalendarDays },
  { id: "insights", label: "분석·최적화", description: "콘텐츠 성과를 살펴보고 다음 제작 방향을 정하세요.", icon: BarChart3 },
  { id: "settings", label: "사용량·설정", description: "제작 비용, 예산과 자동화 운영 설정을 관리하세요.", icon: Settings2 }
] as const;
export type WorkspacePage = typeof pages[number]["id"];

const readPage = (): WorkspacePage => {
  const hash = window.location.hash.slice(1);
  if (hash === "automation") return "home";
  return pages.find((page) => page.id === hash)?.id ??
    (new URLSearchParams(window.location.search).has("oauth") ? "channels" : new URLSearchParams(window.location.search).has("content") ? "content" : "home");
};

export const useWorkspacePage = (): WorkspacePage => {
  const [page, setPage] = useState<WorkspacePage>(readPage);
  useEffect(() => {
    const update = () => setPage(readPage());
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => { window.removeEventListener("hashchange", update); window.removeEventListener("popstate", update); };
  }, []);
  return page;
};

export const WorkspaceView = ({ active, page, children }: { active: WorkspacePage; page: WorkspacePage; children: ReactNode }): ReactElement =>
  <div className="workspace-view" data-page={page} hidden={active !== page}>{children}</div>;

export const WorkspaceShell = ({ page, workspace, user, action, logout, loggingOut, children }: {
  page: WorkspacePage; workspace: string; user: string; action: ReactNode; logout: () => void; loggingOut: boolean; children: ReactNode;
}): ReactElement => {
  const [menuOpen, setMenuOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousPage = useRef(page);
  const mobileMenu = useRef<HTMLButtonElement>(null);
  const current = pages.find((item) => item.id === page) ?? pages[0];
  useEffect(() => {
    setMenuOpen(false);
    if (previousPage.current !== page) {
      window.scrollTo({ top: 0 });
      heading.current?.focus({ preventScroll: true });
      previousPage.current = page;
    }
  }, [page]);
  useEffect(() => {
    if (!menuOpen) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenuOpen(false); mobileMenu.current?.focus(); } };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [menuOpen]);
  return <div className="workspace-shell">
    <a className="workspace-skip" href="#workspace-main" onClick={(event) => { event.preventDefault(); document.getElementById("workspace-main")?.focus(); }}>본문으로 이동</a>
    {menuOpen ? <button className="workspace-backdrop" aria-label="메뉴 닫기" onClick={() => setMenuOpen(false)} /> : null}
    <aside className={`workspace-sidebar ${menuOpen ? "is-open" : ""}`} aria-label="워크스페이스">
      <a className="workspace-brand" href="#home"><span className="workspace-brand-icon"><Clapperboard size={20} strokeWidth={1.7} /></span>Postbot</a>
      <div className="workspace-account"><span className="workspace-avatar">{workspace.slice(0, 1)}</span><div><strong>{workspace}</strong><span>워크스페이스</span></div></div>
      <p className="workspace-nav-label">보관함</p>
      <nav aria-label="운영 메뉴">{pages.map(({ id, label, icon: Icon }) => <a key={id} href={`#${id}`} aria-current={page === id ? "page" : undefined} onClick={(event) => { setMenuOpen(false); if (page === id) { event.preventDefault(); window.scrollTo({ top: 0 }); heading.current?.focus({ preventScroll: true }); } }}><Icon size={18} strokeWidth={1.7} aria-hidden="true" /><span>{label}</span></a>)}</nav>
      <div className="workspace-sidebar-footer"><div className="workspace-person"><span className="workspace-avatar">{user.slice(0, 1)}</span><div><strong>{user}</strong><span>내 계정</span></div></div><button onClick={logout} disabled={loggingOut}><LogOut size={17} aria-hidden="true" />로그아웃</button></div>
    </aside>
    <div className="workspace-body">
      <div className="workspace-topbar"><button ref={mobileMenu} className="workspace-menu-toggle" aria-label={menuOpen ? "메뉴 닫기" : "메뉴 열기"} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={21} /> : <Menu size={21} />}</button><span>워크스페이스</span><ChevronRight size={14} aria-hidden="true" /><strong>{current.label}</strong></div>
      <main id="workspace-main" className="workspace-main" tabIndex={-1}>
        <header className="workspace-page-header"><div><h1 ref={heading} tabIndex={-1}>{current.label}</h1><p>{current.description}</p></div><div className="workspace-header-action">{action}</div></header>
        {children}

      </main>
    </div>
  </div>;
};

export const FirstChannelWelcome = ({ onCreate }: { onCreate: () => void }): ReactElement => <section className="workspace-welcome">
  <span className="workspace-empty-icon"><Clapperboard size={34} strokeWidth={1.25} aria-hidden="true" /></span>
  <h2>첫 채널을 추가하세요.</h2>
  <p>채널의 주제와 SNS 계정을 설정하면<br />첫 샘플 영상을 만들어 확인할 수 있습니다.</p>
  <button className="workspace-primary-action" onClick={onCreate}><Plus size={16} aria-hidden="true" />채널 만들기</button>
  <p className="workspace-welcome-note">샘플 확인 후 게시 일정을 설정할 수 있습니다.</p>
</section>;
