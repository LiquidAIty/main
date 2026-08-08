import OpenClaudeConsolePanel from '../../features/agentbuilder/console/OpenClaudeConsolePanel';
import {
  hermesConsoleClient,
  type OpenClaudeConsoleClient,
} from '../../features/agentbuilder/console/openClaudeConsoleClient';

type HermesConsoleProps = {
  open: boolean;
  targetRoot: string;
  projectId?: string;
  onClose?: () => void;
  client?: OpenClaudeConsoleClient;
};

/** Visible terminal for the installed Hermes CLI; never an OpenClaude substitute. */
export default function HermesConsole({
  open,
  targetRoot,
  projectId,
  onClose,
  client = hermesConsoleClient,
}: HermesConsoleProps) {
  return (
    <OpenClaudeConsolePanel
      open={open}
      targetRoot={targetRoot}
      projectId={projectId}
      title="Hermes Terminal"
      testIdPrefix="hermes-console"
      client={client}
      attachExisting
      idleLabel="Stopped"
      completeLabel="Stopped"
      onClose={onClose}
    />
  );
}
