/**
 * Reminderly Focus Mode & Distracting Website Blocker Engine
 */

import { storage } from '../common/storage.js';
import { isDomainMatch } from '../common/utils.js';

let tempAllowedSites = {}; // { 'instagram.com': allowedUntilTimestamp }

export function initFocusManager() {
  if (typeof chrome === 'undefined' || !chrome.tabs) return;

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' || changeInfo.status === 'complete') {
      await evaluateTabBlocking(tabId, tab.url);
    }
  });

  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      if (tab && tab.url) {
        await evaluateTabBlocking(activeInfo.tabId, tab.url);
      }
    } catch (e) {}
  });
}

export function tempAllowDomain(domain, minutes) {
  tempAllowedSites[domain.toLowerCase()] = Date.now() + minutes * 60 * 1000;
}

async function evaluateTabBlocking(tabId, url) {
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;

  const settings = await storage.getSettings();
  const focusState = await storage.getFocusState();
  const isFocusActive = focusState && focusState.active && Date.now() < focusState.endTime;

  const isBlockerEnabled = settings.websiteBlockerEnabled !== false;
  if (!isFocusActive && !isBlockerEnabled) return;

  const blockedList = settings.blockedWebsites || [];
  const isBlockedSite = isDomainMatch(url, blockedList);
  if (!isBlockedSite) return;

  // Check temporary override allowance
  const matchedDomain = blockedList.find(d => isDomainMatch(url, [d]));
  if (matchedDomain && tempAllowedSites[matchedDomain.toLowerCase()]) {
    if (Date.now() < tempAllowedSites[matchedDomain.toLowerCase()]) {
      return; // Still within temp allowed time window
    } else {
      delete tempAllowedSites[matchedDomain.toLowerCase()];
    }
  }

  // Trigger Blocker Overlay in active tab
  let sent = false;
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'SHOW_BLOCKER_OVERLAY',
      url: url,
      domain: matchedDomain || 'this website',
      isFocusMode: isFocusActive
    });
    sent = true;
  } catch (e) {
    sent = false;
  }

  if (!sent) {
    // If content script was not ready (e.g. during initial page load), dynamically inject scripts and retry
    try {
      if (chrome.scripting) {
        await chrome.scripting.insertCSS({
          target: { tabId: tabId },
          files: ['css/design-system.css', 'css/content.css']
        }).catch(() => {});

        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['js/content/content-script.js']
        }).catch(() => {});

        setTimeout(async () => {
          try {
            await chrome.tabs.sendMessage(tabId, {
              action: 'SHOW_BLOCKER_OVERLAY',
              url: url,
              domain: matchedDomain || 'this website',
              isFocusMode: isFocusActive
            }).catch(() => {});
          } catch (err) {}
        }, 100);
      }
    } catch (err) {}
  }
}
