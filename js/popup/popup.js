/**
 * Reminderly Popup Logic
 */

import { storage } from '../common/storage.js';
import { CATEGORIES, PRIORITIES } from '../common/constants.js';
import { generateId, formatRelativeTime, toInputDate, toInputTime, parseDateTime, checkRestorableStreak, getCategoryDetails } from '../common/utils.js';

let focusTimerInterval = null;
let popCustomCategories = [];
let currentCategoryFilter = 'all';
let currentTimeFilter = 'today';

const savedFocusHidden = localStorage.getItem('reminderly_focus_hidden');
let isFocusWidgetHidden = savedFocusHidden === null ? true : savedFocusHidden === 'true';

document.addEventListener('DOMContentLoaded', async () => {
  await loadTheme();
  await refreshUI();

  // Scroll-more arrow indicator
  const remList = document.getElementById('reminders-list-container');
  const arrowEl = document.getElementById('scroll-more-arrow');
  function updateScrollArrow() {
    if (!remList || !arrowEl) return;
    const hasMore = remList.scrollHeight > remList.clientHeight + remList.scrollTop + 2;
    arrowEl.classList.toggle('visible', hasMore);
  }
  if (remList) {
    remList.addEventListener('scroll', updateScrollArrow);
    setTimeout(updateScrollArrow, 100);
  }

  // Event Listeners
  document.getElementById('btn-theme-toggle')?.addEventListener('click', toggleTheme);
  document.getElementById('btn-theme-toggle-quick')?.addEventListener('click', toggleTheme);
  document.getElementById('btn-open-dashboard')?.addEventListener('click', openDashboard);
  document.getElementById('btn-open-dashboard-quick')?.addEventListener('click', openDashboard);
  document.getElementById('btn-log-water')?.addEventListener('click', handleLogWaterClick);
  document.getElementById('btn-unlog-water')?.addEventListener('click', unlogWater);

  // Focus Widget Hide / Unhide Listeners
  document.getElementById('btn-hide-focus')?.addEventListener('click', () => {
    isFocusWidgetHidden = true;
    localStorage.setItem('reminderly_focus_hidden', 'true');
    refreshUI();
  });
  document.getElementById('btn-unhide-focus')?.addEventListener('click', (e) => {
    e.stopPropagation();
    isFocusWidgetHidden = false;
    localStorage.setItem('reminderly_focus_hidden', 'false');
    refreshUI();
  });
  document.getElementById('focus-tab-bar')?.addEventListener('click', () => {
    isFocusWidgetHidden = false;
    localStorage.setItem('reminderly_focus_hidden', 'false');
    refreshUI();
  });

  // Filter Icon & Filter Bar Listeners
  document.getElementById('btn-filter-reminders')?.addEventListener('click', () => {
    const filterBar = document.getElementById('reminders-filter-bar');
    if (filterBar) {
      const isHidden = filterBar.style.display === 'none' || !filterBar.style.display;
      filterBar.style.display = isHidden ? 'block' : 'none';
    }
  });

  document.getElementById('filter-select-time')?.addEventListener('change', (e) => {
    currentTimeFilter = e.target.value;
    updateFilterActiveIndicator();
    refreshUI();
  });

  document.getElementById('filter-select-category')?.addEventListener('change', (e) => {
    currentCategoryFilter = e.target.value;
    updateFilterActiveIndicator();
    refreshUI();
  });

  document.getElementById('btn-clear-filter-badge')?.addEventListener('click', () => {
    resetFilters();
  });

  // Quick Add Modal Listeners
  document.getElementById('new-rem-repeat')?.addEventListener('change', (e) => {
    updateQuickAddFields(e.target.value);
    refreshQuickAddLivePreview();
  });
  document.getElementById('new-rem-date')?.addEventListener('change', refreshQuickAddLivePreview);
  document.getElementById('new-rem-time')?.addEventListener('change', refreshQuickAddLivePreview);
  document.getElementById('new-rem-interval')?.addEventListener('input', refreshQuickAddLivePreview);

  document.getElementById('new-rem-category')?.addEventListener('change', (e) => {
    const val = e.target.value;
    const box = document.getElementById('box-pop-custom-category-fields');
    if (box) {
      box.style.display = (val === 'new_custom' || val === 'custom') ? 'flex' : 'none';
    }
  });

  document.querySelectorAll('.btn-emoji-preset').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = e.currentTarget.dataset.target;
      const emoji = e.currentTarget.dataset.emoji;
      const input = document.getElementById(targetId);
      if (input && emoji) {
        input.value = emoji;
      }
    });
  });

  document.getElementById('new-rem-custom-emoji')?.addEventListener('input', (e) => {
    const chars = Array.from(e.target.value);
    if (chars.length > 1) {
      e.target.value = chars[0];
    }
  });

  document.getElementById('btn-open-add-modal')?.addEventListener('click', async () => {
    await populateQuickAddCategories();
    if (document.getElementById('new-rem-date')) {
      document.getElementById('new-rem-date').value = '';
    }
    if (document.getElementById('new-rem-time')) {
      document.getElementById('new-rem-time').value = '';
    }
    if (document.getElementById('new-rem-repeat')) {
      document.getElementById('new-rem-repeat').value = 'once';
    }
    if (document.getElementById('new-rem-custom-name')) document.getElementById('new-rem-custom-name').value = '';
    if (document.getElementById('new-rem-custom-emoji')) document.getElementById('new-rem-custom-emoji').value = '';

    const catSelect = document.getElementById('new-rem-category');
    if (catSelect) catSelect.value = '';

    const box = document.getElementById('box-pop-custom-category-fields');
    if (box) box.style.display = 'none';

    if (document.getElementById('new-rem-notes')) {
      document.getElementById('new-rem-notes').value = '';
    }

    updateQuickAddFields('once');
    document.getElementById('quick-add-modal')?.classList.add('active');
    startQuickAddLivePreview();
  });

  document.getElementById('btn-close-quick-add')?.addEventListener('click', () => {
    stopQuickAddLivePreview();
    document.getElementById('quick-add-modal')?.classList.remove('active');
  });

  document.getElementById('btn-cancel-quick-add')?.addEventListener('click', () => {
    stopQuickAddLivePreview();
    document.getElementById('quick-add-modal')?.classList.remove('active');
  });

  document.getElementById('btn-save-reminder')?.addEventListener('click', () => {
    saveNewReminder();
  });

  setInterval(updateAllLiveCountdowns, 1000);
});

function resetFilters() {
  currentTimeFilter = 'today';
  currentCategoryFilter = 'all';
  const timeSelect = document.getElementById('filter-select-time');
  const catSelect = document.getElementById('filter-select-category');
  if (timeSelect) timeSelect.value = 'today';
  if (catSelect) catSelect.value = 'all';
  updateFilterActiveIndicator();
  refreshUI();
}

function updateFilterActiveIndicator() {
  const isFiltered = currentTimeFilter !== 'today' || currentCategoryFilter !== 'all';
  const filterDot = document.getElementById('filter-active-dot');
  const filterBtn = document.getElementById('btn-filter-reminders');
  const badge = document.getElementById('filter-summary-badge');
  const badgeText = document.getElementById('filter-summary-text');

  if (filterDot) filterDot.style.display = isFiltered ? 'block' : 'none';
  if (filterBtn) filterBtn.classList.toggle('active', isFiltered);

  if (badge && badgeText) {
    if (isFiltered) {
      const timeLabels = { all: 'All Time', today: 'Today', week: 'This Week', month: 'This Month' };
      const catLabels = {
        all: 'All Categories',
        health: '💧 Health',
        workout: '🏋️ Workout',
        study: '📚 Study',
        meetings: '📅 Meetings',
        reading: '📖 Reading',
        break: '☕ Break',
        sleep: '🌙 Sleep',
        custom: 'Custom'
      };

      let catPart = catLabels[currentCategoryFilter];
      if (!catPart) {
        const foundCustom = (popCustomCategories || []).find(c => c.id === currentCategoryFilter);
        if (foundCustom) {
          catPart = (foundCustom.icon ? foundCustom.icon + ' ' : '') + foundCustom.label;
        } else {
          catPart = 'Custom';
        }
      }
      const timePart = timeLabels[currentTimeFilter] || 'All Time';
      badgeText.textContent = `Showing: ${timePart} • ${catPart}`;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }
}

function matchesTimeFilter(rem, timeFilter) {
  if (timeFilter === 'all') return true;
  if (!rem.time) return true; // health / interval reminders without static target date
  
  const now = new Date();
  const remTime = parseInt(rem.time, 10);
  if (!remTime) return true;

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  if (timeFilter === 'today') {
    const endOfDay = startOfDay + 24 * 60 * 60 * 1000 - 1;
    return remTime <= endOfDay;
  }

  if (timeFilter === 'week') {
    const endOfWeek = startOfDay + 7 * 24 * 60 * 60 * 1000;
    return remTime <= endOfWeek;
  }

  if (timeFilter === 'month') {
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
    return remTime <= endOfMonth;
  }

  return true;
}

function updateAllLiveCountdowns() {
  document.querySelectorAll('.live-countdown').forEach(el => {
    const ts = parseInt(el.dataset.timestamp, 10);
    if (ts) {
      el.textContent = formatRelativeTime(ts);
    }
  });
}

let quickAddLiveInterval = null;

function refreshQuickAddLivePreview() {
  const repeat = document.getElementById('new-rem-repeat')?.value || 'once';
  const dateVal = document.getElementById('new-rem-date')?.value;
  const timeVal = document.getElementById('new-rem-time')?.value;
  const intervalVal = document.getElementById('new-rem-interval')?.value || '15';
  const badgeVal = document.getElementById('quick-preview-next-trigger-val');

  let ts = 0;
  if (repeat === 'once' || repeat === 'weekly' || repeat === 'monthly') {
    if (!dateVal || !timeVal) {
      if (badgeVal) badgeVal.textContent = 'Select Date & Time';
      return;
    }
    ts = parseDateTime(dateVal, timeVal);
    if (repeat === 'weekly') {
      while (ts <= Date.now()) {
        ts += 7 * 24 * 3600 * 1000;
      }
    } else if (repeat === 'monthly') {
      if (ts <= Date.now()) {
        const d = new Date(ts);
        d.setMonth(d.getMonth() + 1);
        ts = d.getTime();
      }
    }
  } else if (repeat === 'daily') {
    if (!timeVal) {
      if (badgeVal) badgeVal.textContent = 'Select Time';
      return;
    }
    const todayDate = toInputDate();
    ts = parseDateTime(todayDate, timeVal);
    if (ts <= Date.now()) {
      ts += 24 * 3600 * 1000;
    }
  } else if (repeat === 'every_x_minutes') {
    const mins = parseInt(intervalVal, 10) || 1;
    ts = Date.now() + mins * 60 * 1000;
  } else if (repeat === 'every_x_hours') {
    const hrs = parseInt(intervalVal, 10) || 1;
    ts = Date.now() + hrs * 3600 * 1000;
  }

  if (badgeVal) {
    badgeVal.textContent = ts > 0 ? formatRelativeTime(ts) : 'Select Date & Time';
  }
}

function startQuickAddLivePreview() {
  if (quickAddLiveInterval) clearInterval(quickAddLiveInterval);
  refreshQuickAddLivePreview();
  quickAddLiveInterval = setInterval(refreshQuickAddLivePreview, 1000);
}

function stopQuickAddLivePreview() {
  if (quickAddLiveInterval) clearInterval(quickAddLiveInterval);
}

function updateQuickAddFields(repeatPattern) {
  const grpDate = document.getElementById('grp-new-date');
  const grpTime = document.getElementById('grp-new-time');
  const grpInterval = document.getElementById('grp-new-interval');
  const lblInterval = document.getElementById('lbl-new-interval');

  if (!grpDate || !grpTime || !grpInterval) return;

  switch (repeatPattern) {
    case 'once':
    case 'weekly':
    case 'monthly':
      grpDate.style.display = 'block';
      grpTime.style.display = 'block';
      grpInterval.style.display = 'none';
      break;

    case 'daily':
      grpDate.style.display = 'none';
      grpTime.style.display = 'block';
      grpInterval.style.display = 'none';
      break;

    case 'every_x_minutes':
      grpDate.style.display = 'none';
      grpTime.style.display = 'none';
      grpInterval.style.display = 'block';
      if (lblInterval) lblInterval.textContent = '⏱️ Interval (in Mins)';
      break;

    case 'every_x_hours':
      grpDate.style.display = 'none';
      grpTime.style.display = 'none';
      grpInterval.style.display = 'block';
      if (lblInterval) lblInterval.textContent = '⏱️ Interval (in Hours)';
      break;

    default:
      grpDate.style.display = 'block';
      grpTime.style.display = 'block';
      grpInterval.style.display = 'none';
      break;
  }
}

async function loadTheme() {
  const settings = await storage.getSettings();
  const pref = settings.theme || 'system';
  let effectiveTheme = pref;
  if (pref === 'system') {
    effectiveTheme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', effectiveTheme);
  document.body.setAttribute('data-theme', effectiveTheme);
  const iconSymbol = effectiveTheme === 'light' ? '☀️' : '🌙';
  const iconBtn = document.getElementById('btn-theme-toggle');
  const iconBtnQuick = document.getElementById('btn-theme-toggle-quick');
  if (iconBtn) iconBtn.textContent = iconSymbol;
  if (iconBtnQuick) iconBtnQuick.textContent = iconSymbol;
}

async function toggleTheme() {
  const settings = await storage.getSettings();
  const currentPref = settings.theme || 'system';
  let nextTheme = 'light';
  if (currentPref === 'system') {
    const isSystemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    nextTheme = isSystemDark ? 'light' : 'dark';
  } else {
    nextTheme = currentPref === 'light' ? 'dark' : 'light';
  }
  settings.theme = nextTheme;
  await storage.saveSettings(settings);
  await loadTheme();
}

function openDashboard() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open('../dashboard/dashboard.html', '_blank');
  }
}

async function refreshUI() {
  await populateQuickAddCategories();
  const stats = await storage.getDailyStats();
  const queue = await storage.getPendingQueue();
  const reminders = await storage.getReminders();
  const focusState = await storage.getFocusState();
  const settings = await storage.getSettings();

  // Check restorable streak
  const allStats = await storage.getAllDailyStats();
  const restorable = checkRestorableStreak(allStats);

  // 1. Stats Bar (Day Streak Widget)
  const streakDays = stats.streakDays || 0;
  const completedToday = (stats.completedCount || 0) + (stats.waterGlasses || 0) + (stats.focusMinutesToday || 0);
  const isDoneToday = completedToday > 0;
  const isZeroStreak = streakDays <= 0;

  const streakVal = document.getElementById('stat-streak-val');
  const streakLbl = document.getElementById('stat-streak-label');
  const streakGroup = document.querySelector('.header-action-group');

  if (streakVal && streakLbl) {
    streakLbl.textContent = streakDays === 1 ? 'Day Streak' : 'Days Streak';

    if (restorable) {
      streakVal.textContent = `${streakDays} 🔥 ❗`;
    } else {
      streakVal.textContent = `${streakDays} 🔥`;
    }

    if (streakGroup) {
      streakGroup.removeAttribute('title'); // Prevent duplicate native browser tooltip

      if (restorable) {
        streakGroup.classList.add('is-inactive');
        streakGroup.style.cursor = 'pointer';
        streakGroup.setAttribute('data-tooltip', `⚠️ Yesterday's ${restorable.pastStreakValue}-Day Streak Broken!\nClick here to open Dashboard & play Hangman to restore!`);
        streakGroup.onclick = () => {
          if (typeof chrome !== 'undefined' && chrome.tabs) {
            chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html#tab-overview') });
          }
        };
      } else {
        streakGroup.onclick = null;
        streakGroup.style.cursor = 'default';

        if (isZeroStreak) {
          // 0 Days Streak (Never completed or reset)
          streakGroup.classList.add('is-inactive');
          streakGroup.setAttribute('data-tooltip', `🔥 Streak: 0 Days (Inactive)\nComplete at least 1 reminder today to start your daily streak!`);
        } else if (!isDoneToday) {
          // Pending Today (Completed yesterday, but not today yet)
          streakGroup.classList.add('is-inactive');
          streakGroup.setAttribute('data-tooltip', `🔥 Streak: ${streakDays} Day${streakDays > 1 ? 's' : ''} (Pending Today)\nComplete 1 reminder today to ignite & advance your streak to ${streakDays + 1} Days!`);
        } else {
          // Active & Done Today
          streakGroup.classList.remove('is-inactive');
          streakGroup.setAttribute('data-tooltip', `🔥 Streak: ${streakDays} Day${streakDays > 1 ? 's' : ''} Active!\nGreat job! Keep completing daily reminders to maintain your streak!`);
        }
      }
    }
  }

  // 2. Water Progress
  const waterGlasses = stats.waterGlasses || 0;
  const waterGoal = settings.healthSettings?.waterGoal || settings.waterGoalGlasses || 8;
  const isCompleted = waterGlasses >= waterGoal;

  const countLabel = document.getElementById('water-count-label');
  const fill = document.getElementById('water-progress-fill');
  const unlogBtn = document.getElementById('btn-unlog-water');
  const logBtn = document.getElementById('btn-log-water');

  if (unlogBtn) unlogBtn.style.display = waterGlasses > 0 ? 'inline-block' : 'none';
  if (logBtn) logBtn.style.display = isCompleted ? 'none' : 'inline-block';

  if (isCompleted) {
    if (countLabel) countLabel.innerHTML = `<span style="color: #10b981; font-weight: 700;">🎉 ${waterGlasses} / ${waterGoal} (Goal Met!)</span>`;
    if (fill) {
      fill.style.width = '100%';
      fill.style.background = 'linear-gradient(90deg, #10b981, #06b6d4)';
    }
  } else {
    if (countLabel) countLabel.textContent = `${waterGlasses} / ${waterGoal} Glasses`;
    const pct = Math.min(100, Math.round((waterGlasses / waterGoal) * 100));
    if (fill) {
      fill.style.width = `${pct}%`;
      fill.style.background = '';
    }
  }

  const nextWaterRem = reminders.find(r => r.category === 'water' || r.id === 'auto_health_water');
  const nextWaterTimeEl = document.getElementById('popup-next-water-time');
  if (nextWaterTimeEl) {
    if (nextWaterRem && nextWaterRem.time) {
      nextWaterTimeEl.classList.add('live-countdown');
      nextWaterTimeEl.dataset.timestamp = nextWaterRem.time;
      nextWaterTimeEl.textContent = formatRelativeTime(nextWaterRem.time);
    } else {
      nextWaterTimeEl.classList.remove('live-countdown');
      nextWaterTimeEl.removeAttribute('data-timestamp');
      nextWaterTimeEl.textContent = 'Every 60m';
    }
  }

  const snoozeMins = settings?.defaultSnoozeMinutes || 10;
  const snoozeLabel = snoozeMins >= 60 ? (snoozeMins / 60) + 'h' : snoozeMins + 'm';
  const waterSnoozeBtn = document.getElementById('btn-snooze-water');
  if (waterSnoozeBtn) {
    waterSnoozeBtn.textContent = `⏰ ${snoozeLabel}`;
  }

  // 3. Focus Timer Widget
  updateFocusWidget(focusState);

  // 4. Reminders List
  renderRemindersList(reminders, settings, stats);

  // Re-check scroll arrow after list re-renders
  setTimeout(() => {
    const remList = document.getElementById('reminders-list-container');
    const arrowEl = document.getElementById('scroll-more-arrow');
    if (remList && arrowEl) {
      const hasMore = remList.scrollHeight > remList.clientHeight + remList.scrollTop + 2;
      arrowEl.classList.toggle('visible', hasMore);
    }
  }, 50);
}

function updateFocusWidget(focusState) {
  const widgetBox = document.getElementById('focus-widget-box');
  const tabBar = document.getElementById('focus-tab-bar');
  const tabStatus = document.getElementById('focus-tab-status');
  const label = document.getElementById('focus-status-label');
  const clock = document.getElementById('focus-timer-clock');
  const actionBtns = document.getElementById('focus-action-btns');

  if (!widgetBox || !label || !clock || !actionBtns) return;

  if (focusTimerInterval) clearInterval(focusTimerInterval);

  const isFocusActive = focusState && focusState.active && (focusState.paused || (focusState.endTime && Date.now() < focusState.endTime));

  // Focus widget is expanded when user unhides OR when a focus session is active
  const shouldHideWidget = isFocusWidgetHidden && !isFocusActive;

  if (shouldHideWidget) {
    widgetBox.style.display = 'none';
    if (tabBar) tabBar.style.display = 'flex';
  } else {
    widgetBox.style.display = 'flex';
    if (tabBar) tabBar.style.display = 'none';
  }

  const hideBtn = document.getElementById('btn-hide-focus');
  if (hideBtn) {
    hideBtn.style.display = isFocusActive ? 'none' : 'block';
  }

  if (isFocusActive) {
    widgetBox.classList.add('focus-widget-active');

    if (focusState.paused) {
      label.textContent = '⏸️ Focus Paused';
      const remainingMs = focusState.remainingMs || 0;
      const totalSec = Math.floor(remainingMs / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      const clockStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      clock.textContent = clockStr;
      if (tabStatus) tabStatus.textContent = `⏸️ ${clockStr}`;

      actionBtns.innerHTML = `
        <div style="display: flex; gap: 4px; width: 100%;">
          <button class="btn btn-ghost btn-sm" id="btn-pin-focus" style="padding: 4px 8px; border: none; background: transparent; opacity: ${focusState.pinned !== false ? '1' : '0.45'}; font-size: 1.1rem;" title="${focusState.pinned !== false ? 'Unpin Clock' : 'Pin Clock'}">📌</button>
          <button class="btn btn-primary btn-sm" id="btn-resume-focus" style="flex: 1;">▶ Resume</button>
          <button class="btn btn-danger btn-sm" id="btn-stop-focus" style="flex: 1;">Stop</button>
        </div>
      `;
      document.getElementById('btn-pin-focus')?.addEventListener('click', togglePinFocus);
      document.getElementById('btn-resume-focus')?.addEventListener('click', resumeFocus);
      document.getElementById('btn-stop-focus')?.addEventListener('click', stopFocus);

    } else {
      label.textContent = '🔥 Focus Active';

      const tick = () => {
        const remainingMs = focusState.endTime - Date.now();
        if (remainingMs <= 0) {
          clearInterval(focusTimerInterval);
          if (typeof chrome !== 'undefined' && chrome.runtime) {
            chrome.runtime.sendMessage({ action: 'COMPLETE_FOCUS_MODE' }, async () => {
              showToast('🎉 Focus session completed!', 'success');
              await refreshUI();
            });
          }
          return;
        }
        const totalSec = Math.floor(remainingMs / 1000);
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        const clockStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        clock.textContent = clockStr;
        if (tabStatus) tabStatus.textContent = `🔥 ${clockStr}`;
      };

      tick();
      focusTimerInterval = setInterval(tick, 1000);

      actionBtns.innerHTML = `
        <div style="display: flex; gap: 4px; width: 100%;">
          <button class="btn btn-ghost btn-sm" id="btn-pin-focus" style="padding: 4px 8px; border: none; background: transparent; opacity: ${focusState.pinned !== false ? '1' : '0.45'}; font-size: 1.1rem;" title="${focusState.pinned !== false ? 'Unpin Clock' : 'Pin Clock'}">📌</button>
          <button class="btn btn-secondary btn-sm" id="btn-pause-focus" style="flex: 1;">⏸ Pause</button>
          <button class="btn btn-danger btn-sm" id="btn-stop-focus" style="flex: 1;">Stop</button>
        </div>
      `;
      document.getElementById('btn-pin-focus')?.addEventListener('click', togglePinFocus);
      document.getElementById('btn-pause-focus')?.addEventListener('click', pauseFocus);
      document.getElementById('btn-stop-focus')?.addEventListener('click', stopFocus);
    }
  } else {
    widgetBox.classList.remove('focus-widget-active');
    label.textContent = 'Focus Mode Idle';
    clock.textContent = '25:00';
    if (tabStatus) tabStatus.textContent = '25:00';
    actionBtns.innerHTML = `
      <div id="row-focus-btns" style="display: flex; flex-direction: column; gap: 4px; min-width: 80px;">
        <button class="btn btn-primary btn-sm" id="btn-start-focus-25" style="width: 100%;">25m</button>
        <button class="btn btn-ghost btn-sm" id="btn-show-custom-focus" style="width: 100%;">Custom</button>
      </div>
      <div id="box-custom-focus" style="display: none; flex-direction: column; gap: 4px; min-width: 90px;">
        <input type="number" id="input-custom-focus" class="input-field" placeholder="Mins (e.g. 45)" min="1" max="480" style="width: 100%; padding: 2px 6px; font-size: 0.75rem; height: 28px;">
        <div style="display: flex; gap: 4px; width: 100%;">
          <button class="btn btn-primary btn-sm" id="btn-start-custom-focus" style="flex: 1; height: 28px;">▶ Start</button>
          <button class="btn btn-ghost btn-sm" id="btn-cancel-custom-focus" style="height: 28px; padding: 2px 8px; border: 1px solid var(--border);">✕</button>
        </div>
      </div>
    `;
    document.getElementById('btn-start-focus-25')?.addEventListener('click', () => startFocus(25));
    document.getElementById('btn-show-custom-focus')?.addEventListener('click', () => {
      const btnRow = document.getElementById('row-focus-btns');
      const box = document.getElementById('box-custom-focus');
      if (btnRow) btnRow.style.display = 'none';
      if (box) {
        box.style.display = 'flex';
        document.getElementById('input-custom-focus')?.focus();
      }
    });
    document.getElementById('btn-cancel-custom-focus')?.addEventListener('click', () => {
      const btnRow = document.getElementById('row-focus-btns');
      const box = document.getElementById('box-custom-focus');
      if (btnRow) btnRow.style.display = 'flex';
      if (box) box.style.display = 'none';
    });
    document.getElementById('btn-start-custom-focus')?.addEventListener('click', () => {
      const customVal = parseInt(document.getElementById('input-custom-focus')?.value, 10);
      if (customVal && customVal > 0) {
        startFocus(customVal);
      }
    });
  }

  document.getElementById('btn-hide-focus')?.addEventListener('click', (e) => {
    e.stopPropagation();
    isFocusWidgetHidden = true;
    localStorage.setItem('reminderly_focus_hidden', 'true');
    refreshUI();
  });
}

async function startFocus(minutes) {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: 'START_FOCUS_MODE', durationMinutes: minutes }, async () => {
      await refreshUI();
    });
  } else {
    const endTime = Date.now() + minutes * 60 * 1000;
    await storage.saveFocusState({ active: true, paused: false, remainingMs: null, endTime: endTime, durationMinutes: minutes, startTime: Date.now() });
    await refreshUI();
  }
}

async function pauseFocus() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: 'PAUSE_FOCUS_MODE' }, async () => {
      await refreshUI();
    });
  }
}

async function resumeFocus() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: 'RESUME_FOCUS_MODE' }, async () => {
      await refreshUI();
    });
  }
}

async function stopFocus() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: 'STOP_FOCUS_MODE' }, async () => {
      await refreshUI();
    });
  } else {
    await storage.saveFocusState({ active: false, paused: false, remainingMs: null, endTime: null, durationMinutes: 0, startTime: null });
    await refreshUI();
  }
}

async function togglePinFocus() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: 'TOGGLE_PIN_FOCUS_CLOCK' }, async () => {
      await refreshUI();
    });
  }
}

async function handleLogWaterClick() {
  const stats = await storage.getDailyStats();
  const settings = await storage.getSettings();
  const waterGlasses = stats.waterGlasses || 0;
  const waterGoal = settings.healthSettings?.waterGoal || settings.waterGoalGlasses || 8;

  if (waterGlasses >= waterGoal) return;

  promptEarlyLogConfirm(
    '💧',
    'Hydration Check',
    'Did you just drink a glass of water? 💧',
    logWater
  );
}

async function logWater() {
  const settings = await storage.getSettings();
  const waterMins = settings.healthSettings?.waterIntervalMinutes || settings.waterIntervalMinutes || 60;
  const nextWaterTime = Date.now() + waterMins * 60 * 1000;

  const reminders = await storage.getReminders();
  const waterIdx = reminders.findIndex(r => r.id === 'auto_health_water' || r.category === 'water');
  if (waterIdx !== -1) {
    reminders[waterIdx].time = nextWaterTime;
    await storage.saveReminders(reminders);
  }

  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage({ action: 'LOG_WATER', amount: 1 }, async () => {
      await refreshUI();
    });
  } else {
    await storage.updateDailyStats(curr => ({
      ...curr,
      waterGlasses: (curr.waterGlasses || 0) + 1
    }));
    await storage.incrementReminderProgress('auto_health_water');
    await refreshUI();
  }
}

async function unlogWater() {
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage({ action: 'DECREMENT_WATER' }, async () => {
      await refreshUI();
    });
  } else {
    await storage.updateDailyStats(curr => ({
      ...curr,
      waterGlasses: Math.max(0, (curr.waterGlasses || 0) - 1)
    }));
    await storage.decrementReminderProgress('auto_health_water');
    await refreshUI();
  }
}

function promptEarlyLogConfirm(icon, title, msgText, onConfirmCallback) {
  const modal = document.getElementById('modal-early-log-confirm');
  const iconEl = document.getElementById('early-log-icon');
  const titleEl = document.getElementById('early-log-title');
  const txtEl = document.getElementById('early-log-msg-text');
  const btnConfirm = document.getElementById('btn-confirm-early-log');
  const btnCancel = document.getElementById('btn-cancel-early-log');

  if (!modal) {
    onConfirmCallback();
    return;
  }

  if (iconEl) iconEl.textContent = icon || '⏰';
  if (titleEl) titleEl.textContent = title || 'Early Log Alert';
  if (txtEl) txtEl.textContent = msgText;
  modal.classList.add('active');

  const cleanup = () => {
    modal.classList.remove('active');
    btnConfirm.removeEventListener('click', handleConfirm);
    btnCancel.removeEventListener('click', handleCancel);
  };

  const handleConfirm = () => {
    setTimeout(() => {
      cleanup();
      onConfirmCallback();
    }, 220);
  };

  const handleCancel = () => {
    setTimeout(() => {
      cleanup();
    }, 220);
  };

  btnConfirm.addEventListener('click', handleConfirm);
  btnCancel.addEventListener('click', handleCancel);
}

function updatePopupHeaderTitle(reminders, settings) {
  const sectionTitleEl = document.getElementById('popup-section-title') || document.querySelector('.section-title');
  if (!sectionTitleEl) return;

  const health = settings?.healthSettings || {};
  const period = settings?.periodTracker || {};
  const meds = health.medications || [];

  const isHealthEnabled = 
    health.waterEnabled !== false ||
    health.eyeRestEnabled !== false ||
    health.postureEnabled !== false ||
    !!period.trackingEnabled ||
    meds.length > 0 ||
    reminders.some(r => r.enabled && (r.category === 'health' || r.category === 'water' || r.category === 'medicine' || r.id.startsWith('auto_health_') || r.id.startsWith('med_rem_')));

  sectionTitleEl.textContent = isHealthEnabled ? 'Reminders & Health' : 'Reminders';
}

function renderRemindersList(reminders, settings, stats) {
  const container = document.getElementById('reminders-list-container');
  if (!container) return;

  updatePopupHeaderTitle(reminders, settings);
  
  container.innerHTML = '';
  
  const isWaterEnabled = settings?.healthSettings?.waterEnabled !== false;
  const isEyeEnabled = settings?.healthSettings?.eyeRestEnabled !== false;
  const isPostureEnabled = settings?.healthSettings?.postureEnabled !== false;
  const isPeriodEnabled = !!settings?.periodTracker?.trackingEnabled;
  const meds = settings?.healthSettings?.medications || [];

  const showHealthCard = (currentCategoryFilter === 'all' || currentCategoryFilter === 'health') && (currentTimeFilter === 'all' || currentTimeFilter === 'today');

  // Filter active reminders based on settings & active category/time filters
  let activeReminders = reminders.filter(r => {
    if (!r.enabled) return false;
    if (r.id === 'auto_health_water' || r.category === 'water') return isWaterEnabled;
    if (r.id === 'auto_health_eye' || r.category === 'eye') return isEyeEnabled;
    if (r.id === 'auto_health_posture' || r.category === 'posture') return isPostureEnabled;
function parseLocalDate(dateStr) {
  if (!dateStr) return new Date();
  const parts = String(dateStr).split('-');
  if (parts.length === 3) {
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return d;
}

    if (r.id === 'auto_period_reminder' || r.isPeriodReminder || r.category === 'period') {
      if (!isPeriodEnabled) return false;
      const pc = settings?.periodTracker || {};
      const profile = settings?.userProfile || {};
      if (profile.gender !== 'female' || !pc.trackingEnabled || !pc.lastPeriodDate) return false;
      const remindDays = pc.remindDaysBefore ?? 3;
      const cycleLength = pc.cycleLength || 28;
      const today = new Date(); today.setHours(0,0,0,0);
      const last = parseLocalDate(pc.lastPeriodDate);
      const daysSince = Math.floor((today - last) / 86400000);
      const cyclesSince = Math.floor(daysSince / cycleLength);
      const nextPeriod = new Date(last.getTime() + (cyclesSince + 1) * cycleLength * 86400000);
      const diffDays = Math.ceil((nextPeriod.getTime() - today.getTime()) / 86400000);
      if (diffDays > remindDays) return false;
      return true;
    }
    return true;
  });

  if (isWaterEnabled && showHealthCard && !activeReminders.some(r => r.id === 'auto_health_water' || r.category === 'water')) {
    const waterMins = settings?.healthSettings?.waterIntervalMinutes || settings?.waterIntervalMinutes || 60;
    const nextWaterRem = reminders.find(r => r.category === 'water' || r.id === 'auto_health_water');
    const waterTime = (nextWaterRem && nextWaterRem.time) ? nextWaterRem.time : Date.now() + waterMins * 60 * 1000;
    activeReminders.push({
      id: 'auto_health_water',
      title: '💧 Hydration Break - Drink Water',
      category: 'water',
      priority: 'medium',
      time: waterTime,
      enabled: true
    });
  }

  if (currentTimeFilter !== 'all') {
    activeReminders = activeReminders.filter(rem => matchesTimeFilter(rem, currentTimeFilter));
  }

  if (currentCategoryFilter !== 'all') {
    activeReminders = activeReminders.filter(rem => {
      if (currentCategoryFilter === 'health') {
        return rem.category === 'health' || rem.category === 'water' || rem.category === 'medicine' || rem.id.startsWith('auto_health_') || rem.id.startsWith('med_rem_');
      } else if (currentCategoryFilter === 'custom') {
        const standardCats = ['workout', 'study', 'meetings', 'reading', 'break', 'sleep', 'water', 'medicine', 'health'];
        return !standardCats.includes(rem.category) && !rem.id.startsWith('auto_health_') && !rem.id.startsWith('med_rem_');
      } else {
        return rem.category === currentCategoryFilter;
      }
    });
  }

  // Sort by upcoming scheduled time (earliest first: 1 min before 3 min)
  // Tie-breaker: If exact same time, sort by Priority descending (CRITICAL > HIGH > MEDIUM > LOW)
  const PRIO_WEIGHTS = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  activeReminders.sort((a, b) => {
    const timeA = a.time || 0;
    const timeB = b.time || 0;
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    const pA = PRIO_WEIGHTS[a.priority?.toUpperCase()] || 2;
    const pB = PRIO_WEIGHTS[b.priority?.toUpperCase()] || 2;
    return pB - pA;
  });

  const hasAnyItems = activeReminders.length > 0;

  if (!hasAnyItems) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const isFiltered = currentCategoryFilter !== 'all' || currentTimeFilter !== 'today';
    
    let filterMsg = 'No active reminders scheduled for today.';
    if (isFiltered) {
      const parts = [];
      if (currentTimeFilter !== 'today') parts.push(currentTimeFilter);
      if (currentCategoryFilter !== 'all') parts.push(currentCategoryFilter);
      filterMsg = `No reminders found matching filter (${parts.join(' & ')}).`;
    }

    empty.innerHTML = `
      <div class="empty-icon">${isFiltered ? '🔍' : '✨'}</div>
      <div>${filterMsg}</div>
      ${isFiltered ? `<button class="btn btn-secondary btn-sm" id="btn-clear-filter-empty" style="margin-top: 8px; font-size: 0.75rem;">Clear Filters</button>` : ''}
    `;
    container.appendChild(empty);
    if (isFiltered) {
      document.getElementById('btn-clear-filter-empty')?.addEventListener('click', () => {
        resetFilters();
      });
    }
    return;
  }

  activeReminders.forEach(rem => {
    const cat = getCategoryDetails(rem.category, popCustomCategories);
    const prio = PRIORITIES[rem.priority?.toUpperCase()] || PRIORITIES.MEDIUM;
    const cleanTitle = rem.title ? rem.title.replace(/^💊\s*/, '') : '';
    const snoozeMins = settings?.defaultSnoozeMinutes || 10;
    const snoozeLabel = snoozeMins >= 60 ? (snoozeMins / 60) + 'h' : snoozeMins + 'm';
    // For period reminders: smart contextual "Remind in X days" instead of generic snooze
    const isPeriodRem = rem.isPeriodReminder || rem.category === 'period';
    const periodDaysLeft = isPeriodRem ? Math.max(1, Math.ceil((rem.time - Date.now()) / (1000 * 60 * 60 * 24))) : 0;
    const periodRemindInDays = Math.max(1, Math.floor(periodDaysLeft / 2));
    const periodRemindLabel = periodRemindInDays === 1 ? 'Remind Tomorrow 📅' : `Remind in ${periodRemindInDays}d 📅`;
    const snoozeBtnHtml = isPeriodRem
      ? `<button class="btn btn-secondary btn-sm btn-snooze-action" data-id="${rem.id}" data-period-remind-days="${periodRemindInDays}" title="Remind Later" style="padding: 2px 6px; font-size: 0.7rem; width: 100%; border-color: #ec489955;">${periodRemindLabel}</button>`
      : `<button class="btn btn-secondary btn-sm btn-snooze-action" data-id="${rem.id}" title="Snooze" style="padding: 2px 6px; font-size: 0.725rem; width: 100%;">⏰ ${snoozeLabel}</button>`;

    // Dynamic Water Tracker Card
    if (rem.id === 'auto_health_water' || rem.category === 'water') {
      if (!isWaterEnabled || !showHealthCard) return;

      const waterGlasses = stats?.waterGlasses || 0;
      const waterGoal = settings?.healthSettings?.waterGoal || settings?.waterGoalGlasses || 8;
      const isCompleted = waterGlasses >= waterGoal;

      const countText = isCompleted 
        ? `<span style="color: #10b981; font-weight: 700;">🎉 ${waterGlasses} / ${waterGoal} (Goal Met!)</span>`
        : `${waterGlasses} / ${waterGoal} Glasses`;

      const pct = isCompleted ? 100 : Math.min(100, Math.round((waterGlasses / waterGoal) * 100));
      const fillBg = isCompleted ? 'background: linear-gradient(90deg, #10b981, #06b6d4);' : '';

      const unlogStyle = waterGlasses > 0 ? '' : 'display: none;';
      const logStyle = isCompleted ? 'display: none;' : '';

      const item = document.createElement('div');
      item.className = 'glass-card water-widget';
      item.innerHTML = `
        <div class="water-info">
          <span class="water-icon">💧</span>
          <div>
            <div style="font-size: 0.825rem; font-weight: 700;">Water Tracker</div>
            <div style="font-size: 0.725rem; color: var(--text-secondary);" id="water-count-label">${countText}</div>
            <div class="water-progress-bar">
              <div class="water-progress-fill" id="water-progress-fill" style="width: ${pct}%; ${fillBg}"></div>
            </div>
            <div style="font-size: 0.7rem; color: var(--text-secondary); margin-top: 4px;" id="popup-next-water-info">⏰ Next Water: <strong id="popup-next-water-time" style="color: #38bdf8;" class="live-countdown" data-timestamp="${rem.time}">${formatRelativeTime(rem.time)}</strong></div>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px; align-items: stretch; justify-content: center;">
          <div style="display: flex; gap: 4px; align-items: center; justify-content: flex-end;">
            <button class="btn btn-ghost btn-sm" id="btn-unlog-water" title="Undo / -1 Glass" style="padding: 2px 6px; font-size: 0.75rem; border: 1px solid var(--border); ${unlogStyle}">-1</button>
            <button class="btn btn-secondary btn-sm" id="btn-log-water" style="padding: 3px 8px; font-size: 0.75rem; ${logStyle}">+1 Glass</button>
          </div>
          <button class="btn btn-secondary btn-sm btn-snooze-action" id="btn-snooze-water" data-id="auto_health_water" title="Snooze" style="padding: 2px 6px; font-size: 0.725rem; width: 100%;">⏰ ${snoozeLabel}</button>
        </div>
      `;
      container.appendChild(item);

      const btnLog = item.querySelector('#btn-log-water');
      if (btnLog) btnLog.onclick = handleLogWaterClick;
      const btnUnlog = item.querySelector('#btn-unlog-water');
      if (btnUnlog) btnUnlog.onclick = unlogWater;
      return;
    }

    // Special Health Hub Item UI
    if (rem.id === 'auto_health_eye') {
      const item = document.createElement('div');
      item.className = 'glass-card water-widget';
      item.innerHTML = `
        <div class="water-info">
          <span class="water-icon">👀</span>
          <div>
            <div style="font-size: 0.825rem; font-weight: 700;">Eye Rest</div>
            <div style="font-size: 0.725rem; color: var(--text-secondary);">Look 20ft away for 20 seconds 👀</div>
            <div style="font-size: 0.7rem; color: var(--text-secondary); margin-top: 4px;">⏰ Next Eye Rest: <strong style="color: #38bdf8;" class="live-countdown" data-timestamp="${rem.time}">${formatRelativeTime(rem.time)}</strong></div>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end; justify-content: center; min-width: 62px;">
          <button class="btn btn-secondary btn-sm btn-done-action" data-id="${rem.id}" style="padding: 2px 8px; font-size: 0.75rem; width: 100%;">Done ✓</button>
          ${snoozeBtnHtml}
        </div>
      `;
      container.appendChild(item);
      return;
    }

    if (rem.id === 'auto_health_posture') {
      const item = document.createElement('div');
      item.className = 'glass-card water-widget';
      item.innerHTML = `
        <div class="water-info">
          <span class="water-icon">🧍</span>
          <div>
            <div style="font-size: 0.825rem; font-weight: 700;">Posture & Stretch Break</div>
            <div style="font-size: 0.725rem; color: var(--text-secondary);">Adjust posture & stretch back</div>
            <div style="font-size: 0.7rem; color: var(--text-secondary); margin-top: 4px;">⏰ Next Posture Check: <strong style="color: #38bdf8;" class="live-countdown" data-timestamp="${rem.time}">${formatRelativeTime(rem.time)}</strong></div>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end; justify-content: center; min-width: 62px;">
          <button class="btn btn-secondary btn-sm btn-done-action" data-id="${rem.id}" style="padding: 2px 8px; font-size: 0.75rem; width: 100%;">Done ✓</button>
          ${snoozeBtnHtml}
        </div>
      `;
      container.appendChild(item);
      return;
    }

    if (rem.category === 'medicine' || rem.id.startsWith('med_rem_')) {
      const medId = rem.id.replace('med_rem_', '');
      const med = meds.find(m => m.id === medId || rem.id.includes(m.id));
      const taken = med ? (med.takenTodayCount || 0) : 0;
      const total = med ? (med.doseCount || 1) : 1;
      const isGoalMet = taken >= total;
      const countText = isGoalMet 
        ? `<span style="color: #10b981; font-weight: 700;">🎉 Doses: ${taken} / ${total} (Goal Met!)</span>`
        : `Doses Taken: <strong style="color: #ec4899;">${taken} / ${total}</strong>`;

      const unlogStyle = taken > 0 ? '' : 'display: none;';
      const logStyle = taken < total ? '' : 'display: none;';

      const item = document.createElement('div');
      item.className = 'glass-card water-widget';
      item.innerHTML = `
        <div class="water-info">
          <span class="water-icon">💊</span>
          <div>
            <div style="font-size: 0.825rem; font-weight: 700;">${escapeHTML(cleanTitle)}</div>
            <div style="font-size: 0.725rem; color: var(--text-secondary);">${countText}</div>
            <div style="font-size: 0.7rem; color: var(--text-secondary); margin-top: 4px;">⏰ Next Dose: <strong style="color: #38bdf8;" class="live-countdown" data-timestamp="${rem.time}">${formatRelativeTime(rem.time)}</strong></div>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px; align-items: stretch; justify-content: center;">
          ${med ? `
            <div style="display: flex; gap: 4px; align-items: center; justify-content: flex-end; width: 100%;">
              <button class="btn btn-ghost btn-sm med-pop-unlog-btn" data-medid="${med.id}" title="Undo Dose (-1)" style="padding: 2px 6px; font-size: 0.75rem; border: 1px solid var(--border); ${unlogStyle}">-1</button>
              <button class="btn btn-secondary btn-sm med-pop-log-btn" data-medid="${med.id}" style="padding: 2px 8px; font-size: 0.75rem; ${logStyle}">+1 Dose</button>
            </div>
          ` : `<button class="btn btn-secondary btn-sm btn-done-action" data-id="${rem.id}" style="padding: 2px 8px; font-size: 0.75rem; width: 100%;">Done ✓</button>`}
          ${snoozeBtnHtml}
        </div>
      `;
      container.appendChild(item);
      return;
    }

    // Standard Custom Reminder Card
    const isPeriodCard = rem.isPeriodReminder || rem.category === 'period' || rem.id === 'auto_period_reminder';
    const doneBtnHtml = `<button class="btn btn-secondary btn-sm btn-done-action" data-id="${rem.id}" style="padding: 6px 12px; font-size: 0.775rem; width: 100%;">${isPeriodCard ? 'Got It 👍' : 'Done ✓'}</button>`;

    const item = document.createElement('div');
    item.className = 'glass-card reminder-item';
    item.style.flexDirection = 'column';
    item.style.alignItems = 'stretch';

    item.innerHTML = isPeriodCard ? `
      <div class="reminder-main">
        <div class="reminder-icon">${cat.icon}</div>
        <div class="reminder-details">
          <div class="reminder-item-title">${escapeHTML(cleanTitle)}</div>
          <div class="reminder-item-meta" style="font-size: 0.7rem; color: var(--text-secondary); margin-top: 2px;">
            ⏰ Next Reminder: <strong style="color: #38bdf8;" class="live-countdown" data-timestamp="${rem.time}">${formatRelativeTime(rem.time)}</strong>
          </div>
        </div>
      </div>
      <div style="margin-top: 10px;">
        ${doneBtnHtml}
      </div>
    ` : `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <div class="reminder-main">
          <div class="reminder-icon">${cat.icon}</div>
          <div class="reminder-details">
            <div class="reminder-item-title">${escapeHTML(cleanTitle)}</div>
            <div class="reminder-item-meta" style="font-size: 0.7rem; color: var(--text-secondary); margin-top: 2px;">
              ⏰ Next Reminder: <strong style="color: #38bdf8;" class="live-countdown" data-timestamp="${rem.time}">${formatRelativeTime(rem.time)}</strong>
            </div>
          </div>
        </div>
        <div class="reminder-quick-actions" style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end; justify-content: center; min-width: 62px;">
          ${doneBtnHtml}
          ${snoozeBtnHtml}
        </div>
      </div>
    `;

    container.appendChild(item);
  });

  // Action listeners
  container.querySelectorAll('.med-pop-log-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const medId = e.currentTarget.dataset.medid;
      const rem = activeReminders.find(r => r.category === 'medicine');
      const executeLog = () => {
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({ action: 'LOG_MED_DOSE', id: medId }, async () => {
            await refreshUI();
          });
        }
      };

      if (rem && rem.time > Date.now() + 10 * 60 * 1000) {
        promptEarlyLogConfirm(
          '💊',
          'Medication Check',
          `You are logging this medicine earlier than scheduled (${formatRelativeTime(rem.time)}). Did you take it early or forget to log earlier?`,
          executeLog
        );
      } else {
        executeLog();
      }
    });
  });

  container.querySelectorAll('.med-pop-unlog-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const medId = e.currentTarget.dataset.medid;
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({ action: 'DECREMENT_MED_DOSE', id: medId }, async () => {
          await refreshUI();
        });
      }
    });
  });

  container.querySelectorAll('.btn-done-action').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;

      if (id === 'auto_health_eye') {
        promptEarlyLogConfirm(
          '👀',
          'Eye Rest Check! 😜',
          "20 seconds haven't passed yet! 😄 Did you really look 20 feet away for 20 full seconds, or are you rushing? Give your eyes a real rest!",
          () => {
            if (typeof chrome !== 'undefined' && chrome.runtime) {
              chrome.runtime.sendMessage({ action: 'MARK_DONE', id: id }, async () => {
                await refreshUI();
              });
            }
          }
        );
        return;
      }

      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({ action: 'MARK_DONE', id: id }, async () => {
          await refreshUI();
        });
      }
    });
  });

  container.querySelectorAll('.btn-snooze-action').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      const periodRemindDays = e.currentTarget.dataset.periodRemindDays;
      const minutes = periodRemindDays
        ? parseInt(periodRemindDays, 10) * 24 * 60  // smart remind-later for period
        : (settings?.defaultSnoozeMinutes || 10);
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({ action: 'SNOOZE_REMINDER', id: id, minutes }, async () => {
          await refreshUI();
        });
      }
    });
  });
}

async function populateQuickAddCategories() {
  popCustomCategories = await storage.getCustomCategories();
  const selectElem = document.getElementById('new-rem-category');
  const filterCatElem = document.getElementById('filter-select-category');

  if (selectElem) {
    const defaultOptions = [
      { value: 'workout', label: '🏋️ Workout' },
      { value: 'study', label: '📚 Study' },
      { value: 'meetings', label: '📅 Meetings' },
      { value: 'reading', label: '📖 Reading' },
      { value: 'break', label: '☕ Break' },
      { value: 'sleep', label: '🌙 Sleep' }
    ];

    const currentVal = selectElem.value;
    let html = `<option value="" disabled ${!currentVal ? 'selected' : ''}>Select Category</option>`;
    html += defaultOptions.map(o => `<option value="${o.value}">${o.label}</option>`).join('');

    popCustomCategories.forEach(c => {
      html += `<option value="${c.id}">${c.icon ? c.icon + ' ' : ''}${escapeHTML(c.label)}</option>`;
    });

    html += `<option value="new_custom">Other...</option>`;
    selectElem.innerHTML = html;
    if (currentVal && selectElem.querySelector(`option[value="${currentVal}"]`)) {
      selectElem.value = currentVal;
    } else if (!currentVal) {
      selectElem.value = '';
    }
  }

  if (filterCatElem) {
    const currentFilterVal = filterCatElem.value || 'all';
    const defaultFilterOptions = [
      { value: 'all', label: 'All Categories' },
      { value: 'health', label: '🩺 Health Hub' },
      { value: 'workout', label: '🏋️ Workout' },
      { value: 'study', label: '📚 Study' },
      { value: 'meetings', label: '📅 Meetings' },
      { value: 'reading', label: '📖 Reading' },
      { value: 'break', label: '☕ Break' },
      { value: 'sleep', label: '🌙 Sleep' },
      { value: 'custom', label: 'Custom' }
    ];

    let filterHtml = defaultFilterOptions.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    popCustomCategories.forEach(c => {
      filterHtml += `<option value="${c.id}">${c.icon ? c.icon + ' ' : ''}${escapeHTML(c.label)}</option>`;
    });
    filterCatElem.innerHTML = filterHtml;
    if (currentFilterVal && filterCatElem.querySelector(`option[value="${currentFilterVal}"]`)) {
      filterCatElem.value = currentFilterVal;
    }
  }
}

function showToast(message, type = 'success', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || '🔔'}</span>
    <span class="toast-msg" style="flex: 1;">${message}</span>
    <button class="toast-close" style="background: none; border: none; color: inherit; cursor: pointer; opacity: 0.8; font-size: 0.8rem;">✕</button>
  `;

  const dismiss = () => {
    toast.classList.add('toast-hiding');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };

  toast.querySelector('.toast-close').addEventListener('click', dismiss);
  container.appendChild(toast);
  if (duration > 0) setTimeout(dismiss, duration);
}

function highlightPopFieldError(inputElem, message) {
  if (!inputElem) return;
  showToast(message, 'error');
  inputElem.focus();
  inputElem.style.borderColor = '#ef4444';
  inputElem.style.boxShadow = '0 0 0 2px rgba(239, 68, 68, 0.3)';
  setTimeout(() => {
    inputElem.style.borderColor = '';
    inputElem.style.boxShadow = '';
  }, 3500);
}

async function saveNewReminder() {
  // 1. Title Validation (Required)
  const titleInput = document.getElementById('new-rem-title');
  const title = titleInput ? titleInput.value.trim() : '';

  if (!title) {
    highlightPopFieldError(titleInput, 'Reminder title is required!');
    return;
  }

  // 2. Schedule & Repeat Validation (Required fields based on pattern)
  const repeat = document.getElementById('new-rem-repeat').value;
  let scheduledTimestamp = Date.now() + 15 * 60 * 1000;
  let repeatInterval = 1;

  if (repeat === 'once') {
    const dateInput = document.getElementById('new-rem-date');
    const timeInput = document.getElementById('new-rem-time');
    const dateVal = dateInput?.value;
    const timeVal = timeInput?.value;

    if (!dateVal) {
      highlightPopFieldError(dateInput, 'Please select a date for your reminder!');
      return;
    }
    if (!timeVal) {
      highlightPopFieldError(timeInput, 'Please select a time for your reminder!');
      return;
    }

    scheduledTimestamp = parseDateTime(dateVal, timeVal);
    if (isNaN(scheduledTimestamp) || scheduledTimestamp <= Date.now() - 30000) {
      const todayStr = toInputDate();
      if (dateVal < todayStr) {
        highlightPopFieldError(dateInput, 'The selected date is in the past! Please choose today or a future date.');
      } else {
        highlightPopFieldError(timeInput, 'The selected time has already passed! Please choose a future time.');
      }
      return;
    }
  } else if (repeat === 'daily') {
    const timeInput = document.getElementById('new-rem-time');
    const timeVal = timeInput?.value;
    if (!timeVal) {
      highlightPopFieldError(timeInput, 'Please select a time for your daily reminder!');
      return;
    }
    const todayDate = toInputDate();
    let ts = parseDateTime(todayDate, timeVal);
    if (ts <= Date.now()) {
      ts += 24 * 3600 * 1000;
    }
    scheduledTimestamp = ts;
  } else if (repeat === 'weekly') {
    const timeInput = document.getElementById('new-rem-time');
    const dateInput = document.getElementById('new-rem-date');
    const timeVal = timeInput?.value;
    const dateVal = dateInput?.value || toInputDate();
    if (!timeVal) {
      highlightPopFieldError(timeInput, 'Please select a time for your weekly reminder!');
      return;
    }
    let ts = parseDateTime(dateVal, timeVal);
    while (ts <= Date.now()) {
      ts += 7 * 24 * 3600 * 1000;
    }
    scheduledTimestamp = ts;
  } else if (repeat === 'monthly') {
    const timeInput = document.getElementById('new-rem-time');
    const dateInput = document.getElementById('new-rem-date');
    const timeVal = timeInput?.value;
    const dateVal = dateInput?.value || toInputDate();
    if (!timeVal) {
      highlightPopFieldError(timeInput, 'Please select a time for your monthly reminder!');
      return;
    }
    let ts = parseDateTime(dateVal, timeVal);
    if (ts <= Date.now()) {
      const d = new Date(ts);
      d.setMonth(d.getMonth() + 1);
      ts = d.getTime();
    }
    scheduledTimestamp = ts;
  } else if (repeat === 'every_x_minutes') {
    const intervalInput = document.getElementById('new-rem-interval');
    const intervalMins = parseInt(intervalInput?.value, 10);
    if (!intervalInput?.value || isNaN(intervalMins) || intervalMins < 1) {
      highlightPopFieldError(intervalInput, 'Please enter a valid interval in minutes (min 1)!');
      return;
    }
    repeatInterval = intervalMins;
    scheduledTimestamp = Date.now() + intervalMins * 60 * 1000;
  } else if (repeat === 'every_x_hours') {
    const intervalInput = document.getElementById('new-rem-interval');
    const intervalHrs = parseInt(intervalInput?.value, 10);
    if (!intervalInput?.value || isNaN(intervalHrs) || intervalHrs < 1) {
      highlightPopFieldError(intervalInput, 'Please enter a valid interval in hours (min 1)!');
      return;
    }
    repeatInterval = intervalHrs;
    scheduledTimestamp = Date.now() + intervalHrs * 3600 * 1000;
  }

  const catInput = document.getElementById('new-rem-category');
  let category = catInput ? catInput.value : '';
  if (!category) {
    highlightPopFieldError(catInput, 'Please select a category!');
    return;
  }

  const customName = document.getElementById('new-rem-custom-name')?.value.trim();
  const customEmoji = document.getElementById('new-rem-custom-emoji')?.value.trim() || '';

  if (category === 'new_custom' || customName || customEmoji) {
    const finalLabel = customName || 'General';
    const finalEmoji = customEmoji ? (Array.from(customEmoji)[0] || '🔔') : '🔔';
    const savedCat = await storage.saveCustomCategory({ label: finalLabel, icon: finalEmoji });
    if (savedCat) {
      category = savedCat.id;
    }
    await populateQuickAddCategories();
  }

  const priority = document.getElementById('new-rem-priority').value;
  const notesInput = document.getElementById('new-rem-notes');
  const notes = notesInput ? notesInput.value.trim() : '';

  const newRem = {
    id: generateId(),
    title: title,
    description: notes || `Scheduled via Quick Add`,
    notes: notes,
    category: category,
    priority: priority,
    repeat: repeat,
    repeatInterval: repeatInterval,
    time: scheduledTimestamp,
    enabled: true,
    completedCount: 0,
    createdAt: Date.now()
  };

  const reminders = await storage.getReminders();
  reminders.push(newRem);
  await storage.saveReminders(reminders);

  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage({ action: 'REFRESH_ALARMS' });
  }

  if (titleInput) titleInput.value = '';
  if (notesInput) notesInput.value = '';
  if (catInput) catInput.value = '';
  document.getElementById('quick-add-modal').classList.remove('active');
  showToast('Reminder saved successfully! 🎉', 'success');
  await refreshUI();
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// Global storage listener to keep popup UI synchronized in real-time
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && (changes.reminderly_daily_stats || changes.reminderly_settings || changes.reminderly_reminder_daily_progress)) {
      refreshUI();
    }
  });
}

/**
 * Calculate per-reminder completion % and return the average across all active reminders.
 * - Water: waterGlasses / waterGoal
 * - Medicine: takenTodayCount / doseCount
 * - Recurring (eye/posture/custom): completedToday / expectedTriggers (based on elapsed hours since midnight)
 * - One-time: 0% pending, 100% if done (disabled)
 */
async function calculateAverageCompletion(reminders, stats, settings) {
  const progress = await storage.getReminderDailyProgress();
  const health = settings.healthSettings || {};
  const waterGoal = health.waterGoal || settings.waterGoalGlasses || 8;
  const meds = health.medications || [];

  // Hours elapsed since midnight, minimum 1 to avoid division by zero
  const now = new Date();
  const midnightMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const elapsedMinutes = Math.max(1, (Date.now() - midnightMs) / 60000);

  const percentages = [];

  const activeReminders = reminders.filter(r => r.enabled !== false);

  for (const rem of activeReminders) {
    // Water — use waterGlasses / waterGoal
    if (rem.id === 'auto_health_water' || (rem.category === 'water' && rem.id.startsWith('auto_health_'))) {
      const pct = Math.min(100, ((stats.waterGlasses || 0) / waterGoal) * 100);
      percentages.push(pct);
      continue;
    }

    // Medicine — use takenTodayCount / doseCount
    if (rem.category === 'medicine' || rem.id.startsWith('med_rem_')) {
      const medId = rem.id.replace('med_rem_', '');
      const med = meds.find(m => m.id === medId || rem.id.includes(m.id));
      if (med) {
        const taken = med.takenTodayCount || 0;
        const total = med.doseCount || 1;
        const pct = Math.min(100, (taken / total) * 100);
        percentages.push(pct);
      }
      continue;
    }

    // Recurring reminders — completedToday / expectedTriggers
    if (rem.repeat && rem.repeat !== 'once') {
      const completedToday = progress[rem.id] || 0;
      let intervalMinutes = 60; // default

      if (rem.repeat === 'every_x_minutes') {
        intervalMinutes = rem.repeatInterval || 20;
      } else if (rem.repeat === 'every_x_hours') {
        intervalMinutes = (rem.repeatInterval || 1) * 60;
      } else if (rem.repeat === 'daily') {
        // Daily = 1 per day, expected = 1
        const pct = Math.min(100, completedToday >= 1 ? 100 : 0);
        percentages.push(pct);
        continue;
      } else {
        // weekly/monthly — treat as 1 expected per period
        const pct = completedToday >= 1 ? 100 : 0;
        percentages.push(pct);
        continue;
      }

      const expectedTriggers = Math.max(1, Math.floor(elapsedMinutes / intervalMinutes));
      const pct = Math.min(100, (completedToday / expectedTriggers) * 100);
      percentages.push(pct);
      continue;
    }

    // One-time reminders
    if (rem.repeat === 'once' || !rem.repeat) {
      // If disabled (completed), 100%. If still pending, 0%.
      const pct = rem.enabled === false ? 100 : 0;
      percentages.push(pct);
    }
  }

  if (percentages.length === 0) return 0;
  const avg = percentages.reduce((sum, p) => sum + p, 0) / percentages.length;
  return Math.min(100, Math.round(avg));
}

function renderCircularProgress() {}
