import type { ReactNode, RefObject } from 'react';

type AgentBuilderShellProps = {
  workspaceShellRef: RefObject<HTMLDivElement | null>;
  chatPane: ReactNode;
  splitter: ReactNode;
  canvasRegion: ReactNode;
  companionSurfaceHost: ReactNode;
  drawer: ReactNode;
};

export default function AgentBuilderShell({
  workspaceShellRef,
  chatPane,
  splitter,
  canvasRegion,
  companionSurfaceHost,
  drawer,
}: AgentBuilderShellProps) {
  return (
    <div
      ref={workspaceShellRef}
      className="flex flex-1 overflow-hidden min-h-0"
      style={{ position: 'relative' }}
    >
      {chatPane}
      {splitter}
      {canvasRegion}
      {companionSurfaceHost}
      {drawer}
    </div>
  );
}
