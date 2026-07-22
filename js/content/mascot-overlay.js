/**
 * Remi Floating Mascot Overlay Engine (Content Script)
 */

import { getMascotSVG, MASCOT_EMOTIONS } from '../common/mascots.js';
import { CATEGORIES, PRIORITIES } from '../common/constants.js';
import { getCategoryDetails } from '../common/utils.js';

let activeOverlay = null;
let isCelebratingOutro = false;

export function renderMascotReminder(reminder, settings, queue = [], currentIndex = 0) {
  if (!queue || queue.length === 0) {
    queue = [reminder];
  }

  // If mascot is ALREADY rendered on screen, do NOT destroy & replay 4s entrance GIF!
  // Just update the queue and speech bubble in place!
  const existingRoot = document.getElementById('remi-overlay-root');
  if (existingRoot && activeOverlay && typeof window.__remiUpdateQueue === 'function') {
    window.__remiUpdateQueue(queue);
    return;
  }

  removeExistingMascot();

  const mascotSettings = settings.mascot || {};
  if (mascotSettings.enabled === false) return;

  const mascotType = mascotSettings.type || 'remi';
  const position = mascotSettings.position || 'bottom-right';
  const size = 400;
  const opacity = mascotSettings.opacity !== undefined ? mascotSettings.opacity : 1.0;

  const userTheme = settings.theme || 'system';
  const effectiveTheme = (userTheme === 'system' || !userTheme)
    ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : userTheme;

  const root = document.createElement('div');
  root.id = 'remi-overlay-root';
  root.className = `pos-${position} theme-${effectiveTheme}`;
  root.style.opacity = opacity;

  const customCategories = settings.customCategories || [];
  const categoryInfo = getCategoryDetails(reminder.category, customCategories);
  const priorityInfo = PRIORITIES[reminder.priority?.toUpperCase()] || PRIORITIES.MEDIUM;

  const queueHeaderHTML = `
    <div class="remi-queue-header" style="${queue.length > 1 ? '' : 'display: none;'}">
      <span>🔔 Reminder ${currentIndex + 1} of ${queue.length}</span>
      <div style="display: flex; gap: 4px;">
        <button id="remi-queue-prev" class="remi-queue-btn" ${currentIndex === 0 ? 'disabled style="opacity: 0.3;"' : ''}>◀ Prev</button>
        <button id="remi-queue-next" class="remi-queue-btn" ${currentIndex === queue.length - 1 ? 'disabled style="opacity: 0.3;"' : ''}>Next ▶</button>
      </div>
    </div>
  `;

  root.innerHTML = `
    <div class="remi-container">
      <div class="remi-speech-bubble" style="opacity: 0; visibility: hidden; pointer-events: none; animation: none; transition: opacity 0.4s ease, visibility 0.4s ease;">
        ${queueHeaderHTML}
        <div class="remi-bubble-header">
          <span class="remi-category-tag">
            ${categoryInfo.icon ? `<span>${categoryInfo.icon}</span>` : ''}
            <span>${categoryInfo.label}</span>
          </span>
          <span class="remi-priority-tag ${priorityInfo.badgeClass}">
            ${priorityInfo.label}
          </span>
        </div>
        <div class="remi-title">${escapeHTML(reminder.title)}</div>
        <div class="remi-desc">${escapeHTML(reminder.description || 'Time for your scheduled reminder!')}</div>
        <div class="remi-actions">
          ${(() => {
            if (reminder.isPeriodReminder) {
              return `
                <button class="remi-btn remi-btn-done" id="remi-action-done" style="background: linear-gradient(135deg,#ec4899,#a855f7);">
                  Got it! 🩸
                </button>
                <button class="remi-btn remi-btn-snooze" id="remi-action-snooze" style="border-color:#ec489955;">
                  📅 1d
                </button>
                <button class="remi-btn remi-btn-skip" id="remi-action-skip">
                  ✕ Dismiss
                </button>
              `;
            } else {
              const snoozeMins = settings.defaultSnoozeMinutes || 10;
              const snoozeLabel = snoozeMins >= 60 ? (snoozeMins / 60) + 'h' : snoozeMins + 'm';
              return `
                <button class="remi-btn remi-btn-done" id="remi-action-done">
                  ✓ Done
                </button>
                <button class="remi-btn remi-btn-snooze" id="remi-action-snooze" title="Snooze">
                  ⏰ ${snoozeLabel}
                </button>
                <button class="remi-btn remi-btn-skip" id="remi-action-skip">
                  ✕ Skip
                </button>
              `;
            }
          })()}
        </div>
      </div>
      <div class="remi-avatar" id="remi-avatar-box">
        ${getMascotSVG(mascotType, MASCOT_EMOTIONS.NEUTRAL, size)}
      </div>
    </div>
  `;

  const ensureTopDOMOrder = () => {
    if (root && document.body && document.body.lastChild !== root) {
      document.body.appendChild(root);
    }
  };

  ensureTopDOMOrder();
  activeOverlay = root;

  // Periodically re-check to ensure late-loaded ad iframes don't get appended above root
  const domOrderInterval = setInterval(ensureTopDOMOrder, 1000);

  const updateSpeechBubbleContent = (newIndex) => {
    if (!queue || queue.length === 0) return;
    currentIndex = Math.max(0, Math.min(newIndex, queue.length - 1));
    const currentRem = queue[currentIndex];
    if (!currentRem) return;

    const currentCatInfo = getCategoryDetails(currentRem.category, customCategories);
    const currentPriorityInfo = PRIORITIES[currentRem.priority?.toUpperCase()] || PRIORITIES.MEDIUM;

    // Update queue header
    const queueHeader = root.querySelector('.remi-queue-header');
    if (queueHeader) {
      if (queue.length <= 1) {
        queueHeader.style.display = 'none';
      } else {
        queueHeader.style.display = 'flex';
        const headerSpan = queueHeader.querySelector('span');
        if (headerSpan) {
          headerSpan.textContent = `🔔 Reminder ${currentIndex + 1} of ${queue.length}`;
        }
      }
    }

    // Update prev/next button states
    const prevBtn = root.querySelector('#remi-queue-prev');
    const nextBtn = root.querySelector('#remi-queue-next');
    if (prevBtn) {
      if (currentIndex === 0) {
        prevBtn.setAttribute('disabled', 'true');
        prevBtn.style.opacity = '0.3';
      } else {
        prevBtn.removeAttribute('disabled');
        prevBtn.style.opacity = '1';
      }
    }
    if (nextBtn) {
      if (currentIndex === queue.length - 1) {
        nextBtn.setAttribute('disabled', 'true');
        nextBtn.style.opacity = '0.3';
      } else {
        nextBtn.removeAttribute('disabled');
        nextBtn.style.opacity = '1';
      }
    }

    // Update tags
    const catTag = root.querySelector('.remi-category-tag');
    if (catTag) {
      catTag.innerHTML = `<span>${currentCatInfo.icon}</span> <span>${currentCatInfo.label}</span>`;
    }
    const prioTag = root.querySelector('.remi-priority-tag');
    if (prioTag) {
      prioTag.className = `remi-priority-tag ${currentPriorityInfo.badgeClass}`;
      prioTag.textContent = currentPriorityInfo.label;
    }

    // Update texts
    const titleEl = root.querySelector('.remi-title');
    if (titleEl) {
      titleEl.textContent = currentRem.title;
    }
    const descEl = root.querySelector('.remi-desc');
    if (descEl) {
      descEl.textContent = currentRem.description || 'Time for your scheduled reminder!';
    }

    // Reset/start eye rest timer if applicable
    if (eyeCountdownInterval) {
      clearInterval(eyeCountdownInterval);
      eyeCountdownInterval = null;
    }
    eyeStartTimestamp = null;
    isEyeWarningShown = false;
    activeWarningTemplate = null;

    // Update action buttons based on reminder type
    const btnDone = root.querySelector('#remi-action-done');
    const btnSnooze = root.querySelector('#remi-action-snooze');
    const btnSkip = root.querySelector('#remi-action-skip');
    
    if (btnDone && btnSnooze && btnSkip) {
      if (currentRem.isPeriodReminder) {
        btnDone.innerHTML = 'Got it! 🩸';
        btnDone.style.background = 'linear-gradient(135deg,#ec4899,#a855f7)';
        btnSnooze.innerHTML = '📅 1d';
        btnSnooze.style.borderColor = '#ec489955';
        btnSkip.innerHTML = '✕ Dismiss';
      } else {
        btnDone.innerHTML = '✓ Done';
        btnDone.style.background = '';
        const snoozeMins = settings.defaultSnoozeMinutes || 10;
        const snoozeLabel = snoozeMins >= 60 ? (snoozeMins / 60) + 'h' : snoozeMins + 'm';
        btnSnooze.innerHTML = '⏰ ' + snoozeLabel;
        btnSnooze.style.borderColor = '';
        btnSkip.innerHTML = '✕ Skip';
      }
    }

    if (currentRem.id === 'auto_health_eye') {
      startEyeCountdown();
    }
  };

  // Attach global in-place queue updater
  window.__remiUpdateQueue = (newQueue, isSilentSync = false) => {
    queue = newQueue || [];
    if (queue.length === 0) {
      handleActionFinish();
    } else {
      updateSpeechBubbleContent(isSilentSync ? currentIndex : 0);
    }
  };

  // Bind Queue Prev/Next buttons
  const prevBtn = root.querySelector('#remi-queue-prev');
  const nextBtn = root.querySelector('#remi-queue-next');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentIndex > 0) {
        updateSpeechBubbleContent(currentIndex - 1);
      }
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (currentIndex < queue.length - 1) {
        updateSpeechBubbleContent(currentIndex + 1);
      }
    });
  }

  // Handle action (Done / Snooze / Skip) for item in queue without re-playing 4s entrance GIF
  const handleItemAction = (actionMsg) => {
    if (userActionClicked) return;
    const currentRem = queue[currentIndex];
    if (!currentRem) return;

    // Send action message to background worker
    safeSendMessage(actionMsg);

    // Remove actioned item from local queue
    queue.splice(currentIndex, 1);

    if (queue.length > 0) {
      // Advance to next available item in current speech bubble seamlessly!
      if (currentIndex >= queue.length) {
        currentIndex = queue.length - 1;
      }
      updateSpeechBubbleContent(currentIndex);
    } else {
      // All queued notifications cleared! Play 3.5s celebration outro GIF and close
      handleActionFinish(null);
    }
  };

  // Safe chrome.runtime.sendMessage helper
  function safeSendMessage(message) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
        const p = chrome.runtime.sendMessage(message);
        if (p && typeof p.catch === 'function') {
          p.catch(() => { });
        }
      }
    } catch (e) {
      // Gracefully handle extension context invalidation
    }
  }

  function hideBubble() {
    const bubble = root.querySelector('.remi-speech-bubble');
    if (bubble) {
      bubble.style.opacity = '0';
      bubble.style.visibility = 'hidden';
      bubble.style.pointerEvents = 'none';
    }
  }

  function showBubbleNow() {
    const bubble = root.querySelector('.remi-speech-bubble');
    if (bubble) {
      bubble.style.opacity = '1';
      bubble.style.visibility = 'visible';
      bubble.style.pointerEvents = 'auto';
      startEyeCountdown();
    }
  }

  function safeGetURL(path) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.runtime.getURL) {
        return chrome.runtime.getURL(path);
      }
    } catch (e) {
      // Gracefully handle context invalidation
    }
    return `../${path}`;
  }

  // Sliced GIF Timeline Controller
  let userActionClicked = false;
  hideBubble();

  // Phase 1 -> Phase 2: Switch from Welcome (4s1.gif) to Idle transition (1.8Sec2.gif) after 4s (4000ms)
  const idleTimer = setTimeout(() => {
    if (userActionClicked) return;
    const gifEl = root.querySelector('#remi-gif-element');
    if (gifEl) {
      gifEl.src = safeGetURL('remi/1.8Sec2.gif');
    }
    showBubbleNow();

    // After 1.8 seconds (one play of 1.8Sec2.gif), transition to wait.gif in loop
    setTimeout(() => {
      if (userActionClicked) return;
      const finalGifEl = root.querySelector('#remi-gif-element');
      if (finalGifEl) {
        finalGifEl.src = safeGetURL('remi/wait.gif');
      }
    }, 1800);
  }, 4000);

  const renderTimestamp = Date.now();
  let eyeStartTimestamp = null;
  let eyeCountdownInterval = null;
  let isEyeWarningShown = false;

  const EARLY_EYE_WARNINGS = [
    (sec) => `<span style="color: #f59e0b; font-weight: bold;">😜 Hey! 20 seconds haven't passed yet! You're lying! 😄 Look 20ft away for <span style="font-size: 1.1em; color: #ec4899;">${sec}s</span> more, then click Done!</span>`,
    (sec) => `<span style="color: #38bdf8; font-weight: bold;">👁️ Nice try! Your eyes still need <span style="font-size: 1.1em; color: #ec4899;">${sec}s</span> of rest. Look out a window or across the room! 🪟</span>`,
    (sec) => `<span style="color: #f59e0b; font-weight: bold;">👀 Don't cheat your eyes! You have <span style="font-size: 1.1em; color: #ec4899;">${sec}s</span> left. Blink, stretch, and relax your vision! ✨</span>`,
    (sec) => `<span style="color: #a855f7; font-weight: bold;">🤖 Remi sees you trying to click early! 😆 Just <span style="font-size: 1.1em; color: #ec4899;">${sec}s</span> more of looking 20ft away!</span>`,
    (sec) => `<span style="color: #10b981; font-weight: bold;">🛑 Hold on! Computer vision strain needs a full 20s break! Only <span style="font-size: 1.1em; color: #ec4899;">${sec}s</span> remaining! ⏳</span>`
  ];
  let currentWarningIndex = 0;
  let activeWarningTemplate = null;

  function startEyeCountdown() {
    const currentRem = queue[currentIndex];
    if (!currentRem || currentRem.id !== 'auto_health_eye') return;
    if (eyeStartTimestamp) return; // Prevent multiple calls
    eyeStartTimestamp = Date.now();

    const descEl = root.querySelector('.remi-desc');
    const updateEyeTimer = () => {
      const activeRem = queue[currentIndex];
      if (!activeRem || activeRem.id !== 'auto_health_eye') {
        if (eyeCountdownInterval) {
          clearInterval(eyeCountdownInterval);
          eyeCountdownInterval = null;
        }
        activeWarningTemplate = null;
        return;
      }

      const elapsedMs = Date.now() - eyeStartTimestamp;
      const remainingSecs = Math.max(0, Math.ceil((20000 - elapsedMs) / 1000));

      const targetDescEl = root.querySelector('.remi-desc');
      if (!targetDescEl) return;

      if (remainingSecs > 0) {
        if (activeWarningTemplate) {
          targetDescEl.innerHTML = activeWarningTemplate(remainingSecs);
        } else {
          targetDescEl.innerHTML = `Look 20ft away for 20 seconds. ⏱️ <strong><span style="color: #38bdf8; font-size: 1.05em;">${remainingSecs}s</span> remaining</strong>`;
        }
      } else {
        if (eyeCountdownInterval) {
          clearInterval(eyeCountdownInterval);
          eyeCountdownInterval = null;
        }
        activeWarningTemplate = null;
        targetDescEl.innerHTML = `<span style="color: #10b981; font-weight: bold;">🎉 20 seconds complete! Great job resting your eyes! Click Done ✓ to record your break.</span>`;
      }
    };

    updateEyeTimer();
    eyeCountdownInterval = setInterval(updateEyeTimer, 1000);
  }

  // Handle action click -> immediately hide notification speech bubble & play 3.5s mascot outro GIF
  const handleActionFinish = (actionMsg = null) => {
    if (userActionClicked) return;
    userActionClicked = true;
    isCelebratingOutro = true;
    clearTimeout(idleTimer);
    if (eyeCountdownInterval) clearInterval(eyeCountdownInterval);
    if (domOrderInterval) clearInterval(domOrderInterval);
    delete window.__remiUpdateQueue;

    // Send action message to background worker immediately so state updates instantly
    if (actionMsg) {
      safeSendMessage(actionMsg);
    }

    // 1. Immediately hide speech bubble notification card
    hideBubble();

    // 2. Switch mascot avatar to 3.5s celebration/outro GIF (3.5s3.gif)
    const avatarBox = root.querySelector('#remi-avatar-box');
    if (avatarBox) {
      avatarBox.innerHTML = getMascotSVG(mascotType, MASCOT_EMOTIONS.NEUTRAL, size, 'outro');
    }

    // 3. After 3.5s celebration GIF finishes, force remove mascot overlay from DOM
    let isClosed = false;
    const finishAndClose = () => {
      if (isClosed) return;
      isClosed = true;
      removeExistingMascot(true);
    };

    setTimeout(finishAndClose, 3500);
  };

  // Bind Event Listeners
  root.querySelector('#remi-action-done').addEventListener('click', async () => {
    const elapsed = eyeStartTimestamp ? (Date.now() - eyeStartTimestamp) : 0;
    const currentRem = queue[currentIndex];
    if (currentRem && currentRem.id === 'auto_health_eye' && elapsed < 20000) {
      isEyeWarningShown = true;
      const remainingSecs = Math.max(1, Math.ceil((20000 - elapsed) / 1000));
      activeWarningTemplate = EARLY_EYE_WARNINGS[currentWarningIndex % EARLY_EYE_WARNINGS.length];
      currentWarningIndex = (currentWarningIndex + 1) % EARLY_EYE_WARNINGS.length;

      const descEl = root.querySelector('.remi-desc');
      if (descEl) {
        descEl.innerHTML = activeWarningTemplate(remainingSecs);
      }
      return;
    }

    setTimeout(() => {
      handleItemAction({ action: 'MARK_DONE', id: currentRem.id });
    }, 220);
  });

  root.querySelector('#remi-action-snooze').addEventListener('click', async () => {
    const currentRem = queue[currentIndex];
    if (!currentRem) return;
    const snoozeMinutes = currentRem.isPeriodReminder ? 1440 : (settings.defaultSnoozeMinutes || 10);
    setTimeout(() => {
      handleItemAction({ action: 'SNOOZE_REMINDER', id: currentRem.id, minutes: snoozeMinutes });
    }, 220);
  });

  root.querySelector('#remi-action-skip').addEventListener('click', async () => {
    const currentRem = queue[currentIndex];
    if (!currentRem) return;
    setTimeout(() => {
      handleItemAction({ action: 'SKIP_REMINDER', id: currentRem.id });
    }, 220);
  });
}

export function triggerFocusCompletedCelebration() {
  removeExistingMascot();

  const root = document.createElement('div');
  root.id = 'remi-overlay-root';
  root.className = 'pos-bottom-right';

  root.innerHTML = `
    <div class="remi-container">
      <div class="remi-speech-bubble" style="border-color: #10b981;">
        <div class="remi-title" style="color: #34d399;">🎉 Focus Session Completed!</div>
        <div class="remi-desc">Fantastic job staying focused and productive today!</div>
        <button class="remi-btn remi-btn-done" id="remi-celebrate-close" style="width:100%;">
          Awesome!
        </button>
      </div>
      <div class="remi-avatar remi-celebrate">
        ${getMascotSVG('remi', MASCOT_EMOTIONS.HAPPY, 120, 'outro')}
      </div>
    </div>
  `;

  document.body.appendChild(root);
  activeOverlay = root;

  root.querySelector('#remi-celebrate-close').addEventListener('click', () => {
    removeExistingMascot();
  });
}

export function removeExistingMascot(force = false) {
  if (isCelebratingOutro && !force) {
    return; // Don't kill Remi while he is performing his 3.5s celebration dance!
  }
  const existing = document.getElementById('remi-overlay-root');
  if (existing) {
    existing.remove();
  }
  activeOverlay = null;
  isCelebratingOutro = false;
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g,
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}
