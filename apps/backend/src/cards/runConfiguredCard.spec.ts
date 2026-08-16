import { describe, expect, it } from 'vitest';

import * as runtime from './runtime';
import * as pythonTransport from '../services/autogen/autogenOrchestratorClient';

describe('configured Card ownership boundary', () => {
  it('does not export the removed TypeScript Card orchestrator', () => {
    expect('runConfiguredCard' in runtime).toBe(false);
  });

  it('does not expose durable IDF creation or reread transports', () => {
    expect('createInputDataFileOnPython' in pythonTransport).toBe(false);
    expect('reviseInputDataFileOnPython' in pythonTransport).toBe(false);
    expect('approveInputDataFileOnPython' in pythonTransport).toBe(false);
    expect('fetchInputDataFile' in pythonTransport).toBe(false);
  });
});
