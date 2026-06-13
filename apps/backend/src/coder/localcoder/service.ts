import {
  compareCoderReportToPacket,
  parseCoderPacket,
  type CoderPacket,
  type CoderReport,
} from '../../contracts/coderContracts';
import { LocalCoderAdapter } from './adapter';

export class LocalCoderService {
  constructor(private readonly adapter = new LocalCoderAdapter()) {}

  async inspect(repoPath?: string) {
    return await this.adapter.inspectRuntime(repoPath);
  }

  async run(value: unknown): Promise<{
    packet: CoderPacket;
    report: CoderReport;
    comparison: ReturnType<typeof compareCoderReportToPacket>;
  }> {
    const packet = parseCoderPacket(value);
    const report = await this.adapter.run(packet);
    return {
      packet,
      report,
      comparison: compareCoderReportToPacket(packet, report),
    };
  }
}

export const localCoderService = new LocalCoderService();
