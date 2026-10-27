/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Card Terminals
 * Relationship: Connects the existing browser terminal to the full Hermes CLI using Desktop's node-pty transport and the Card's existing Bot Chat.
 * Entity: Authentication
 * Relationship: Revalidates the browser session, allowed origin, Project ownership, saved Card, and exact Hermes conversation before opening a PTY.
 * Entity: Card Sessions
 * Relationship: Closing the terminal disposes its CLI viewer, not the persistent Hermes Gateway or conversation.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import { Router } from 'express';
import { spawn } from 'node-pty';
import { WebSocketServer, WebSocket } from 'ws';
import { tsImport } from 'tsx/esm/api';
import { getUserBySessionId } from '../auth/sessionStore';
import { getAllowedCorsOrigins } from '../security/requestAccess';
import { projectCardAuthority } from '../services/projectCardAuthority';
import { assertCardProfileOwner, getOwnedProjectByReference } from '../services/projectStore';
import { resolveRepoRoot } from '../services/workingDirectories';
import { findExistingCanonicalChat, prepareTerminalConversation } from './mainSession.routes';

const router = Router();
const sockets = new WebSocketServer({ noServer: true });
const dimension = (value: unknown, minimum: number) => Math.max(minimum, Math.min(500, Math.floor(Number(value)) || minimum));

router.post('/:projectId/:deckId/:cardId/open', async (req, res) => {
  try {
    const identity = await prepareTerminalConversation(req, res);
    if (!identity) return;
    res.json({ ...identity, cols: dimension(req.body.cols, 2), rows: dimension(req.body.rows, 1),
      websocketPath: `/api/card-terminals/${[identity.projectId, identity.deckId, identity.cardId, identity.sessionId].map(encodeURIComponent).join('/')}/stream` });
  } catch {
    if (!res.headersSent) res.status(503).json({ error: 'card_cli_open_failed' });
  }
});

export function installCardTerminals(server: Server): void {
  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (!pathname.startsWith('/api/card-terminals/')) return;
    void (async () => {
      const parts = /^\/api\/card-terminals\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/stream$/.exec(pathname);
      if (!parts || !getAllowedCorsOrigins().includes(String(req.headers.origin || ''))) throw new Error('terminal_origin_rejected');
      const [projectId, deckId, cardId, sessionId] = parts.slice(1).map(decodeURIComponent);
      const credential = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '')?.[1];
      const user = credential ? await getUserBySessionId(decodeURIComponent(credential)) : null;
      if (!user || !await getOwnedProjectByReference(projectId, user.id)) throw new Error('terminal_owner_required');
      const authority = await projectCardAuthority(projectId, deckId);
      const card = authority.cards.find(item => item.card.id === cardId);
      if (!card || card === authority.main || card.card.runtime.kind !== 'hermes') throw new Error('card_cli_unavailable');
      await assertCardProfileOwner(card.profile, user.id);
      if (await findExistingCanonicalChat(card.profile) !== sessionId) throw new Error('card_cli_session_changed');
      const root = path.join(resolveRepoRoot(), 'HermesLatest');
      const freshness = await tsImport(pathToFileURL(path.join(root, 'scripts/build/freshness.mjs')).href, pathToFileURL(__filename).href);
      if (!freshness.productCurrent({ source: root, product: 'tui', out: path.join(root, 'ui-tui/dist') })) {
        throw new Error('card_cli_build_required');
      }
      if (socket.destroyed) return;
      sockets.handleUpgrade(req, socket, head, ws => {
        const command = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
        const inherited = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'HOME', 'LANG', 'LC_ALL']);
        const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => inherited.has(key.toUpperCase()) && value !== undefined)) as Record<string, string>;
        let terminal: ReturnType<typeof spawn>;
        try {
          terminal = spawn(command, ['-m', 'hermes_cli.main', '-p', card.profile, '--tui', '--resume', sessionId], {
            name: 'xterm-256color', cols: 80, rows: 24, cwd: resolveRepoRoot(),
            env: { ...env, HERMES_HOME: path.join(root, '.hermes'), HERMES_PYTHON: command,
              HERMES_PYTHON_SRC_ROOT: root, HERMES_NODE: process.execPath,
              HERMES_TUI_DIR: path.join(root, 'ui-tui'), PYTHONPATH: root,
              TERM: 'xterm-256color', COLORTERM: 'truecolor' },
          });
        } catch { ws.close(1011, 'card_cli_start_failed'); return; }
        const output = terminal.onData(data => { if (ws.readyState === WebSocket.OPEN) ws.send(data); });
        const exited = terminal.onExit(() => { if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'CLI exited'); });
        ws.on('message', data => {
          const text = data.toString();
          const resize = /^\u001b\[RESIZE:(\d+);(\d+)\]$/.exec(text);
          try {
            if (resize) terminal.resize(dimension(resize[1], 2), dimension(resize[2], 1));
            else terminal.write(text);
          } catch { ws.close(1011, 'card_cli_input_failed'); }
        });
        ws.on('error', () => ws.terminate());
        ws.once('close', () => { output.dispose(); exited.dispose(); try { terminal.kill(); } catch { /* Viewer already exited. */ } });
      });
    })().catch(() => { if (!socket.destroyed) socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); });
  });
}

export function closeCardTerminals(): void {
  for (const socket of sockets.clients) socket.terminate();
}

export default router;
