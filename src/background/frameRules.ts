// The AI sites refuse to be framed (CSP frame-ancestors, X-Frame-Options). A session rule strips those
// headers, but only for sub-frames inside open Themis tabs, so ordinary browsing keeps the protection.
// The rule's tab list is rebuilt whenever a tab opens, navigates, closes or is replaced.
import { syncGrokCookies, watchGrokCookies } from './grokCookies'

const FRAME_RULE_ID = 1
const AI_DOMAINS = ['gemini.google.com', 'chatgpt.com', 'chat.openai.com', 'claude.ai', 'chat.deepseek.com', 'grok.com']

interface FrameRulesLogger {
  debug(event: string, details?: Record<string, unknown>): void
  warn(event: string, details?: Record<string, unknown>): void
}

function frameRule(tabIds: number[]): chrome.declarativeNetRequest.Rule {
  return {
    id: FRAME_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
      responseHeaders: [
        { header: 'content-security-policy', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation },
        { header: 'x-frame-options', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation },
      ],
    },
    condition: { requestDomains: AI_DOMAINS, resourceTypes: ['sub_frame' as chrome.declarativeNetRequest.ResourceType], tabIds },
  }
}

async function themisTabIds(): Promise<number[]> {
  const base = chrome.runtime.getURL('team.html')
  return (await chrome.tabs.query({}))
    .filter(tab => (tab.pendingUrl || tab.url || '').startsWith(base))
    .map(tab => tab.id)
    .filter(Number.isInteger) as number[]
}

let syncChain: Promise<void> = Promise.resolve()

export function syncFrameRules(log: FrameRulesLogger): Promise<void> {
  return syncChain = syncChain.catch(() => {}).then(async () => {
    const dnr = chrome.declarativeNetRequest
    if (!dnr?.updateSessionRules || !chrome.tabs.query) return
    const tabIds = await themisTabIds()
    await dnr.updateSessionRules({ removeRuleIds: [FRAME_RULE_ID], addRules: tabIds.length ? [frameRule(tabIds)] : [] })
    await syncGrokCookies(tabIds.length > 0)
    log.debug('frame-rules:synced', { tabIds })
  }).catch(error => log.warn('frame-rules:sync-failed', { error: error instanceof Error ? error.message : String(error) }))
}

export function registerFrameRuleSync(log: FrameRulesLogger): void {
  const sync = () => {
    syncFrameRules(log)
  }
  chrome.tabs.onCreated?.addListener(sync)
  chrome.tabs.onUpdated?.addListener((_tabId, info) => {
    if (info.url !== undefined || info.status === 'loading') sync()
  })
  chrome.tabs.onRemoved.addListener(sync)
  chrome.tabs.onReplaced?.addListener(sync)
  chrome.runtime.onStartup.addListener(sync)
  watchGrokCookies(async () => (await themisTabIds()).length > 0, log)
  sync()
}
