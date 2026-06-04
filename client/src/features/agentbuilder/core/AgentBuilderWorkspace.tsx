import type { ReactNode } from 'react';

type AgentBuilderWorkspaceProps = {
  rail: ReactNode;
  shell: ReactNode;
};

export default function AgentBuilderWorkspace({
  rail,
  shell,
}: AgentBuilderWorkspaceProps) {
  return (
    <>
      <style>{`
        @keyframes builder-orb-float {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(-0.5px) scale(1.015); }
        }
      `}</style>
      <div className="flex flex-1 overflow-hidden min-h-0">
        {rail}
        {shell}
      </div>
    </>
  );
}
