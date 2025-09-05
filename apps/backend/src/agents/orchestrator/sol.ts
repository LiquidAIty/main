import fs from 'fs';
import path from 'path';
import { createDeptAgent } from '../lang/agentFactory';

export type RouteInput  = { q: string; meta?: Record<string, any> };
export type RouteResult = { ok: true; routed: string; tool?: { id: string; name: string }; reasoning: string };

export async function routeQuery(input: RouteInput): Promise<RouteResult> {
  const query = input.q.toLowerCase();
  
  if (query.includes('code') || query.includes('program') || query.includes('function') || query.includes('debug')) {
    return {
      ok: true,
      routed: 'code',
      tool: { id: 'code', name: 'Code Agent' },
      reasoning: 'Query contains coding-related keywords'
    };
  } else if (query.includes('market') || query.includes('campaign') || query.includes('brand') || query.includes('content')) {
    return {
      ok: true,
      routed: 'marketing',
      tool: { id: 'marketing', name: 'Marketing Agent' },
      reasoning: 'Query contains marketing-related keywords'
    };
  } else if (query.includes('research') || query.includes('analyze') || query.includes('study') || query.includes('investigate')) {
    return {
      ok: true,
      routed: 'research',
      tool: { id: 'research', name: 'Research Agent' },
      reasoning: 'Query contains research-related keywords'
    };
  }
  
  return { 
    ok: true, 
    routed: 'orchestrator', 
    tool: { id: 'orchestrator', name: 'Orchestrator Agent' },
    reasoning: 'General query routed to orchestrator' 
  };
}

const MEM_PATH = path.resolve(process.cwd(), '.data/sol-memory.json');

type Msg = { role: 'system'|'user'|'assistant', content: string };
type History = Msg[];

function ensureDir(p: string) { 
  const d = path.dirname(p); 
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); 
}

function saveMemory(h: History) { 
  ensureDir(MEM_PATH); 
  fs.writeFileSync(MEM_PATH, JSON.stringify(h, null, 2), 'utf8'); 
}

// Enhanced solRun with real LangGraph agent orchestration
export async function solRun({ question, agentMode = 'auto' }: { question: string; agentMode?: string }): Promise<{ text: string; decision?: string; agentUsed?: string }> {
  // Auto-detect agent mode based on question content
  if (agentMode === 'auto') {
    const lowerQ = question.toLowerCase();
    if (lowerQ.includes('code') || lowerQ.includes('program') || lowerQ.includes('function') || lowerQ.includes('debug')) {
      agentMode = 'code';
    } else if (lowerQ.includes('market') || lowerQ.includes('campaign') || lowerQ.includes('brand') || lowerQ.includes('content')) {
      agentMode = 'marketing';
    } else if (lowerQ.includes('research') || lowerQ.includes('analyze') || lowerQ.includes('study') || lowerQ.includes('investigate')) {
      agentMode = 'research';
    } else {
      agentMode = 'orchestrator';
    }
  }

  // Use LangGraph agent-based approach
  try {
    let agent;

    switch (agentMode) {
      case 'orchestrator':
        agent = createDeptAgent({
          id: 'sol-orchestrator',
          name: 'SOL Orchestrator',
          defaultPersona: `You are the SOL (Smart Operations Layer) orchestrator using GPT-5. You coordinate AI agents and provide comprehensive responses.

Key responsibilities:
1. Analyze user requests and determine optimal approach
2. Create knowledge graphs of key concepts and relationships  
3. Provide detailed, actionable responses
4. Suggest follow-up actions and next steps
5. Route complex tasks to specialized agents when needed

Always structure your responses with clear sections and actionable insights.`,
          matchKeywords: ['orchestrate', 'manage', 'analyze', 'plan', 'coordinate']
        });
        break;
        
      case 'code':
        agent = createDeptAgent({
          id: 'sol-code',
          name: 'SOL Code Agent',
          defaultPersona: `You are the SOL coding specialist. You provide precise, well-documented code solutions.

Key responsibilities:
1. Write clean, efficient, and well-commented code
2. Explain code logic and architecture decisions
3. Create knowledge graphs of code dependencies and relationships
4. Suggest best practices and optimizations
5. Debug and troubleshoot issues

Always provide working code examples with explanations.`,
          matchKeywords: ['code', 'programming', 'debug', 'function', 'typescript', 'javascript']
        });
        break;
        
      case 'marketing':
        agent = createDeptAgent({
          id: 'sol-marketing',
          name: 'SOL Marketing Agent',
          defaultPersona: `You are the SOL marketing specialist. You create compelling, data-driven marketing strategies.

Key responsibilities:
1. Develop targeted marketing campaigns and content
2. Map customer journeys and touchpoints
3. Create brand positioning and messaging strategies
4. Analyze market trends and competitive landscapes
5. Generate knowledge graphs of marketing concepts and relationships

Always provide actionable marketing strategies with clear metrics and goals.`,
          matchKeywords: ['marketing', 'content', 'campaign', 'brand', 'strategy']
        });
        break;
        
      case 'research':
        agent = createDeptAgent({
          id: 'sol-research',
          name: 'SOL Research Agent',
          defaultPersona: `You are the SOL research specialist. You provide thorough, evidence-based analysis.

Key responsibilities:
1. Conduct comprehensive research and analysis
2. Synthesize findings from multiple sources
3. Create knowledge graphs of research findings and connections
4. Identify trends, patterns, and insights
5. Provide actionable recommendations based on data

Always cite sources and provide well-structured research findings.`,
          matchKeywords: ['research', 'analysis', 'investigate', 'study', 'data']
        });
        break;
        
      default:
        throw new Error(`Invalid agentMode: ${agentMode}`);
    }

    const result = await agent.run({
      prompt: question,
      role: agentMode === 'orchestrator' ? 'orchestrator' : 'worker',
      threadId: `sol-${agentMode}-${Date.now()}`
    });

    return { 
      text: result.output || 'No response from agent', 
      decision: agentMode,
      agentUsed: `sol-${agentMode}`
    };

  } catch (error) {
    console.error(`Agent ${agentMode} failed:`, error);
    
    // Fallback response
    return { 
      text: `I apologize, but I encountered an issue processing your request: ${error}. Please ensure your OpenAI API key is configured correctly.`, 
      decision: 'error-fallback', 
      agentUsed: 'none' 
    };
  }
}

export async function askSol(question: string): Promise<{ text: string }>{
  const { text } = await solRun({ question });
  return { text };
}

export function resetSolMemory(): void { 
  saveMemory([]); 
}
