/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Project Knowledge Graph
 * Relationship: This file provides the collapsible inspector section used to group Project graph controls, status signals, and record details without owning graph data.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';

import { GRAPH_THEME, graphDrawerSectionStyle } from './graphVisualTokens';

export default function GlassInspectorSection({
  title,
  signal,
  defaultOpen = true,
  testId,
  children,
}: {
  title: string;
  signal?: string;
  defaultOpen?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      data-testid={testId}
      data-open={open ? 'true' : 'false'}
      style={graphDrawerSectionStyle({ overflow: 'hidden', flex: '0 0 auto' })}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={{
          width: '100%',
          minHeight: 40,
          border: 0,
          borderBottom: open ? '1px solid rgba(126,232,226,.10)' : 0,
          background: open
            ? 'linear-gradient(90deg, rgba(55,173,170,.13), rgba(255,255,255,.025), transparent)'
            : 'linear-gradient(90deg, rgba(255,255,255,.025), transparent)',
          color: GRAPH_THEME.surface.text,
          padding: '9px 11px',
          display: 'grid',
          gridTemplateColumns: '1fr auto auto',
          gap: 8,
          alignItems: 'center',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 10.5, fontWeight: 760, letterSpacing: '.075em', textTransform: 'uppercase' }}>
          {title}
        </span>
        {signal ? <span style={{ color: GRAPH_THEME.accent.primary, fontSize: 10 }}>{signal}</span> : null}
        <span
          aria-hidden="true"
          style={{
            color: GRAPH_THEME.accent.primary,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 160ms ease',
          }}
        >
          ⌃
        </span>
      </button>
      {open ? (
        <div style={{ padding: 11, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
