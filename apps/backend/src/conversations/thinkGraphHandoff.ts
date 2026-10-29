/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: ThinkGraph
 * Relationship: Submits one committed conversation pair to the saved ThinkGraph profile through Hermes prompt.submit, outside Main's route.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { projectCardAuthority } from '../services/projectCardAuthority';
import { fetchThinkGraphProjection, requestPythonRailsJson } from '../services/pythonRailsClient';
import { resolveRepoRoot } from '../services/workingDirectories';
import { notifyThinkGraphChanged } from '../routes/thinkGraph.routes';
import type { ConversationMessage } from './store';

type Rpc = Record<string, any>;

export async function submitSavedThinkPair(answer: ConversationMessage): Promise<void> {
  if (answer.role !== 'assistant' || answer.status !== 'complete') return;
  const speaker = answer.visibleActivities?.find(item => item.kind === 'conversation_speaker');
  if (speaker?.profile !== 'main') return;
  const authority = await projectCardAuthority(answer.projectId, 'deck_builder');
  const target = authority.cards.find(item => item.card.id === 'card_thinkgraph' && item.profile === 'thinkgraph'
    && item.card.runtime.kind === 'hermes');
  if (!target || !authority.deck.edges.some(edge => edge.enabled !== false && edge.edgeType !== 'invalid'
    && ((edge.source === authority.main.card.id && edge.target === target.card.id)
      || (edge.target === authority.main.card.id && edge.source === target.card.id)))) return;

  const root = path.join(resolveRepoRoot(), 'HermesLatest');
  const home = path.join(root, '.hermes');
  const load = (file: string) => tsImport(pathToFileURL(path.join(root, file)).href, pathToFileURL(__filename).href);
  const [api, local, tickets] = await Promise.all([
    load('apps/desktop/src/api/client.ts'), load('apps/desktop/electron/local-gateway.ts'),
    load('apps/desktop/electron/local-gateway-python.ts'),
  ]);
  const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  // Existing provider discovery only: never start, ensure or restart the Gateway.
  const discovery = 'import os,json; from dataclasses import asdict; from hermes_cli.gateway_runtime import discover_gateway_endpoint; print(json.dumps(asdict(discover_gateway_endpoint(os.environ["HERMES_HOME"])),default=list))';
  const descriptor = await local.ensureLocalGateway(() => local.runGatewayEnsure({
    command: python, args: ['-c', discovery], shell: false, env: { PYTHONPATH: root },
  }, root, home, process.env, { timeoutMs: 15000, label: 'Hermes endpoint discovery' }));
  const resolveTicket = tickets.createGatewayTicketResolver(
    async () => ({ command: python, args: [], kind: 'python', shell: false, env: { PYTHONPATH: root } }), () => root,
  );
  const client = new api.HermesGateway();
  const request = (profile: string, method: string, params: Rpc) => client.request(method, { ...params, profile });
  let detach = () => {};
  try {
    const ticket = await resolveTicket(descriptor.gatewayEndpoint, 'interactive');
    await client.connect(local.createLocalGatewayDials().prepare(descriptor.baseUrl, ticket, 0));
    const stored = await requestPythonRailsJson('/thinkgraph/operation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: answer.projectId, operation: 'conversation',
        arguments: { action: 'read', conversationId: answer.conversationId } }),
    }) as ConversationMessage[];
    const candidates = stored.filter(item => item.role === 'user' && item.status === 'complete'
      && item.seq < answer.seq && item.providerContinuationRef === answer.providerContinuationRef
      && item.providerMessageId?.startsWith(`hermes:${speaker.profile}:admission:`));
    let sourceUser: ConversationMessage | undefined;
    for (const user of candidates.reverse()) {
      const admissionId = user.providerMessageId!.split(':').pop();
      // Read identity from the exact admission, not message bodies from a session history.
      const receipt = await request(speaker.profile!, 'prompt.receipt', {
        session_id: answer.providerContinuationRef, admission_id: admissionId, include_result: true,
      });
      const turn = receipt.result?.persisted_turn;
      if (receipt.status !== 'terminal' || receipt.outcome !== 'completed'
        || receipt.result?.partial || receipt.result?.interrupted || receipt.result?.failed
        || !Number.isSafeInteger(turn?.final_assistant_row_id)
        || answer.providerMessageId !== `hermes:${speaker.profile}:row:${turn.final_assistant_row_id}`) continue;
      // `complete` describes whole-transcript prefix coverage, not this completed pair.
      if (!Array.isArray(turn.user_row_ids) || turn.user_row_ids.length !== 1
        || !Number.isSafeInteger(turn.user_row_ids[0]) || turn.user_row_ids[0] <= 0) {
        throw new Error('thinkgraph_pair_identity_incomplete');
      }
      sourceUser = user;
      break;
    }
    if (!sourceUser) return; // An intermediate assistant row is not a completed user/assistant pair.
    const prepared = await requestPythonRailsJson('/thinkgraph/operation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: answer.projectId, operation: 'prepare_conversation_pair', arguments: {
        conversationId: answer.conversationId, userMessageIds: [sourceUser.messageId], assistantMessageId: answer.messageId,
      } }),
    }) as Rpc;
    if (!prepared.preparation?.structuredExtractionRequired) return;
    const graph = await fetchThinkGraphProjection(answer.projectId) as Rpc;
    const created = await request(target.profile, 'session.create', {
      request_id: prepared.preparation.pairReference, source: 'oneshot', hidden: true, follow_profile_config: true,
    });
    const sessionId = created.session_id || created.ref?.session_id;
    if (!sessionId) throw new Error('thinkgraph_submission_session_unavailable');
    const completion = new Promise<Rpc>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('thinkgraph_completion_timeout')), api.PROMPT_SUBMIT_REQUEST_TIMEOUT_MS);
      const offEvent = client.onEvent((event: Rpc) => {
        if (event.profile === target.profile && event.session_id === sessionId && event.type === 'message.complete') resolve(event);
      });
      const offState = client.onState((state: string) => {
        if (state === 'closed' || state === 'error') reject(new Error('thinkgraph_connection_closed'));
      });
      detach = () => { clearTimeout(timeout); offEvent(); offState(); };
    });
    // A submission error may precede the completion; keep its rejection observed.
    void completion.catch(() => undefined);
    const submitted = await request(target.profile, 'prompt.submit', {
      session_id: sessionId, submission_id: prepared.preparation.pairReference, finite: true,
      text: ['EXTRACTION_PROMPT:', prepared.preparation.enrichmentPrompt,
        'OUTPUT_SCHEMA:', JSON.stringify(prepared.preparation.enrichmentSchema),
        'PROJECT_ENTITY_MAP:', JSON.stringify(graph.canonicalEntityDirectory)].join('\n'),
    });
    if (!submitted.admission_id) throw new Error('thinkgraph_submission_not_admitted');
    const event = await completion;
    if (event.admission_id !== submitted.admission_id) throw new Error('thinkgraph_completion_identity_mismatch');
    const receipt = await request(target.profile, 'prompt.receipt', {
      session_id: sessionId, admission_id: submitted.admission_id, include_result: true,
    });
    if (receipt.status !== 'terminal' || receipt.outcome !== 'completed'
      || receipt.result?.partial || receipt.result?.interrupted || receipt.result?.failed
      || receipt.admission_id !== submitted.admission_id || receipt.ref?.session_id !== sessionId) {
      throw new Error('thinkgraph_execution_not_completed');
    }
    const settled = await requestPythonRailsJson('/thinkgraph/completed-pair/settle', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        ...prepared.source, pairReference: prepared.preparation.pairReference,
        structuredOutput: JSON.parse(receipt.result.final_response),
        cardRun: { cardId: target.card.id, revisionId: target.cardRevisionId, profile: target.profile,
          // The exact Hermes execution receipt, not a fabricated application Run.
          runId: submitted.admission_id, hermesSessionId: sessionId,
          resolvedProvider: receipt.result.provider, resolvedModel: receipt.result.model },
      }),
    }) as Rpc;
    if (settled.ok === true && settled.status === 'completed' && settled.revisionChanged === true) {
      notifyThinkGraphChanged(answer.projectId);
    }
  } finally {
    detach();
    client.close();
  }
}
