/**
 * Every git call the plugin makes. The plugin runs outside the sandbox, so it — not the maker —
 * commits, diffs and lands; agents only ever edit files in their worktree.
 */
import { execFile } from 'node:child_process';
import { mkdir, rm, rmdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export class GitError extends Error {}

export function git(cwd, args, { timeout = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, stdout, stderr) => {
      if (error) reject(new GitError(`git ${args.join(' ')}: ${(stderr || error.message).trim()}`));
      else resolve(stdout.replace(/\n$/, ''));
    });
  });
}

const ok = (promise) => promise.then(() => true, () => false);

export const toplevel = (dir) => git(dir, ['rev-parse', '--show-toplevel']);
export const revParse = (repo, ref) => git(repo, ['rev-parse', '--verify', `${ref}^{commit}`]);
export const currentBranch = (repo) => git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '');
export const isClean = async (repo) => (await git(repo, ['status', '--porcelain', '--untracked-files=normal'])) === '';
export const hasOrigin = (repo) => ok(git(repo, ['remote', 'get-url', 'origin']));
export const isAncestor = (repo, a, b) => ok(git(repo, ['merge-base', '--is-ancestor', a, b]));

/** A detached worktree at `sha`, replacing whatever was at `path` before. */
export async function freshWorktree(repo, path, sha) {
  await removeWorktree(repo, path);
  await mkdir(dirname(path), { recursive: true });
  await git(repo, ['worktree', 'add', '--detach', path, sha]);
}

export async function removeWorktree(repo, path) {
  await git(repo, ['worktree', 'remove', '--force', path]).catch(() => {});
  await rm(path, { recursive: true, force: true });
  await git(repo, ['worktree', 'prune']).catch(() => {});
  await rmdir(dirname(path)).catch(() => {}); // the run's folder, once both roles are gone
}

/**
 * Commit everything in the worktree with a fixed message (never the maker's words, so a commit
 * message cannot carry instructions to the reviewer). Returns the new HEAD, or null when nothing changed.
 */
export async function commitAll(worktree, message) {
  await git(worktree, ['add', '-A']);
  if (await ok(git(worktree, ['diff', '--cached', '--quiet']))) return null;
  await git(worktree, ['-c', 'user.name=autoproject', '-c', 'user.email=autoproject@localhost', 'commit', '--no-verify', '-q', '-m', message]);
  return git(worktree, ['rev-parse', 'HEAD']);
}

/** Keep every candidate reachable (and inspectable) after its worktree is recycled. */
export const keepRef = (repo, slug, n, sha) => git(repo, ['update-ref', `refs/autoproject/${slug}/${n}`, sha]);

export const changedFiles = async (repo, base, sha) => (await git(repo, ['diff', '--name-only', base, sha])).split('\n').filter(Boolean);
export const diffStat = (repo, base, sha) => git(repo, ['diff', '--stat', base, sha]);

/**
 * Land exactly `sha` on `branch` in the main checkout by fast-forward. Refuses (BLOCKED) when the
 * checkout is dirty or on another branch, and fails when the branch moved since `base`.
 */
export async function fastForward(repo, branch, base, sha) {
  if ((await currentBranch(repo)) !== branch) return { outcome: 'BLOCKED', reason: `main checkout is not on ${branch}` };
  if (!(await isClean(repo))) return { outcome: 'BLOCKED', reason: 'main checkout has uncommitted changes' };
  const head = await revParse(repo, branch);
  if (head === sha) return { outcome: 'MERGED', landed: sha, reason: 'already landed' };
  if (head !== base) return { outcome: 'FAILED', reason: `${branch} moved from ${base.slice(0, 8)} to ${head.slice(0, 8)}` };
  await git(repo, ['merge', '--ff-only', '-q', sha]);
  return { outcome: 'MERGED', landed: await revParse(repo, branch) };
}
