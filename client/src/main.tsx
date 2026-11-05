// Entity: Application Startup
// Relationship: This file installs global browser crash hooks and mounts the root React application inside its top-level recovery boundary.
// Entity: Application Shell
// Relationship: This file provides the one browser entry point that renders the route-owning application shell into the required root element.

import React from "react";
import { createRoot } from "react-dom/client";
// Case-exact import: on the case-insensitive Windows FS a "./app" import
// resolves but makes tsc treat app.tsx/App.tsx as two files (TS1149).
import App from "./App";
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
