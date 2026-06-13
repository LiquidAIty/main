import { describe, expect, it, vi } from 'vitest';

import { parseCoderPacketJson, runLocalCoderPacket } from './coderLoop';

const packet = {
  id: 'packet-1',
  projectId: 'project-1',
  repoPath: 'C:\\Projects\\main',
  objective: 'Wire one active job.',
  planExcerpt: 'Connect PlanFlow Go.',
  contextSummary: 'Backend route exists.',
  codeAnchors: ['client/src/pages/agentbuilder.tsx'],
  cbmQueries: ['search_graph PlanFlow'],
  guardrails: ['No fake success.'],
  allowedFiles: ['client/src/features/agentbuilder/plan/*'],
  forbiddenWork: ['Do not auto-run the next job.'],
  proofRequired: ['Run focused client checks.'],
  reportFormat: 'CoderReport',
  stopConditions: ['Stop after one report.'],
};

it('accepts a complete active CoderPacket', () => {
  expect(parseCoderPacketJson(JSON.stringify(packet))).toEqual(packet);
});

it('rejects an incomplete active CoderPacket', () => {
  expect(() => parseCoderPacketJson(JSON.stringify({ id: 'packet-1' }))).toThrow();
});

describe('LocalCoder run client', () => {
  it('preserves an honest blocked report returned with HTTP 424', async () => {
    const payload = {
      ok: false,
      packet,
      report: {
        coderPacketId: packet.id,
        status: 'blocked',
        summary: 'LocalCoder runtime is missing.',
        specComparison: [],
        filesChanged: [],
        proofCommands: [],
        proofResults: [],
        failedCommands: [],
        blockers: ['bun command is unavailable'],
        assumptions: [],
        nextRecommendedTask: 'Install Bun.',
        rawOutput: '',
      },
      comparison: {
        matchesPacket: false,
        comparedRequirements: 0,
        unresolvedRequirements: [],
      },
    };
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 424,
      json: async () => payload,
    });

    await expect(runLocalCoderPacket(packet, fetchImpl as any)).resolves.toEqual(payload);
  });

  it('rejects a response that does not contain a CoderReport', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 500,
      json: async () => ({ ok: false, error: 'localcoder_run_failed' }),
    });

    await expect(runLocalCoderPacket(packet, fetchImpl as any)).rejects.toThrow(
      'localcoder_run_failed',
    );
  });
});
