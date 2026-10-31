/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: ThinkGraph
 * Relationship: Delivers one committed conversation pair to the saved ThinkGraph Bot Chat through Hermes bot_relay.deliver, outside Main's route.
 * Entity: KnowGraph
 * Relationship: Requests optional research preparation for one settled Think and forwards its returned mission to the saved KnowGraph profile through Hermes bot_relay.deliver.
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

// Attach to the existing profile authority using Hermes' own ticket and RPC channel.
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
    const chat = await request('session.resume', { title: 'Bot Chat' });
    const sessionId = chat.session_id;
    if (!sessionId) throw new Error('thinkgraph_submission_session_unavailable');
    let admissionId = '';
    const completion = new Promise<Rpc>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('thinkgraph_completion_timeout')), 1_800_000);
      eventHandler = (event: Rpc) => {
        if (event.session_id === sessionId && event.admission_id === admissionId
          && event.type === 'message.complete') resolve(event);
      };
      closedHandler = () => reject(new Error('thinkgraph_connection_closed'));
      detach = () => { clearTimeout(timeout); eventHandler = () => {}; closedHandler = () => {}; };
    });
    // A submission error may precede the completion; keep its rejection observed.
    void completion.catch(() => undefined);
    const submitted = await request('bot_relay.deliver', {
      id: prepared.preparation.pairReference.replace(/^pair_/, ''),
      profile: target.profile, session_id: sessionId,
      message: JSON.stringify({
        projectMapContext: prepared.projectMapContext,
        input: ['EXTRACTION_PROMPT:', prepared.preparation.enrichmentPrompt,
          'OUTPUT_SCHEMA:', JSON.stringify(prepared.preparation.enrichmentSchema)].join('\n'),
      }),
    });
    admissionId = submitted.retry_admission_id || submitted.admission_id;
    if (!admissionId || submitted.session_id !== sessionId) throw new Error('thinkgraph_submission_not_admitted');
    let receipt = await request('prompt.receipt', {
      session_id: sessionId, admission_id: admissionId, include_result: true,
    });
    if (receipt.status !== 'terminal') {
      await completion;
      receipt = await request('prompt.receipt', {
        session_id: sessionId, admission_id: admissionId, include_result: true,
      });
    }
    if (receipt.status !== 'terminal' || receipt.outcome !== 'completed'
      || receipt.result?.partial || receipt.result?.interrupted || receipt.result?.failed
      || receipt.admission_id !== admissionId || receipt.ref?.session_id !== sessionId) {
      throw new Error('thinkgraph_execution_not_completed');
    }
    const settled = await requestPythonRailsJson('/thinkgraph/completed-pair/settle', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        ...prepared.source, pairReference: prepared.preparation.pairReference,
        structuredOutput: JSON.parse(receipt.result.final_response),
        cardRun: { cardId: target.card.id, revisionId: target.cardRevisionId, profile: target.profile,
          // The exact Hermes execution receipt, not a fabricated application Run.
          runId: admissionId, hermesSessionId: sessionId,
          resolvedProvider: receipt.result.provider, resolvedModel: receipt.result.model },
      }),
    }) as Rpc;
    if (settled.ok === true && settled.status === 'completed' && settled.revisionChanged === true) {
      notifyThinkGraphChanged(answer.projectId);
    }
    const candidate = settled.intakeOperation === 'add'
      ? settled.thinks?.find((think: Rpc) => think.researchRequested === true) : null;
    const researcher = authority.cards.find(item => item.card.id === 'card_knowgraph' && item.profile === 'knowgraph'
      && item.card.enabled !== false && item.card.runtime.kind === 'hermes');
    if (candidate && researcher) {
      let researchId = '';
      let admissionAttempted = false;
      try {
        const research = await requestPythonRailsJson('/knowgraph/research/prepare', {
          method: 'POST', headers: { 'Content-Type': 'application/json',
            'X-LiquidAIty-Internal-MCP-Secret': process.env.LIQUIDAITY_INTERNAL_MCP_SECRET || '' }, body: JSON.stringify({
            projectId: answer.projectId, pairReference: settled.pairReference, thinkId: candidate.engraphisMemoryId,
          }),
        }) as Rpc;
        if (!research.enabled) return;
        researchId = research.requestId;
        detach(); client.close();
        client = await connectProfile(researcher.profile, () => {}, () => {});
        const chat = await request('session.resume', { title: 'Bot Chat' });
        admissionAttempted = true;
        const receipt = await request('bot_relay.deliver', { id: research.requestId, profile: researcher.profile,
          session_id: chat.session_id, message: research.message });
        if (!receipt.admission_id && !receipt.retry_admission_id) throw new Error('research_admission_unconfirmed');
        console.info('[knowgraph-research]', { projectId: answer.projectId, requestId: researchId,
          admissionId: receipt.admission_id, status: receipt.status });
      } catch (error) {
        // A lost acknowledgement is unknown, not proof that nothing was admitted.
        console.error('[knowgraph-research]', { projectId: answer.projectId, requestId: researchId,
          status: admissionAttempted ? 'admission_unknown' : 'not_submitted', error: String(error) });
      }
    }
  } finally {
    detach();
    client.close();
  }
}
