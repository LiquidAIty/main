import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import labagentchat from "./pages/labagentchat";
import AgentManager from "./pages/agentmanager";
import TradingUI from "./pages/tradingui";
import BossAgent from "./pages/bossagent";
import Chat from "./pages/chat";
import AgentChat from "./pages/agentchat";
import Agentic from "./pages/agentic";
import DetailedMode from "./pages/detailedmode";
import AdminPanel from "./pages/adminpanel";
import UserPanel from "./pages/userpanel";
import agentknowledge from "./pages/agentknowledge";
import AgentBuilder from "./pages/agentbuilder";

export default function App() {
  useEffect(() => {
    console.log("App component mounted, routing initialized");
  }, []);
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/agent-manager" replace />} />
        <Route path="/lab/agent" element={<labagentchat />} />
        <Route path="/agent-manager" element={<AgentManager />} />
        <Route path="/tradingui" element={<TradingUI />} />
        <Route path="/boss-agent" element={<BossAgent />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/agent-chat" element={<AgentChat />} />
        <Route path="/agentic" element={<Agentic />} />
        <Route path="/agentpage" element={<AgentBuilder />} />
        <Route path="/agentbuilder" element={<AgentBuilder />} />
        <Route path="/detailed" element={<DetailedMode />} />
        <Route path="/admin" element={<AdminPanel />} />
        <Route path="/user-panel" element={<UserPanel />} />
        <Route path="/agentknowledge" element={<agentknowledge />} />
      </Routes>
    </BrowserRouter>
  );
}
