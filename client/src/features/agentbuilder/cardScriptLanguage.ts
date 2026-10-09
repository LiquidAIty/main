import type { SavedCardConfiguration } from '../../types/agentgraph';

export type CardScript = NonNullable<SavedCardConfiguration['script']>;

export type ScriptToolReference = {
  canonicalId: string;
  access: 'read' | 'write';
  available: boolean;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
};

type CardScriptTextModel = {
  getLineContent(lineNumber: number): string;
  getWordAtPosition(position: { lineNumber: number; column: number }): { word: string } | null;
};

export const TOOL_MODE_COMPLETIONS = [
  {
    label: 'OFF', value: 0, detail: 'OFF (0) · unavailable to Script and agent',
    documentation: 'The Card may authorize this tool, but this Scripted Run exposes it to neither Python nor the Hermes agent.',
  },
  {
    label: 'SCRIPT', value: 1, detail: 'SCRIPT (1) · Python only',
    documentation: 'The saved Python Script may call this authorized tool. Its schema is omitted from the Hermes agent request.',
  },
  {
    label: 'AGENT', value: 2, detail: 'AGENT (2) · Hermes agent only',
    documentation: 'Hermes receives the authorized tool normally. The Python Script cannot call it directly.',
  },
  {
    label: 'BOTH', value: 3, detail: 'BOTH (3) · Python and Hermes agent',
    documentation: 'Both the saved Python Script and the Hermes agent may call this authorized tool. Use only when duplicate access is intentional.',
  },
] as const;
export const SCRIPT_SECTIONS = [
  'Optimized Tool Configuration',
  'Authorized Tool Operations',
  'Typed Result',
] as const;

export const STARTER_SCRIPT = `# region Optimized Tool Configuration
CARD_SCRIPT = {
    "mode": "tool_recipe",
    "input": {
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
        "additionalProperties": False,
    },
    "output": {
        "type": "object",
        "properties": {"result": {}},
        "required": ["result"],
        "additionalProperties": False,
    },
    "timeout_seconds": 15,
    "max_tool_calls": 6,
    "max_output_bytes": 20000,
}
# endregion

# region Authorized Tool Operations
from hermes_tools import SCRIPT, input, output, tools

# Selected tools default to AGENT. Mark only recipe-owned handles SCRIPT:
# tools.cbm.search_graph = SCRIPT
# endregion

# region Typed Result
# Hermes exposes valid saved source as the compact card_python tool. The
# recipe cannot rewrite the Card prompt, context, memory, lifecycle, or Team.
output.emit({"result": {"query": input.query}})
# endregion
`;

export const SCRIPT_EXAMPLES = [
  {
    id: 'thinkgraph-context',
    label: 'ThinkGraph context',
    description: 'Read bounded Engraphis context plus one exact Engraphis memory.',
    source: `CARD_SCRIPT = {
    "mode": "tool_recipe",
    "input": {
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "memoryId": {"type": "string"},
        },
        "required": ["query", "memoryId"],
        "additionalProperties": False,
    },
    "output": {
        "type": "object",
        "properties": {
            "result": {"type": "object"},
        },
        "required": ["result"],
        "additionalProperties": False,
    },
    "timeout_seconds": 15,
    "max_tool_calls": 2,
    "max_output_bytes": 20000,
}

from hermes_tools import SCRIPT, input, output, tools

tools.engraphis_recall_context = SCRIPT
tools.engraphis_get_memory = SCRIPT

bounded_context = tools.call(
    "engraphis_recall_context", query=input.query, token_budget=600, k=6
)
exact_memory = tools.call(
    "engraphis_get_memory", memory_id=input.memoryId
)
result = {"context": bounded_context, "exactMemory": exact_memory}
output.emit({"result": result})
`,
  },
  {
    id: 'knowgraph-evidence',
    label: 'KnowGraph evidence',
    description: 'Read bounded Graphiti entities, facts, and episode provenance.',
    source: `CARD_SCRIPT = {
    "mode": "tool_recipe",
    "input": {
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
        "additionalProperties": False,
    },
    "output": {
        "type": "object",
        "properties": {
            "result": {"type": "object"},
        },
        "required": ["result"],
        "additionalProperties": False,
    },
    "timeout_seconds": 15,
    "max_tool_calls": 3,
    "max_output_bytes": 20000,
}

from hermes_tools import SCRIPT, input, output, tools

tools.graphiti.search_nodes = SCRIPT
tools.graphiti.search_memory_facts = SCRIPT
tools.graphiti.get_episodes = SCRIPT

nodes = tools.call("graphiti.search_nodes", query=input.query, max_nodes=8)
facts = tools.call("graphiti.search_memory_facts", query=input.query, max_facts=12)
episodes = tools.call(
    "graphiti.get_episodes", max_episodes=10, include_body=False,
    body_preview_chars=300, max_response_chars=12000
)
result = {"nodes": nodes, "facts": facts, "episodes": episodes}
output.emit({"result": result})
`,
  },
] as const;

export function schemaText(reference: ScriptToolReference): string {
  return JSON.stringify({
    input: reference.inputSchema || { type: 'object', properties: {} },
    output: reference.outputSchema || null,
  }, null, 2);
}

export function symbolAtPosition(model: CardScriptTextModel, position: { lineNumber: number; column: number }): string | null {
  const line = model.getLineContent(position.lineNumber);
  const offset = position.column - 1;
  for (const match of line.matchAll(/(?:tools|card)(?:\.[A-Za-z_][A-Za-z0-9_]*)+/g)) {
    const start = match.index || 0;
    const end = start + match[0].length;
    if (offset >= start && offset <= end) return match[0];
  }
  const callMatch = /tools\.call\(\s*["']([^"']+)["']/.exec(line);
  if (callMatch) {
    const quotedStart = (callMatch.index || 0) + callMatch[0].indexOf(callMatch[1]);
    if (offset >= quotedStart && offset <= quotedStart + callMatch[1].length) return `tools.${callMatch[1]}`;
  }
  const word = model.getWordAtPosition(position)?.word || '';
  if (TOOL_MODE_COMPLETIONS.some((mode) => mode.label === word)) return word;
  return null;
}

export function changedSourceDraft(
  current: CardScript,
  nextSource: string,
): CardScript {
  return {
    ...current,
    source: nextSource,
    sourceHash: '',
    compiledHash: '',
    compiled: {},
    lastValidation: {
      // A changed nonblank draft is fail-closed until the Python AST validator
      // returns it as valid. There is no separate enable/disable state.
      status: nextSource.trim() ? 'invalid' : 'blank',
      errors: [],
      toolHandles: [],
    },
  };
}
