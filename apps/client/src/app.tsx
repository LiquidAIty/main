import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LabAgentChat from './pages/LabAgentChat';
import TradingUI from './pages/TradingUI';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* send root to lab/agent */}
        <Route path="/" element={<Navigate to="/lab/agent" replace />} />
        <Route path="/lab/agent" element={<LabAgentChat />} />
        {/* Trading UI (top-level, lowercase) */}
        <Route path="/tradingui" element={<TradingUI />} />
      </Routes>
    </BrowserRouter>
  );
}
