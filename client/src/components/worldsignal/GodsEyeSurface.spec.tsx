// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import GodsEyeSurface, {
  parseGodsEyeHostMessage,
  resolveGodsEyeEmbedUrl,
} from './GodsEyeSurface';

describe('GodsEyeSurface providerless host boundary', () => {
  it('accepts only a distinct loopback origin and pins providerless query state', () => {
    const url = resolveGodsEyeEmbedUrl('http://127.0.0.1:4173/globe?theme=dark', 'http://localhost:5173');
    expect(url.origin).toBe('http://127.0.0.1:4173');
    expect(url.searchParams.get('theme')).toBe('dark');
    expect(url.searchParams.get('embed')).toBe('1');
    expect(url.searchParams.get('agentRuntime')).toBe('host');
    expect(url.searchParams.get('voice')).toBe('disabled');
  });

  it('rejects remote and same-origin embeds', () => {
    expect(() => resolveGodsEyeEmbedUrl('https://example.com', 'http://localhost:5173'))
      .toThrow('gods_eye_embed_must_be_loopback');
    expect(() => resolveGodsEyeEmbedUrl('http://localhost:5173/globe', 'http://localhost:5173'))
      .toThrow('gods_eye_embed_requires_isolated_origin');
  });

  it('requires upstream to prove host runtime and disabled voice before readiness', () => {
    expect(parseGodsEyeHostMessage({
      schemaVersion: 'gev.embed.ready.v1',
      sourceVersion: '0.1.0',
      agentRuntime: 'host',
      voiceEnabled: false,
    })).toEqual({
      schemaVersion: 'gev.embed.ready.v1',
      sourceVersion: '0.1.0',
      agentRuntime: 'host',
      voiceEnabled: false,
    });
    expect(parseGodsEyeHostMessage({
      schemaVersion: 'gev.embed.ready.v1',
      sourceVersion: '0.1.0',
      agentRuntime: 'openai-realtime',
      voiceEnabled: true,
    })).toBeNull();
  });

  it('rejects invalid geographic selections', () => {
    expect(parseGodsEyeHostMessage({
      schemaVersion: 'gev.embed.selection.v1',
      selection: {
        id: 'contact-1',
        type: 'flight',
        label: 'Contact',
        position: { longitude: 240, latitude: 40 },
      },
    })).toBeNull();
  });

  it('renders an honest unavailable state without an upstream embed URL', () => {
    render(
      <GodsEyeSurface
        embedUrl={null}
        projectId="project-1"
        cardId="card-worldview"
        onReady={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'God’s Eye embed unavailable' })).toBeTruthy();
    expect(screen.getByText(/providerless, isolated upstream build/)).toBeTruthy();
    expect(screen.queryByTitle('God’s Eye WorldView globe')).toBeNull();
  });
});
