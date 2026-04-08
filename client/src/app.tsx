import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import TradingUI from "./pages/tradingui";
import DetailedMode from "./pages/detailedmode";
import Login from "./pages/login";
import UserPanel from "./pages/userpanel";
import AgentBuilder from "./pages/agentbuilder";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/agentbuilder" replace />} />
        <Route path="/agentbuilder" element={<AgentBuilder />} />
        <Route path="/agentpage" element={<Navigate to="/agentbuilder" replace />} />
        <Route path="/tradingui" element={<TradingUI />} />
        <Route path="/login" element={<Login />} />
        <Route path="/user-panel" element={<UserPanel />} />
        <Route path="/detailed" element={<DetailedMode />} />
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
