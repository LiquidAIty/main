import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LabAgentChat from "./pages/labagentchat";
import TradingUI from "./pages/tradingui";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/lab/agent" replace />} />
        <Route path="/lab/agent" element={<LabAgentChat />} />
        <Route path="/tradingui" element={<TradingUI />} />
      </Routes>
    </BrowserRouter>
  );
}
