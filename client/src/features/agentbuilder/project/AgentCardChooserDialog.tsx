import type { AvailableSavedCard } from '../state/useAgentCardChooser';

type AgentBuilderColors = {
  primary: string;
  bg: string;
  panel: string;
  border: string;
  text: string;
  neutral: string;
  warn: string;
};

type AgentCardChooserDialogProps = {
  open: boolean;
  choices: AvailableSavedCard[];
  busy: boolean;
  error: string | null;
  colors: AgentBuilderColors;
  onClose: () => void;
  onCreateNewAgent: () => void;
  onAttachSavedCard: (choice: AvailableSavedCard) => void;
};

export default function AgentCardChooserDialog({
  open,
  choices,
  busy,
  error,
  colors,
  onClose,
  onCreateNewAgent,
  onAttachSavedCard,
}: AgentCardChooserDialogProps) {
  if (!open) return null;

  return (
    <div
      data-testid="saved-card-chooser"
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.58)' }}
      onClick={onClose}
    >
      <div
        className="w-[min(560px,calc(100vw-32px))] max-h-[72vh] overflow-auto rounded-xl p-4"
        style={{ background: colors.panel, border: `1px solid ${colors.border}` }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <div className="text-sm font-semibold">Add Agent</div>
            <div className="text-xs mt-1" style={{ color: colors.neutral }}>
              Reuse a saved Card unchanged, or create and save one new Card.
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Add Agent"
            onClick={onClose}
            disabled={busy}
          >
            ×
          </button>
        </div>
        {error ? (
          <div className="text-xs mb-3" style={{ color: colors.warn }}>{error}</div>
        ) : null}
        <button
          type="button"
          className="w-full text-left rounded-lg p-3 mb-3"
          style={{ border: `1px solid ${colors.primary}`, background: colors.bg }}
          disabled={busy}
          onClick={onCreateNewAgent}
          data-testid="add-agent-new-card"
        >
          <div className="text-sm font-medium">New Agent</div>
          <div className="text-xs mt-1" style={{ color: colors.neutral }}>
            Open one new editable Card, then save it as the permanent authority.
          </div>
        </button>
        <div className="text-xs font-semibold mb-2" style={{ color: colors.neutral }}>
          Saved Agents
        </div>
        {busy && choices.length === 0 ? (
          <div className="text-sm" style={{ color: colors.neutral }}>Loading saved Cards…</div>
        ) : null}
        {!busy && choices.length === 0 ? (
          <div className="text-sm" style={{ color: colors.neutral }}>
            Every available saved Card is already in this Project.
          </div>
        ) : null}
        <div className="grid gap-2">
          {choices.map((choice) => (
            <button
              key={`${choice.cardId}:${choice.cardRevisionId}`}
              type="button"
              className="text-left rounded-lg p-3"
              style={{ border: `1px solid ${colors.border}`, background: colors.bg }}
              disabled={busy}
              onClick={() => onAttachSavedCard(choice)}
              data-testid={`saved-card-choice-${choice.cardId}`}
            >
              <div className="text-sm font-medium">{choice.title}</div>
              <div className="text-xs mt-1" style={{ color: colors.neutral }}>
                {choice.subtitle || 'Saved Card'} · {choice.runtimeProfile}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
