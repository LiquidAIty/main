{{ ... }}
+import LabAgentChat from '../pages/LabAgentChat';
{{ ... }}
 export function App() {
   return (
     <Routes>
       {/* your existing routes */}
       <Route path="/" element={<Home />} />
+      {/* Agent-0 tester */}
+      <Route path="/lab/agent" element={<LabAgentChat />} />
     </Routes>
   );
 }
{{ ... }}
