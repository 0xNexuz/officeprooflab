'use client';
// The signed-in frame: the rail with the project switcher, and the account every page inside it can rely on.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { api, errorText } from '@/lib/api';
import type { ProjectSummary } from '@/lib/types';
import { Brand, Icon } from './Bits';

type ShellState = { user: { id: string; username: string }; projects: ProjectSummary[]; reloadProjects: () => Promise<void> };
const ShellContext = createContext<ShellState | null>(null);
export function useShell() {
  const value = useContext(ShellContext);
  if (!value) throw new Error('useShell must be used inside the app shell');
  return value;
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ project?: string }>();
  const [user, setUser] = useState<ShellState['user'] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [formError, setFormError] = useState('');

  const reloadProjects = useCallback(async () => {
    setProjects((await api<{ projects: ProjectSummary[] }>('/api/projects')).projects);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const auth = await api<{ user: ShellState['user'] | null }>('/api/auth');
        if (!alive) return;
        if (!auth.user) { window.location.replace(`/signin?next=${encodeURIComponent(window.location.pathname)}`); return; }
        const list = (await api<{ projects: ProjectSummary[] }>('/api/projects')).projects;
        if (!alive) return;
        setProjects(list);
        setUser(auth.user);
      } catch (e) { if (alive) setError(errorText(e)); }
    })();
    return () => { alive = false; };
  }, []);

  if (error) return <div className="loading"><p className="notice notice--error" role="alert">{error}</p></div>;
  if (!user) return <div className="loading">Opening your projects<span className="busy-dots" /></div>;

  const projectId = params.project && projects.some(project => project.id === params.project) ? params.project : projects[0]?.id;
  const base = projectId ? `/app/p/${projectId}` : '/app';
  const at = (href: string, exact = false) => exact ? pathname === href : pathname.startsWith(href);
  const overviewActive = at(base, true) || at(`${base}/cases`);
  const signOut = async () => { try { await api('/api/auth', { json: { action: 'logout' } }); } finally { window.location.assign('/'); } };
  const createProject = async (event: React.FormEvent) => {
    event.preventDefault(); setFormError('');
    try {
      const { projectId: created } = await api<{ projectId: string }>('/api/projects', { json: { action: 'create', name } });
      await reloadProjects();
      dialog.current?.close(); setName('');
      router.push(`/app/p/${created}`);
    } catch (e) { setFormError(errorText(e)); }
  };

  return (
    <ShellContext.Provider value={{ user, projects, reloadProjects }}>
      <div className="shell">
        <nav className="rail" aria-label="Project">
          <Brand href="/app" />
          <div className="rail-project">
            <label htmlFor="project-switch">Project</label>
            <select id="project-switch" className="rail-select" value={projectId ?? ''} onChange={event => router.push(`/app/p/${event.target.value}`)}>
              {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <button type="button" className="rail-new" onClick={() => dialog.current?.showModal()}>New project</button>
          </div>
          <div className="rail-nav">
            <a className={`op-nav${overviewActive ? ' is-active' : ''}`} href={base} aria-current={overviewActive ? 'page' : undefined}><Icon.grid />Overview</a>
            <a className={`op-nav${at(`${base}/runs`) ? ' is-active' : ''}`} href={`${base}/runs`} aria-current={at(`${base}/runs`) ? 'page' : undefined}><Icon.play />Runs</a>
            <a className={`op-nav${at(`${base}/ci`) ? ' is-active' : ''}`} href={`${base}/ci`} aria-current={at(`${base}/ci`) ? 'page' : undefined}><Icon.branch />CI and tokens</a>
          </div>
          <div className="rail-user">
            <span title={user.username}>{user.username}</span>
            <button type="button" className="op-link" onClick={signOut}>Sign out</button>
          </div>
        </nav>
        <main className="main">{children}</main>
      </div>
      <dialog ref={dialog} className="sheet" aria-labelledby="new-project-title">
        <form className="sheet-body" onSubmit={createProject}>
          <h2 id="new-project-title">New project</h2>
          <label className="field">Name
            <input className="op-input" value={name} onChange={event => setName(event.target.value)} required maxLength={80} placeholder="Month-end pack" />
            <span className="hint">A project holds the test cases for one generator or one product.</span>
          </label>
          {formError && <p className="notice notice--error" role="alert">{formError}</p>}
          <div className="sheet-actions">
            <button type="button" className="op-ghost" onClick={() => dialog.current?.close()}>Cancel</button>
            <button type="submit" className="op-btn op-btn--sm op-btn--ink">Create project</button>
          </div>
        </form>
      </dialog>
    </ShellContext.Provider>
  );
}

/** Loads something for a page and reloads it on request. */
export function useLoad<T>(path: string | null): { data: T | null; error: string; reload: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    if (!path) return;
    try { setData(await api<T>(path)); setError(''); } catch (e) { setError(errorText(e)); }
  }, [path]);
  useEffect(() => { setData(null); void reload(); }, [reload]);
  return { data, error, reload };
}

export function PageState({ error }: { error: string }) {
  return error ? <div className="content"><p className="notice notice--error" role="alert">{error}</p><a className="op-ghost" href="/app" style={{ alignSelf: 'flex-start' }}>Back to your projects</a></div>
    : <div className="loading">Loading<span className="busy-dots" /></div>;
}
