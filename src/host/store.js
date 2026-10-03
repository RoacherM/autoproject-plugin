/**
 * Run state, one JSON file per run under the plugin's data dir. The rubric lives here and nowhere
 * in a worktree. Every transition is written before the next step starts, so a restart knows
 * exactly where each run stood.
 */
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** v2 keeps its own directory: v1 runs have another shape and are not loaded (they stay on disk). */
export const defaultDataDir = () => join(homedir(), '.dsh', 'plugin-data', 'autoproject-v2');

export function createStore({ dir }) {
  const runsDir = join(dir, 'runs');
  const file = (slug) => join(runsDir, `${slug}.json`);
  return {
    dir,
    worktreePath: (slug, role) => join(dir, 'worktrees', slug, role),
    async get(slug) {
      try { return JSON.parse(await readFile(file(slug), 'utf8')); } catch { return undefined; }
    },
    async list() {
      let names = [];
      try { names = await readdir(runsDir); } catch { return []; }
      const runs = await Promise.all(names.filter((n) => n.endsWith('.json')).map((n) => this.get(n.slice(0, -5))));
      return runs.filter(Boolean).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async save(run) {
      await mkdir(runsDir, { recursive: true });
      const tmp = `${file(run.slug)}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(run, null, 2)}\n`);
      await rename(tmp, file(run.slug));
      return run;
    },
  };
}
