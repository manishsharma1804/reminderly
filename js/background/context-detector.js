/**
 * Reminderly Context & Priority Site Detector
 */

import { storage } from '../common/storage.js';
import { isDomainMatch } from '../common/utils.js';

let previousTabWasPriority = false;

export function initContextDetector() {
  if (typeof chrome === 'undefined' || !chrome.tabs) return;

  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await checkTabContext(activeInfo.tabId);
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
      await checkTabContext(tabId);
    }
  });
}

async function checkTabContext(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url || tab.url.startsWith('chrome://')) return;

    const settings = await storage.getSettings();
    if (settings.contextAwarenessEnabled === false) return;

    const isPriority = isDomainMatch(tab.url, settings.priorityWebsites || []);

    if (previousTabWasPriority && !isPriority) {
      // User just left a priority website!
      const pendingQueue = await storage.getPendingQueue();
      if (pendingQueue && pendingQueue.length > 0) {
        // Notify the current non-priority page about pending reminders
        try {
          await chrome.tabs.sendMessage(tabId, {
            action: 'SHOW_PENDING_BANNER',
            count: pendingQueue.length,
            reminders: pendingQueue
          }).catch(() => {});
        } catch (e) {}
      }
    }

    previousTabWasPriority = isPriority;
  } catch (e) {
    // Tab closed or forbidden
  }
}
