import {
  compareCoderReportToPacket,
  parseCoderPacket,
  type CoderPacket,
  type CoderReport,
} from '../../contracts/coderContracts';
import {
  runLocalCoderCbmScopeGate,
  type LocalCoderCbmScopeGateResult,
} from '../../services/graphContext/cbmScopeGate';
import { LocalCoderAdapter, type LocalCoderRuntimeDiagnostics } from './adapter';

type LocalCoderAdapterBoundary = Pick<LocalCoderAdapter, 'inspectRuntime' | 'run'> & {
  runWithDiagnostics?: LocalCoderAdapter['runWithDiagnostics'];
};
type LocalCoderCbmScopeGate = (repoPath: string) => Promise<LocalCoderCbmScopeGateResult>;

function buildCbmScopeBlockedReport(
  packetId: string,
  gate: LocalCoderCbmScopeGateResult,
): CoderReport {
  return {
    coderPacketId: packetId,
    status: 'blocked',
    summary: gate.blockedReason,
    specComparison: [],
    filesChanged: [],
    proofCommands: [],
    proofResults: [],
    failedCommands: [],
    blockers: [gate.blockedReason],
    assumptions: [
      `edit_scope_source_root: ${gate.sourceRoot || 'unavailable'}`,
    ],
    outOfScopeFindings: [],
    nextRecommendedTask: 'Provide a valid project root inside the requested project before retrying.',
    rawOutput: '',
  };
}

export class LocalCoderService {
  constructor(
    private readonly adapter: LocalCoderAdapterBoundary = new LocalCoderAdapter(),
    private readonly cbmScopeGate: LocalCoderCbmScopeGate = runLocalCoderCbmScopeGate,
  ) {}

  async inspect(repoPath?: string) {
    return await this.adapter.inspectRuntime(repoPath);
  }

  async run(value: unknown): Promise<{
    packet: CoderPacket;
    report: CoderReport;
    comparison: ReturnType<typeof compareCoderReportToPacket>;
    cbmScopeGate: LocalCoderCbmScopeGateResult;
    runtimeDiagnostics: LocalCoderRuntimeDiagnostics | null;
  }> {
    const packet = parseCoderPacket(value);
    const cbmScopeGate = await this.cbmScopeGate(packet.repoPath);
    let runtimeDiagnostics: LocalCoderRuntimeDiagnostics | null = null;
    let report: CoderReport;
    if (!cbmScopeGate.editAllowed) {
      report = buildCbmScopeBlockedReport(packet.id, cbmScopeGate);
    } else if (this.adapter.runWithDiagnostics) {
      const result = await this.adapter.runWithDiagnostics(packet);
      report = result.report;
      runtimeDiagnostics = result.runtimeDiagnostics;
    } else {
      report = await this.adapter.run(packet);
    }
    return {
      packet,
      report,
      comparison: compareCoderReportToPacket(packet, report),
      cbmScopeGate,
      runtimeDiagnostics,
    };
  }
}

export const localCoderService = new LocalCoderService();
