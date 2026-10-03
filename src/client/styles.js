/**
 * Laid out like Vibe Kanban's board (packages/ui KanbanBoard, web-core KanbanContainer):
 * title and one toolbar row, then the board takes every remaining pixel. Columns sit edge to edge
 * divided by hairlines, share the width up to a cap and scroll sideways only when the window is
 * narrower than four readable columns; each column scrolls on its own. Cards are rows divided by
 * hairlines, not floating boxes. The detail opens as a split panel beside the board.
 * No shadows, gradients or tints; color only in the column dots and warning text.
 */
const fg = 'var(--dsw-alias-label-primary)', fg2 = 'var(--dsw-alias-label-secondary)', fg3 = 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))';
const base = 'var(--dsw-alias-bg-base)', l1 = 'var(--dsw-alias-bg-layer-1)', l2 = 'var(--dsw-alias-bg-layer-2)';
const line = 'var(--dsw-alias-border-l1)', line2 = 'var(--dsw-alias-border-l2)';
const ok = 'var(--dsw-alias-state-success-primary)', warn = 'var(--dsw-alias-state-warn-primary)', err = 'var(--dsw-alias-state-error-primary)', idle = 'var(--dsw-alias-state-idle-primary, #b4b4ba)';
const brand = 'var(--dsw-alias-brand-primary, #4d6bfe)';
const mix = (c, p, into = 'transparent') => `color-mix(in srgb, ${c} ${p}%, ${into})`;

export const TONE = { todo: idle, inprogress: brand, inreview: warn, done: ok, cancelled: err };

export const CSS = `
.apk { position:relative; height:100%; display:flex; flex-direction:column; color:${fg}; background:${base}; font-size:13px; line-height:1.5; -webkit-font-smoothing:antialiased; overflow:hidden; container-type:inline-size; }
.apk button, .apk select { font:inherit; }

/* 44px top: clears the window controls when the sidebar is collapsed, like every other DSH page. */
.apk-head { flex:none; display:flex; flex-direction:column; gap:14px; padding:44px 24px 14px; }
.apk-title { display:flex; align-items:baseline; gap:10px; }
.apk-title h1 { margin:0; font-size:22px; font-weight:600; letter-spacing:-.02em; line-height:1.2; }
.apk-live { font-size:12px; color:${fg3}; }
.apk-live.off { color:${err}; }

.apk-toolbar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; min-height:28px; }
.apk-seg { display:inline-flex; padding:2px; gap:2px; border-radius:7px; background:${l2}; }
.apk-seg button { display:inline-flex; align-items:center; gap:5px; height:24px; padding:0 10px; border:none; border-radius:5px; background:transparent; color:${fg2}; font-size:12.5px; cursor:pointer; }
.apk-seg button span { color:${fg3}; font-variant-numeric:tabular-nums; }
.apk-seg button.on { background:${base}; color:${fg}; box-shadow:0 0 0 1px ${line}; }
.apk-select { height:28px; max-width:240px; padding:0 28px 0 10px; border:1px solid ${line}; border-radius:6px; color:${fg}; font-size:12.5px; cursor:pointer; outline:none;
  -webkit-appearance:none; appearance:none; background:${base} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath d='M2 4l3 3 3-3' fill='none' stroke='%23999' stroke-width='1.4'/%3E%3C/svg%3E") no-repeat right 10px center; }
.apk-select:hover { border-color:${line2}; }
.apk-check { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; color:${fg2}; cursor:pointer; user-select:none; }
.apk-check input { margin:0; }
.apk-summary { margin-left:auto; font-size:12.5px; color:${fg3}; font-variant-numeric:tabular-nums; white-space:nowrap; }
.apk-summary b { font-weight:500; color:${warn}; }
.apk-run-ctl { display:inline-flex; gap:6px; align-items:center; }
.apk-note { font-size:12px; color:${fg3}; }

.apk-btn { display:inline-flex; align-items:center; gap:5px; height:28px; padding:0 10px; border:1px solid ${line}; border-radius:6px; background:${base}; color:${fg};
  font-size:12.5px; font-weight:500; cursor:pointer; white-space:nowrap; }
.apk-btn:hover:not(:disabled) { background:${l2}; }
.apk-btn:disabled { opacity:.45; cursor:default; }
.apk-btn.primary { background:${fg}; border-color:${fg}; color:${base}; }
.apk-btn.danger { color:${err}; }
.apk-btn.ghost { border-color:transparent; color:${fg2}; }

/* The work area: board (or list) plus the optional detail panel, split side by side. */
.apk-main { position:relative; flex:1; min-height:0; display:flex; border-top:1px solid ${line}; }
.apk-scroll { flex:1; min-width:0; overflow-x:auto; overflow-y:hidden; padding:0 24px; }
.apk-scroll.list { overflow-y:auto; }
.apk-board { height:100%; display:grid; grid-template-columns:repeat(4, minmax(232px, 1fr)); max-width:1520px; border-left:1px solid ${line}; }
.apk-col { min-width:0; min-height:0; display:flex; flex-direction:column; border-right:1px solid ${line}; }
.apk-col-head { flex:none; display:flex; align-items:center; gap:8px; height:38px; padding:0 12px; border-bottom:1px solid ${line}; background:${mix(l2, 45)}; font-size:12.5px; font-weight:500; }
.apk-col-head i { width:7px; height:7px; border-radius:50%; flex:none; }
.apk-col-head span { margin-left:auto; color:${fg3}; font-weight:400; font-variant-numeric:tabular-nums; }
.apk-col-body { flex:1; min-height:0; overflow-y:auto; }

.apk-card { display:flex; flex-direction:column; gap:4px; width:100%; padding:11px 12px 12px; border:none; border-bottom:1px solid ${line}; border-radius:0; background:transparent; color:inherit; text-align:left; cursor:pointer; }
.apk-card:hover { background:${mix(l2, 55)}; }
.apk-card.sel { background:${mix(l2, 80)}; box-shadow:inset 2px 0 0 ${fg}; }
.apk-card.queued .apk-card-title { color:${fg2}; font-weight:400; }
.apk-card-top { display:flex; align-items:center; gap:6px; min-width:0; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11.5px; color:${fg3}; }
.apk-card-top > span:last-child { margin-left:auto; font-family:inherit; }
.apk-slug { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
.apk-card-title { font-size:13px; font-weight:500; line-height:1.4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.apk-card-desc { font-size:12px; color:${fg3}; line-height:1.45; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; word-break:break-word; }
.apk-card-foot { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:2px; font-size:11.5px; color:${fg3}; font-variant-numeric:tabular-nums; }
.apk-card-foot .grow { flex:1; }
.apk-tag { font-size:11.5px; color:${fg3}; }
.apk-tag.warn { color:${warn}; }
.apk-tag.ok { color:${ok}; }
.apk-tag.err { color:${err}; }
.apk-mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11.5px; }
.apk-spin { display:inline-block; width:10px; height:10px; border-radius:50%; border:1.5px solid ${line2}; border-top-color:${fg2}; animation:apk-rot 1s linear infinite; flex:none; }
@keyframes apk-rot { to { transform:rotate(360deg); } }

.apk-list { max-width:760px; border-left:1px solid ${line}; border-right:1px solid ${line}; min-height:100%; }

/* Detail: a split panel beside the board; below 1400px (four readable columns plus the panel) it covers the board instead. */
.apk-panel { flex:none; width:420px; min-height:0; display:flex; flex-direction:column; border-left:1px solid ${line}; background:${base}; }
@container (max-width: 1400px) { .apk-panel { position:absolute; top:0; right:0; bottom:0; width:min(420px, 100%); z-index:5; } }
.apk-panel-head { flex:none; display:flex; align-items:flex-start; gap:10px; padding:14px 16px 12px; border-bottom:1px solid ${line}; }
.apk-panel-head h2 { margin:4px 0 0; font-size:14.5px; font-weight:600; line-height:1.4; }
.apk-panel-head .apk-card-top { font-family:inherit; }
.apk-panel-body { flex:1; overflow-y:auto; padding:14px 16px 28px; display:flex; flex-direction:column; gap:18px; }
.apk-sec h3 { margin:0 0 6px; font-size:12px; font-weight:600; color:${fg3}; }
.apk-kv { display:grid; grid-template-columns:90px 1fr; gap:4px 12px; font-size:12.5px; margin:0; }
.apk-kv dt { color:${fg3}; }
.apk-kv dd { margin:0; word-break:break-word; }
.apk-text { margin:0; white-space:pre-wrap; word-break:break-word; font-size:12.5px; color:${fg2}; line-height:1.55; }
.apk-steps { display:flex; flex-direction:column; }
.apk-step { display:grid; grid-template-columns:1fr auto; gap:10px; padding:3px 0; font-size:12.5px; }
.apk-step i { display:none; }
.apk-step.open span:first-of-type { font-weight:600; }
.apk-step.todo { color:${fg3}; }
.apk-step span:last-child { color:${fg3}; font-variant-numeric:tabular-nums; font-size:12px; }
.apk-activity { margin-top:6px; font-size:12px; color:${fg3}; display:flex; gap:8px; align-items:center; }
.apk-actions { display:flex; gap:8px; flex-wrap:wrap; }
.apk-steer { display:flex; gap:6px; }
.apk-steer input { flex:1; min-width:0; height:28px; padding:0 9px; border:1px solid ${line}; border-radius:6px; background:${base}; color:${fg}; font:inherit; font-size:12.5px; outline:none; }
.apk-steer input:focus { border-color:${fg3}; }
details.apk-more summary { cursor:pointer; color:${fg2}; font-size:12.5px; }
details.apk-more[open] summary { margin-bottom:6px; }

.apk-empty { margin:48px auto; max-width:420px; padding:0 24px; text-align:center; color:${fg3}; font-size:13px; line-height:1.6; }
.apk-error { font-size:12.5px; color:${err}; }

.apk-toolcard { display:flex; align-items:center; gap:10px; padding:8px 12px; border:1px solid ${line}; border-radius:8px; font-size:13px; }
.apk-toolcard div { flex:1; min-width:0; }
.apk-toolcard b { display:block; font-weight:500; }
.apk-toolcard small { display:block; color:${fg3}; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
`;
