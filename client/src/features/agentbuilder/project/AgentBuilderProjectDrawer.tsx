import { useState } from 'react';
import type { FormEvent } from 'react';

import BuilderDrawer from '../../../components/builder/BuilderDrawer';
import { safeText } from '../deck/deckPrimitives';

type ProjectSummary = {
  id: string;
  name?: string | null;
  code?: string | null;
};

type DrawerColors = {
  bg: string;
  border: string;
  neutral: string;
  panel: string;
  primary: string;
  text: string;
  warn: string;
};

type AgentBuilderProjectDrawerProps = {
  activeProject: string;
  colors: DrawerColors;
  open: boolean;
  projects: ProjectSummary[];
  projectsApi: string;
  projectsError: unknown;
  onClose: () => void;
  refreshProjects: (
    reason: string,
    preferredProjectId?: string,
  ) => Promise<void>;
  setActiveProjectWithUrl: (projectId: string) => void;
  setProjectsError: (message: string | null) => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Unknown error';
}

export default function AgentBuilderProjectDrawer({
  activeProject,
  colors,
  open,
  projects,
  projectsApi,
  projectsError,
  onClose,
  refreshProjects,
  setActiveProjectWithUrl,
  setProjectsError,
}: AgentBuilderProjectDrawerProps) {
  const [showCreateProjectForm, setShowCreateProjectForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  if (!open) return null;

  const handleCreateProject = async (event?: FormEvent) => {
    event?.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    const code = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    try {
      const response = await fetch(projectsApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          code,
          project_type: 'assist',
        }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || `HTTP ${response.status}`);
      }
      const data: unknown = await response.json().catch(() => null);
      const record =
        data && typeof data === 'object'
          ? (data as {
              id?: unknown;
              project?: { id?: unknown };
            })
          : null;
      const newId = String(record?.project?.id || record?.id || '').trim();

      setShowCreateProjectForm(false);
      setNewProjectName('');
      await refreshProjects('after-create', newId);
      if (newId) setActiveProjectWithUrl(newId);
    } catch (error: unknown) {
      console.error('Create project failed', error);
      setProjectsError(`Failed to create project: ${errorMessage(error)}`);
    }
  };

  const handleDeleteProject = async (project: ProjectSummary) => {
    if (
      !confirm(
        `Delete project "${safeText(project.name || project.id)}"? This cannot be undone.`,
      )
    ) {
      return;
    }

    try {
      const response = await fetch(`${projectsApi}/${project.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await refreshProjects('after-delete');
      if (activeProject === project.id) {
        const nextProject = projects.find(
          (entry) => entry.id !== project.id,
        );
        setActiveProjectWithUrl(nextProject?.id || '');
      }
    } catch (error: unknown) {
      alert(`Failed to delete project: ${errorMessage(error)}`);
    }
  };

  return (
    <BuilderDrawer title="Projects" onClose={onClose} colors={colors}>
      <div data-testid="navigation-drawer" className="space-y-3">
        <div
          data-testid="drawer-projects-section"
          className="text-xs uppercase mb-2 flex items-center justify-between"
          style={{ color: colors.neutral }}
        >
          <span>Chat Projects</span>
          <button
            onClick={() =>
              setShowCreateProjectForm((current) => !current)
            }
            className="text-[11px] px-2 py-1 rounded"
            style={{
              border: `1px solid ${colors.border}`,
              color: colors.text,
            }}
            data-testid="new-project-button"
          >
            New Project
          </button>
        </div>

        {showCreateProjectForm ? (
          <form
            onSubmit={handleCreateProject}
            className="mb-2 p-2 rounded"
            style={{
              border: `1px solid ${colors.border}`,
              background: colors.bg,
            }}
            data-testid="create-project-form"
          >
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={newProjectName}
                onChange={(event) =>
                  setNewProjectName(event.target.value)
                }
                placeholder="Project name"
                autoFocus
                className="flex-1 px-2 py-1 text-xs rounded focus:outline-none"
                style={{
                  background: colors.panel,
                  border: `1px solid ${colors.border}`,
                  color: colors.text,
                }}
                data-testid="project-name-input"
              />
              <button
                type="submit"
                disabled={!newProjectName.trim()}
                className="text-xs py-1 px-3 rounded font-medium"
                style={{
                  background: newProjectName.trim()
                    ? 'rgba(79,162,173,0.18)'
                    : colors.panel,
                  border: `1px solid ${
                    newProjectName.trim()
                      ? colors.primary
                      : colors.border
                  }`,
                  color: colors.text,
                  cursor: newProjectName.trim()
                    ? 'pointer'
                    : 'not-allowed',
                }}
                data-testid="create-project-submit"
              >
                Create
              </button>
            </div>
          </form>
        ) : null}

        <div
          className="space-y-2"
          style={{ maxHeight: 400, overflowY: 'auto' }}
        >
          {projectsError ? (
            <div className="text-xs" style={{ color: colors.neutral }}>
              {safeText(projectsError)}
            </div>
          ) : null}
          {projects.map((project) => (
            <div key={project.id} className="flex items-center gap-2">
              <button
                onClick={() => {
                  setActiveProjectWithUrl(project.id);
                  onClose();
                }}
                className="flex-1 text-left p-3 rounded"
                style={{
                  background:
                    activeProject === project.id
                      ? 'rgba(79,162,173,0.18)'
                      : 'transparent',
                  border: `1px solid ${
                    activeProject === project.id
                      ? colors.primary
                      : colors.border
                  }`,
                  color: colors.text,
                }}
              >
                <div className="font-medium">
                  {safeText(project.name || project.id)}
                </div>
                {project.code ? (
                  <div
                    className="opacity-60 text-xs"
                    style={{ marginTop: 2 }}
                  >
                    {safeText(project.code)}
                  </div>
                ) : null}
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  void handleDeleteProject(project);
                }}
                className="p-2 rounded"
                style={{
                  background: 'transparent',
                  border: `1px solid ${colors.border}`,
                  color: colors.warn,
                }}
                title="Delete project"
              >
                ×
              </button>
            </div>
          ))}
          {projects.length === 0 && !projectsError ? (
            <div className="text-xs" style={{ color: colors.neutral }}>
              No projects available.
            </div>
          ) : null}
        </div>

        <div
          className="mt-6 pt-4"
          style={{ borderTop: `1px solid ${colors.border}` }}
        >
          <div
            className="text-xs uppercase mb-2"
            style={{ color: colors.neutral }}
          >
            Account
          </div>
          <button
            onClick={() => {
              void fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include',
              })
                .then(() => {
                  window.location.href = '/login';
                })
                .catch((error: unknown) => {
                  console.error('Logout failed:', error);
                });
            }}
            className="w-full text-left p-3 rounded"
            style={{
              background: 'transparent',
              border: `1px solid ${colors.border}`,
              color: colors.text,
            }}
          >
            <div className="font-medium">Sign Out</div>
          </button>
        </div>
      </div>
    </BuilderDrawer>
  );
}
