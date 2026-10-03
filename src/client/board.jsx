/**
 * The Autoproject board: every run's iterations as Vibe Kanban cards, live.
 * Data: one GET of all runs, then a long-poll on the Host's revision; while an iteration is in
 * flight it also re-reads every few seconds, because a role's tool activity does not bump the revision.
 */
import React from 'react';
import { buildBoard, COLUMNS, CONDITIONAL, formatDuration, PIPELINE, steps } from '../shared/board.js';
import { kTokens, metrics, POINTS, ROLES, tokensOf } from '../shared/metrics.js';
import { useI18n } from './i18n.jsx';
import { TONE } from './styles.js';

/** Cancelled is a tab, not a column, as in Vibe Kanban: the board shows the work that is still moving. */
const BOARD_COLUMNS = COLUMNS.filter((c) => c !== 'cancelled');

const short = (sha) => (sha ? sha.slice(0, 8) : '');
const since = (iso, now) => formatDuration(now - new Date(iso));

function useBoard(api) {
  const [state, setState] = React.useState({ data: null, error: null, connected: true });
  const reload = React.useCallback(async (signal) => {
    const data = await api.runs(signal);
    setState({ data, error: null, connected: true });
    return data;
  }, [api]);
  React.useEffect(() => {
    const abort = new AbortController();
    let revision = -1;
    (async () => {
      while (!abort.signal.aborted) {
        try {
          const data = await reload(abort.signal);
          revision = data.revision;
          while (!abort.signal.aborted) {
            const next = await api.wait(revision, abort.signal);
            if (next.revision !== revision) { revision = (await reload(abort.signal)).revision; }
          }
        } catch (error) {
          if (abort.signal.aborted) return;
          setState((s) => ({ ...s, error: s.data ? null : error.message, connected: false }));
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    })();
    return () => abort.abort();
  }, [reload]);
  // A live role's tool calls don't bump the revision: poll lightly while something is in flight.
  const live = state.data?.runs?.some((r) => r.current);
  React.useEffect(() => {
    if (!live) return undefined;
    const timer = setInterval(() => { reload().catch(() => {}); }, 4000);
    return () => clearInterval(timer);
  }, [live, reload]);
  const apply = React.useCallback((data) => setState({ data, error: null, connected: true }), []);
  return { ...state, apply };
}

function useNow(active) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

const modelText = (m) => (m ? `${m.model}${m.reasoningEffort ? `@${m.reasoningEffort}` : ''}` : '');

const Slug = ({ slug }) => <span className="apk-slug" title={slug}>{slug}</span>;

/** Opens one role's history through its parent chat; older roles have no subagent record and cannot be opened. */
function TranscriptButton({ t, label, parent, session, viewable, open }) {
  const reason = !session || !parent ? t('noTranscript') : viewable ? undefined : t('oldTranscript');
  return <button type="button" className="apk-btn" disabled={reason !== undefined} title={reason} onClick={() => open(parent, session)}>{t(label)}</button>;
}

function StatusIcon({ card }) {
  if (card.live) return <span className="apk-spin" />;
  if (card.queued) return <span>{card.paused ? '⏸' : '◷'}</span>;
  if (card.attention) return <span>!</span>;
  if (card.outcome === 'BETTER') return <span>✓</span>;
  return <span>✕</span>;
}


function Card({ card, now, selected, onOpen }) {
  const { t } = useI18n();
  let title;
  let desc;
  if (card.queued) {
    title = `${t('next')} · #${card.n}`;
    desc = card.paused ? card.pauseReason : card.left > 1 ? t('moreLeft', { n: card.left - 1 }) : '';
  } else if (card.live) {
    title = t(`node_${card.phase}`);
    const a = card.activity;
    desc = a?.lastTool ? `${a.lastTool}${a.lastHint ? ` · ${a.lastHint}` : ''}` : card.makerSummary ?? '';
  } else {
    title = card.summary || card.reason || t(`outcome_${card.outcome}`);
    desc = card.summary && card.reason && card.outcome !== 'BETTER' && !card.reason.includes(card.summary) ? card.reason : card.makerSummary ?? '';
  }
  const cls = ['apk-card', card.live && 'live', card.queued && 'queued', card.attention && 'attn', selected && 'sel'].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} onClick={() => onOpen(card.id)}>
      <div className="apk-card-top"><Slug slug={card.slug} /><span>#{card.n}</span><span style={{ marginLeft: 'auto' }}><StatusIcon card={card} /></span></div>
      <div className="apk-card-title">{title}</div>
      {desc ? <div className="apk-card-desc">{desc}</div> : null}
      <div className="apk-card-foot">
        {card.live ? <>
          <span>{t('inNode', { t: since(card.phaseSince, now) })}</span>
          {card.activity?.toolCalls ? <span>· {t('toolCalls', { n: card.activity.toolCalls })}</span> : null}
        </> : null}
        {!card.live && !card.queued && card.finishedAt ? <span>{t('took', { t: formatDuration(new Date(card.finishedAt) - new Date(card.startedAt)) })}</span> : null}
        {card.sha && !card.live ? <span className="apk-mono">{short(card.sha)}</span> : null}
        <span className="grow" />
        {card.stuck ? <span className="apk-tag">{t('stuckTag')}</span> : null}
        {card.revised ? <span className="apk-tag">{t('revised')}</span> : null}
        {card.repaired ? <span className="apk-tag">{t('repaired')}</span> : null}
        {card.attention ? <span className="apk-tag warn">{t('needsYou')}</span> : null}
        {card.queued && card.paused ? <span className="apk-tag warn">{t('pausedTag')}</span> : null}
        {card.queued && card.guidance?.length ? <span className="apk-tag">{t('guidanceQueued', { n: card.guidance.length })}</span> : null}
      </div>
    </button>
  );
}

function RunControls({ run, act, busy }) {
  const { t } = useI18n();
  const [confirm, setConfirm] = React.useState(false);
  React.useEffect(() => { if (!confirm) return undefined; const x = setTimeout(() => setConfirm(false), 3000); return () => clearTimeout(x); }, [confirm]);
  if (run.status === 'stopped') return null;
  const stop = (e) => { e.stopPropagation(); if (confirm) { setConfirm(false); act(run.slug, 'stop'); } else setConfirm(true); };
  return (
    <div className="apk-run-ctl" onClick={(e) => e.stopPropagation()}>
      {run.status === 'running'
        ? <button type="button" className="apk-btn" disabled={busy || run.pauseRequested || run.stopRequested} onClick={() => act(run.slug, 'pause')}>{t('pause')}</button>
        : <button type="button" className="apk-btn primary" disabled={busy} onClick={() => act(run.slug, 'resume')}>{t('resume')}</button>}
      <button type="button" className="apk-btn danger" disabled={busy || run.stopRequested} onClick={stop}>{confirm ? t('confirmStop') : t('stop')}</button>
      {run.stopRequested ? <span className="apk-note">{t('stopRequested')}</span> : run.pauseRequested ? <span className="apk-note">{t('pauseRequested')}</span> : null}
    </div>
  );
}

function Steer({ run, act, busy }) {
  const { t } = useI18n();
  const [text, setText] = React.useState('');
  if (run.status === 'stopped') return null;
  const send = () => { const value = text.trim(); if (!value) return; act(run.slug, 'steer', value).then((ok) => { if (ok) setText(''); }); };
  return (
    <div className="apk-steer">
      <input value={text} placeholder={t('steer')} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(); }} />
      <button type="button" className="apk-btn" disabled={busy || !text.trim()} onClick={send}>{t('send')}</button>
    </div>
  );
}

function Kv({ rows }) {
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!shown.length) return null;
  return <dl className="apk-kv">{shown.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>;
}

const pct = (x) => (x === null ? '–' : `${Math.round(x * 100)}%`);

/** The numbers that say whether each node earns its tokens (see shared/metrics.js). */
function RunMetrics({ run }) {
  const { t } = useI18n();
  if (!run.iterations.length) return null;
  const m = metrics(run);
  const rows = [
    [t('m_perLanded'), `${kTokens(m.tokensPerLanded)} · ${t('m_landed', { a: m.landed, b: m.iterations })}`],
    [t('m_share'), ROLES.map((r) => `${t(`role_${r}`)} ${pct(m.share[r])}`).join(' · ')],
    ...POINTS.filter((p) => m.points[p].calls).map((p) => {
      const x = m.points[p];
      return [`${t('advisor')} · ${t(`point_${p}`)}`, t('m_point', { calls: x.calls, revise: x.revise, afterRevise: pct(x.passAfterRevise), afterProceed: pct(x.passAfterProceed) })];
    }),
  ];
  return <Kv rows={rows} />;
}

function Drawer({ card, run, now, onClose, openTranscript, act, busy }) {
  const { t } = useI18n();
  const it = card.iteration;
  const visited = card.queued ? [] : steps(it, new Date(now));
  const seen = new Set(visited.map((s) => s.phase));
  const future = card.live ? PIPELINE.filter((p) => !CONDITIONAL.has(p) && !seen.has(p) && PIPELINE.indexOf(p) > PIPELINE.indexOf(card.phase)) : [];
  const outcomeTone = card.outcome === 'BETTER' ? 'ok' : card.attention ? 'warn' : 'err';
  const title = card.queued ? t('next') : card.live ? t(`node_${card.phase}`) : card.summary || card.reason;
  const a = card.activity;
  return (
    <aside className="apk-panel" aria-label={title}>
      <div className="apk-panel-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="apk-card-top"><Slug slug={card.slug} /><span>{t('iteration', { n: card.n })}</span>
            {!card.queued && !card.live ? <span className={'apk-tag ' + outcomeTone}>{card.attention ? t('needsYou') : t(`outcome_${card.outcome}`)}</span> : null}
          </div>
          <h2>{title}</h2>
        </div>
        <button type="button" className="apk-btn ghost" onClick={onClose} aria-label={t('close')}>✕</button>
      </div>
      <div className="apk-panel-body">
        {card.queued ? (
          <section className="apk-sec">
            <p className="apk-text">{t('queuedDetail', { when: card.paused ? t('whenPaused', { reason: card.pauseReason ?? '' }) : t('whenRunning') })}</p>
          </section>
        ) : (
          <section className="apk-sec">
            <h3>{t('pipeline')}</h3>
            <div className="apk-steps">
              {visited.map((s, i) => (
                <div key={i} className={'apk-step' + (s.open && card.live ? ' open' : '')}><i /><span>{t(`step_${s.phase}`)}</span><span>{formatDuration(s.ms)}</span></div>
              ))}
              {future.map((p) => <div key={p} className="apk-step todo"><i /><span>{t(`step_${p}`)}</span><span /></div>)}
            </div>
            {card.live && a ? (
              <div className="apk-activity"><span className="apk-spin" />
                <span>{t(`role_${a.kind}`)} · {t('toolCalls', { n: a.toolCalls ?? 0 })}{a.lastTool ? ` · ${t('lastTool', { tool: `${a.lastTool}${a.lastHint ? ` (${a.lastHint})` : ''}` })}` : ''}{a.lastAt ? ` · ${t('ago', { t: since(a.lastAt, now) })}` : ''}</span>
              </div>
            ) : null}
          </section>
        )}

        {!card.queued && !card.live ? (
          <section className="apk-sec">
            <h3>{t('result')}</h3>
            <Kv rows={[[t('verdict'), card.verdict], [t('success'), card.success], [t('landing'), card.landing], [t('reason'), card.reason],
              [t('tokens'), it.usage ? ROLES.map((r) => `${t(`role_${r}`)} ${kTokens(tokensOf(it.usage[r]))}`).join(' · ') : undefined]]} />
          </section>
        ) : null}

        {card.sha || card.base ? (
          <section className="apk-sec">
            <h3>{t('candidate')}</h3>
            <Kv rows={[[t('sha'), card.sha ? <span className="apk-mono">{card.sha}</span> : undefined], [t('base'), card.base ? <span className="apk-mono">{card.base}</span> : undefined], ['ref', card.sha ? <span className="apk-mono">refs/autoproject/{card.slug}/{card.n}</span> : undefined]]} />
          </section>
        ) : null}

        {card.plan ? <section className="apk-sec"><h3>{t('makerPlan')}</h3><p className="apk-text">{card.plan}</p></section> : null}

        {card.advice?.length ? (
          <section className="apk-sec">
            <h3>{t('advisorSaid')}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {card.advice.map((x, i) => (
                <div key={i}>
                  <div className="apk-card-top">
                    <span>{t(`point_${x.point}`)}</span>
                    {x.verdict ? <span className={'apk-tag ' + (x.verdict === 'PROCEED' ? 'ok' : 'warn')}>{x.verdict}</span> : null}
                    {x.usage ? <span>{kTokens(tokensOf(x.usage))} tokens</span> : null}
                    <span style={{ marginLeft: 'auto' }}><TranscriptButton t={t} label="openAdvisor" parent={card.originSessionId} session={x.sessionId} viewable={x.addressable} open={openTranscript} /></span>
                  </div>
                  <p className="apk-text">{x.error ?? x.advice ?? '…'}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {card.makerSummary ? <section className="apk-sec"><h3>{t('makerSaid')}</h3><p className="apk-text">{card.makerSummary}</p></section> : null}

        {card.rationale ? (
          <section className="apk-sec">
            <h3>{t('reviewerSaid')}</h3>
            <p className="apk-text">{card.rationale}</p>
            {card.learnings ? <><h3 style={{ marginTop: 12 }}>{t('learnings')}</h3><p className="apk-text">{card.learnings}</p></> : null}
            {card.evidence ? <details className="apk-more" style={{ marginTop: 10 }}><summary>{t('evidence')}</summary><p className="apk-text">{card.evidence}</p></details> : null}
          </section>
        ) : null}

        {!card.queued ? (
          <section className="apk-actions">
            <TranscriptButton t={t} label="openMaker" parent={card.originSessionId} session={card.makerSession} viewable={card.makerViewable} open={openTranscript} />
            <TranscriptButton t={t} label="openReviewer" parent={card.originSessionId} session={card.reviewerSession} viewable={card.reviewerViewable} open={openTranscript} />
          </section>
        ) : null}

        {run ? (
          <section className="apk-sec">
            <h3><Slug slug={run.slug} /></h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <RunControls run={run} act={act} busy={busy} />
              <Steer run={run} act={act} busy={busy} />
              {card.queued && card.guidance?.length ? <Kv rows={[[t('guidance'), card.guidance.join(' / ')]]} /> : null}
              <details className="apk-more"><summary>{t('runBrief')}</summary><p className="apk-text">{run.brief}</p></details>
              <details className="apk-more"><summary>{t('runRubric')}</summary><p className="apk-text">{run.rubric}</p></details>
              <RunMetrics run={run} />
              <Kv rows={[[t('runModels'), ['maker', 'reviewer', 'advisor'].map((r) => `${t(`role_${r}`)} ${modelText(run.models[r])}`).join(' · ')], [t('runSuccess'), run.success || t('none')], [t('runChecks'), run.checkCommand ? <span className="apk-mono">{run.checkCommand.replace(/^\S*\//, '')}</span> : t('none')], [t('runLimits'), `${t('iterations', { a: run.iterations.length, b: run.limits.maxIterations })} · ${t('streak', { a: run.streak, b: run.limits.streakLimit })}`]]} />
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  );
}

export function makeBoardPage({ api, openTranscript }) {
  return function BoardPage() {
    const { t } = useI18n();
    const board = useBoard(api);
    const [filter, setFilter] = React.useState(null);
    const [selected, setSelected] = React.useState(null);
    const [showStopped, setShowStopped] = React.useState(false);
    const [tab, setTab] = React.useState('board');
    const [busy, setBusy] = React.useState(false);
    const [actionError, setActionError] = React.useState(null);
    const runs = board.data?.runs ?? [];
    // Finished runs stay off the board unless asked for, so it shows what is happening now.
    const onBoard = React.useMemo(() => runs.filter((r) => r.status !== 'stopped' || showStopped || r.slug === filter), [runs, showStopped, filter]);
    const view = React.useMemo(() => buildBoard(onBoard, { filter }), [onBoard, filter]);
    const now = useNow(view.stats.live > 0 || selected !== null);
    const cards = COLUMNS.flatMap((c) => view.columns[c]);
    const open = cards.find((c) => c.id === selected);

    const act = async (slug, action, text) => {
      setBusy(true);
      setActionError(null);
      try { board.apply(await api.control(slug, action, text)); return true; } catch (error) { setActionError(error.message); return false; } finally { setBusy(false); }
    };

    const selectedRun = filter ? runs.find((r) => r.slug === filter) : null;
    React.useEffect(() => {
      const onKey = (e) => { if (e.key === 'Escape') setSelected(null); };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, []);
    const summary = [
      [view.stats.running, 'stat_running'], [view.stats.paused, 'stat_paused'], [view.stats.landed, 'stat_landed'],
    ].filter(([n]) => n > 0).map(([n, key]) => `${n} ${t(key)}`);
    const openCard = (id) => setSelected(id === selected ? null : id);

    return (
      <div className="apk">
        <header className="apk-head">
          <div className="apk-title">
            <h1>{t('title')}</h1>
            <span className={'apk-live' + (board.connected ? '' : ' off')}>{board.connected ? t('live') : t('offline')}</span>
          </div>
          {runs.length ? (
            <div className="apk-toolbar">
              <div className="apk-seg" role="tablist">
                <button type="button" role="tab" className={tab === 'board' ? 'on' : ''} onClick={() => setTab('board')}>{t('tab_board')}</button>
                <button type="button" role="tab" className={tab === 'cancelled' ? 'on' : ''} onClick={() => setTab('cancelled')}>{t('col_cancelled')}<span>{view.columns.cancelled.length}</span></button>
              </div>
              <select className="apk-select" value={filter ?? ''} onChange={(e) => { setFilter(e.target.value || null); setSelected(null); }}>
                <option value="">{t('allRuns')}</option>
                {runs.map((r) => <option key={r.slug} value={r.slug}>{r.slug} · {t(`status_${r.status}`)}</option>)}
              </select>
              {!filter ? (
                <label className="apk-check"><input type="checkbox" checked={showStopped} onChange={(e) => setShowStopped(e.target.checked)} />{t('showStopped')}</label>
              ) : null}
              {selectedRun ? <RunControls run={selectedRun} act={act} busy={busy} /> : null}
              <span className="apk-summary">
                {summary.join(' · ')}
                {view.stats.attention ? <b>{summary.length ? ' · ' : ''}{view.stats.attention} {t('stat_attention')}</b> : null}
              </span>
            </div>
          ) : null}
          {board.error ? <div className="apk-error">{t('loadFailed', { error: board.error })}</div> : null}
          {actionError ? <div className="apk-error">{actionError}</div> : null}
        </header>
        <div className="apk-main">
          {!board.data && !board.error ? <div className="apk-empty">{t('loading')}</div> : null}
          {board.data && !runs.length ? <div className="apk-empty">{t('emptyBoard')}</div> : null}
          {runs.length && tab === 'board' ? (
            <div className="apk-scroll">
              <div className="apk-board">
                {BOARD_COLUMNS.map((col) => (
                  <section key={col} className="apk-col">
                    <div className="apk-col-head"><i style={{ background: TONE[col] }} />{t(`col_${col}`)}<span>{view.columns[col].length}</span></div>
                    <div className="apk-col-body">
                      {view.columns[col].map((card) => <Card key={card.id} card={card} now={now} selected={card.id === selected} onOpen={openCard} />)}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          ) : null}
          {runs.length && tab === 'cancelled' ? (
            <div className="apk-scroll list">
              <div className="apk-list">
                {view.columns.cancelled.length
                  ? view.columns.cancelled.map((card) => <Card key={card.id} card={card} now={now} selected={card.id === selected} onOpen={openCard} />)
                  : <div className="apk-empty">{t('empty')}</div>}
              </div>
            </div>
          ) : null}
          {open ? <Drawer card={open} run={runs.find((r) => r.slug === open.slug)} now={now} onClose={() => setSelected(null)} openTranscript={openTranscript} act={act} busy={busy} /> : null}
        </div>
      </div>
    );
  };
}
