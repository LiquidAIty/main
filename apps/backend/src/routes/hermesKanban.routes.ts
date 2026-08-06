import { Router } from 'express';
import { execFile } from 'node:child_process';

/*
 * Hermes Kanban proxy — thin read/persistence adapter (DONT.md rule 5).
 *
 * This router shells out to the installed `hermes` CLI for the LIVE kanban
 * system (kanban.db is owned by the local Hermes install, not by LiquidAIty).
 * TS is transport only: every value shown is the native `hermes kanban ...`
 * JSON / plain output verbatim-shaped. No logic, no fallbacks, no fake data.
 *
 * Read routes are safe (list/show/stats/boards/profiles/config). Mutation
 * routes (create/block/comment/...) run the real CLI and are only invoked by
 * explicit user action in the Hermes Kanban app. Nothing here auto-mutates.
 */

const HERMES_BIN = process.env.HERMES_BIN || 'hermes';
const HERMES_EXEC_TIMEOUT_MS = 20_000;

export type HermesExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export function runHermes(
  args: readonly string[],
  bin: string = HERMES_BIN,
  timeoutMs: number = HERMES_EXEC_TIMEOUT_MS,
): Promise<HermesExecResult> {
  return new Promise((resolve) => {
    execFile(
      bin,
      [...args],
      {
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        shell: false,
      },
      (error, stdout, stderr) => {
        const rawCode = (error as { code?: unknown } | null)?.code;
        const exitCode =
          typeof rawCode === 'number' ? rawCode : error ? 1 : 0;
        resolve({
          exitCode,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
      },
    );
  });
}

/** Parse `hermes ... --json` stdout, tolerating a leading warning line. */
export function parseHermesJson<T>(stdout: string): T {
  const trimmed = stdout.trim();
  const start = trimmed.search(/[[{]/);
  if (start < 0) {
    throw new Error(`hermes_cli_json_not_found: ${trimmed.slice(0, 120)}`);
  }
  return JSON.parse(trimmed.slice(start)) as T;
}

export function parseYamlishConfig(block: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes(':')) continue;
    const idx = line.indexOf(':');
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value === '' || value === 'null' || value === 'None') {
      out[key] = null;
    } else if (value === 'true') {
      out[key] = true;
    } else if (value === 'false') {
      out[key] = false;
    } else if (/^-?\d+$/.test(value)) {
      out[key] = Number(value);
    } else if (/^-?\d+\.\d+$/.test(value)) {
      out[key] = Number(value);
    } else if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      out[key] = value.slice(1, -1);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Slice a plain-text `hermes profile list` table by header column offsets. */
export function parseProfileTable(text: string): {
  name: string;
  active: boolean;
  model: string;
  gateway: string;
  alias: string;
  distribution: string;
}[] {
  const rows: {
    name: string;
    active: boolean;
    model: string;
    gateway: string;
    alias: string;
    distribution: string;
  }[] = [];
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.trimStart().startsWith('Profile'));
  if (headerIdx < 0) return rows;
  const header = lines[headerIdx];
  const offsets: { name: string; start: number }[] = [];
  for (const col of ['Profile', 'Model', 'Gateway', 'Alias', 'Distribution']) {
    const at = header.indexOf(col);
    if (at >= 0) offsets.push({ name: col, start: at });
  }
  if (offsets.length === 0) return rows;
  // Slice by ascending column offsets against the RAW line (both header and
  // data rows share the same leading column padding, so untrimmed slicing
  // keeps glyph alignment).
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '');
    if (!line.trim()) continue;
    // Skip only separator lines made of dash/box-drawing glyphs — data rows
    // may legitimately contain an em-dash in the Alias/Distribution columns.
    if (/^[\s─—\-·.]+$/.test(line)) continue;
    const slice = (col: string): string => {
      const idx = offsets.findIndex((o) => o.name === col);
      if (idx < 0) return '';
      const start = offsets[idx].start;
      const end = idx < offsets.length - 1 ? offsets[idx + 1].start : line.length;
      return line.slice(start, end).trim();
    };
    const rawName = slice('Profile');
    const active = rawName.includes('◆');
    rows.push({
      name: rawName.replace(/^[◆]/, '').trim(),
      active,
      model: slice('Model'),
      gateway: slice('Gateway'),
      alias: slice('Alias'),
      distribution: slice('Distribution'),
    });
  }
  return rows;
}

const router = Router();

function ok(res: Parameters<Parameters<Router['get']>[1]>[1], data: unknown) {
  res.json({ ok: true, data });
}

function fail(
  res: Parameters<Parameters<Router['get']>[1]>[1],
  status: number,
  error: string,
  detail?: unknown,
) {
  res.status(status).json({ ok: false, error, detail: detail ?? null });
}

// ── Read surface ─────────────────────────────────────────────────────────
router.get('/boards', async (_req, res) => {
  try {
    const { exitCode, stdout, stderr } = await runHermes([
      'kanban',
      'boards',
      'list',
      '--json',
    ]);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_boards_failed`, stderr.trim());
    }
    return ok(res, parseHermesJson(stdout));
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_boards_failed',
    );
  }
});

router.get('/tasks', async (req, res) => {
  try {
    const board = String(req.query.board || '').trim();
    const includeArchived = req.query.includeArchived === 'true';
    const tenant = String(req.query.tenant || '').trim();
    const assignee = String(req.query.assignee || '').trim();
    const args = ['kanban'];
    if (board) args.push('--board', board);
    args.push('list', '--json');
    if (includeArchived) args.push('--archived');
    if (tenant) args.push('--tenant', tenant);
    if (assignee) args.push('--assignee', assignee);
    const { exitCode, stdout, stderr } = await runHermes(args);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_list_failed`, stderr.trim());
    }
    return ok(res, parseHermesJson<unknown[]>(stdout));
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_list_failed',
    );
  }
});

router.get('/tasks/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return fail(res, 400, 'hermes_kanban_task_id_required');
    const { exitCode, stdout, stderr } = await runHermes(['kanban', 'show', id, '--json']);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_show_failed`, stderr.trim());
    }
    return ok(res, parseHermesJson(stdout));
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_show_failed',
    );
  }
});

router.get('/tasks/:id/runs', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return fail(res, 400, 'hermes_kanban_task_id_required');
    const { exitCode, stdout, stderr } = await runHermes(['kanban', 'runs', id, '--json']);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_runs_failed`, stderr.trim());
    }
    return ok(res, parseHermesJson(stdout));
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_runs_failed',
    );
  }
});

router.get('/tasks/:id/attachments', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return fail(res, 400, 'hermes_kanban_task_id_required');
    const { exitCode, stdout, stderr } = await runHermes([
      'kanban',
      'attachments',
      id,
      '--json',
    ]);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_attachments_failed`, stderr.trim());
    }
    return ok(res, parseHermesJson(stdout));
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_attachments_failed',
    );
  }
});

router.get('/stats', async (req, res) => {
  try {
    const board = String(req.query.board || '').trim();
    const args = ['kanban'];
    if (board) args.push('--board', board);
    args.push('stats', '--json');
    const { exitCode, stdout, stderr } = await runHermes(args);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_stats_failed`, stderr.trim());
    }
    return ok(res, parseHermesJson(stdout));
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_stats_failed',
    );
  }
});

router.get('/system', async (_req, res) => {
  try {
    const [gatewayRes, configRes, statsRes, diagRes, profilesRes] =
      await Promise.all([
        runHermes(['gateway', 'status']),
        runHermes(['config', 'get', 'kanban']),
        runHermes(['kanban', 'stats', '--json']),
        runHermes(['kanban', 'diagnostics', '--json']),
        runHermes(['profile', 'list']),
      ]);
    const gatewayOut = gatewayRes.stdout.trim();
    const running = gatewayRes.exitCode === 0 && /Gateway process running/i.test(gatewayOut);
    const pidMatch = gatewayOut.match(/PID:\s*(\d+)/i);
    const kanbanCfg = parseYamlishConfig(configRes.stdout);
    return ok(res, {
      gateway: {
        running,
        pid: pidMatch ? Number(pidMatch[1]) : null,
        raw: gatewayOut.slice(0, 400),
      },
      dispatcher: {
        running: running && kanbanCfg.dispatch_in_gateway !== false,
        dispatchInGateway: kanbanCfg.dispatch_in_gateway !== false,
        intervalSeconds: kanbanCfg.dispatch_interval_seconds ?? null,
        staleTimeoutSeconds: kanbanCfg.dispatch_stale_timeout_seconds ?? null,
      },
      stats: statsRes.exitCode === 0 ? parseHermesJson(statsRes.stdout) : null,
      diagnostics:
        diagRes.exitCode === 0 ? parseHermesJson<unknown[]>(diagRes.stdout) : [],
      profiles: parseProfileTable(profilesRes.stdout),
      now: Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_system_failed',
    );
  }
});

router.get('/profiles', async (_req, res) => {
  try {
    const [listRes, configRes] = await Promise.all([
      runHermes(['profile', 'list']),
      runHermes(['config', 'get', 'kanban']),
    ]);
    const profiles = parseProfileTable(listRes.stdout);
    const kanbanCfg = parseYamlishConfig(configRes.stdout);
    const enriched: Record<string, unknown>[] = await Promise.all(
      profiles.map(async (p) => {
        let description = '';
        const desc = await runHermes(['profile', 'describe', p.name]);
        if (desc.exitCode === 0) description = desc.stdout.trim();
        return {
          ...p,
          description: description || null,
          defaultProfile: Boolean(p.active),
          concurrency:
            kanbanCfg.max_in_progress_per_profile ?? null,
        };
      }),
    );
    return ok(res, enriched);
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_profiles_failed',
    );
  }
});

router.get('/config', async (_req, res) => {
  try {
    const [kanbanRes, delegationRes] = await Promise.all([
      runHermes(['config', 'get', 'kanban']),
      runHermes(['config', 'get', 'delegation']),
    ]);
    return ok(res, {
      kanban:
        kanbanRes.exitCode === 0 ? parseYamlishConfig(kanbanRes.stdout) : {},
      delegation:
        delegationRes.exitCode === 0
          ? parseYamlishConfig(delegationRes.stdout)
          : {},
    });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_config_failed',
    );
  }
});

// ── Mutation surface (explicit user action only) ─────────────────────────
type PostBody = Record<string, unknown>;

function requireAnchor(body: PostBody, name: string): string | null {
  const value = String(body[name] ?? '').trim();
  return value || null;
}

router.post('/create', async (req, res) => {
  try {
    const b = (req.body || {}) as PostBody;
    const board = requireAnchor(b, 'board');
    const title = requireAnchor(b, 'title');
    if (!title) return fail(res, 400, 'hermes_kanban_create_title_required');
    const args = ['kanban'];
    if (board) args.push('--board', board);
    args.push('create', title, '--body', requireAnchor(b, 'body') ?? '');
    const assignee = requireAnchor(b, 'assignee');
    if (assignee) args.push('--assignee', assignee);
    const priority = Number(b.priority ?? 0);
    if (Number.isFinite(priority) && priority !== 0) {
      args.push('--priority', String(Math.trunc(priority)));
    }
    const parent = requireAnchor(b, 'parent');
    if (parent) args.push('--parent', parent);
    args.push('--json');
    const { exitCode, stdout, stderr } = await runHermes(args);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_create_failed`, stderr.trim());
    }
    return ok(res, parseHermesJson(stdout));
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_create_failed',
    );
  }
});

router.post('/tasks/:id/block', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const b = (req.body || {}) as PostBody;
    const reason = String(b.reason ?? '').trim();
    const args = ['kanban', 'block', id, '--kind', String(b.kind ?? 'needs_input')];
    if (reason) args.push(reason);
    const { exitCode, stdout, stderr } = await runHermes(args);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_block_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_block_failed',
    );
  }
});

router.post('/tasks/:id/unblock', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const b = (req.body || {}) as PostBody;
    const reason = String(b.reason ?? '');
    const args = ['kanban', 'unblock'];
    if (reason.trim()) args.push('--reason', reason.trim());
    args.push(id);
    const { exitCode, stdout, stderr } = await runHermes(args);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_unblock_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_unblock_failed',
    );
  }
});

router.post('/tasks/:id/archive', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const { exitCode, stdout, stderr } = await runHermes(['kanban', 'archive', id]);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_archive_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_archive_failed',
    );
  }
});

router.post('/tasks/:id/promote', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const { exitCode, stdout, stderr } = await runHermes(['kanban', 'promote', id]);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_promote_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_promote_failed',
    );
  }
});

router.post('/tasks/:id/complete', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const b = (req.body || {}) as PostBody;
    const args = ['kanban', 'complete', id];
    const result = requireAnchor(b, 'result');
    if (result) args.push('--result', result);
    const { exitCode, stdout, stderr } = await runHermes(args);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_complete_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_complete_failed',
    );
  }
});

router.post('/tasks/:id/edit', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const b = (req.body || {}) as PostBody;
    const result = requireAnchor(b, 'result');
    if (!result) return fail(res, 400, 'hermes_kanban_edit_result_required');
    const args = ['kanban', 'edit', id, '--result', result];
    const summary = requireAnchor(b, 'summary');
    if (summary) args.push('--summary', summary);
    const metadata = requireAnchor(b, 'metadata');
    if (metadata) args.push('--metadata', metadata);
    const { exitCode, stdout, stderr } = await runHermes(args);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_edit_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_edit_failed',
    );
  }
});

router.post('/tasks/:id/comment', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const b = (req.body || {}) as PostBody;
    const text = requireAnchor(b, 'text');
    if (!text) return fail(res, 400, 'hermes_kanban_comment_text_required');
    const author = requireAnchor(b, 'author') || 'user';
    const { exitCode, stdout, stderr } = await runHermes([
      'kanban',
      'comment',
      id,
      text,
      '--author',
      author,
    ]);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_comment_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_comment_failed',
    );
  }
});

router.post('/tasks/:id/assign', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const b = (req.body || {}) as PostBody;
    const assignee = requireAnchor(b, 'assignee');
    if (!assignee) return fail(res, 400, 'hermes_kanban_assignee_required');
    const { exitCode, stdout, stderr } = await runHermes([
      'kanban',
      'assign',
      id,
      '--assignee',
      assignee,
    ]);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_assign_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_assign_failed',
    );
  }
});

router.post('/tasks/:id/link', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const b = (req.body || {}) as PostBody;
    const parent = requireAnchor(b, 'parent');
    if (!parent) return fail(res, 400, 'hermes_kanban_link_parent_required');
    const { exitCode, stdout, stderr } = await runHermes([
      'kanban',
      'link',
      parent,
      id,
    ]);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_link_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_link_failed',
    );
  }
});

router.post('/tasks/:id/unlink', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const b = (req.body || {}) as PostBody;
    const parent = requireAnchor(b, 'parent');
    if (!parent) return fail(res, 400, 'hermes_kanban_unlink_parent_required');
    const { exitCode, stdout, stderr } = await runHermes([
      'kanban',
      'unlink',
      parent,
      id,
    ]);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_unlink_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_unlink_failed',
    );
  }
});

router.post('/dispatch', async (_req, res) => {
  try {
    const { exitCode, stdout, stderr } = await runHermes(['kanban', 'dispatch', '--json']);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_dispatch_failed`, stderr.trim());
    }
    return ok(res, parseHermesJson(stdout));
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_dispatch_failed',
    );
  }
});

router.post('/gateway/restart', async (_req, res) => {
  try {
    const { exitCode, stdout, stderr } = await runHermes([
      'gateway',
      'restart',
    ]);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_gateway_restart_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_gateway_restart_failed',
    );
  }
});

export default router;
