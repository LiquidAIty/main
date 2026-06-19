// Safe KnowGraph ingest for graph-seeded search EVIDENCE (not facts). Converts
// SearchAgentResultPackets into project-scoped, source-backed evidence nodes/relationships in
// the existing Neo4j KnowGraph. It NEVER promotes a packet's observed entities/sources into
// verified facts — only later extraction/acceptance may do that. No truth-claim relationship
// types are written. No live search is called here. No second Neo4j connection system: it
// reuses getNeo4jDriver and the shared Neo4j-safe property serializer.
import type { Driver } from 'neo4j-driver';
import { getNeo4jDriver } from '../connectors/neo4j';
import { toNeoSafeProperties } from '../graph/neoSafeProperties';
import type { SearchAgentResultPacket } from './graphSeededSearchConvergence';

// Evidence-only labels (raw/reviewable; NOT verified KnowGraph :SemanticRecord facts).
export const EVIDENCE_NODE_LABELS = ['SearchRun', 'SearchPacket', 'SearchTask', 'Source', 'ObservedEntity', 'GraphSeed'] as const;
// Evidence relationships that record provenance WITHOUT asserting truth of any claim.
export const EVIDENCE_REL_TYPES = ['PART_OF_SEARCH_RUN', 'DERIVED_FROM_GRAPH_SEED', 'PACKET_FOR_TASK', 'RETURNED_SOURCE', 'MENTIONS_ENTITY', 'HAS_SOURCE_REF'] as const;
// Relationship types that would imply a claim is TRUE — never written by this evidence path.
export const TRUTH_CLAIM_REL_TYPES = ['PROVES', 'CONFIRMS', 'IS_TRUE', 'HAS_PRICE', 'PUBLICLY_TRADES_AS'] as const;

const NODE_LABEL_SET = new Set<string>(EVIDENCE_NODE_LABELS);
const REL_TYPE_SET = new Set<string>(EVIDENCE_REL_TYPES);

export type EvidenceNode = { id: string; label: (typeof EVIDENCE_NODE_LABELS)[number]; properties: Record<string, unknown> };
export type EvidenceRelationship = { type: (typeof EVIDENCE_REL_TYPES)[number]; fromId: string; toId: string; properties: Record<string, unknown> };

export type EvidenceWritePlan =
  | { ok: true; projectId: string; runId: string; nodes: EvidenceNode[]; relationships: EvidenceRelationship[] }
  | { ok: false; reason: string };

export type IngestSearchPacketsInput = {
  projectId: string;
  runId: string;
  graphSeedSourceRef?: string;
  packets: SearchAgentResultPacket[];
};

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function isValidPacket(p: unknown): p is SearchAgentResultPacket {
  if (!p || typeof p !== 'object') return false;
  const pkt = p as Record<string, unknown>;
  return (
    clean(pkt.searchTaskId).length > 0 &&
    typeof pkt.query === 'string' &&
    Array.isArray(pkt.sourceRefs) &&
    Array.isArray(pkt.entities)
  );
}

/**
 * Pure mapper: SearchAgentResultPackets -> a project-scoped evidence write plan (nodes +
 * relationships) using ONLY evidence labels/rel types. Deterministic. Dedupes sources by URL
 * and observed entities by lowercased label. Fails closed on missing projectId/runId or a
 * malformed packet. NO truth-claim relationships are ever produced.
 */
export function searchPacketsToKnowGraphEvidence(input: IngestSearchPacketsInput): EvidenceWritePlan {
  const projectId = clean(input.projectId);
  const runId = clean(input.runId);
  if (!projectId) return { ok: false, reason: 'project_id_required' };
  if (!runId) return { ok: false, reason: 'run_id_required' };
  const packets = Array.isArray(input.packets) ? input.packets : [];
  if (packets.length === 0) return { ok: false, reason: 'no_packets' };
  for (const p of packets) {
    if (!isValidPacket(p)) return { ok: false, reason: 'invalid_packet' };
  }
  const graphSeedSourceRef = clean(input.graphSeedSourceRef);
  const ts = new Date().toISOString();

  const nodeById = new Map<string, EvidenceNode>();
  const relationships: EvidenceRelationship[] = [];
  const addNode = (node: EvidenceNode) => {
    if (!NODE_LABEL_SET.has(node.label)) return; // defense: evidence labels only
    if (!nodeById.has(node.id)) nodeById.set(node.id, { ...node, properties: toNeoSafeProperties({ ...node.properties, project_id: projectId }) });
  };
  const addRel = (rel: EvidenceRelationship) => {
    if (!REL_TYPE_SET.has(rel.type)) return; // defense: evidence rels only, never truth-claims
    relationships.push({ ...rel, properties: toNeoSafeProperties({ ...rel.properties, project_id: projectId }) });
  };

  const runNodeId = runId;
  addNode({ id: runNodeId, label: 'SearchRun', properties: { run_id: runId, graph_seed_source_ref: graphSeedSourceRef || null, created_at: ts } });

  if (graphSeedSourceRef) {
    const seedId = `${projectId}::seed::${graphSeedSourceRef}`;
    addNode({ id: seedId, label: 'GraphSeed', properties: { source_ref: graphSeedSourceRef, created_at: ts } });
    addRel({ type: 'DERIVED_FROM_GRAPH_SEED', fromId: runNodeId, toId: seedId, properties: {} });
  }

  packets.forEach((packet, index) => {
    const searchTaskId = clean(packet.searchTaskId);
    const packetId = `${runId}::packet::${searchTaskId}::${clean(packet.agentId) || `a${index}`}`;
    addNode({
      id: packetId,
      label: 'SearchPacket',
      properties: {
        run_id: runId,
        agent_id: clean(packet.agentId),
        search_task_id: searchTaskId,
        query: clean(packet.query),
        source_count: packet.sourceRefs.length,
        entity_count: packet.entities.length,
        uncertainty: (packet.uncertainty || []).map((u) => clean(u)).filter(Boolean),
        created_at: ts,
      },
    });
    addRel({ type: 'PART_OF_SEARCH_RUN', fromId: packetId, toId: runNodeId, properties: {} });

    const taskId = `${projectId}::task::${searchTaskId}`;
    addNode({ id: taskId, label: 'SearchTask', properties: { search_task_id: searchTaskId, query: clean(packet.query), run_id: runId } });
    addRel({ type: 'PACKET_FOR_TASK', fromId: packetId, toId: taskId, properties: {} });

    for (const ref of packet.sourceRefs) {
      const url = clean(ref?.url || ref?.ref);
      if (!url) continue;
      const sourceId = `${projectId}::source::${url}`;
      addNode({
        id: sourceId,
        label: 'Source',
        properties: { url, ref: clean(ref?.ref) || url, title: clean(ref?.title) || url, source_type: clean(ref?.sourceType) || 'web' },
      });
      // RETURNED_SOURCE: this packet got this source back. HAS_SOURCE_REF: the source ref is
      // recorded on the packet. Neither asserts the source's claims are true.
      addRel({ type: 'RETURNED_SOURCE', fromId: packetId, toId: sourceId, properties: {} });
      addRel({ type: 'HAS_SOURCE_REF', fromId: packetId, toId: sourceId, properties: { ref: clean(ref?.ref) || url } });
    }

    for (const entity of packet.entities) {
      const label = clean(entity?.label);
      if (!label) continue;
      const entityId = `${projectId}::obsentity::${label.toLowerCase()}`;
      addNode({
        id: entityId,
        label: 'ObservedEntity',
        properties: { label, label_lc: label.toLowerCase(), observed: true, type: clean((entity as any)?.type) || null },
      });
      // MENTIONS_ENTITY: this entity was OBSERVED (mentioned) in the packet's sources — not a
      // verified fact about the entity.
      addRel({
        type: 'MENTIONS_ENTITY',
        fromId: packetId,
        toId: entityId,
        properties: { observed_confidence: typeof entity?.confidence === 'number' ? entity.confidence : null },
      });
    }
  });

  return { ok: true, projectId, runId, nodes: Array.from(nodeById.values()), relationships };
}

export type IngestResult =
  | { ok: true; projectId: string; runId: string; nodeCount: number; relationshipCount: number; nodeIds: string[]; sourceCount: number; entityCount: number }
  | { ok: false; reason: string };

export type IngestDeps = { driver?: Driver };

/**
 * Write the evidence plan into the real Neo4j KnowGraph (project-scoped) via MERGE (idempotent,
 * dedupes on re-run). Reuses getNeo4jDriver. Fails closed BEFORE opening a session when the
 * input is invalid. Never calls live search.
 */
export async function ingestSearchAgentPacketsToKnowGraph(
  input: IngestSearchPacketsInput,
  deps: IngestDeps = {},
): Promise<IngestResult> {
  const plan = searchPacketsToKnowGraphEvidence(input);
  if (!plan.ok) return { ok: false, reason: plan.reason };

  const driver = deps.driver ?? getNeo4jDriver();
  const database = clean(process.env.NEO4J_DATABASE);
  const session = driver.session(database ? { database } : undefined);
  try {
    for (const node of plan.nodes) {
      if (!NODE_LABEL_SET.has(node.label)) continue;
      await session.run(
        `MERGE (n:\`${node.label}\` { id: $id })
         ON CREATE SET n.created_at = $props.created_at
         SET n += $props, n.id = $id, n.project_id = $projectId`,
        { id: node.id, props: node.properties, projectId: plan.projectId },
      );
    }
    for (const rel of plan.relationships) {
      if (!REL_TYPE_SET.has(rel.type)) continue;
      await session.run(
        `MATCH (a { id: $fromId }), (b { id: $toId })
         MERGE (a)-[r:\`${rel.type}\` { id: $relId }]->(b)
         SET r += $props, r.project_id = $projectId`,
        { fromId: rel.fromId, toId: rel.toId, relId: `${rel.fromId}->${rel.toId}:${rel.type}`, props: rel.properties, projectId: plan.projectId },
      );
    }
    const sourceCount = plan.nodes.filter((n) => n.label === 'Source').length;
    const entityCount = plan.nodes.filter((n) => n.label === 'ObservedEntity').length;
    return {
      ok: true,
      projectId: plan.projectId,
      runId: plan.runId,
      nodeCount: plan.nodes.length,
      relationshipCount: plan.relationships.length,
      nodeIds: plan.nodes.map((n) => n.id),
      sourceCount,
      entityCount,
    };
  } catch (err: any) {
    return { ok: false, reason: clean(err?.message) || 'knowgraph_evidence_write_failed' };
  } finally {
    await session.close();
  }
}

export type ReadBackResult =
  | {
      ok: true;
      projectId: string;
      runId: string;
      packets: Array<{ id: string; query: string; sources: Array<{ url: string; title: string; ref: string }>; entities: string[] }>;
      relTypes: string[];
      truthClaimRelTypesFound: string[];
      packetCount: number;
      sourceCount: number;
      entityCount: number;
    }
  | { ok: false; reason: string };

/**
 * Read back the evidence written for one run (project-scoped) to prove it persisted, and that
 * NO truth-claim relationship type exists on the evidence subgraph.
 */
export async function readBackSearchEvidence(
  query: { projectId: string; runId: string },
  deps: IngestDeps = {},
): Promise<ReadBackResult> {
  const projectId = clean(query.projectId);
  const runId = clean(query.runId);
  if (!projectId || !runId) return { ok: false, reason: 'project_id_and_run_id_required' };

  const driver = deps.driver ?? getNeo4jDriver();
  const database = clean(process.env.NEO4J_DATABASE);
  const session = driver.session(database ? { database } : undefined);
  try {
    const res = await session.run(
      `MATCH (p:SearchPacket { project_id: $projectId, run_id: $runId })
       OPTIONAL MATCH (p)-[:RETURNED_SOURCE]->(s:Source)
       OPTIONAL MATCH (p)-[:MENTIONS_ENTITY]->(e:ObservedEntity)
       OPTIONAL MATCH (p)-[r]->()
       RETURN p.id AS packet_id, p.query AS query,
         collect(DISTINCT { url: s.url, title: s.title, ref: s.ref }) AS sources,
         collect(DISTINCT e.label) AS entities,
         collect(DISTINCT type(r)) AS rel_types`,
      { projectId, runId },
    );

    const packets: Array<{ id: string; query: string; sources: Array<{ url: string; title: string; ref: string }>; entities: string[] }> = [];
    const relTypeSet = new Set<string>();
    let sourceCount = 0;
    let entityCount = 0;
    for (const record of res.records) {
      const sources = (record.get('sources') as any[]).filter((x) => x && x.url).map((x) => ({ url: String(x.url), title: String(x.title || x.url), ref: String(x.ref || x.url) }));
      const entities = (record.get('entities') as any[]).filter(Boolean).map((x) => String(x));
      (record.get('rel_types') as any[]).filter(Boolean).forEach((t) => relTypeSet.add(String(t)));
      sourceCount += sources.length;
      entityCount += entities.length;
      packets.push({ id: String(record.get('packet_id') || ''), query: String(record.get('query') || ''), sources, entities });
    }
    const relTypes = Array.from(relTypeSet);
    const truthClaimRelTypesFound = relTypes.filter((t) => (TRUTH_CLAIM_REL_TYPES as readonly string[]).includes(t));
    return {
      ok: true,
      projectId,
      runId,
      packets,
      relTypes,
      truthClaimRelTypesFound,
      packetCount: packets.length,
      sourceCount,
      entityCount,
    };
  } catch (err: any) {
    return { ok: false, reason: clean(err?.message) || 'knowgraph_evidence_read_failed' };
  } finally {
    await session.close();
  }
}
