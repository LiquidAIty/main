import React from "react";
import { createRoot } from "react-dom/client";
import App from "./app";
import FrontendCrashBoundary from "./components/diagnostics/FrontendCrashBoundary";
import { installGlobalFrontendCrashHooks } from "./lib/frontendCrashDiagnostics";
import "./styles.css";

installGlobalFrontendCrashHooks();

const el = document.getElementById("root");
if (!el) throw new Error("missing #root");
createRoot(el).render(
  <React.StrictMode>
    <FrontendCrashBoundary scopeLabel="AppRoot">
      <App />
    </FrontendCrashBoundary>
  </React.StrictMode>
);
