/** The board's calls to the plugin's Host routes (same origin, the page's own session cookie). */
const url = (path, query = {}) => {
  const target = new URL('api/autoproject' + path, document.baseURI);
  for (const [key, value] of Object.entries(query)) if (value !== undefined) target.searchParams.set(key, String(value));
  return target;
};

async function call(method, path, { body, query, signal } = {}) {
  const init = { method, credentials: 'same-origin', signal, headers: {} };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const response = await fetch(url(path, query), init);
  let data;
  try { data = await response.json(); } catch { data = undefined; }
  if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
  return data;
}

export const api = {
  runs: (signal) => call('GET', '/runs', { signal }),
  wait: (revision, signal) => call('GET', '/wait', { query: { revision }, signal }),
  control: (slug, action, text) => call('POST', '/control', { body: { slug, action, text } }),
  merge: (slug) => call('POST', '/merge', { body: { slug } }),
};
