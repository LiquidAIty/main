// Entity: Building Workspace
// Relationship: Building-view import or render failures stay inside this pane and leave the host Chat and navigation available.
import { Component, type ReactNode } from 'react';

export default class ModelWorkspaceBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <p role="alert">Building view unavailable: {this.state.error.message}</p>;
    }
    return this.props.children;
  }
}
