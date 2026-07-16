import type { CSSProperties } from 'react';

import { graphDrawerButtonStyle } from '../graph/graphVisualTokens';

export type GraphAuthority = 'thinkgraph' | 'knowgraph' | 'codegraph';
export type GraphSelectionSurface = GraphAuthority | 'unified';

export type GraphObjectRef = {
  authority: GraphAuthority;
  canonicalId: string;
  selectedThrough: GraphSelectionSurface;
  sourceAuthority?: GraphAuthority;
  projectionId?: string;
  graphViewId?: string;
  displayLabel: string;
};

export function graphObjectRefKey(ref: GraphObjectRef): string {
  return `${ref.authority}:${ref.canonicalId}`;
}

export function AskMainAction({
  reference,
  onAskMain,
  style,
}: {
  reference: GraphObjectRef;
  onAskMain?: (reference: GraphObjectRef) => void;
  style?: CSSProperties;
}) {
  if (!onAskMain) return null;
  return (
    <button
      type="button"
      onClick={() => onAskMain(reference)}
      style={graphDrawerButtonStyle({ width: '100%', marginTop: 10, ...style })}
    >
      Ask Main
    </button>
  );
}
