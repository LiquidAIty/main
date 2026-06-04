import type { ReactNode } from 'react';

type AgentBuilderCanvasRegionProps = {
  minWidth: number;
  children: ReactNode;
};

export default function AgentBuilderCanvasRegion({
  minWidth,
  children,
}: AgentBuilderCanvasRegionProps) {
  return (
    <div
      data-testid="workspace-canvas-region"
      className="h-full flex-1 min-w-0 relative"
      style={{ minWidth }}
    >
      {children}
    </div>
  );
}
