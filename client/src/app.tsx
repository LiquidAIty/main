import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LabAgentChat from "./pages/labagentchat";
import AgentManager from "./pages/agentmanager";
import TradingUI from "./pages/tradingui";
import BossAgent from "./pages/bossagent";
import Chat from "./pages/chat";

export default function App() {
  useEffect(() => {
    console.log("App component mounted, routing initialized");
  }, []);
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/agent-manager" replace />} />
        <Route path="/lab/agent" element={<LabAgentChat />} />
        <Route path="/agent-manager" element={<AgentManager />} />
        <Route path="/tradingui" element={<TradingUI />} />
        <Route path="/boss-agent" element={<BossAgent />} />
        <Route path="/chat" element={<Chat />} />
      </Routes>
    </BrowserRouter>
  );
}
