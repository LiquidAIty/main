// Entity: Card Skills
// Relationship: Verifies missing saved-Card profiles receive concise profile-named operating procedures without the rejected generic skill identity or storage-path prose.

import { describe, expect, it } from 'vitest';

import { buildBasicHermesCardSkill } from './hermesCardSkill';

describe('basic saved Card skill', () => {
  it('uses the stable profile identity and separates procedure from saved SOUL', () => {
    const skill = buildBasicHermesCardSkill({
      profile: 'builder',
      title: 'Builder',
      mode: 'delegate',
    });

    expect(skill).toContain('name: builder');
    expect(skill).toContain('Builder never runs a Card it creates');
    expect(skill).toContain('Follow the saved SOUL for persona, general behavior');
    expect(skill).not.toContain('card-skill');
    expect(skill).not.toContain('SKILL.md');
  });

  it('gives KnowGraph its evidence and Graphiti operating boundary', () => {
    const skill = buildBasicHermesCardSkill({
      profile: 'knowgraph',
      title: 'KnowGraph',
      mode: 'delegate',
    });

    expect(skill).toContain('grounded-citations');
    expect(skill).toContain('Persist a Know only after evidence verification and exact Graphiti readback.');
  });

  it('keeps Main Bot delivery acknowledgements natural and free of transport receipts', () => {
    const skill = buildBasicHermesCardSkill({
      profile: 'main',
      title: 'Main',
      mode: 'main',
    });

    expect(skill).toContain('acknowledge naturally in one short sentence');
    expect(skill).toContain('never expose delivery IDs, hashes, receipts, transport status');
    expect(skill).toContain('never builds');
  });
});
