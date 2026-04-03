import { Router } from 'express';
import { executeDeck } from '../runtime/deckRuntime';
import { saveProjectBlackboard } from '../decks';
import { getV3ProjectBlob } from '../decks/store';
import type { AgentCardInstance, AgentTemplate } from '../types';

const router = Router();

router.post('/:projectId/cards/run', async (req, res) => {
  const { card, templates, input } = req.body || {};
  if (!card || typeof card !== 'object') {
    return res.status(400).json({ ok: false, error: 'card_required' });
  }
  if (!Array.isArray(templates) || templates.length === 0) {
    return res.status(400).json({ ok: false, error: 'templates_required' });
  }

  try {
    const projectBlob = await getV3ProjectBlob(req.params.projectId);
    const typedCard = card as AgentCardInstance;
    const typedTemplates = templates as AgentTemplate[];
    const singleCardDocument = {
      id: `card_run_${typedCard.id}`,
      name: typedCard.title || typedCard.id,
      promptTemplates: [],
      version: 1,
      nodes: [typedCard],
      edges: [],
    };

    const run = await executeDeck(singleCardDocument, typedTemplates, {
      input: String(input || ''),
      blackboard: projectBlob.blackboard,
      projectId: req.params.projectId,
    });
    const step = run.steps[0];
    if (!step) {
      return res.status(500).json({ ok: false, error: 'card_run_failed' });
    }

    const result = {
      output: step.output,
      status: step.status,
      error: step.error,
      startedAt: step.startedAt,
      endedAt: step.endedAt,
      runtimeBinding: step.runtimeBinding,
      runtimeType: step.runtimeType,
      seed: step.seed,
      contract: step.contract,
      handshake: step.handshake,
      score: step.score,
      passed: step.passed,
      scoreDetail: step.scoreDetail,
      improvementPromptBit: step.improvementPromptBit,
      inputSummary: step.inputSummary,
      outputSummary: step.outputSummary,
      blackboardWrite: step.blackboardWrite,
      blackboard: run.blackboard,
    };

    const blackboard = await saveProjectBlackboard(
      req.params.projectId,
      run.blackboard || projectBlob.blackboard,
    );

    return res.json({ ok: true, result: { ...result, blackboard }, blackboard });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'card_run_failed' });
  }
});

export default router;
