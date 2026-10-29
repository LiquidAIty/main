/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: ThinkGraph
 * Relationship: Submits one committed conversation pair to the saved ThinkGraph profile through Hermes prompt.submit, outside Main's route.
 */
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { tsImport } from 'tsx/esm/api';
import { projectCardAuthority } from '../services/projectCardAuthority';
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import { resolveRepoRoot } from '../services/workingDirectories';
import { notifyThinkGraphChanged } from '../routes/thinkGraph.routes';
import type { ConversationMessage } from './store';

type Rpc = Record<string, any>;

// Native ticketed transport: the former caller drops client_env. Keep the
// saved-pair owner, app-visible session classification, and Hermes' shared RPC channel.
async function connectProfile(profile: string, onEvent: (event: Rpc) => void, onClose: () => void) {
  const root = path.join(resolveRepoRoot(), 'HermesLatest');
  const home = path.join(root, '.hermes', 'profiles', profile);
  const { JsonRpcRequestChannel } = await tsImport(
    pathToFileURL(path.join(root, 'apps/shared/src/json-rpc-channel.ts')).href,
    pathToFileURL(__filename).href,
  );
  const bootstrap = [
    'import json,os',
    'from pathlib import Path',
    'from hermes_cli.gateway_runtime import discover_gateway_endpoint',
    'from hermes_cli.gateway_client import _session_ticket,gateway_ws_target',
    'home=Path(os.environ["HERMES_HOME"])',
    'found=discover_gateway_endpoint(home)',
    'if found.endpoint is None: raise RuntimeError("existing_gateway_unavailable")',
    'print(json.dumps(gateway_ws_target(found.endpoint,_session_ticket(home,found.endpoint))))',
  ].join('\n');
  const { stdout } = await promisify(execFile)(
    path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
    ['-c', bootstrap],
    { cwd: root, env: { ...process.env, HERMES_HOME: home, PYTHONPATH: root },
      windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
  );
  const [url, protocols] = JSON.parse(stdout);
  const socket = new WebSocket(url, protocols, { handshakeTimeout: 10000 });
  const channel = new JsonRpcRequestChannel({ onEvent });
  let closing = false;
  socket.on('message', data => channel.handleFrame(data.toString()));
  socket.on('close', () => { channel.detach(new Error('thinkgraph_connection_closed')); if (!closing) onClose(); });
  socket.on('error', () => { channel.detach(new Error('thinkgraph_connection_error')); if (!closing) onClose(); });
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.once('open', () => {
      if (socket.protocol !== protocols[0]) {
        socket.close();
        reject(new Error('thinkgraph_gateway_protocol_mismatch'));
      } else {
        channel.attach({ send: (text: string) => socket.send(text) });
        channel.startHeartbeat();
        resolve();
      }
    });
  });
  return {
    request: (method: string, params: Rpc) => channel.request(method, params),
    close: () => { closing = true; channel.detach(new Error('thinkgraph_connection_closed')); socket.close(); },
  };
}

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

  let eventHandler = (_event: Rpc) => {};
  let closedHandler = () => {};
  let client = await connectProfile(speaker.profile!, event => eventHandler(event), () => closedHandler());
  const request = (method: string, params: Rpc) => client.request(method, params);
  let detach = () => {};
  try {
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
      const receipt = await request('prompt.receipt', {
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
    client.close();
    client = await connectProfile(target.profile, event => eventHandler(event), () => closedHandler());
    const created = await request('session.create', {
      request_id: prepared.preparation.pairReference, source: 'gui', hidden: true, follow_profile_config: true,
      client_env: { PROJECT_GRAPH_CONTEXT: JSON.stringify(prepared.projectMapContext) },
    });
    const sessionId = created.session_id || created.ref?.session_id;
    if (!sessionId) throw new Error('thinkgraph_submission_session_unavailable');
    const completion = new Promise<Rpc>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('thinkgraph_completion_timeout')), 1_800_000);
      eventHandler = (event: Rpc) => {
        if (event.session_id === sessionId && event.type === 'message.complete') resolve(event);
      };
      closedHandler = () => reject(new Error('thinkgraph_connection_closed'));
      detach = () => { clearTimeout(timeout); eventHandler = () => {}; closedHandler = () => {}; };
    });
    // A submission error may precede the completion; keep its rejection observed.
    void completion.catch(() => undefined);
    const submitted = await request('prompt.submit', {
      session_id: sessionId, submission_id: prepared.preparation.pairReference, finite: true,
      text: ['EXTRACTION_PROMPT:', prepared.preparation.enrichmentPrompt,
        'OUTPUT_SCHEMA:', JSON.stringify(prepared.preparation.enrichmentSchema)].join('\n'),
    });
    if (!submitted.admission_id) throw new Error('thinkgraph_submission_not_admitted');
    const event = await completion;
    if (event.admission_id !== submitted.admission_id) throw new Error('thinkgraph_completion_identity_mismatch');
    const receipt = await request('prompt.receipt', {
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
