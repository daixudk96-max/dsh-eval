/**
 * dsh-eval-console client dictionaries (zh is the key source; en mirrors it).
 *
 * # absorbed-from: zhu1090093659/dsh-web-ui packages/dsh-task-board/src/client/locales.ts (Apache-2.0)
 * Adapted: task-board strings replaced with evolution-console chrome text; the
 * zh-as-key-source + en-full-mirror + key-union-export pattern is kept.
 */

export const NS = 'eval-console'

const zh = {
  'view.title': '进化控制台',
  'view.error': '加载失败',
  'view.retry': '重试',
  'view.loading': '加载中…',
  'view.revision': '审计修订',
  'view.generatedAt': '快照时间',
  'view.current': '当前版本',
  'view.currentNone': '（无指针）',
  'view.gateRun': '门控运行',
  'view.approval': '批准',
  'view.digest': '摘要',
  'view.updatedAt': '更新时间',
  'view.timeline': '审计时间线',
  'view.emptyTimeline': '暂无审计事件',
  'view.columns': '看板',
  'view.noRows': '无',
  'card.sealedAt': '封存于',
  'card.gate': '门控',
  'card.reason': '原因',
  'detail.title': '修订详情',
  'detail.files': '内容文件',
  'detail.noFiles': '（无内容文件）',
  'detail.loading': '读取内容中…',
  'detail.close': '关闭',
  'detail.rollback': '回滚到此版本',
  'detail.isCurrent': '（当前版本）',
  'rollback.title': '确认回滚',
  'rollback.prompt': '将把此版本的内容写入新修订并推进指针，不可撤销。请输入确认短语后继续。',
  'rollback.placeholder': 'ROLLBACK:<revisionId>',
  'rollback.cancel': '取消',
  'rollback.confirm': '确认回滚',
  'rollback.required': '请输入确认短语',
  'rollback.busy': '回滚执行中…',
  'rollback.success': '回滚已应用，正在刷新…',
  'rollback.failure': '回滚失败',
  'rollback.noop': '目标已是当前版本（无变化）',
  'rollback.badConfirm': '确认短语不匹配，已拒绝',
  'action.invalid': '动作无效',
  'version.trigger': '版本 ▾',
  'version.triggerAria': '切换预设版本',
  'version.listAria': '预设版本列表',
  'version.current': '当前',
  'version.none': '（无指针）',
  'version.loading': '加载中…',
  'version.empty': '暂无版本',
  'version.switch': '切换到此版本',
  'version.syncing': '同步中…',
  'version.synced': '已同步到 {targetDir}，新会话可选',
  'version.failed': '同步失败',
  'version.noop': '目标已是当前版本（无变化）',
} satisfies Record<string, string>

const en = {
  'view.title': 'Evolution Console',
  'view.error': 'Load failed',
  'view.retry': 'Retry',
  'view.loading': 'Loading…',
  'view.revision': 'Audit revision',
  'view.generatedAt': 'Snapshot at',
  'view.current': 'Current version',
  'view.currentNone': '(no pointer)',
  'view.gateRun': 'Gate run',
  'view.approval': 'Approval',
  'view.digest': 'Digest',
  'view.updatedAt': 'Updated',
  'view.timeline': 'Audit timeline',
  'view.emptyTimeline': 'No audit events yet',
  'view.columns': 'Board',
  'view.noRows': 'none',
  'card.sealedAt': 'Sealed',
  'card.gate': 'Gate',
  'card.reason': 'Reason',
  'detail.title': 'Revision detail',
  'detail.files': 'Content files',
  'detail.noFiles': '(no content files)',
  'detail.loading': 'Reading content…',
  'detail.close': 'Close',
  'detail.rollback': 'Roll back to this version',
  'detail.isCurrent': '(current version)',
  'rollback.title': 'Confirm rollback',
  'rollback.prompt': 'This writes this version\'s content as a new revision and advances the pointer. This cannot be undone. Type the confirmation phrase to continue.',
  'rollback.placeholder': 'ROLLBACK:<revisionId>',
  'rollback.cancel': 'Cancel',
  'rollback.confirm': 'Roll back',
  'rollback.required': 'Type the confirmation phrase',
  'rollback.busy': 'Rolling back…',
  'rollback.success': 'Rollback applied, refreshing…',
  'rollback.failure': 'Rollback failed',
  'rollback.noop': 'Target is already the current version (no change)',
  'rollback.badConfirm': 'Confirmation phrase mismatch, rejected',
  'action.invalid': 'Invalid action',
  'version.trigger': 'Version ▾',
  'version.triggerAria': 'Switch preset version',
  'version.listAria': 'Preset versions',
  'version.current': 'Current',
  'version.none': '(no pointer)',
  'version.loading': 'Loading…',
  'version.empty': 'No versions',
  'version.switch': 'Switch to this version',
  'version.syncing': 'Syncing…',
  'version.synced': 'Synced to {targetDir}; selectable in new sessions',
  'version.failed': 'Sync failed',
  'version.noop': 'Target is already the current version (no change)',
} satisfies Record<string, string>

export type EvalConsoleKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The evolution-console view tab label and chrome strings. */
    'eval-console': EvalConsoleKey
  }
}

export type Lang = 'zh' | 'en'

const DICT: Record<Lang, Record<EvalConsoleKey, string>> = { zh, en }

/** Resolve a key against the active language. */
export function tr(lang: Lang, key: EvalConsoleKey): string {
  return DICT[lang][key] ?? zh[key]
}

/** Pick a default language from the browser locale (zh-CN/zh -> zh). */
export function detectLang(): Lang {
  const tag = (typeof navigator !== 'undefined' ? navigator.language : '') || ''
  return /^zh\b|^zh-/.test(tag) ? 'zh' : 'en'
}

export { zh, en }
