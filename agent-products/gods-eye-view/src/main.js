import { createWorldViewApplication } from './app/directApplication.js';
import { setApplicationRoot } from './app/viewport.js';
import { configureRuntimeBaseUrl } from './runtimeUrl.js';

// Standalone and LiquidAIty now compose the same native application lifecycle.
// The standalone document already owns its markup/CSS; the React host uses
// mountWorldView() to supply a scoped caller-owned root.
document.body.dataset.worldviewMounted = 'true';
const restoreRoot = setApplicationRoot(document.body);
const restoreRuntimeBase = configureRuntimeBaseUrl('/');
const app = createWorldViewApplication({ root: document.body, supervised: false });
window.__godsEyeStandaloneApplication = app;

let destroyed = false;
async function destroy() {
  if (destroyed) return;
  destroyed = true;
  try {
    await app.destroy();
  } finally {
    restoreRoot();
    restoreRuntimeBase();
    delete document.body.dataset.worldviewMounted;
    if (window.__godsEyeStandaloneApplication === app) {
      delete window.__godsEyeStandaloneApplication;
    }
  }
}

window.addEventListener('beforeunload', () => { void destroy(); }, { once: true });
app.start().catch((error) => {
  console.error("God's Eye View initialization failed:", error);
  const status = document.querySelector('#loading-screen .loader-status');
  if (status) {
    status.textContent = `Error: ${error?.message || String(error)}`;
    status.style.color = '#ff4444';
  }
});
