/**
 * Authenticated `/api/autoproject/*` routes for the board page (through `ctx.connection.fetch`):
 * the runs as the board draws them, a long-poll on the engine's revision, and the same controls
 * the chat tool has.
 */
import { RunError } from './engine.js';

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

/** A run as the board needs it: the tool lists shrink to counts, the live role's activity is added. */
export function viewRun(run, activity) {
  const slim = (it) => {
    if (!it) return it;
    const { makerTools, reviewerTools, ...rest } = it;
    return rest;
  };
  return {
    ...run,
    iterations: run.iterations.map(slim),
    current: run.current ? { ...slim(run.current), activity } : null,
  };
}

export async function boardData(engine) {
  const runs = await engine.list();
  return {
    revision: engine.revision,
    now: new Date().toISOString(),
    runs: runs.map((run) => viewRun(run, run.status === 'running' ? engine.activity(run.slug) : undefined)),
  };
}

export function registerRoutes(ctx, { engine }) {
  const routes = [
    ['GET', '/api/autoproject/runs', async () => json(await boardData(engine))],
    ['GET', '/api/autoproject/wait', async (request, url) => {
      const since = Number(url.searchParams.get('revision') ?? -1);
      return json({ revision: await engine.wait(since, { signal: request.signal }) });
    }],
    ['POST', '/api/autoproject/control', async (request) => {
      let input;
      try { input = await request.json(); } catch { throw new RunError('the request body is not JSON'); }
      if (!['steer', 'pause', 'resume', 'stop'].includes(input?.action)) throw new RunError('action must be steer, pause, resume or stop');
      if (input.action === 'steer' && !String(input.text ?? '').trim()) throw new RunError('steer needs text');
      await engine.control(String(input.slug ?? ''), input.action, String(input.text ?? '').trim() || undefined);
      return json(await boardData(engine));
    }],
  ];
  for (const [method, path, fn] of routes) {
    ctx.effect(() => ctx.connection.fetch.register({
      path, methods: [method], requestBody: 'buffered',
      fetch: async (request) => {
        try { return await fn(request, new URL(request.url)); } catch (error) {
          return json({ error: error?.message ?? String(error) }, error instanceof RunError ? 400 : 500);
        }
      },
    }), 'dsh-autoproject: ' + path);
  }
}
