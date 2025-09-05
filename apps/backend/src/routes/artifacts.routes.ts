import { Router } from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

const router = Router();

// Execute code artifact
router.post('/execute', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { code, language = 'javascript' } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }

    // Simple code execution for demo purposes
    // In production, use a sandboxed environment
    let result: any;
    
    if (language === 'javascript') {
      try {
        // Create a safe execution context
        const func = new Function('console', `
          const logs = [];
          const mockConsole = {
            log: (...args) => logs.push(args.join(' ')),
            error: (...args) => logs.push('ERROR: ' + args.join(' ')),
            warn: (...args) => logs.push('WARN: ' + args.join(' '))
          };
          
          try {
            ${code}
          } catch (error) {
            logs.push('ERROR: ' + error.message);
          }
          
          return logs.join('\\n');
        `);
        
        result = func();
      } catch (error: any) {
        result = `Error: ${error.message}`;
      }
    } else {
      result = `Language ${language} not supported yet`;
    }

    return res.json({
      ok: true,
      result,
      language,
      executedAt: new Date().toISOString()
    });

  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Get artifacts list
router.get('/', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    // Mock artifacts data
    const artifacts = [
      {
        id: 'artifact-1',
        type: 'code',
        title: 'Hello World Function',
        content: 'function hello() { return "Hello, World!"; }',
        agentId: 'gpt5-orchestrator',
        created: new Date().toISOString()
      }
    ];

    return res.json({
      ok: true,
      artifacts
    });

  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Create new artifact
router.post('/', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { type, title, content, agentId } = req.body;

    const artifact = {
      id: `artifact-${Date.now()}`,
      type,
      title,
      content,
      agentId,
      created: new Date().toISOString()
    };

    return res.json({
      ok: true,
      artifact
    });

  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

export default router;
