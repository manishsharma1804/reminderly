/**
 * Reminderly Content Script Entry Point
 */

(async () => {
  const { renderMascotReminder, removeExistingMascot, triggerFocusCompletedCelebration } = await import(chrome.runtime.getURL('js/content/mascot-overlay.js'));
  const { renderBlockerOverlay } = await import(chrome.runtime.getURL('js/content/blocker-overlay.js'));
  const { renderFocusClockOverlay, removeFocusClockOverlay } = await import(chrome.runtime.getURL('js/content/focus-clock-overlay.js'));
  const { storage } = await import(chrome.runtime.getURL('js/common/storage.js'));
  const { soundEngine } = await import(chrome.runtime.getURL('js/common/audio.js'));

  // Listen for DOM custom event from website landing page to open extension dashboard
  window.addEventListener('REMINDERLY_OPEN_DASHBOARD', () => {
    try {
      chrome.runtime.sendMessage({ action: 'OPEN_DASHBOARD' });
    } catch (e) { }
  });

  // On page load or refresh, check focus clock overlay and active queue
  try {
    const focusState = await storage.getFocusState();
    const settings = await storage.getSettings();
    if (focusState && focusState.active && focusState.pinned) {
      renderFocusClockOverlay(focusState, settings);
    }

    if (document.visibilityState === 'visible') {
      const activeQueue = await storage.getActiveQueue();
      if (activeQueue && activeQueue.length > 0) {
        const topRem = activeQueue[0];
        if (!topRem._deliveredAsSystemNotification) {
          renderMascotReminder(topRem, settings, activeQueue, 0);
        }
      }
    }
  } catch (e) { }

  // Listen for messages from background worker
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
      switch (request.action) {
        case 'SHOW_REMI_REMINDER': {
          const settings = await storage.getSettings();
          const existingRoot = document.getElementById('remi-overlay-root');
          const isAlreadyOpen = existingRoot && typeof window.__remiUpdateQueue === 'function';
          
          if (!isAlreadyOpen && settings.soundEnabled !== false) {
            try {
              soundEngine.playChime(settings.soundTone, settings.volume);
            } catch (e) { }
          }
          
          const queue = request.queue || await storage.getActiveQueue();
          const targetRem = request.reminder || (queue.length > 0 ? queue[0] : null);
          
          if (isAlreadyOpen) {
            window.__remiUpdateQueue(queue, true); // true = silent/preserve index
          } else if (targetRem) {
            renderMascotReminder(targetRem, settings, queue, 0);
          }
          
          sendResponse({ success: true });
          break;
        }
        case 'HIDE_REMI_REMINDER': {
          removeExistingMascot();
          sendResponse({ success: true });
          break;
        }
        case 'FOCUS_COMPLETED_CELEBRATION': {
          const settings = await storage.getSettings();
          if (settings.soundEnabled !== false) {
            try {
              soundEngine.playCelebration();
            } catch (e) {}
          }
          triggerFocusCompletedCelebration(request.durationMinutes);
          sendResponse({ success: true });
          break;
        }
        case 'SHOW_BLOCKER_OVERLAY': {
          const settings = await storage.getSettings();
          renderBlockerOverlay(request.domain, request.isFocusMode, settings);
          sendResponse({ success: true });
          break;
        }
        case 'SHOW_PENDING_BANNER': {
          renderPendingBanner(request.count, request.reminders);
          sendResponse({ success: true });
          break;
        }
      }
    })();
    return true;
  });

  // Listen for settings & focus state changes to dynamically update overlays
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(async (changes, areaName) => {
      if (areaName === 'local') {
        if (changes.reminderly_settings) {
          const newSettings = changes.reminderly_settings.newValue;
          if (newSettings) {
            const userTheme = newSettings.theme || 'system';
            const effectiveTheme = (userTheme === 'system' || !userTheme)
              ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
              : userTheme;

            const root = document.getElementById('remi-overlay-root');
            if (root) {
              const currentClasses = Array.from(root.classList).filter(c => !c.startsWith('theme-'));
              root.className = [...currentClasses, `theme-${effectiveTheme}`].join(' ');
            }

            const blockerRoot = document.getElementById('reminderly-blocker-root');
            if (blockerRoot) {
              blockerRoot.className = `theme-${effectiveTheme}`;
            }

            const clockRoot = document.getElementById('remi-focus-clock-root');
            if (clockRoot) {
              clockRoot.className = `theme-${effectiveTheme}`;
            }
          }
        }

        if (changes.reminderly_focus_state) {
          const focusState = changes.reminderly_focus_state.newValue;
          const settings = await storage.getSettings();
          if (focusState && focusState.active && focusState.pinned) {
            renderFocusClockOverlay(focusState, settings);
          } else {
            removeFocusClockOverlay();
          }
        }
      }
    });
  }

  function renderPendingBanner(count, reminders) {
    if (document.getElementById('reminderly-pending-banner-root')) return;

    const root = document.createElement('div');
    root.id = 'reminderly-pending-banner-root';

    root.innerHTML = `
    <div class="reminderly-pending-card">
      <div class="reminderly-pending-icon">🔔</div>
      <div>
        <div class="reminderly-pending-text">You have ${count} pending reminder${count > 1 ? 's' : ''}</div>
        <div class="reminderly-pending-sub">Paused while you were working on priority sites</div>
      </div>
      <button class="reminderly-banner-btn" id="reminderly-view-pending">View Now</button>
      <button class="reminderly-banner-close" id="reminderly-close-pending">✕</button>
    </div>
  `;

    document.body.appendChild(root);

    root.querySelector('#reminderly-view-pending').addEventListener('click', async () => {
      const settings = await storage.getSettings();
      if (reminders && reminders.length > 0) {
        renderMascotReminder(reminders[0], settings);
      }
      chrome.runtime.sendMessage({ action: 'CLEAR_PENDING_QUEUE' });
      root.remove();
    });

    root.querySelector('#reminderly-close-pending').addEventListener('click', () => {
      root.remove();
    });
  }
})();
