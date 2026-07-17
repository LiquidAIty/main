import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import TradingUI from "./pages/tradingui";
import Login from "./pages/login";
import Signup from "./pages/signup";
import AgentBuilder from "./pages/agentbuilder";
import DevAgentRuns from "./pages/devAgentRuns";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/agentbuilder" replace />} />
        <Route path="/agentbuilder" element={<AgentBuilder />} />
        <Route path="/agentpage" element={<Navigate to="/agentbuilder" replace />} />
        <Route path="/tradingui" element={<TradingUI />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        {/* Dev-only telemetry dashboard: registered only in the dev build; the
            backing /api/dev/agent-harness routes also 403 in production. */}
        {import.meta.env.DEV ? <Route path="/dev/agent-runs" element={<DevAgentRuns />} /> : null}
        <Route path="/lab/agent" element={<Navigate to="/agentbuilder" replace />} />
        <Route path="/agent-manager" element={<Navigate to="/agentbuilder" replace />} />
        <Route path="/boss-agent" element={<Navigate to="/agentbuilder" replace />} />
        <Route path="/chat" element={<Navigate to="/agentbuilder" replace />} />
        <Route path="/agent-chat" element={<Navigate to="/agentbuilder" replace />} />
        <Route path="/agentic" element={<Navigate to="/agentbuilder" replace />} />
        <Route path="/admin" element={<Navigate to="/agentbuilder" replace />} />
        <Route path="/agentknowledge" element={<Navigate to="/agentbuilder" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
