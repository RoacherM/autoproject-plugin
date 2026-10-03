/**
 * Board wording in Chinese and English, following DSH's language setting live. `{name}` in a
 * string is replaced from the values passed to t(). Any non-Chinese locale falls back to English.
 */
import React from 'react';

export const DICT = {
  zh: {
    panel: '自动迭代',
    title: '自动迭代',
    intro: '每轮一张卡：maker 定计划 → advisor 把关 → maker 改代码 → 插件跑检查 → reviewer 评审 → 落地。',
    live: '实时', offline: '连接中断，重试中…', loading: '加载中…', loadFailed: '加载失败：{error}',
    stat_running: '运行中', stat_paused: '已暂停', stat_live: '进行中的轮次', stat_landed: '已落地', stat_attention: '等你处理',
    tab_board: '看板', allRuns: '全部运行', stoppedRuns: '已结束 {n}', showStopped: '含已结束', hideStopped: '隐藏已结束',
    col_todo: '待开始', col_inprogress: '进行中', col_inreview: '评审中', col_done: '已落地', col_cancelled: '未通过',
    empty: '这里还没有卡片', emptyBoard: '还没有自动迭代运行。在对话里说「用 autoproject 改进 …」，确认 Go 后会出现在这里。',
    status_running: '运行中', status_paused: '已暂停', status_stopped: '已结束',
    node_setup: '准备 worktree', node_maker: 'Maker 修改中', node_checks: '运行检查', node_repair: 'Maker 修复中', node_review: 'Reviewer 评审中', node_landing: '落地中',
    step_setup: '准备', step_maker: 'Maker', step_checks: '检查', step_repair: '修复', step_review: 'Reviewer', step_landing: '落地',
    node_advise_stuck: 'Advisor 找新方向', node_plan: 'Maker 定计划', node_advise_plan: 'Advisor 审计划', node_advise_done: 'Advisor 查遗漏', node_revise: 'Maker 按意见修改',
    step_advise_stuck: 'Advisor·卡住', step_plan: '计划', step_advise_plan: 'Advisor·计划', step_advise_done: 'Advisor·交卷前', step_revise: '修改',
    advisor: 'Advisor', advisorSaid: 'Advisor 的意见', point_stuck: '连续失败后', point_plan: '定计划前', point_done: '交卷前',
    makerPlan: 'Maker 的计划', openAdvisor: '查看过程', revised: '按意见改过', stuckTag: '换方向', runModels: '模型',
    role_maker: 'Maker', role_reviewer: 'Reviewer', role_advisor: 'Advisor',
    tokens: 'Token', m_perLanded: '每次落地 token', m_landed: '落地 {a}/{b} 轮', m_share: 'Token 占比', m_point: '{calls} 次，REVISE {revise} 次 · 之后通过率 {afterRevise}，PROCEED 之后 {afterProceed}',
    next: '下一轮', moreLeft: '之后还有 {n} 轮', pausedTag: '已暂停', needsYou: '等你处理', repaired: '修复过', guidanceQueued: '已排队 {n} 条指导',
    toolCalls: '{n} 次工具调用', lastTool: '最近：{tool}', ago: '{t} 前', inNode: '已 {t}', took: '用时 {t}',
    iteration: '第 {n} 轮', iterations: '轮次 {a}/{b}', streak: '连续失败 {a}/{b}', landed: '落地 {n}',
    pause: '暂停', resume: '继续', stop: '停止', confirmStop: '确认停止', steer: '给下一个 maker 和 advisor 的话…', send: '发送',
    pauseRequested: '本轮结束后暂停', stopRequested: '停止中…',
    close: '关闭', pipeline: '流程', result: '结果', candidate: '候选提交', makerSaid: 'Maker 的说明', reviewerSaid: 'Reviewer 的判断',
    rationale: '理由', evidence: '证据', learnings: '给下一轮的经验', reason: '原因',
    verdict: '判决', success: '成功条件', landing: '落地', base: '基于', sha: '提交',
    openMaker: '查看 Maker 过程', openReviewer: '查看 Reviewer 过程', noTranscript: '没有记录会话',
    oldTranscript: '这个会话由旧版插件创建，缺少子会话登记，无法在界面中打开；用 autoproject_status（verbose）查看会话 ID',
    runBrief: 'Brief（只给 maker）', runRubric: 'Rubric（只给 reviewer）', runLimits: '限制', runChecks: '检查命令', runSuccess: '成功条件',
    queuedDetail: '这一轮还没开始。{when}', whenRunning: '当前一轮结束后开始。', whenPaused: '运行已暂停：{reason}',
    guidance: '待发送的指导', none: '无',
    outcome_BETTER: '已落地', outcome_NOT_BETTER: '未通过', outcome_ABORTED: '已中止', outcome_BLOCKED: '未能落地',
    openBoard: '打开看板', card_start: '自动迭代已开始', card_status: '自动迭代状态', card_control: '自动迭代控制', working: '处理中…',
  },
  en: {
    panel: 'Autoproject',
    title: 'Autoproject',
    intro: 'One card per iteration: maker plans → advisor checks → maker edits → harness checks → reviewer judges → lands.',
    live: 'Live', offline: 'Disconnected, retrying…', loading: 'Loading…', loadFailed: 'Could not load: {error}',
    stat_running: 'Running', stat_paused: 'Paused', stat_live: 'Iterations in flight', stat_landed: 'Landed', stat_attention: 'Need you',
    tab_board: 'Board', allRuns: 'All runs', stoppedRuns: 'Stopped {n}', showStopped: 'Show stopped', hideStopped: 'Hide stopped',
    col_todo: 'To Do', col_inprogress: 'In Progress', col_inreview: 'In Review', col_done: 'Done', col_cancelled: 'Cancelled',
    empty: 'No cards', emptyBoard: 'No autoproject runs yet. Ask for one in chat; after you choose Go it shows up here.',
    status_running: 'Running', status_paused: 'Paused', status_stopped: 'Stopped',
    node_setup: 'Preparing worktree', node_maker: 'Maker editing', node_checks: 'Running checks', node_repair: 'Maker repairing', node_review: 'Reviewer judging', node_landing: 'Landing',
    step_setup: 'Setup', step_maker: 'Maker', step_checks: 'Checks', step_repair: 'Repair', step_review: 'Review', step_landing: 'Land',
    node_advise_stuck: 'Advisor finding a new direction', node_plan: 'Maker planning', node_advise_plan: 'Advisor reviewing the plan', node_advise_done: 'Advisor checking for misses', node_revise: 'Maker revising',
    step_advise_stuck: 'Advisor · stuck', step_plan: 'Plan', step_advise_plan: 'Advisor · plan', step_advise_done: 'Advisor · before done', step_revise: 'Revise',
    advisor: 'Advisor', advisorSaid: 'Advisor', point_stuck: 'after repeated failures', point_plan: 'before the plan', point_done: 'before done',
    makerPlan: 'Maker plan', openAdvisor: 'Open transcript', revised: 'Revised', stuckTag: 'New direction', runModels: 'Models',
    role_maker: 'Maker', role_reviewer: 'Reviewer', role_advisor: 'Advisor',
    tokens: 'Tokens', m_perLanded: 'Tokens per landed', m_landed: 'landed {a}/{b}', m_share: 'Token share', m_point: '{calls} calls, {revise} REVISE · pass after it {afterRevise}, after PROCEED {afterProceed}',
    next: 'Next iteration', moreLeft: '{n} more after it', pausedTag: 'Paused', needsYou: 'Needs you', repaired: 'Repaired', guidanceQueued: '{n} guidance queued',
    toolCalls: '{n} tool calls', lastTool: 'last: {tool}', ago: '{t} ago', inNode: 'for {t}', took: 'took {t}',
    iteration: 'Iteration {n}', iterations: 'Iterations {a}/{b}', streak: 'Streak {a}/{b}', landed: 'Landed {n}',
    pause: 'Pause', resume: 'Resume', stop: 'Stop', confirmStop: 'Confirm stop', steer: 'Guidance for the next maker and advisor…', send: 'Send',
    pauseRequested: 'Pausing after this iteration', stopRequested: 'Stopping…',
    close: 'Close', pipeline: 'Pipeline', result: 'Result', candidate: 'Candidate', makerSaid: 'Maker summary', reviewerSaid: 'Reviewer',
    rationale: 'Rationale', evidence: 'Evidence', learnings: 'Learnings for the next attempt', reason: 'Reason',
    verdict: 'Verdict', success: 'Success', landing: 'Landing', base: 'Base', sha: 'Commit',
    openMaker: 'Open maker transcript', openReviewer: 'Open reviewer transcript', noTranscript: 'No session recorded',
    oldTranscript: 'Created by an older plugin version without a subagent record, so the GUI cannot open it; autoproject_status (verbose) lists its session id',
    runBrief: 'Brief (maker only)', runRubric: 'Rubric (reviewer only)', runLimits: 'Limits', runChecks: 'Checks', runSuccess: 'Success criterion',
    queuedDetail: 'Not started yet. {when}', whenRunning: 'Starts when the current iteration finishes.', whenPaused: 'The run is paused: {reason}',
    guidance: 'Queued guidance', none: 'None',
    outcome_BETTER: 'Landed', outcome_NOT_BETTER: 'Not better', outcome_ABORTED: 'Aborted', outcome_BLOCKED: 'Not landed',
    openBoard: 'Open board', card_start: 'autoproject started', card_status: 'autoproject status', card_control: 'autoproject control', working: 'Working…',
  },
};

export const langOf = (active) => (String(active ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en');

export function translator(lang) {
  const dict = DICT[lang] ?? DICT.en;
  return (key, values = {}) => String(dict[key] ?? DICT.en[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => (values[name] ?? `{${name}}`));
}

const I18n = React.createContext({ lang: 'zh', t: translator('zh') });

/** Wrap a tree so it re-renders when DSH's language changes. `locale` is ctx.locale (may be absent in previews). */
export function withI18n(locale, Component) {
  const subscribe = (fn) => locale?.subscribe?.(fn) ?? (() => {});
  const snapshot = () => (locale?.getSnapshot?.() ?? locale?.getLocale?.())?.active ?? 'zh';
  return function Localized(props) {
    const lang = langOf(React.useSyncExternalStore(subscribe, snapshot));
    const value = React.useMemo(() => ({ lang, t: translator(lang) }), [lang]);
    return <I18n.Provider value={value}><Component {...props} /></I18n.Provider>;
  };
}

export const useI18n = () => React.useContext(I18n);
