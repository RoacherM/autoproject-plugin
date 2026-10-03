/**
 * Browser half: an "Autoproject" entry in the left sidebar opening the board page, and a compact
 * card with an "Open board" button for the autoproject_* tool calls in the conversation.
 */
import React from 'react';
import { api } from './api.js';
import { makeBoardPage } from './board.jsx';
import { DICT, useI18n, withI18n } from './i18n.jsx';
import { CSS } from './styles.js';

const PKG = '@local/dsh-autoproject';
const NS = 'local-autoproject';
const PANEL_ID = 'local-autoproject';
const CARD_TOOLS = { autoproject_start: 'card_start', autoproject_status: 'card_status', autoproject_control: 'card_control' };

export const inject = ['slots', 'locale'];

function BoardIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9 4v16M15 4v16" />
      <path d="M5.5 8h1.5M11 8h2M11 11.5h2M17 8h1.5" />
    </svg>
  );
}

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh: { panel: DICT.zh.panel }, en: { panel: DICT.en.panel } }), 'dsh-autoproject: dictionary');
  const t = ctx.locale.bind(NS);
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.plugin = PKG;
    style.textContent = CSS;
    document.head.appendChild(style);
    return () => style.remove();
  }, 'dsh-autoproject: styles');

  const openPanel = () => ctx.get('layout')?.selectPanel(PANEL_ID);
  /**
   * Leave the board and show one maker/reviewer transcript: a one-shot subagent child of the chat
   * that started the run. The Host serves a subagent child's history only under its durable parent
   * address, so pass the address instead of the bare id (which is requested as `kind: 'session'`).
   */
  const openTranscript = (parentSessionId, childSessionId) => {
    ctx.get('uiWorkspace')?.openSession({ parentSessionId, childSessionId, mode: 'one-shot' });
  };

  const BoardPage = withI18n(ctx.locale, makeBoardPage({ api, openTranscript }));
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, BoardPage)), 'dsh-autoproject: page');
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL_ID, order: 15, locale: NS, label: () => t('panel'),
  }, BoardIcon)), 'dsh-autoproject: sidebar entry');

  function ToolCard(props) {
    const { t: tr } = useI18n();
    const done = props.phase === 'result';
    const block = done ? props.block : undefined;
    const text = (block?.content ?? []).find((c) => c?.type === 'text')?.text ?? '';
    const failed = block?.isError === true || /^Error:/.test(text);
    const first = text.split('\n').find((l) => l.trim()) ?? '';
    const headline = text.split('\n').find((l) => l.startsWith('autoproject ')) ?? first;
    return (
      <div className="apk-toolcard">
        <BoardIcon size={18} />
        <div>
          <b>{tr(CARD_TOOLS[props.toolName] ?? 'card_status')}</b>
          <small style={failed ? { color: 'var(--dsw-alias-state-error-primary)' } : undefined}>{done ? (failed ? first : headline).slice(0, 180) : tr('working')}</small>
        </div>
        {done ? <button type="button" className="apk-btn" onClick={openPanel}>{tr('openBoard')}</button> : null}
      </div>
    );
  }
  const LocalizedCard = withI18n(ctx.locale, ToolCard);
  for (const name of Object.keys(CARD_TOOLS)) {
    ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: name, locale: NS }, LocalizedCard)), 'dsh-autoproject: tool card ' + name);
  }
}
