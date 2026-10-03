/**
 * The checks and the protected-path gate, both run by the plugin itself: a maker's own
 * "tests pass" is never trusted, and a candidate that touches tests or eval config is rejected
 * before any reviewer sees it.
 */
import { spawn } from 'node:child_process';

const TAIL = 4000;

/** Run `command` through the shell in `cwd`. Resolves { ok, code, output } with the output's tail. */
export function runChecks(command, cwd, { timeoutMs = 10 * 60_000 } = {}) {
  if (!command?.trim()) return Promise.resolve({ ok: true, code: 0, output: '(no checks configured)' });
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], { cwd, env: { ...process.env, CI: '1' }, detached: true });
    let output = '';
    const add = (chunk) => { output = (output + chunk).slice(-TAIL * 4); };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } add(`\n[killed after ${timeoutMs / 1000}s]`); }, timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, output: output.slice(-TAIL) }); });
    child.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, code: -1, output: error.message }); });
  });
}

/** Minimal glob: `**` any path, `*` within a segment, a trailing `/` a whole directory. */
export function globToRegExp(glob) {
  const pattern = glob.endsWith('/') ? `${glob}**` : glob;
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') { re += '.*'; i++; if (pattern[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function protectedHits(files, globs = []) {
  const res = globs.map(globToRegExp);
  return files.filter((f) => res.some((re) => re.test(f)));
}
