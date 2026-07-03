import React, { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary for knowledge graph surfaces to prevent crashes from breaking the UI.
 * This ensures the knowledge page doesn't disappear when graph rendering fails.
 */
export class KnowledgeGraphErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[KnowledgeGraph] Render error:', error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      
      return (
        <div
          style={{
            padding: '20px',
            border: '1px solid #3A3A3A',
            borderRadius: '8px',
            background: '#1F1F1F',
            color: '#D98458',
            minHeight: '200px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '8px' }}>
            Knowledge Graph Temporarily Unavailable
          </div>
          <div style={{ fontSize: '13px', opacity: 0.8, textAlign: 'center' }}>
            The graph visualization encountered an error and has been safely disabled.
            <br />
            The rest of the workspace remains functional.
            {this.state.error && (
              <div style={{ marginTop: '12px', fontSize: '11px', color: '#888', maxWidth: '400px', wordBreak: 'break-word' }}>
                Error: {this.state.error.message}
              </div>
            )}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: '16px',
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid #4FA2AD',
              background: 'transparent',
              color: '#4FA2AD',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default KnowledgeGraphErrorBoundary;
