// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import GodsEyeSurface, {
  parseGodsEyeHostMessage,
  resolveGodsEyeEmbedUrl,
} from './GodsEyeSurface';

describe('GodsEyeSurface supervised host boundary', () => {
  it('accepts only a distinct loopback origin and pins supervised query state', () => {
    const url = resolveGodsEyeEmbedUrl('http://127.0.0.1:4173/globe?theme=dark', 'http://localhost:5173');
    expect(url.origin).toBe('http://127.0.0.1:4173');
    expect(url.searchParams.get('theme')).toBe('dark');
    expect(url.searchParams.get('embed')).toBe('1');
    expect(url.searchParams.get('agentRuntime')).toBe('supervised');
    expect(url.searchParams.get('hostOrigin')).toBe('http://localhost:5173');
  });

  it('rejects remote and same-origin embeds', () => {
    expect(() => resolveGodsEyeEmbedUrl('https://example.com', 'http://localhost:5173'))
      .toThrow('gods_eye_embed_must_be_loopback');
    expect(() => resolveGodsEyeEmbedUrl('http://localhost:5173/globe', 'http://localhost:5173'))
      .toThrow('gods_eye_embed_requires_isolated_origin');
  });

  it('requires upstream to report the supervised native-agent state', () => {
    expect(parseGodsEyeHostMessage({
      schemaVersion: 'gev.embed.ready.v1',
      sourceVersion: '0.1.0',
      agentRuntime: 'supervised',
      nativeAgentAvailable: true,
      nativeAgentActive: false,
    })).toEqual({
      schemaVersion: 'gev.embed.ready.v1',
      sourceVersion: '0.1.0',
      agentRuntime: 'supervised',
      nativeAgentAvailable: true,
      nativeAgentActive: false,
    });
    expect(parseGodsEyeHostMessage({
      schemaVersion: 'gev.embed.ready.v1',
      sourceVersion: '0.1.0',
      agentRuntime: 'standalone',
      nativeAgentAvailable: true,
      nativeAgentActive: true,
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
    expect(screen.getByText(/supervised, isolated upstream build/)).toBeTruthy();
    expect(screen.queryByTitle('God’s Eye WorldView globe')).toBeNull();
  });

  it('sends a Card-scoped evidence flight only after the supervised handshake', () => {
    const onNativeAgentState = vi.fn();
    const { rerender } = render(
      <GodsEyeSurface
        embedUrl="http://127.0.0.1:4174"
        projectId="project-1"
        cardId="card-worldview"
        onNativeAgentState={onNativeAgentState}
      />,
    );
    const frame = screen.getByTitle('God’s Eye WorldView globe') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'http://127.0.0.1:4174',
      source: frame.contentWindow,
      data: {
        schemaVersion: 'gev.embed.ready.v1',
        sourceVersion: '0.1.0',
        agentRuntime: 'supervised',
        nativeAgentAvailable: true,
        nativeAgentActive: false,
      },
    }));
    expect(onNativeAgentState).toHaveBeenCalledExactlyOnceWith({
      available: true,
      active: false,
    });

    rerender(
      <GodsEyeSurface
        embedUrl="http://127.0.0.1:4174"
        projectId="project-1"
        cardId="card-worldview"
        focus={{ id: 'candidate-1', position: { longitude: -97.7431, latitude: 30.2672 } }}
      />,
    );

    expect(postMessage).toHaveBeenLastCalledWith({
      schemaVersion: 'gev.embed.focus.v1',
      projectId: 'project-1',
      cardId: 'card-worldview',
      id: 'candidate-1',
      position: { longitude: -97.7431, latitude: 30.2672 },
    }, 'http://127.0.0.1:4174');
  });
});
