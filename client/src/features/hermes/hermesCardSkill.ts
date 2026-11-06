/**
 * Entity: Card Skills
 * Relationship: Seeds one concise profile-named operational skill for a saved Hermes Card when that profile does not already own an editable skill.
 */

export type BasicCardSkillInput = {
  profile: string;
  title: string;
  mode: string;
};

export function buildBasicHermesCardSkill(input: BasicCardSkillInput): string {
  const profile = String(input.profile || '').trim().toLowerCase();
  const title = String(input.title || profile || 'Card').replace(/\s+/g, ' ').trim();
  const specialist = `Perform the saved ${title} specialist role for one bounded assignment and return the result to the caller.`;
  const roleProcedure = profile === 'main' || input.mode === 'main'
    ? 'Remain the fast Project front door. Delegate time-consuming work with message_agent only to the saved wired roster; Main directs work and never builds. After message_agent, acknowledge naturally in one short sentence: never expose delivery IDs, hashes, receipts, transport status, or restate the child mission.'
    : profile === 'builder'
      ? 'Build or edit the requested artifact. Builder never runs a Card it creates; Main performs the later saved-Card test through message_agent.'
      : profile === 'thinkgraph'
        ? 'Use the granted Engraphis operations for Project reasoning and operational knowledge. Do not write sourced KnowGraph records.'
        : profile === 'knowgraph'
          ? 'Use granted web research, grounded-citations, and Graphiti operations. Persist a Know only after evidence verification and exact Graphiti readback.'
          : profile === 'card_magentic' || input.mode === 'magentic_one'
            ? 'Run the saved fixed blue-wire roster for the bounded PromptSpec. Hermes owns task decomposition, dependencies, worker execution, and synthesis.'
            : profile === 'team'
              ? 'Handle a bounded job when no saved specialist matches. Use the saved Team taskgraph and return one final synthesis.'
              : specialist;
  const description = JSON.stringify(`Operational procedure ${title} follows for every run.`);
  return [
    '---',
    `name: ${profile}`,
    `description: ${description}`,
    '---',
    '',
    `# ${title}`,
    '',
    roleProcedure,
    '',
    '- Preserve the literal assigned task and deliberately selected context.',
    '- Follow the saved SOUL for persona, general behavior, constraints, and output expectations.',
    '- Use only the Card\'s enabled Hermes toolsets and selected LiquidAIty MCP tools.',
    '- Never claim a tool call, persistence result, delegation, or read that did not complete.',
    '- Finish the bounded assignment or return the exact blocker without inventing a fallback.',
    '',
  ].join('\n');
}
