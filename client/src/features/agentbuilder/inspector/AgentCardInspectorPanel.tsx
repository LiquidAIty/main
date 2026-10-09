import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from 'react';

import CardTerminalPanel from '../console/CardTerminalPanel';
import CardSubsystemTab from '../subsystems/CardSubsystemTab';
import MagneticTasksTab from '../tasks/MagneticTasksTab';
import { BUILDER_CARD_ID, DEFAULT_PROJECT_DECK_ID } from '../deck/newProjectDeck';
import { readCardSubsystemAttachments } from '../deck/cardSubsystems';
import { safeText } from '../deck/deckPrimitives';
import type { CardEditorConfiguration } from '../cardConfigurationEditor';
import {
  graphCompanionTabButtonStyle,
  graphCompanionTabGroupStyle,
  graphDrawerSectionStyle,
  GRAPH_THEME,
} from '../../../components/graph/graphVisualTokens';
import type { DeckCard, DeckDocument } from '../../../types/agentgraph';

const loadCardInspector = () => import('../../../components/CardInspector');
const CardInspector = lazy(async () => {
  const module = await loadCardInspector();
  return { default: module.CardInspector };
});
void loadCardInspector();

export const CARD_CONFIGURATION_TABS = [
  'Prompt',
  'Runtime',
  'Memory',
  'Skills',
  'Tools',
] as const;

export function isTaskLedgerCard(card: DeckCard | null | undefined): boolean {
  return card?.id === 'card_magentic' || card?.id === 'card_team';
}

export function resolveTaskLedgerCardId(card: DeckCard, deck: DeckDocument): string {
  if (card.id !== 'card_team') return card.id;
  for (const edge of deck.edges) {
    if (edge.edgeType !== 'magentic_option' || edge.enabled === false) continue;
    const peerId = edge.source === card.id
      ? edge.target
      : edge.target === card.id ? edge.source : null;
    const peer = peerId ? deck.nodes.find((node) => node.id === peerId) : null;
    if (peer?.id === 'card_magentic') return peer.id;
  }
  return card.id;
}

class CardEditorErrorBoundary extends Component<
  { cardTitle: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        data-testid="card-editor-error"
        style={graphDrawerSectionStyle({
          padding: '12px 14px',
          color: 'rgba(255,162,162,0.95)',
        })}
      >
        {this.props.cardTitle} configuration could not be rendered: {this.state.error.message}
      </div>
    );
  }
}

type AgentCardInspectorPanelProps = {
  canvasProjectId: string;
  conversationId: string;
  deck: DeckDocument;
  selectedCard: DeckCard | null;
  selectedCardConfig: CardEditorConfiguration | null;
  tab: string;
  setTab: Dispatch<SetStateAction<string>>;
  mainCardId: string | null;
  builderCardId: string | null;
  cardTitlesByProfile: Record<string, string>;
  cardDraftFlushRef: MutableRefObject<(() => Promise<boolean>) | null>;
  registerCardDraftFlush: (save: (() => Promise<boolean>) | null) => void;
  onRenameSelectedCard: (value: string) => void;
  onSaveSelectedCardConfig: (config: CardEditorConfiguration) => void | Promise<void>;
  onSetBuilderProjectCodeFolder: (folder: string) => Promise<void>;
  projectCodeFolder: string | null;
};

export default function AgentCardInspectorPanel({
  canvasProjectId,
  conversationId,
  deck,
  selectedCard,
  selectedCardConfig,
  tab,
  setTab,
  mainCardId,
  builderCardId,
  cardTitlesByProfile,
  cardDraftFlushRef,
  registerCardDraftFlush,
  onRenameSelectedCard,
  onSaveSelectedCardConfig,
  onSetBuilderProjectCodeFolder,
  projectCodeFolder,
}: AgentCardInspectorPanelProps) {
  const orangeConnections = useMemo(() => {
    if (!selectedCard) return [];
    const nodeById = new Map(deck.nodes.map((node) => [node.id, node] as const));
    const seen = new Set<string>();
    return deck.edges.flatMap((edge) => {
      if (
        edge.edgeType !== 'flow'
        || edge.enabled === false
        || edge.source !== selectedCard.id
      ) return [];
      const other = nodeById.get(edge.target);
      const otherRecord = other as (typeof other & { enabled?: boolean }) | undefined;
      const otherOptions = other?.runtimeOptions as ({ enabled?: boolean } | null | undefined);
      if (
        !other
        || otherRecord?.enabled === false
        || otherOptions?.enabled === false
        || seen.has(edge.target)
      ) return [];
      seen.add(edge.target);
      return [{
        cardId: edge.target,
        title: safeText(other.title || edge.target),
        direction: 'outgoing' as const,
      }];
    });
  }, [deck.edges, deck.nodes, selectedCard]);

  const tabs = useMemo(() => {
    if (!selectedCard) return [];
    return [
      ...CARD_CONFIGURATION_TABS,
      ...(isTaskLedgerCard(selectedCard) ? ['Tasks'] : []),
      ...(selectedCard.runtime.kind === 'hermes'
        && !isTaskLedgerCard(selectedCard)
        && selectedCard.id !== mainCardId
        && selectedCard.id !== builderCardId
        ? ['CLI']
        : []),
      ...readCardSubsystemAttachments(selectedCard.runtimeOptions)
        .filter((attachment) => attachment.cardTab.enabled)
        .map((attachment) => attachment.label),
    ];
  }, [builderCardId, mainCardId, selectedCard]);

  const selectedSubsystem = useMemo(
    () => readCardSubsystemAttachments(selectedCard?.runtimeOptions)
      .find((attachment) => attachment.cardTab.enabled && attachment.label === tab) || null,
    [selectedCard?.runtimeOptions, tab],
  );

  useEffect(() => {
    if (tabs.some((entry) => entry === tab)) return;
    setTab(tabs[0] || 'Prompt');
  }, [setTab, tab, tabs]);

  const selectTab = useCallback(async (nextTab: string) => {
    if (cardDraftFlushRef.current && !(await cardDraftFlushRef.current())) return;
    setTab(nextTab);
  }, [cardDraftFlushRef, setTab]);

  if (!selectedCard || !selectedCardConfig) return null;

  let content: ReactNode = null;
  if (tab === 'Tasks' && isTaskLedgerCard(selectedCard)) {
    content = (
      <MagneticTasksTab
        projectId={canvasProjectId}
        deckId={DEFAULT_PROJECT_DECK_ID}
        cardId={resolveTaskLedgerCardId(selectedCard, deck)}
        label={selectedCard.title}
        cardTitlesByProfile={cardTitlesByProfile}
      />
    );
  } else if (selectedSubsystem) {
    content = (
      <CardSubsystemTab
        attachment={selectedSubsystem}
        readinessEndpoint={selectedSubsystem.id === 'lumibot'
          ? '/api/trading/readiness'
          : selectedSubsystem.id === 'gods-eye'
            ? '/api/worldview/readiness'
            : null}
      />
    );
  } else if (
    tab === 'CLI'
    && selectedCard.runtime.kind === 'hermes'
    && !isTaskLedgerCard(selectedCard)
    && selectedCard.id !== mainCardId
    && selectedCard.id !== builderCardId
  ) {
    content = (
      <CardTerminalPanel
        key={`${canvasProjectId}:${DEFAULT_PROJECT_DECK_ID}:${selectedCard.id}:${selectedCard.runtime.profile}`}
        identity={{
          projectId: canvasProjectId,
          deckId: DEFAULT_PROJECT_DECK_ID,
          cardId: selectedCard.id,
          conversationId,
        }}
      />
    );
  } else if (CARD_CONFIGURATION_TABS.some((entry) => entry === tab)) {
    content = (
      <CardEditorErrorBoundary
        key={`card-editor-boundary:${selectedCard.id}`}
        cardTitle={String(selectedCard.title || 'Selected card')}
      >
        <Suspense
          fallback={(
            <div
              style={graphDrawerSectionStyle({
                padding: '12px 14px',
                borderRadius: 8,
                color: GRAPH_THEME.drawer.inputMuted,
              })}
            >
              Loading card configuration…
            </div>
          )}
        >
          <CardInspector
            key="deck-card-editor"
            cardId={selectedCard.id}
            projectId={canvasProjectId}
            deckId={DEFAULT_PROJECT_DECK_ID}
            registerCardDraftFlush={registerCardDraftFlush}
            activeTab={tab}
            cardName={selectedCard.title}
            onChangeCardName={onRenameSelectedCard}
            localConfig={selectedCardConfig}
            onSaveLocalConfig={onSaveSelectedCardConfig}
            projectCodeFolder={
              selectedCard.id === BUILDER_CARD_ID ? projectCodeFolder : undefined
            }
            onSetProjectCodeFolder={
              selectedCard.id === BUILDER_CARD_ID
                ? onSetBuilderProjectCodeFolder
                : undefined
            }
            orangeConnections={orangeConnections}
          />
        </Suspense>
      </CardEditorErrorBoundary>
    );
  }

  return (
    <>
      {tabs.length > 0 ? (
        <div
          className="flex min-w-0"
          style={graphCompanionTabGroupStyle({
            gap: isTaskLedgerCard(selectedCard) ? 3 : 6,
            padding: isTaskLedgerCard(selectedCard) ? 4 : 6,
            flexWrap: isTaskLedgerCard(selectedCard) ? 'nowrap' : 'wrap',
            overflowX: isTaskLedgerCard(selectedCard) ? 'auto' : 'visible',
            marginBottom: 10,
          })}
        >
          {tabs.map((entry) => {
            const active = tab === entry;
            return (
              <button
                key={entry}
                data-testid={`companion-tab-${entry.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                aria-pressed={active}
                onClick={(event) => {
                  event.stopPropagation();
                  void selectTab(entry);
                }}
                className="whitespace-nowrap transition-colors duration-150 ease-out"
                style={graphCompanionTabButtonStyle(
                  active,
                  isTaskLedgerCard(selectedCard)
                    ? { padding: '5px 6px', fontSize: 10, flex: '0 0 auto' }
                    : undefined,
                )}
              >
                {entry}
              </button>
            );
          })}
        </div>
      ) : null}
      <div
        data-testid="companion-surface-editor"
        style={{ display: 'grid', gap: 8 }}
      >
        <div className="space-y-3">{content}</div>
      </div>
    </>
  );
}
