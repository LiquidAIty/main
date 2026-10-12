import { existsSync } from 'node:fs';
import path from 'node:path';

export function resolveRepoRoot(): string {
  const configured = String(process.env.LIQUIDAITY_REPO_ROOT || '').trim();
  if (configured) return path.resolve(configured);

  for (const start of [process.cwd(), __dirname]) {
    let candidate = path.resolve(start);
    for (;;) {
      if (
        existsSync(path.join(candidate, 'package.json'))
        && existsSync(path.join(candidate, 'apps', 'backend', 'package.json'))
      ) {
        return candidate;
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) break;
      candidate = parent;
    }
  }
  throw new Error('liquidaity_repo_root_not_found');
}
