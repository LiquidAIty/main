import { useEffect, useRef } from 'react';

import { useBuilderProjects } from '../../../components/builder/useBuilderProjects';

type UseAgentBuilderProjectArgs = {
  projectsApi: string;
  workspaceView: string;
  openCanvasWorkspace: () => void;
};

export default function useAgentBuilderProject({
  projectsApi,
  workspaceView,
  openCanvasWorkspace,
}: UseAgentBuilderProjectArgs) {
  const {
    activeProject,
    assistProjects,
    projectsError,
    setProjectsError,
    setActiveProjectWithUrl,
    refreshProjects,
  } = useBuilderProjects({
    projectsApi,
    workspaceView,
  });
  const canvasAutoOpenedForProjectRef = useRef(false);
  const canvasProjectId = String(activeProject ?? '').trim();

  useEffect(() => {
    if (!canvasProjectId) {
      canvasAutoOpenedForProjectRef.current = false;
      return;
    }
    if (workspaceView !== 'chat') {
      canvasAutoOpenedForProjectRef.current = true;
      return;
    }
    if (canvasAutoOpenedForProjectRef.current) {
      return;
    }
    canvasAutoOpenedForProjectRef.current = true;
    openCanvasWorkspace();
  }, [canvasProjectId, openCanvasWorkspace, workspaceView]);

  return {
    activeProject,
    assistProjects,
    projectsError,
    setProjectsError,
    setActiveProjectWithUrl,
    refreshProjects,
    canvasProjectId,
  };
}
