/**
 * Entity: Hermes UI Integration
 * Relationship: Exports the existing LiquidAIty workspace for the official Hermes web-dashboard bootstrap without an iframe, Electron, or a second React root.
 */

import React from 'react';

import FrontendCrashBoundary from './components/diagnostics/FrontendCrashBoundary';
import { installGlobalFrontendCrashHooks } from './lib/frontendCrashDiagnostics';
import AgentBuilder from './pages/agentbuilder';
import './styles.css';
import './hermesDashboardPlugin.css';
import '../../agent-products/gods-eye-view/node_modules/cesium/Build/Cesium/Widgets/widgets.css';

installGlobalFrontendCrashHooks();

export default function LiquidAItyDashboardPage(): React.ReactElement {
  return (
    <div className="liquidaity-dashboard-page">
      <FrontendCrashBoundary scopeLabel="HermesDashboardPlugin">
        <AgentBuilder embedded />
      </FrontendCrashBoundary>
    </div>
  );
}
