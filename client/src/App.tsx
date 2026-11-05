// Entity: Application Shell
// Relationship: This file maps browser URLs to the Agent Builder, Trading, login, and signup surfaces and redirects the root route into the workspace.

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import TradingUI from "./pages/tradingui";
import Login from "./pages/login";
import Signup from "./pages/signup";
import AgentBuilder from "./pages/agentbuilder";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/agentbuilder" replace />} />
        <Route path="/agentbuilder" element={<AgentBuilder />} />
        <Route path="/tradingui" element={<TradingUI />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
      </Routes>
    </BrowserRouter>
  );
}
