import type {
  AgentCardInstance,
  DeckEdge,
  DeckEdgeExecutionMode,
  DeckEdgeMergeIntent,
  DeckEdgeType,
  V3Blackboard,
} from '../types';

export type RuntimeActiveMergeIntent =
  | 'legacy_default'
  | 'all_inputs'
  | 'any_input'
  | 'first_success'
  | 'summarize_all';

export type GraphExecutionInputMode = 'legacy_text' | 'single_upstream' | 'structured_merge';

export type GraphExecutionInputSource = {
  edgeId: string;
  sourceCardId: string;
  sourceTitle: string;
  executionMode: DeckEdgeExecutionMode | 'legacy_default';
  output: string | null;
};

export type GraphExecutionRouteInfo = {
  mergeIntent: RuntimeActiveMergeIntent;
  inputMode: GraphExecutionInputMode;
  notes: string[];
  inputSources: GraphExecutionInputSource[];
};

export type GraphExecutionEvent =
  | {
      type: 'ready';
      card: AgentCardInstance;
      isStart: boolean;
      routeInfo: GraphExecutionRouteInfo;
    }
  | {
      type: 'skipped';
      card: AgentCardInstance;
      isStart: boolean;
      reason: string;
      routeInfo: GraphExecutionRouteInfo;
    };

type EdgeRuntimeState = {
  status: 'pending' | 'inactive' | 'satisfied';
  executionMode: DeckEdgeExecutionMode | 'legacy_default';
  blocking: boolean;
  resolvedOrder: number | null;
  note: string;
};

type MergeResolution = {
  mergeIntent: RuntimeActiveMergeIntent;
  notes: string[];
};

type ConditionResolution = {
  active: boolean;
  note: string;
};

const SUPPORTED_RUNTIME_MERGE_INTENTS = new Set<DeckEdgeMergeIntent>([
  'all_inputs',
  'any_input',
  'first_success',
  'summarize_all',
]);

function normalizeEdgeType(value: unknown): DeckEdgeType {
  return String(value || '').trim().toLowerCase() === 'magentic_option'
    ? 'magentic_option'
    : 'graph_flow';
}

function normalizeExecutionMode(edge: DeckEdge): DeckEdgeExecutionMode | 'legacy_default' {
  const executionMode = String(edge.metadata?.executionMode || '').trim().toLowerCase();
  if (executionMode === 'required') return 'required';
  if (executionMode === 'optional') return 'optional';
  if (executionMode === 'conditional') return 'conditional';
  return 'legacy_default';
}

function normalizeMergeIntentValue(value: unknown): DeckEdgeMergeIntent | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'all_inputs') return 'all_inputs';
  if (normalized === 'any_input') return 'any_input';
  if (normalized === 'first_success') return 'first_success';
  if (normalized === 'summarize_all') return 'summarize_all';
  if (normalized === 'select_best') return 'select_best';
  if (normalized === 'manual_review') return 'manual_review';
  return null;
}

function normalizeConditionType(edge: DeckEdge): string | null {
  const normalized = String(edge.metadata?.conditionType || '').trim().toLowerCase();
  return normalized || null;
}

function parseLiteral(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return numeric;
  return trimmed;
}

function coerceComparisonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return numeric;
  return trimmed;
}

function readBlackboardPath(path: string, blackboard: V3Blackboard): unknown {
  const normalized = path.trim();
  if (normalized === 'blackboard.current_goal') return blackboard.current_goal;
  if (normalized === 'blackboard.next_move') return blackboard.next_move;
  if (normalized.startsWith('blackboard.store.')) {
    const key = normalized.slice('blackboard.store.'.length).trim();
    return key ? blackboard.store?.[key] ?? null : null;
  }
  return undefined;
}

function evaluateSimpleConditionExpression(
  expression: string,
  blackboard: V3Blackboard,
): ConditionResolution {
  const trimmed = expression.trim();
  const normalized = trimmed.toLowerCase();

  if (normalized === 'true' || normalized === 'always') {
    return {
      active: true,
      note: `Conditional edge ran because expression "${trimmed}" resolved to always.`,
    };
  }

  if (normalized === 'false' || normalized === 'never') {
    return {
      active: false,
      note: `Conditional edge skipped because expression "${trimmed}" resolved to never.`,
    };
  }

  const comparisonMatch = trimmed.match(
    /^(blackboard(?:\.store\.[A-Za-z0-9_-]+|\.current_goal|\.next_move))\s*(===|!==|==|!=)\s*(.+)$/i,
  );
  if (!comparisonMatch) {
    return {
      active: false,
      note: `Conditional edge skipped because expression "${trimmed}" is preserved-only in this runtime.`,
    };
  }

  const [, path, operator, rawRight] = comparisonMatch;
  const leftValue = coerceComparisonValue(readBlackboardPath(path, blackboard));
  const rightValue = parseLiteral(rawRight);
  const equals = leftValue === rightValue;
  const active = operator === '===' || operator === '==' ? equals : !equals;

  return {
    active,
    note: active
      ? `Conditional edge ran because ${path} ${operator} ${rawRight.trim()} passed.`
      : `Conditional edge skipped because ${path} ${operator} ${rawRight.trim()} did not pass.`,
  };
}

function evaluateConditionalEdge(edge: DeckEdge, blackboard: V3Blackboard): ConditionResolution {
  const conditionType = normalizeConditionType(edge);
  const conditionExpression = String(edge.metadata?.conditionExpression || '').trim();
  const conditionLabel = String(edge.metadata?.conditionLabel || '').trim();

  if (conditionType === 'always') {
    return {
      active: true,
      note: 'Conditional edge ran because conditionType=always.',
    };
  }

  if (conditionType === 'never') {
    return {
      active: false,
      note: 'Conditional edge skipped because conditionType=never.',
    };
  }

  if (conditionExpression) {
    return evaluateSimpleConditionExpression(conditionExpression, blackboard);
  }

  if (conditionType === 'label_only' || conditionType === 'label' || conditionLabel) {
    return {
      active: false,
      note: 'Conditional edge skipped because label-only conditions are preserved but not executable yet.',
    };
  }

  return {
    active: false,
    note: 'Conditional edge skipped because it has no executable condition.',
  };
}

function supportsRuntimeMergeIntent(value: DeckEdgeMergeIntent | null): value is Exclude<DeckEdgeMergeIntent, 'select_best' | 'manual_review'> {
  return Boolean(value && SUPPORTED_RUNTIME_MERGE_INTENTS.has(value));
}

function resolveMergeIntent(edges: DeckEdge[]): MergeResolution {
  const rawMergeIntents = edges
    .map((edge) => normalizeMergeIntentValue(edge.metadata?.mergeIntent))
    .filter((value): value is DeckEdgeMergeIntent => Boolean(value));

  if (rawMergeIntents.length === 0) {
    return {
      mergeIntent: 'legacy_default',
      notes: ['Merge policy used legacy graph_flow defaults because no edge metadata was present.'],
    };
  }

  const firstSupported = rawMergeIntents.find((value) => supportsRuntimeMergeIntent(value)) || null;
  if (!firstSupported) {
    return {
      mergeIntent: 'legacy_default',
      notes: [
        `Merge metadata (${rawMergeIntents.join(', ')}) is preserved-only in this runtime. Using legacy all_inputs behavior.`,
      ],
    };
  }

  const conflictingSupported = rawMergeIntents.filter((value) => supportsRuntimeMergeIntent(value) && value !== firstSupported);
  return {
    mergeIntent: firstSupported,
    notes: conflictingSupported.length > 0
      ? [
          `Conflicting merge metadata was present (${rawMergeIntents.join(', ')}). Using ${firstSupported} from the first saved edge.`,
        ]
      : [`Merge policy ${firstSupported} is active for this node.`],
  };
}

function defaultEdgeState(): EdgeRuntimeState {
  return {
    status: 'pending',
    executionMode: 'legacy_default',
    blocking: true,
    resolvedOrder: null,
    note: 'Waiting for upstream execution.',
  };
}

function buildStructuredMergePayload(
  card: AgentCardInstance,
  sources: GraphExecutionInputSource[],
): string {
  return JSON.stringify(
    {
      type: 'deck_merge_input',
      mergeIntent: 'summarize_all',
      targetCardId: card.id,
      targetTitle: card.title,
      upstreamInputs: sources.map((source) => ({
        edgeId: source.edgeId,
        sourceCardId: source.sourceCardId,
        sourceTitle: source.sourceTitle,
        executionMode: source.executionMode,
        output: source.output || '',
      })),
    },
    null,
    2,
  );
}

export function buildGraphExecutionInputText(options: {
  card: AgentCardInstance;
  routeInfo: GraphExecutionRouteInfo;
  isStart: boolean;
  baseInput?: string;
  blackboardInput?: string;
}): string {
  const sections: string[] = [];
  const baseInput = String(options.baseInput || '').trim();
  const blackboardInput = String(options.blackboardInput || '').trim();

  if (options.isStart && baseInput) {
    sections.push(baseInput);
  }
  if (blackboardInput) {
    sections.push(blackboardInput);
  }

  if (options.routeInfo.inputSources.length > 0) {
    if (options.routeInfo.inputMode === 'structured_merge') {
      sections.push(
        [
          'Use the structured upstream merge payload below as the authoritative graph input for this card.',
          buildStructuredMergePayload(options.card, options.routeInfo.inputSources),
        ].join('\n\n'),
      );
    } else if (options.routeInfo.inputMode === 'single_upstream') {
      const firstSource = options.routeInfo.inputSources[0];
      const upstreamOutput = String(firstSource?.output || '').trim();
      if (upstreamOutput) {
        sections.push(upstreamOutput);
      }
    } else {
      const upstreamText = options.routeInfo.inputSources
        .map((source) => String(source.output || '').trim())
        .filter(Boolean)
        .join('\n\n')
        .trim();
      if (upstreamText) {
        sections.push(upstreamText);
      }
    }
  }

  return sections.join('\n\n').trim() || baseInput;
}

export function createGraphExecutionScheduler(options: {
  nodes: AgentCardInstance[];
  edges: DeckEdge[];
  startCardIds?: string[];
}) {
  const nodeMap = new Map(options.nodes.map((node) => [node.id, node] as const));
  const documentOrder = new Map(options.nodes.map((node, index) => [node.id, index] as const));
  const edgeOrder = new Map(options.edges.map((edge, index) => [edge.id, index] as const));
  const graphEdges = options.edges.filter(
    (edge) =>
      normalizeEdgeType(edge.edgeType) === 'graph_flow' &&
      nodeMap.has(edge.source) &&
      nodeMap.has(edge.target),
  );
  const incomingByTarget = new Map<string, DeckEdge[]>();
  const outgoingBySource = new Map<string, DeckEdge[]>();
  const edgeStates = new Map<string, EdgeRuntimeState>();
  const nodeStates = new Map<string, 'pending' | 'queued' | 'success' | 'skipped'>();
  const outputsByCardId = new Map<string, string>();
  const readyQueue: string[] = [];
  const skippedEvents: GraphExecutionEvent[] = [];
  const startCardIds =
    options.startCardIds && options.startCardIds.length > 0
      ? options.startCardIds.filter((cardId) => nodeMap.has(cardId))
      : options.nodes
          .filter((node) => !graphEdges.some((edge) => edge.target === node.id))
          .map((node) => node.id);
  let resolutionCounter = 0;

  options.nodes.forEach((node) => {
    incomingByTarget.set(node.id, []);
    outgoingBySource.set(node.id, []);
    nodeStates.set(node.id, 'pending');
  });

  graphEdges.forEach((edge) => {
    incomingByTarget.set(edge.target, [...(incomingByTarget.get(edge.target) || []), edge]);
    outgoingBySource.set(edge.source, [...(outgoingBySource.get(edge.source) || []), edge]);
    edgeStates.set(edge.id, defaultEdgeState());
  });

  startCardIds
    .slice()
    .sort((left, right) => (documentOrder.get(left) || 0) - (documentOrder.get(right) || 0))
    .forEach((cardId) => {
      readyQueue.push(cardId);
      nodeStates.set(cardId, 'queued');
    });

  function getSortedInboundEdges(cardId: string): DeckEdge[] {
    return [...(incomingByTarget.get(cardId) || [])].sort(
      (left, right) => (edgeOrder.get(left.id) || 0) - (edgeOrder.get(right.id) || 0),
    );
  }

  function buildInputSources(cardId: string, mergeIntent: RuntimeActiveMergeIntent): GraphExecutionInputSource[] {
    const satisfiedEdges = getSortedInboundEdges(cardId)
      .map((edge) => ({ edge, state: edgeStates.get(edge.id) || defaultEdgeState() }))
      .filter(({ state }) => state.status === 'satisfied')
      .map(({ edge, state }) => {
        const sourceCard = nodeMap.get(edge.source);
        return {
          edgeId: edge.id,
          sourceCardId: edge.source,
          sourceTitle: sourceCard?.title || edge.source,
          executionMode: state.executionMode,
          output: outputsByCardId.get(edge.source) || null,
          resolvedOrder: state.resolvedOrder || 0,
        };
      });

    if (mergeIntent === 'any_input' || mergeIntent === 'first_success') {
      const firstSatisfied = [...satisfiedEdges].sort((left, right) => left.resolvedOrder - right.resolvedOrder)[0];
      return firstSatisfied
        ? [
            {
              edgeId: firstSatisfied.edgeId,
              sourceCardId: firstSatisfied.sourceCardId,
              sourceTitle: firstSatisfied.sourceTitle,
              executionMode: firstSatisfied.executionMode,
              output: firstSatisfied.output,
            },
          ]
        : [];
    }

    return satisfiedEdges.map(({ resolvedOrder: _ignoredResolvedOrder, ...source }) => source);
  }

  function buildRouteInfo(cardId: string): GraphExecutionRouteInfo {
    const inboundEdges = getSortedInboundEdges(cardId);
    const mergeResolution = resolveMergeIntent(inboundEdges);
    const inputSources = buildInputSources(cardId, mergeResolution.mergeIntent);
    const edgeNotes = inboundEdges
      .map((edge) => edgeStates.get(edge.id)?.note || null)
      .filter((note): note is string => Boolean(note));
    const inputMode: GraphExecutionInputMode =
      mergeResolution.mergeIntent === 'summarize_all'
        ? 'structured_merge'
        : mergeResolution.mergeIntent === 'any_input' || mergeResolution.mergeIntent === 'first_success'
          ? 'single_upstream'
          : 'legacy_text';

    return {
      mergeIntent: mergeResolution.mergeIntent,
      inputMode,
      notes: [...mergeResolution.notes, ...edgeNotes],
      inputSources,
    };
  }

  function pendingEdgeCanStillBlock(edge: DeckEdge): boolean {
    const executionMode = normalizeExecutionMode(edge);
    return executionMode === 'legacy_default' || executionMode === 'required' || executionMode === 'conditional';
  }

  function evaluateNodeTransition(cardId: string): { ready: boolean; skip: boolean; reason?: string } {
    const inboundEdges = getSortedInboundEdges(cardId);
    if (inboundEdges.length === 0) {
      return { ready: true, skip: false };
    }

    const mergeResolution = resolveMergeIntent(inboundEdges);
    const inboundStates = inboundEdges.map((edge) => ({
      edge,
      state: edgeStates.get(edge.id) || defaultEdgeState(),
    }));
    const satisfiedCount = inboundStates.filter(({ state }) => state.status === 'satisfied').length;
    const pendingCount = inboundStates.filter(({ state }) => state.status === 'pending').length;
    const pendingBlockingCount = inboundStates.filter(
      ({ edge, state }) => state.status === 'pending' && pendingEdgeCanStillBlock(edge),
    ).length;

    switch (mergeResolution.mergeIntent) {
      case 'any_input':
      case 'first_success':
        if (satisfiedCount > 0) {
          return { ready: true, skip: false };
        }
        if (pendingCount === 0) {
          return {
            ready: false,
            skip: true,
            reason: `No upstream route satisfied merge policy ${mergeResolution.mergeIntent}.`,
          };
        }
        return { ready: false, skip: false };
      case 'summarize_all':
      case 'all_inputs':
      case 'legacy_default':
      default:
        if (pendingBlockingCount > 0) {
          return { ready: false, skip: false };
        }
        if (satisfiedCount > 0) {
          return { ready: true, skip: false };
        }
        if (pendingCount === 0) {
          return {
            ready: false,
            skip: true,
            reason:
              mergeResolution.mergeIntent === 'summarize_all'
                ? 'No upstream outputs were available to summarize.'
                : 'No upstream route produced an input for this node.',
          };
        }
        return { ready: false, skip: false };
    }
  }

  function flushTransitions(): void {
    let changed = true;
    while (changed) {
      changed = false;
      const pendingNodes = options.nodes
        .filter((node) => nodeStates.get(node.id) === 'pending')
        .sort(
          (left, right) =>
            (documentOrder.get(left.id) || 0) - (documentOrder.get(right.id) || 0),
        );

      for (const node of pendingNodes) {
        const transition = evaluateNodeTransition(node.id);
        if (transition.ready) {
          readyQueue.push(node.id);
          nodeStates.set(node.id, 'queued');
          changed = true;
          continue;
        }

        if (transition.skip) {
          nodeStates.set(node.id, 'skipped');
          skippedEvents.push({
            type: 'skipped',
            card: node,
            isStart: startCardIds.includes(node.id),
            reason: transition.reason || 'This node was skipped by graph routing.',
            routeInfo: buildRouteInfo(node.id),
          });

          (outgoingBySource.get(node.id) || []).forEach((edge) => {
            resolutionCounter += 1;
            edgeStates.set(edge.id, {
              status: 'inactive',
              executionMode: normalizeExecutionMode(edge),
              blocking: false,
              resolvedOrder: resolutionCounter,
              note: `Edge "${edge.id}" was skipped because source card "${node.id}" did not run.`,
            });
          });
          changed = true;
        }
      }
    }
  }

  function buildSatisfiedEdgeState(
    edge: DeckEdge,
    blackboard: V3Blackboard,
  ): EdgeRuntimeState {
    const executionMode = normalizeExecutionMode(edge);
    if (executionMode === 'legacy_default') {
      return {
        status: 'satisfied',
        executionMode,
        blocking: true,
        resolvedOrder: resolutionCounter,
        note: `Edge "${edge.id}" used legacy graph_flow defaults and participated as required execution.`,
      };
    }

    if (executionMode === 'required') {
      return {
        status: 'satisfied',
        executionMode,
        blocking: true,
        resolvedOrder: resolutionCounter,
        note: `Edge "${edge.id}" participated as a required execution route.`,
      };
    }

    if (executionMode === 'optional') {
      return {
        status: 'satisfied',
        executionMode,
        blocking: false,
        resolvedOrder: resolutionCounter,
        note: `Edge "${edge.id}" participated as an optional execution route.`,
      };
    }

    const condition = evaluateConditionalEdge(edge, blackboard);
    return {
      status: condition.active ? 'satisfied' : 'inactive',
      executionMode,
      blocking: condition.active,
      resolvedOrder: resolutionCounter,
      note: `Edge "${edge.id}": ${condition.note}`,
    };
  }

  return {
    next(): GraphExecutionEvent | null {
      flushTransitions();

      if (skippedEvents.length > 0) {
        return skippedEvents.shift() || null;
      }

      const nextCardId = readyQueue.shift();
      if (!nextCardId) return null;
      const card = nodeMap.get(nextCardId);
      if (!card) return null;
      return {
        type: 'ready',
        card,
        isStart: startCardIds.includes(card.id),
        routeInfo: buildRouteInfo(card.id),
      };
    },

    markSuccess(cardId: string, output: string | null, blackboard: V3Blackboard): void {
      nodeStates.set(cardId, 'success');
      outputsByCardId.set(cardId, String(output || '').trim());

      (outgoingBySource.get(cardId) || []).forEach((edge) => {
        resolutionCounter += 1;
        edgeStates.set(edge.id, buildSatisfiedEdgeState(edge, blackboard));
      });
    },

    getUnresolvedNodeIds(): string[] {
      flushTransitions();
      return options.nodes
        .filter((node) => {
          const status = nodeStates.get(node.id);
          return status !== 'success' && status !== 'skipped' && status !== 'queued';
        })
        .map((node) => node.id);
    },

    getTerminalExecutedNodeIds(): string[] {
      return options.nodes
        .filter((node) => nodeStates.get(node.id) === 'success')
        .map((node) => node.id)
        .filter(
          (cardId) =>
            !(outgoingBySource.get(cardId) || []).some((edge) => {
              const edgeState = edgeStates.get(edge.id);
              return edgeState?.status === 'satisfied';
            }),
        );
    },
  };
}
