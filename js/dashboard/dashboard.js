/**
 * Reminderly Dashboard & Settings Logic
 */

import { storage, STORAGE_KEYS } from '../common/storage.js';
import { CATEGORIES, PRIORITIES } from '../common/constants.js';
import { getMascotSVG, MASCOT_EMOTIONS } from '../common/mascots.js';
import { soundEngine } from '../common/audio.js';
import { generateId, formatRelativeTime, toInputDate, toInputTime, parseDateTime, formatDate, getDateKeyOffset, getTodayKey, formatTime, getCategoryDetails } from '../common/utils.js';

let currentTheme = 'dark';
let activeRemindersList = [];
let userSettings = {};
let userCustomCategories = [];

function cleanReminderTitle(title) {
  if (!title) return '';
  return title.replace(/^([\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2300}-\u{23FF}]|[\u{2B50}]|[\u{200D}]|\uFE0F)+\s*/u, '');
}

function getExpectedLabel(rem, waterGoal = 8, meds = []) {
  if (rem.id === 'auto_health_water' || (rem.category === 'water' && rem.id.startsWith('auto_health_'))) {
    return `${waterGoal} glasses`;
  }
  if (rem.category === 'medicine' || rem.id.startsWith('med_rem_')) {
    const medId = rem.id.replace('med_rem_', '');
    const med = meds.find(m => m.id === medId || rem.id.includes(m.id));
    const count = med?.doseCount || 1;
    return `${count} dose${count > 1 ? 's' : ''}`;
  }
  if (rem.repeat === 'every_x_minutes') {
    const mins = rem.repeatInterval || 20;
    if (mins === 60) return 'Per hour';
    if (mins === 1) return 'Per minute';
    return `Per ${mins} mins`;
  }
  if (rem.repeat === 'every_x_hours') {
    const hrs = rem.repeatInterval || 1;
    if (hrs === 1) return 'Per hour';
    return `Per ${hrs} hours`;
  }
  if (rem.repeat === 'daily') return 'Per day';
  if (rem.repeat === 'weekly') return 'Per week';
  if (rem.repeat === 'monthly') return 'Per month';
  return '1 time';
}

function getScheduleLabel(rem) {
  const repeat = rem.repeat || 'once';
  const interval = rem.repeatInterval;
  switch (repeat) {
    case 'once':    return 'One-Time';
    case 'daily':   return 'Daily';
    case 'weekly':  return 'Weekly';
    case 'monthly': return 'Monthly';
    case 'every_x_minutes': {
      const m = interval || 20;
      return m === 60 ? 'Every 1 Hour' : `Every ${m} Min${m === 1 ? '' : 's'}`;
    }
    case 'every_x_hours': {
      const h = interval || 1;
      return `Every ${h} Hour${h === 1 ? '' : 's'}`;
    }
    default: return repeat;
  }
}

function safeSetHTML(el, newHTML) {
  if (!el) return;
  if (el.innerHTML !== newHTML) {
    el.innerHTML = newHTML;
  }
}

/* ===== Toast Notification System ===== */
/**
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {number} duration ms before auto-dismiss (0 = stay)
 */
function showToast(message, type = 'success', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) { console.log(`[Toast] ${message}`); return; }

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || '🔔'}</span>
    <span class="toast-msg">${message}</span>
    <button class="toast-close" title="Dismiss">✕</button>
  `;

  const dismiss = () => {
    toast.classList.add('toast-hiding');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };

  toast.querySelector('.toast-close').addEventListener('click', dismiss);
  container.appendChild(toast);
  if (duration > 0) setTimeout(dismiss, duration);
}



function applyTheme(themeSetting) {
  const pref = themeSetting || 'system';
  let effectiveTheme = pref;
  if (pref === 'system') {
    effectiveTheme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', effectiveTheme);
  document.body.setAttribute('data-theme', effectiveTheme);
}

if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (userSettings && (userSettings.theme === 'system' || !userSettings.theme)) {
      applyTheme('system');
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  applyTheme(userSettings.theme || 'system');
  initNavigation();
  initRemindersManager();
  initHealthHub();
  initArchiveManager();
  initMascotStudio();
  initContextBlocker();
  initSettingsAndBackup();
  initAnalyticsExportHandlers();
  await refreshActiveTab();

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('action') === 'new_reminder') {
    const btnNew = document.getElementById('btn-dash-new-reminder') || document.getElementById('btn-new-reminder');
    if (btnNew) setTimeout(() => btnNew.click(), 100);
  }

  setInterval(updateAllLiveCountdowns, 1000);

  // Auto re-render active tab dynamically when storage updates in background!
  let storageRefreshDebounce = null;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(() => {
      if (storageRefreshDebounce) clearTimeout(storageRefreshDebounce);
      storageRefreshDebounce = setTimeout(async () => {
        await refreshActiveTab();
      }, 150);
    });
  }
});

async function loadState() {
  userSettings = await storage.getSettings();
  activeRemindersList = await storage.getReminders();

  const health = userSettings.healthSettings || {};
  let needsSync = false;
  if (!activeRemindersList.some(r => r.id === 'auto_health_water')) needsSync = true;
  if (health.eyeRestEnabled !== false && !activeRemindersList.some(r => r.id === 'auto_health_eye')) needsSync = true;
  if (health.postureEnabled !== false && !activeRemindersList.some(r => r.id === 'auto_health_posture')) needsSync = true;

  if (needsSync) {
    await syncHealthReminders(health);
  } else {
    activeRemindersList.forEach(r => {
      if (r.id === 'auto_health_eye') r.category = 'eye';
      if (r.id === 'auto_health_posture') r.category = 'posture';
    });
  }

  userCustomCategories = await storage.getCustomCategories();
  currentTheme = userSettings.theme || 'system';
  applyTheme(currentTheme);
  await populateCategoryDropdowns();
}

async function populateCategoryDropdowns() {
  userCustomCategories = await storage.getCustomCategories();
  const selectElem = document.getElementById('edit-rem-category');
  const filterElem = document.getElementById('mgr-filter-category');

  const defaultOptions = [
    { value: 'workout', label: '🏋️ Workout' },
    { value: 'study', label: '📚 Study' },
    { value: 'meetings', label: '📅 Meetings' },
    { value: 'reading', label: '📖 Reading' },
    { value: 'break', label: '☕ Break' },
    { value: 'sleep', label: '🌙 Sleep' }
  ];

  if (selectElem) {
    const currentVal = selectElem.value;
    let html = defaultOptions.map(o => `<option value="${o.value}">${o.label}</option>`).join('');

    userCustomCategories.forEach(c => {
      html += `<option value="${c.id}">${c.icon ? c.icon + ' ' : ''}${escapeHTML(c.label)}</option>`;
    });

    html += `<option value="new_custom">Other...</option>`;
    selectElem.innerHTML = html;
    if (currentVal && selectElem.querySelector(`option[value="${currentVal}"]`)) {
      selectElem.value = currentVal;
    }
  }

  if (filterElem) {
    const currentFilter = filterElem.value;
    let html = `<option value="all">All Categories</option>` +
      defaultOptions.map(o => `<option value="${o.value}">${o.label}</option>`).join('');

    userCustomCategories.forEach(c => {
      html += `<option value="${c.id}">${c.icon ? c.icon + ' ' : ''}${escapeHTML(c.label)}</option>`;
    });
    filterElem.innerHTML = html;
    if (currentFilter && filterElem.querySelector(`option[value="${currentFilter}"]`)) {
      filterElem.value = currentFilter;
    }
  }

  // Archive filter - same categories as reminder manager
  const archiveFilterElem = document.getElementById('archive-filter-category');
  if (archiveFilterElem) {
    const currentArchiveFilter = archiveFilterElem.value;
    let html = `<option value="all">All Categories</option>` +
      defaultOptions.map(o => `<option value="${o.value}">${o.label}</option>`).join('');

    userCustomCategories.forEach(c => {
      html += `<option value="${c.id}">${c.icon ? c.icon + ' ' : ''}${escapeHTML(c.label)}</option>`;
    });
    archiveFilterElem.innerHTML = html;
    if (currentArchiveFilter && archiveFilterElem.querySelector(`option[value="${currentArchiveFilter}"]`)) {
      archiveFilterElem.value = currentArchiveFilter;
    }
  }
}

async function refreshActiveTab() {
  await loadState();
  const activeTab = document.querySelector('.nav-item.active')?.dataset.tab || 'tab-overview';
  if (activeTab === 'tab-overview') await renderOverview();
  if (activeTab === 'tab-reminders') {
    renderRemindersTable();
    await renderAnalytics();
  }
  if (activeTab === 'tab-mascot') renderMascotState();
  if (activeTab === 'tab-context') {
    renderContextState();
    renderDomainLists();
  }
  if (activeTab === 'tab-health') await renderHealthHub();
  if (activeTab === 'tab-archive') renderArchiveTable();
}

function switchTab(targetTabId) {
  if (!targetTabId) return;

  const navItems = document.querySelectorAll('.nav-item');
  const panels = document.querySelectorAll('.tab-panel');

  const targetItem = document.querySelector(`.nav-item[data-tab="${targetTabId}"]`);
  const targetPanel = document.getElementById(targetTabId);

  if (targetItem && targetPanel) {
    navItems.forEach(i => i.classList.remove('active'));
    panels.forEach(p => p.classList.remove('active'));

    targetItem.classList.add('active');
    targetPanel.classList.add('active');

    if (window.location.hash !== `#${targetTabId}`) {
      history.replaceState(null, '', `#${targetTabId}`);
    }
    try {
      localStorage.setItem('reminderly_active_tab', targetTabId);
    } catch (e) {}
  }
}

/* --- SIDEBAR TAB NAVIGATION --- */
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');

  navItems.forEach(item => {
    item.addEventListener('click', async () => {
      const targetTab = item.dataset.tab;
      switchTab(targetTab);
      await refreshActiveTab();
    });
  });

  // Restore active tab on load/refresh from early resolved initial active tab, URL hash, or localStorage!
  const savedTab = window.__initialActiveTab || (window.location.hash ? window.location.hash.replace('#', '') : null) || (typeof localStorage !== 'undefined' ? localStorage.getItem('reminderly_active_tab') : null) || 'tab-overview';
  switchTab(savedTab);
}

async function renderUsageTimeline() {
  const installDate = await storage.getInstallDate();
  const installDateStr = formatDate(installDate);
  const daysActive = Math.max(1, Math.ceil((Date.now() - installDate) / (1000 * 60 * 60 * 24)));
  const todayStats = await storage.getDailyStats();

  const installDateEl = document.getElementById('analytics-install-date');
  const daysActiveEl = document.getElementById('analytics-days-active');
  const streakValEl = document.getElementById('analytics-streak-val');

  if (installDateEl) installDateEl.textContent = installDateStr;
  if (daysActiveEl) daysActiveEl.textContent = `${daysActive} Day${daysActive > 1 ? 's' : ''}`;
  if (streakValEl) streakValEl.textContent = `${todayStats.streakDays || 1} Day${(todayStats.streakDays || 1) > 1 ? 's' : ''} 🔥`;
}

/* --- TAB 1: OVERVIEW --- */
async function renderOverview() {
  const stats = await storage.getDailyStats();
  const scoreEl = document.getElementById('sidebar-score-val');
  if (scoreEl) scoreEl.style.display = 'none';
  const kpiDone = document.getElementById('dash-kpi-done');
  if (kpiDone) kpiDone.textContent = stats.completedCount || 0;
  document.getElementById('dash-kpi-streak').textContent = `${stats.streakDays || 1} Days 🔥`;
  document.getElementById('dash-kpi-focus').textContent = `${stats.focusMinutesToday || 0} Min`;
  
  const waterGoal = userSettings.healthSettings?.waterGoal || userSettings.waterGoalGlasses || 8;
  const currentWater = stats.waterGlasses || 0;
  const waterKpi = document.getElementById('dash-kpi-water');
  if (waterKpi) {
    if (currentWater >= waterGoal) {
      waterKpi.innerHTML = `<span style="color: #10b981;">🎉 ${currentWater}/${waterGoal}</span>`;
    } else {
      waterKpi.textContent = `${currentWater} / ${waterGoal}`;
    }
  }

  await renderUsageTimeline();
  await updateDashboardFocusWidget();
  await renderPerReminderBreakdown();
}

let dashFocusInterval = null;

async function updateDashboardFocusWidget() {
  const statusLabel = document.getElementById('dash-focus-status-label');
  const desc = document.getElementById('dash-focus-desc');
  const clock = document.getElementById('dash-focus-timer-clock');
  const controlsBox = document.getElementById('dash-focus-controls');
  if (!statusLabel || !controlsBox) return;

  const focusState = await storage.getFocusState();

  if (dashFocusInterval) clearInterval(dashFocusInterval);

  if (focusState && focusState.active) {
    if (focusState.paused) {
      statusLabel.textContent = `⏸️ Focus Paused (${focusState.durationMinutes}m)`;
      if (desc) desc.textContent = 'Timer is paused. Click Resume to continue your session.';

      const remainingMs = focusState.remainingMs || 0;
      const totalSec = Math.floor(remainingMs / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

      controlsBox.innerHTML = `
        <span style="font-size: 1.4rem; font-family: var(--font-display); font-weight: 700; color: #f59e0b;">${timeStr}</span>
        <button class="btn btn-primary btn-sm" id="btn-dash-resume-focus">▶ Resume</button>
        <button class="btn btn-danger btn-sm" id="btn-dash-stop-focus">Stop</button>
      `;
      document.getElementById('btn-dash-resume-focus')?.addEventListener('click', async () => {
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({ action: 'RESUME_FOCUS_MODE' }, async () => {
            await updateDashboardFocusWidget();
            renderOverview();
          });
        }
      });
      document.getElementById('btn-dash-stop-focus')?.addEventListener('click', async () => {
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({ action: 'STOP_FOCUS_MODE' }, async () => {
            await updateDashboardFocusWidget();
            renderOverview();
          });
        }
      });

    } else if (focusState.endTime) {
      statusLabel.textContent = `🧠 Focus Mode Active (${focusState.durationMinutes}m)`;
      if (desc) desc.textContent = 'Silence non-critical distractions while in deep work flow.';

      controlsBox.innerHTML = `
        <span style="font-size: 1.4rem; font-family: var(--font-display); font-weight: 700; color: #10b981;" id="dash-focus-timer-clock">--:--</span>
        <button class="btn btn-secondary btn-sm" id="btn-dash-pause-focus">⏸ Pause</button>
        <button class="btn btn-danger btn-sm" id="btn-dash-stop-focus">Stop</button>
      `;

      const tick = () => {
        const remainingMs = focusState.endTime - Date.now();
        if (remainingMs <= 0) {
          clearInterval(dashFocusInterval);
          updateDashboardFocusWidget();
          renderOverview();
          return;
        }
        const totalSec = Math.floor(remainingMs / 1000);
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        const currentClock = document.getElementById('dash-focus-timer-clock');
        if (currentClock) {
          currentClock.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
      };

      tick();
      dashFocusInterval = setInterval(tick, 1000);

      document.getElementById('btn-dash-pause-focus')?.addEventListener('click', async () => {
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({ action: 'PAUSE_FOCUS_MODE' }, async () => {
            await updateDashboardFocusWidget();
            renderOverview();
          });
        }
      });
      document.getElementById('btn-dash-stop-focus')?.addEventListener('click', async () => {
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({ action: 'STOP_FOCUS_MODE' }, async () => {
            await updateDashboardFocusWidget();
            renderOverview();
          });
        }
      });
    }

  } else {
    statusLabel.textContent = 'Focus Mode Idle';
    if (desc) desc.textContent = 'Silence non-critical distractions while in deep work flow.';
    controlsBox.innerHTML = `
      <div id="row-dash-focus-btns" style="display: flex; flex-direction: column; gap: 4px; min-width: 90px;">
        <button class="btn btn-primary btn-sm" id="btn-dash-focus-25" style="width: 100%;">25m</button>
        <button class="btn btn-secondary btn-sm" id="btn-dash-focus-45" style="width: 100%;">45m</button>
        <button class="btn btn-ghost btn-sm" id="btn-dash-show-custom" style="width: 100%;">Custom</button>
      </div>
      <div id="box-dash-custom-focus" style="display: none; flex-direction: column; gap: 4px; min-width: 90px;">
        <input type="number" id="dash-input-custom-focus" class="input-field" placeholder="Minutes" min="1" max="480" style="width: 100%; height: 32px; padding: 4px 8px; font-size: 0.85rem;">
        <div style="display: flex; gap: 4px; width: 100%;">
          <button class="btn btn-primary btn-sm" id="btn-dash-focus-custom" style="flex: 1; height: 32px;">▶ Start</button>
          <button class="btn btn-ghost btn-sm" id="btn-dash-cancel-custom" style="height: 32px; padding: 4px 8px;">✕</button>
        </div>
      </div>
    `;

    document.getElementById('btn-dash-focus-25')?.addEventListener('click', () => startDashFocus(25));
    document.getElementById('btn-dash-focus-45')?.addEventListener('click', () => startDashFocus(45));
    document.getElementById('btn-dash-show-custom')?.addEventListener('click', () => {
      const btnRow = document.getElementById('row-dash-focus-btns');
      const box = document.getElementById('box-dash-custom-focus');
      if (btnRow) btnRow.style.display = 'none';
      if (box) {
        box.style.display = 'flex';
        document.getElementById('dash-input-custom-focus')?.focus();
      }
    });
    document.getElementById('btn-dash-cancel-custom')?.addEventListener('click', () => {
      const btnRow = document.getElementById('row-dash-focus-btns');
      const box = document.getElementById('box-dash-custom-focus');
      if (btnRow) btnRow.style.display = 'flex';
      if (box) box.style.display = 'none';
    });
    document.getElementById('btn-dash-focus-custom')?.addEventListener('click', () => {
      const customVal = parseInt(document.getElementById('dash-input-custom-focus')?.value, 10);
      if (customVal && customVal > 0) {
        startDashFocus(customVal);
      }
    });
  }
}

async function startDashFocus(minutes) {
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage({ action: 'START_FOCUS_MODE', durationMinutes: minutes }, async () => {
      await updateDashboardFocusWidget();
      renderOverview();
    });
  }
}

function updateAllLiveCountdowns() {
  document.querySelectorAll('.live-countdown').forEach(el => {
    const ts = parseInt(el.dataset.timestamp, 10);
    if (ts) {
      el.textContent = formatRelativeTime(ts);
    }
  });
}

function renderTodayTasksTable() {
  const box = document.getElementById('dash-today-reminders-box');
  if (!box) return;

  const todayReminders = activeRemindersList.filter(r => r.enabled && r.id !== 'auto_health_water');

  if (todayReminders.length === 0) {
    safeSetHTML(box, `
      <div style="text-align: center; padding: 32px; color: var(--text-muted);">
        ✨ No reminders scheduled. Create a new reminder to get started!
      </div>
    `);
    return;
  }

  let html = `<table class="reminders-table">
    <thead>
      <tr>
        <th>Reminder</th>
        <th>Category</th>
        <th>Priority</th>
        <th>Time</th>
        <th>Quick Actions</th>
      </tr>
    </thead>
    <tbody>`;

  todayReminders.forEach(rem => {
    const cat = getCategoryDetails(rem.category, userCustomCategories);
    const prio = PRIORITIES[rem.priority?.toUpperCase()] || PRIORITIES.MEDIUM;
    const cleanTitle = cleanReminderTitle(rem.title);

    html += `
      <tr>
        <td style="font-weight: 600;">${cat.icon} ${escapeHTML(cleanTitle)}</td>
        <td>${cat.label}</td>
        <td><span class="badge ${prio.badgeClass}">${prio.label}</span></td>
        <td><span class="live-countdown" data-timestamp="${rem.time}" style="font-weight: 600; color: #38bdf8;">${formatRelativeTime(rem.time)}</span></td>
        <td>
          <button class="btn btn-secondary btn-sm dash-act-done" data-id="${rem.id}" style="padding: 4px 10px; font-size: 0.75rem;">Done ✓</button>
          ${(() => {
            const snoozeMins = userSettings?.defaultSnoozeMinutes || 10;
            const snoozeLabel = snoozeMins >= 60 ? (snoozeMins / 60) + 'h' : snoozeMins + 'm';
            return `<button class="btn btn-secondary btn-sm dash-act-snooze" data-id="${rem.id}" title="Snooze" style="padding: 4px 8px; font-size: 0.85rem;">⏰ ${snoozeLabel}</button>`;
          })()}
        </td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  safeSetHTML(box, html);

  box.querySelectorAll('.dash-act-done').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({ action: 'MARK_DONE', id }, async () => {
          await loadState();
          await renderOverview();
        });
      }
    });
  });

  box.querySelectorAll('.dash-act-snooze').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({ action: 'SNOOZE_REMINDER', id, minutes: 10 }, async () => {
          await loadState();
          await renderOverview();
        });
      }
    });
  });
}

/* --- TAB 2: REMINDERS MANAGER --- */
function initRemindersManager() {
  document.getElementById('btn-dash-new-reminder').addEventListener('click', openAddModal);
  document.getElementById('btn-mgr-new-reminder').addEventListener('click', openAddModal);

  document.getElementById('btn-close-edit-modal').addEventListener('click', closeEditModal);
  document.getElementById('btn-cancel-edit-modal').addEventListener('click', closeEditModal);
  document.getElementById('btn-save-edit-reminder').addEventListener('click', saveModalReminder);

  document.getElementById('edit-rem-category')?.addEventListener('change', (e) => {
    const val = e.target.value;
    const customBox = document.getElementById('box-custom-category-fields');
    if (customBox) {
      customBox.style.display = (val === 'new_custom' || val === 'custom') ? 'block' : 'none';
    }
  });

  document.getElementById('edit-rem-repeat')?.addEventListener('change', (e) => {
    updateDynamicModalFields(e.target.value);
    refreshModalLivePreview();
  });
  document.getElementById('edit-rem-date')?.addEventListener('change', refreshModalLivePreview);
  document.getElementById('edit-rem-time')?.addEventListener('change', refreshModalLivePreview);
  document.getElementById('edit-rem-interval')?.addEventListener('input', refreshModalLivePreview);

  document.getElementById('edit-rem-custom-emoji')?.addEventListener('input', (e) => {
    const chars = Array.from(e.target.value);
    if (chars.length > 1) {
      e.target.value = chars[0];
    }
  });
}

let livePreviewInterval = null;

function refreshModalLivePreview() {
  const repeat = document.getElementById('edit-rem-repeat')?.value || 'once';
  const dateVal = document.getElementById('edit-rem-date')?.value;
  const timeVal = document.getElementById('edit-rem-time')?.value;
  const intervalVal = document.getElementById('edit-rem-interval')?.value || '15';
  const badgeVal = document.getElementById('preview-next-trigger-val');

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

function startLivePreviewCountdown() {
  if (livePreviewInterval) clearInterval(livePreviewInterval);
  refreshModalLivePreview();
  livePreviewInterval = setInterval(refreshModalLivePreview, 1000);
}

function stopLivePreviewCountdown() {
  if (livePreviewInterval) clearInterval(livePreviewInterval);
}

function updateDynamicModalFields(repeatPattern) {
  const grpDate = document.getElementById('grp-edit-date');
  const grpTime = document.getElementById('grp-edit-time');
  const grpInterval = document.getElementById('grp-edit-interval');
  const lblInterval = document.getElementById('lbl-edit-interval');

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
      if (lblInterval) lblInterval.textContent = '⏱️ Interval (in Minutes)';
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

function renderRemindersTable() {
  const tbody = document.getElementById('mgr-table-body');
  if (!tbody) return;

  // Auto-archive passed one-time reminders
  const now = Date.now();
  const passedOneTime = activeRemindersList.filter(
    r => (r.repeat === 'once' || !r.repeat) && r.time && r.time < now && !r.id.startsWith('auto_health_') && !r.id.startsWith('med_rem_')
  );
  if (passedOneTime.length > 0) {
    (async () => {
      for (const rem of passedOneTime) {
        await storage.archiveReminder(rem);
      }
      activeRemindersList = activeRemindersList.filter(
        r => !passedOneTime.some(p => p.id === r.id)
      );
      await storage.saveReminders(activeRemindersList);
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({ action: 'REFRESH_ALARMS' });
      }
      renderRemindersTable();
      renderOverview();
    })();
    return;
  }

  const searchQuery = document.getElementById('mgr-search-input').value.toLowerCase();
  const catFilter = document.getElementById('mgr-filter-category').value;
  const prioFilter = document.getElementById('mgr-filter-priority').value;

  const filtered = activeRemindersList.filter(rem => {
    const matchesSearch = rem.title.toLowerCase().includes(searchQuery) || 
                          (rem.description && rem.description.toLowerCase().includes(searchQuery));
    const matchesCat = catFilter === 'all' || rem.category === catFilter;
    const matchesPrio = prioFilter === 'all' || rem.priority === prioFilter;
    return matchesSearch && matchesCat && matchesPrio;
  });

  if (filtered.length === 0) {
    safeSetHTML(tbody, `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 32px;">
          No matching reminders found.
        </td>
      </tr>
    `);
    return;
  }

  const html = filtered.map(rem => {
    const cat = getCategoryDetails(rem.category, userCustomCategories);
    const prio = PRIORITIES[rem.priority?.toUpperCase()] || PRIORITIES.MEDIUM;
    const cleanTitle = cleanReminderTitle(rem.title);

    const isFixedHealth = rem.id.startsWith('auto_health_') || rem.id.startsWith('med_rem_') || rem.id === 'auto_period_reminder' || ['water', 'medicine', 'health', 'eye', 'posture'].includes(rem.category);
    
    const editBtnHtml = isFixedHealth
      ? `<button class="btn btn-ghost btn-sm mgr-act-goto-health" style="color: #f472b6;" title="Edit in Health Hub tab">🩺 Edit in Health Hub</button>`
      : `<button class="btn btn-ghost btn-sm mgr-act-edit" data-id="${rem.id}">✏️ Edit</button>`;

    const deleteBtnHtml = isFixedHealth 
      ? '' 
      : `<button class="btn btn-danger btn-sm mgr-act-del" data-id="${rem.id}">🗑️ Delete</button>`;

    const isPassedOneTime = (rem.repeat === 'once' || !rem.repeat) && rem.time && rem.time < now && !isFixedHealth;

    const toggleBtnHtml = isPassedOneTime
      ? `<button class="btn btn-warning btn-sm mgr-act-archive-now" data-id="${rem.id}">📦 Archive Now</button>`
      : `<button class="btn btn-ghost btn-sm mgr-act-toggle" data-id="${rem.id}">
           ${rem.enabled !== false ? '⏸️ Pause' : '▶️ Activate'}
         </button>`;

    return `
      <tr>
        <td style="font-weight: 600;">${cat.icon} ${escapeHTML(cleanTitle)}</td>
        <td>${cat.label}</td>
        <td><span class="badge ${prio.badgeClass}">${prio.label}</span></td>
        <td>
          <div style="font-weight: 600;">${getScheduleLabel(rem)}</div>
          <div style="font-size: 0.775rem; color: ${isPassedOneTime ? '#f59e0b' : '#38bdf8'};" class="live-countdown" data-timestamp="${rem.time}">${formatRelativeTime(rem.time)}</div>
        </td>
        <td>
          <span style="color: ${isPassedOneTime ? '#f59e0b' : rem.enabled !== false ? '#10b981' : '#64748b'}; font-weight: 600;">
            ${isPassedOneTime ? 'Passed' : rem.enabled !== false ? 'Active' : 'Paused'}
          </span>
        </td>
        <td>
          ${toggleBtnHtml}
          ${editBtnHtml}
          ${deleteBtnHtml}
        </td>
      </tr>
    `;
  }).join('');

  safeSetHTML(tbody, html);

  tbody.querySelectorAll('.mgr-act-toggle').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      const idx = activeRemindersList.findIndex(r => r.id === id);
      if (idx !== -1) {
        activeRemindersList[idx].enabled = !activeRemindersList[idx].enabled;
        await storage.saveReminders(activeRemindersList);
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({ action: 'REFRESH_ALARMS' });
        }
        renderRemindersTable();
        renderOverview();
      }
    });
  });

  tbody.querySelectorAll('.mgr-act-archive-now').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      const rem = activeRemindersList.find(r => r.id === id);
      if (rem) {
        await storage.archiveReminder(rem);
        activeRemindersList = activeRemindersList.filter(r => r.id !== id);
        await storage.saveReminders(activeRemindersList);
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({ action: 'REFRESH_ALARMS' });
        }
        showToast('Reminder archived.', 'success');
        renderRemindersTable();
        renderOverview();
      }
    });
  });

  tbody.querySelectorAll('.mgr-act-goto-health').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab('tab-health');
    });
  });

  tbody.querySelectorAll('.mgr-act-edit').forEach(btn => {
    btn.addEventListener('click', (e) => openEditModal(e.currentTarget.dataset.id));
  });

  tbody.querySelectorAll('.mgr-act-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      activeRemindersList = activeRemindersList.filter(r => r.id !== id);
      await storage.saveReminders(activeRemindersList);
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({ action: 'REFRESH_ALARMS' });
      }
      renderRemindersTable();
      renderOverview();
    });
  });
}

function openAddModal() {
  document.getElementById('edit-rem-id').value = '';
  document.getElementById('edit-rem-title').value = '';
  document.getElementById('edit-rem-desc').value = '';
  document.getElementById('edit-rem-priority').value = 'medium';
  document.getElementById('edit-rem-repeat').value = 'once';
  
  if (document.getElementById('edit-rem-custom-name')) document.getElementById('edit-rem-custom-name').value = '';
  if (document.getElementById('edit-rem-custom-emoji')) document.getElementById('edit-rem-custom-emoji').value = '';

  const catSelect = document.getElementById('edit-rem-category');
  if (catSelect) {
    catSelect.value = 'new_custom';
  }
  const customBox = document.getElementById('box-custom-category-fields');
  if (customBox) customBox.style.display = 'block';

  if (document.getElementById('edit-rem-date')) {
    document.getElementById('edit-rem-date').value = '';
  }
  if (document.getElementById('edit-rem-time')) {
    document.getElementById('edit-rem-time').value = '';
  }
  if (document.getElementById('edit-rem-interval')) {
    document.getElementById('edit-rem-interval').value = '15';
  }
  if (document.getElementById('edit-rem-status')) {
    document.getElementById('edit-rem-status').value = 'true';
  }

  updateDynamicModalFields('once');
  document.getElementById('modal-reminder-title').textContent = 'Add Smart Reminder';
  document.getElementById('edit-reminder-modal').classList.add('active');
  startLivePreviewCountdown();
}

function openEditModal(id) {
  const rem = activeRemindersList.find(r => r.id === id);
  if (!rem) return;

  const repeatPattern = rem.repeat || 'once';

  document.getElementById('edit-rem-id').value = rem.id;
  document.getElementById('edit-rem-title').value = rem.title;
  document.getElementById('edit-rem-desc').value = rem.description || '';
  
  const catDetails = getCategoryDetails(rem.category, userCustomCategories);
  const catSelect = document.getElementById('edit-rem-category');
  const customBox = document.getElementById('box-custom-category-fields');

  if (catSelect) {
    if (catSelect.querySelector(`option[value="${rem.category}"]`)) {
      catSelect.value = rem.category;
      if (customBox) customBox.style.display = 'none';
    } else {
      catSelect.value = 'new_custom';
      if (customBox) customBox.style.display = 'block';
      if (document.getElementById('edit-rem-custom-name')) document.getElementById('edit-rem-custom-name').value = catDetails.label || '';
      if (document.getElementById('edit-rem-custom-emoji')) document.getElementById('edit-rem-custom-emoji').value = catDetails.icon || '';
    }
  }

  document.getElementById('edit-rem-priority').value = rem.priority || 'medium';
  document.getElementById('edit-rem-repeat').value = repeatPattern;
  
  const targetTime = rem.time || (Date.now() + 15 * 60 * 1000);
  if (document.getElementById('edit-rem-date')) {
    document.getElementById('edit-rem-date').value = toInputDate(targetTime);
  }
  if (document.getElementById('edit-rem-time')) {
    document.getElementById('edit-rem-time').value = toInputTime(targetTime);
  }
  if (document.getElementById('edit-rem-interval')) {
    document.getElementById('edit-rem-interval').value = rem.repeatInterval || 15;
  }
  if (document.getElementById('edit-rem-status')) {
    document.getElementById('edit-rem-status').value = rem.enabled !== false ? 'true' : 'false';
  }

  updateDynamicModalFields(repeatPattern);
  document.getElementById('modal-reminder-title').textContent = 'Edit Reminder';
  document.getElementById('edit-reminder-modal').classList.add('active');
  startLivePreviewCountdown();
}

function closeEditModal() {
  stopLivePreviewCountdown();
  document.getElementById('edit-reminder-modal').classList.remove('active');
}

function highlightFieldError(inputElem, message) {
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

async function saveModalReminder() {
  const id = document.getElementById('edit-rem-id').value;
  
  // 1. Title Validation (Required)
  const titleInput = document.getElementById('edit-rem-title');
  const title = titleInput ? titleInput.value.trim() : '';
  if (!title) {
    highlightFieldError(titleInput, 'Reminder title is required!');
    return;
  }

  // 2. Schedule & Repeat Validation (Required fields based on pattern)
  const repeat = document.getElementById('edit-rem-repeat').value;
  let scheduledTimestamp = Date.now() + 15 * 60 * 1000;
  let repeatInterval = 1;

  if (repeat === 'once') {
    const dateInput = document.getElementById('edit-rem-date');
    const timeInput = document.getElementById('edit-rem-time');
    const dateVal = dateInput?.value;
    const timeVal = timeInput?.value;

    if (!dateVal) {
      highlightFieldError(dateInput, 'Please select a date for your reminder!');
      return;
    }
    if (!timeVal) {
      highlightFieldError(timeInput, 'Please select a time for your reminder!');
      return;
    }

    scheduledTimestamp = parseDateTime(dateVal, timeVal);
    if (isNaN(scheduledTimestamp) || scheduledTimestamp <= Date.now() - 30000) {
      // Check if the date itself is in the past vs just the time
      const todayStr = toInputDate();
      if (dateVal < todayStr) {
        highlightFieldError(dateInput, 'The selected date is in the past! Please choose today or a future date.');
      } else {
        highlightFieldError(timeInput, 'The selected time has already passed! Please choose a future time.');
      }
      return;
    }
  } else if (repeat === 'daily') {
    const timeInput = document.getElementById('edit-rem-time');
    const timeVal = timeInput?.value;
    if (!timeVal) {
      highlightFieldError(timeInput, 'Please select a time for your daily reminder!');
      return;
    }
    const todayDate = toInputDate();
    let ts = parseDateTime(todayDate, timeVal);
    if (ts <= Date.now()) {
      ts += 24 * 3600 * 1000;
    }
    scheduledTimestamp = ts;
  } else if (repeat === 'weekly') {
    const timeInput = document.getElementById('edit-rem-time');
    const dateInput = document.getElementById('edit-rem-date');
    const timeVal = timeInput?.value;
    const dateVal = dateInput?.value || toInputDate();
    if (!timeVal) {
      highlightFieldError(timeInput, 'Please select a time for your weekly reminder!');
      return;
    }
    let ts = parseDateTime(dateVal, timeVal);
    while (ts <= Date.now()) {
      ts += 7 * 24 * 3600 * 1000;
    }
    scheduledTimestamp = ts;
  } else if (repeat === 'monthly') {
    const timeInput = document.getElementById('edit-rem-time');
    const dateInput = document.getElementById('edit-rem-date');
    const timeVal = timeInput?.value;
    const dateVal = dateInput?.value || toInputDate();
    if (!timeVal) {
      highlightFieldError(timeInput, 'Please select a time for your monthly reminder!');
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
    const intervalInput = document.getElementById('edit-rem-interval');
    const intervalMins = parseInt(intervalInput?.value, 10);
    if (!intervalInput?.value || isNaN(intervalMins) || intervalMins < 1) {
      highlightFieldError(intervalInput, 'Please enter a valid interval in minutes (min 1)!');
      return;
    }
    repeatInterval = intervalMins;
    scheduledTimestamp = Date.now() + intervalMins * 60 * 1000;
  } else if (repeat === 'every_x_hours') {
    const intervalInput = document.getElementById('edit-rem-interval');
    const intervalHrs = parseInt(intervalInput?.value, 10);
    if (!intervalInput?.value || isNaN(intervalHrs) || intervalHrs < 1) {
      highlightFieldError(intervalInput, 'Please enter a valid interval in hours (min 1)!');
      return;
    }
    repeatInterval = intervalHrs;
    scheduledTimestamp = Date.now() + intervalHrs * 3600 * 1000;
  }

  const desc = document.getElementById('edit-rem-desc').value.trim();
  let category = document.getElementById('edit-rem-category').value;
  const customName = document.getElementById('edit-rem-custom-name')?.value.trim();
  const customEmoji = document.getElementById('edit-rem-custom-emoji')?.value.trim() || '';

  if (category === 'new_custom' || category === 'custom' || customName || customEmoji) {
    const finalLabel = customName || 'General';
    const finalEmoji = customEmoji ? (Array.from(customEmoji)[0] || '🔔') : '🔔';
    const savedCat = await storage.saveCustomCategory({ label: finalLabel, icon: finalEmoji });
    if (savedCat) {
      category = savedCat.id;
    }
    await populateCategoryDropdowns();
  }

  const priority = document.getElementById('edit-rem-priority').value;

  const statusElem = document.getElementById('edit-rem-status');
  const enabled = statusElem ? (statusElem.value === 'true') : true;

  if (id) {
    // Update existing
    const idx = activeRemindersList.findIndex(r => r.id === id);
    if (idx !== -1) {
      activeRemindersList[idx] = {
        ...activeRemindersList[idx],
        title,
        description: desc,
        category,
        priority,
        repeat,
        repeatInterval,
        enabled,
        time: scheduledTimestamp
      };
    }
  } else {
    // Create new
    const newRem = {
      id: generateId(),
      title,
      description: desc,
      category,
      priority,
      repeat,
      repeatInterval,
      time: scheduledTimestamp,
      enabled: enabled,
      completedCount: 0,
      createdAt: Date.now()
    };
    activeRemindersList.push(newRem);
  }

  await storage.saveReminders(activeRemindersList);
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage({ action: 'REFRESH_ALARMS' });
  }

  closeEditModal();
  showToast('Reminder saved successfully! 🎉', 'success');
  renderRemindersTable();
  renderOverview();
  await renderAnalytics();
}

/* --- TAB 3: STATISTICS & SVG CHARTS --- */
async function renderAnalytics() {
  await renderUsageTimeline();
  const allStats = await storage.getAllDailyStats();

  // Build last 7 days metrics
  const past7Days = [];
  for (let i = 6; i >= 0; i--) {
    const key = getDateKeyOffset(i);
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayLabel = d.toLocaleDateString([], { weekday: 'short' });
    const dayStat = allStats[key] || {};
    past7Days.push({
      dateKey: key,
      dayLabel: dayLabel,
      completed: dayStat.completedCount || 0,
      water: dayStat.waterGlasses || 0,
      focusMinutes: dayStat.focusMinutesToday || 0
    });
  }

  await renderPerReminderBreakdown();
}

async function renderPerReminderBreakdown() {
  const container = document.getElementById('per-reminder-breakdown-table');
  if (!container) return;

  const reminders = await storage.getReminders();
  const stats = await storage.getDailyStats();
  const settings = await storage.getSettings();
  const progress = await storage.getReminderDailyProgress();
  const dismissedProgress = await storage.getReminderDailyDismissed();
  const health = settings.healthSettings || {};
  const waterGoal = health.waterGoal || settings.waterGoalGlasses || 8;
  const meds = health.medications || [];

  const activeReminders = reminders.filter(r => r.enabled !== false);
  const rows = [];

  for (const rem of activeReminders) {
    const cat = getCategoryDetails(rem.category, userCustomCategories);
    const cleanTitle = cleanReminderTitle(rem.title) || rem.id;
    const dismissed = dismissedProgress[rem.id] || 0;
    const expectedLabel = getExpectedLabel(rem, waterGoal, meds);

    let completed = 0;

    if (rem.id === 'auto_health_water' || (rem.category === 'water' && rem.id.startsWith('auto_health_'))) {
      completed = stats.waterGlasses || 0;
    } else if (rem.category === 'medicine' || rem.id.startsWith('med_rem_')) {
      const medId = rem.id.replace('med_rem_', '');
      const med = meds.find(m => m.id === medId || rem.id.includes(m.id));
      completed = med?.takenTodayCount || 0;
    } else {
      completed = progress[rem.id] || 0;
    }

    rows.push(`
      <tr>
        <td style="white-space: nowrap;">${cat.icon} ${escapeHTML(cleanTitle)}</td>
        <td style="text-align: center; color: #10b981; font-weight: bold;">${completed}</td>
        <td style="text-align: center; color: #f97316; font-weight: bold;">${dismissed}</td>
        <td style="text-align: center; font-size: 0.8rem; color: var(--text-secondary);">${expectedLabel}</td>
      </tr>
    `);
  }

  if (rows.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">No active reminders to show</div>';
    return;
  }

  container.innerHTML = `
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr>
          <th style="padding: 8px 12px; text-align: left; font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border);">Reminder</th>
          <th style="padding: 8px 12px; text-align: center; font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border);">Done</th>
          <th style="padding: 8px 12px; text-align: center; font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border);">Dismissed</th>
          <th style="padding: 8px 12px; text-align: center; font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border);">Schedule / Goal</th>
        </tr>
      </thead>
      <tbody>${rows.join('')}</tbody>
    </table>
  `;
}

function renderWeeklyCompletionChart() {}
function renderWaterLogChart() {}
function renderFocusSessionsChart() {}
function renderPriorityDistChart() {}

function initAnalyticsExportHandlers() {
  document.getElementById('btn-export-analytics-html')?.addEventListener('click', exportHTMLReport);
}

async function exportHTMLReport() {
  const installDate = await storage.getInstallDate();
  const installDateStr = formatDate(installDate);
  const daysActive = Math.max(1, Math.ceil((Date.now() - installDate) / (1000 * 60 * 60 * 24)));
  const todayStats = await storage.getDailyStats();
  const allStats = await storage.getAllDailyStats();
  const settings = await storage.getSettings();
  const health = settings.healthSettings || {};
  const reminders = await storage.getReminders();
  const archived = await storage.get(STORAGE_KEYS.ARCHIVED_REMINDERS, []);
  const reportDate = formatDate(Date.now());
  const progress = await storage.getReminderDailyProgress();
  const dismissedProgress = await storage.getReminderDailyDismissed();
  const waterGoal = health.waterGoal || settings.waterGoalGlasses || 8;
  const meds = health.medications || [];

  // Compute per-reminder breakdown for export
  const now = new Date();
  const midnightMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const elapsedMinutes = Math.max(1, (Date.now() - midnightMs) / 60000);
  const activeReminders = reminders.filter(r => r.enabled !== false);
  const breakdownRows = [];
  const breakdownPcts = [];

  for (const rem of activeReminders) {
    const cat = getCategoryDetails(rem.category, userCustomCategories);
    const cleanTitle = cleanReminderTitle(rem.title) || rem.id;
    const dismissed = dismissedProgress[rem.id] || 0;
    const expectedLabel = getExpectedLabel(rem, waterGoal, meds);
    let completed = 0;

    if (rem.id === 'auto_health_water' || (rem.category === 'water' && rem.id.startsWith('auto_health_'))) {
      completed = todayStats.waterGlasses || 0;
    } else if (rem.category === 'medicine' || rem.id.startsWith('med_rem_')) {
      const medId = rem.id.replace('med_rem_', '');
      const med = meds.find(m => m.id === medId || rem.id.includes(m.id));
      completed = med?.takenTodayCount || 0;
    } else {
      completed = progress[rem.id] || 0;
    }
    breakdownRows.push(`<tr><td>${cat.icon} ${escapeHTML(cleanTitle)}</td><td style="text-align:center;color:#10b981;font-weight:bold;">${completed}</td><td style="text-align:center;color:#f97316;font-weight:bold;">${dismissed}</td><td style="text-align:center;color:#94a3b8;">${expectedLabel}</td></tr>`);
  }

  // Past 7 Days Rows
  let historyRows = '';
  for (let i = 6; i >= 0; i--) {
    const key = getDateKeyOffset(i);
    const dayStat = allStats[key] || {};
    historyRows += `
      <tr>
        <td><strong>${key}</strong></td>
        <td style="color:#10b981;font-weight:bold;">${dayStat.completedCount || 0}</td>
        <td style="color:#06b6d4;">${dayStat.waterGlasses || 0} glasses</td>
        <td style="color:#8b5cf6;">${dayStat.focusMinutesToday || 0} mins</td>
        <td style="color:#f97316;font-weight:bold;">${dayStat.skippedCount || 0}</td>
      </tr>
    `;
  }

  // Full Reminder Details Rows
  let reminderRows = (reminders || []).map(r => {
    const cat = getCategoryDetails(r.category, userCustomCategories);
    const prio = PRIORITIES[r.priority?.toUpperCase()] || PRIORITIES.MEDIUM;
    const cleanTitle = cleanReminderTitle(r.title);
    const descText = r.description ? escapeHTML(r.description) : '<span style="color:#64748b;">No details provided</span>';
    const scheduleText = r.repeat ? `${r.repeat} ${r.repeatInterval ? '(' + r.repeatInterval + 'm)' : ''}` : 'One-time';
    const nextTimeString = r.time ? `${formatDate(r.time)} at ${formatTime(r.time)} (${formatRelativeTime(r.time)})` : 'N/A';
    const statusTag = r.enabled !== false ? '<span style="color:#10b981; font-weight:bold;">Active</span>' : '<span style="color:#64748b;">Disabled</span>';
    const rDismissed = dismissedProgress[r.id] || 0;

    return `
      <tr>
        <td><strong>${cat.icon} ${escapeHTML(cleanTitle)}</strong></td>
        <td>${cat.label}</td>
        <td><span style="font-weight:bold; color:${prio.badgeClass === 'badge-critical' ? '#ef4444' : prio.badgeClass === 'badge-high' ? '#f97316' : prio.badgeClass === 'badge-medium' ? '#f59e0b' : '#38bdf8'};">${prio.label}</span></td>
        <td style="max-width:250px;">${descText}</td>
        <td>${scheduleText}</td>
        <td>${nextTimeString}</td>
        <td><strong style="color:#10b981;">${r.completedCount || 0}</strong></td>
        <td><strong style="color:#f97316;">${rDismissed}</strong></td>
        <td>${statusTag}</td>
      </tr>
    `;
  }).join('');

  // Medication Schedule Rows
  let medRows = meds.map(m => `
    <tr>
      <td><strong>💊 ${escapeHTML(m.name)}</strong></td>
      <td>${m.takenTodayCount || 0} / ${m.doseCount || 1} doses</td>
      <td>${(m.times || []).join(', ') || 'N/A'}</td>
      <td>${m.instructions ? escapeHTML(m.instructions) : 'None'}</td>
    </tr>
  `).join('');

  // Archived Rows
  let archiveRows = (archived || []).map(a => `
    <tr>
      <td>${escapeHTML(a.title)}</td>
      <td>${escapeHTML(a.category || 'custom')}</td>
      <td>${formatDate(a.archivedAt || Date.now())}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Reminderly Full Analytics & Reminder Details Report - ${reportDate}</title>
  <style>
    body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: #0f1117; color: #f1f5f9; margin: 0; padding: 40px; }
    .card { background: #1e2130; border: 1px solid #2e3248; border-radius: 12px; padding: 24px; margin-bottom: 24px; }
    h1, h2, h3 { color: #ffffff; margin-top: 0; }
    .accent { color: #4f46e5; }
    .pink { color: #ec4899; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin: 20px 0; }
    .stat-box { background: #1a1d27; padding: 16px; border-radius: 8px; text-align: center; border: 1px solid #2e3248; }
    .stat-val { font-size: 1.8rem; font-weight: bold; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #2e3248; font-size: 0.875rem; vertical-align: top; }
    th { background: #1a1d27; color: #8b92a9; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em; }
    .footer { text-align: center; color: #64748b; font-size: 0.8rem; margin-top: 32px; }
    .profile-pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 0.8rem; font-weight: 700; background: rgba(99, 102, 241, 0.15); color: #a5b4fc; margin-right: 6px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔔 Reminderly Full Analytics Report</h1>
    <p>Generated on <strong>${reportDate}</strong> • Using Reminderly since <strong>${installDateStr} (${daysActive} day${daysActive > 1 ? 's' : ''} active)</strong></p>
    ${(() => {
      const p = settings.userProfile || {};
      if (!p.name && !p.age && !p.gender) return '';
      const genderLabel = p.gender === 'female' ? '👩 Female' : p.gender === 'male' ? '👨 Male' : p.gender === 'prefer_not_to_say' ? 'Prefer not to say' : 'Other';
      return `<p><span class="profile-pill">👤 ${escapeHTML(p.name) || 'Anonymous'}</span>${p.age ? `<span class="profile-pill">🎂 Age ${p.age}</span>` : ''}<span class="profile-pill">${genderLabel}</span></p>`;
    })()}
    ${(() => {
      const p = settings.userProfile || {};
      const pt = settings.periodTracker || {};
      if (p.gender !== 'female' || !pt.lastPeriodDate) return '';
      const cycleLength = pt.cycleLength || 28;
      const today = new Date(); today.setHours(0,0,0,0);
      const last = new Date(pt.lastPeriodDate); last.setHours(0,0,0,0);
      const daysSince = Math.floor((today - last) / 86400000);
      const cycleDay = (daysSince % cycleLength) + 1;
      const cyclesSince = Math.floor(daysSince / cycleLength);
      const nextPeriod = new Date(last.getTime() + (cyclesSince + 1) * cycleLength * 86400000);
      const daysToNext = Math.max(0, Math.floor((nextPeriod - today) / 86400000));
      const ov = Math.round(cycleLength / 2);
      let phase = cycleDay <= (pt.periodDuration||5) ? '🩸 Menstruation' : cycleDay <= ov-2 ? '🌿 Follicular' : cycleDay <= ov+2 ? '🥚 Ovulation' : '🍂 Luteal';
      return `<p style="margin-top:8px; color:#f472b6;">🌸 <strong>Cycle Tracker:</strong> Currently on <strong>Day ${cycleDay}</strong> of ${cycleLength} — Phase: <strong>${phase}</strong> — Next Period in <strong>${daysToNext === 0 ? 'Today' : daysToNext + ' days'}</strong></p>`;
    })()}
    <div class="grid">
      <div class="stat-box"><div>Active Streak</div><div class="stat-val" style="color:#f59e0b;">${todayStats.streakDays || 1} Days 🔥</div></div>
      <div class="stat-box"><div>Tasks Completed</div><div class="stat-val" style="color:#10b981;">${todayStats.completedCount || 0}</div></div>
      <div class="stat-box"><div>Tasks Dismissed</div><div class="stat-val" style="color:#f97316;">${todayStats.skippedCount || 0}</div></div>
      <div class="stat-box"><div>Today Focus Time</div><div class="stat-val" style="color:#06b6d4;">${todayStats.focusMinutesToday || 0}m</div></div>
    </div>
  </div>

  <div class="card">
    <h2>📊 Past 7 Days Daily Activity Log</h2>
    <table>
      <thead><tr><th>Date Key</th><th>Completed Tasks</th><th>Hydration Logged</th><th>Focus Time</th><th>Dismissed / Skipped</th></tr></thead>
      <tbody>${historyRows}</tbody>
    </table>
  </div>

  <div class="card">
    <h2>🎯 Per-Reminder Activity (Today)</h2>
    <table>
      <thead><tr><th>Reminder</th><th style="text-align:center;">Done</th><th style="text-align:center;">Dismissed</th><th style="text-align:center;">Schedule / Goal</th></tr></thead>
      <tbody>${breakdownRows.length > 0 ? breakdownRows.join('') : '<tr><td colspan="4" style="color:#64748b;">No active reminders</td></tr>'}</tbody>
    </table>
  </div>

  <div class="card">
    <h2>⏰ Detailed Reminders & Schedules (${reminders.length})</h2>
    <table>
      <thead>
        <tr>
          <th>Title</th>
          <th>Category</th>
          <th>Priority</th>
          <th>Description / Details</th>
          <th>Schedule</th>
          <th>Next Trigger Time</th>
          <th>Completed</th>
          <th>Dismissed</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${reminderRows || '<tr><td colspan="9">No reminders scheduled.</td></tr>'}</tbody>
    </table>
  </div>

  ${meds.length > 0 ? `
  <div class="card">
    <h2>💊 Medication & Pill Schedule (${meds.length})</h2>
    <table>
      <thead><tr><th>Medication Name</th><th>Doses Logged Today</th><th>Scheduled Dose Times</th><th>Instructions</th></tr></thead>
      <tbody>${medRows}</tbody>
    </table>
  </div>
  ` : ''}

  ${archived.length > 0 ? `
  <div class="card">
    <h2>📦 Archived Reminders History (${archived.length})</h2>
    <table>
      <thead><tr><th>Title</th><th>Category</th><th>Archived On</th></tr></thead>
      <tbody>${archiveRows}</tbody>
    </table>
  </div>
  ` : ''}

  <div class="footer">
    Reminderly • 100% Offline & Private Data • Downloaded HTML Analytics Record
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Reminderly_Report_${getTodayKey()}.html`;
  a.click();
  URL.revokeObjectURL(url);
}



/* --- TAB 4: REMI ASSISTANT STUDIO --- */
let mascotEditMode = false;

function renderMascotState() {
  const mascotConfig = userSettings.mascot || {};
  const enabledEl = document.getElementById('setting-mascot-enabled');
  const posEl = document.getElementById('setting-mascot-pos');

  if (enabledEl) {
    enabledEl.disabled = !mascotEditMode;
    if (!mascotEditMode) enabledEl.value = String(mascotConfig.enabled !== false);
  }
  if (posEl) {
    posEl.disabled = !mascotEditMode;
    if (!mascotEditMode) posEl.value = mascotConfig.position || 'top-right';
  }

  updateMascotPreview();

  const grp = document.getElementById('grp-btn-mascot');
  if (grp) {
    if (mascotEditMode) {
      grp.innerHTML = `
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-primary btn-sm" id="btn-save-mascot">💾 Save</button>
          <button class="btn btn-ghost btn-sm" id="btn-cancel-mascot">✕ Cancel</button>
        </div>
      `;
    } else {
      grp.innerHTML = `<button class="btn btn-secondary btn-sm" id="btn-edit-mascot">✏️ Edit</button>`;
    }
  }

  document.getElementById('btn-edit-mascot')?.addEventListener('click', () => {
    mascotEditMode = true;
    renderMascotState();
  });

  document.getElementById('btn-save-mascot')?.addEventListener('click', async () => {
    userSettings.mascot = {
      enabled: document.getElementById('setting-mascot-enabled').value === 'true',
      type: 'remi',
      position: document.getElementById('setting-mascot-pos').value,
      size: 220
    };

    await storage.saveSettings(userSettings);
    showToast('Remi settings saved successfully!', 'success');
    mascotEditMode = false;
    renderMascotState();
  });

  document.getElementById('btn-cancel-mascot')?.addEventListener('click', () => {
    mascotEditMode = false;
    renderMascotState();
  });
}

let previewTimer1 = null;
let previewTimer2 = null;

function initMascotStudio() {
  renderMascotState();
  document.getElementById('setting-mascot-pos')?.addEventListener('change', () => updateMascotPreview());
}

function updateMascotPreview() {
  const stage = document.getElementById('mascot-studio-avatar-container');
  if (!stage) return;

  if (previewTimer1) clearTimeout(previewTimer1);
  if (previewTimer2) clearTimeout(previewTimer2);

  const size = 290;

  stage.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; min-height: 290px; width: 100%;">
      <div class="remi-avatar" id="remi-preview-avatar">
        ${getMascotSVG('remi', MASCOT_EMOTIONS.NEUTRAL, size, 'welcome')}
      </div>
    </div>
  `;

  // Sequence: 4s1.gif (4s welcome) -> 1.8Sec2.gif (1.8s idle transition) -> wait.gif (waiting loop)
  previewTimer1 = setTimeout(() => {
    const imgEl = stage.querySelector('#remi-gif-element');
    if (imgEl) {
      let src2 = 'remi/1.8Sec2.gif';
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        try { src2 = chrome.runtime.getURL('remi/1.8Sec2.gif'); } catch (e) { src2 = '../remi/1.8Sec2.gif'; }
      } else { src2 = '../remi/1.8Sec2.gif'; }
      imgEl.src = src2;
    }

    previewTimer2 = setTimeout(() => {
      const finalImg = stage.querySelector('#remi-gif-element');
      if (finalImg) {
        let srcWait = 'remi/wait.gif';
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
          try { srcWait = chrome.runtime.getURL('remi/wait.gif'); } catch (e) { srcWait = '../remi/wait.gif'; }
        } else { srcWait = '../remi/wait.gif'; }
        finalImg.src = srcWait;
      }
    }, 1800);
  }, 4000);
}

/* --- TAB 5: CONTEXT & BLOCKER --- */
let contextEditMode = false;

function renderContextState() {
  const blockerEl = document.getElementById('setting-blocker-enabled');
  const contextEl = document.getElementById('setting-context-enabled');

  if (blockerEl) {
    blockerEl.disabled = !contextEditMode;
    if (!contextEditMode) blockerEl.value = String(userSettings.websiteBlockerEnabled !== false);
  }
  if (contextEl) {
    contextEl.disabled = !contextEditMode;
    if (!contextEditMode) contextEl.value = String(userSettings.contextAwarenessEnabled !== false);
  }

  const grp = document.getElementById('grp-btn-context');
  if (grp) {
    if (contextEditMode) {
      grp.innerHTML = `
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-primary btn-sm" id="btn-save-context">💾 Save</button>
          <button class="btn btn-ghost btn-sm" id="btn-cancel-context">✕ Cancel</button>
        </div>
      `;
    } else {
      grp.innerHTML = `<button class="btn btn-secondary btn-sm" id="btn-edit-context">✏️ Edit</button>`;
    }
  }

  document.getElementById('btn-edit-context')?.addEventListener('click', () => {
    contextEditMode = true;
    renderContextState();
  });

  document.getElementById('btn-save-context')?.addEventListener('click', async () => {
    userSettings.websiteBlockerEnabled = document.getElementById('setting-blocker-enabled').value === 'true';
    userSettings.contextAwarenessEnabled = document.getElementById('setting-context-enabled').value === 'true';
    await storage.saveSettings(userSettings);
    showToast('Blocker & Context settings saved successfully!', 'success');
    contextEditMode = false;
    renderContextState();
  });

  document.getElementById('btn-cancel-context')?.addEventListener('click', () => {
    contextEditMode = false;
    renderContextState();
  });
}

function initContextBlocker() {
  renderContextState();

  document.getElementById('btn-add-priority-site').addEventListener('click', () => {
    const input = document.getElementById('new-priority-site-input');
    const domain = input.value.trim().toLowerCase();
    if (domain && !(userSettings.priorityWebsites || []).includes(domain)) {
      if (!userSettings.priorityWebsites) userSettings.priorityWebsites = [];
      userSettings.priorityWebsites.push(domain);
      storage.saveSettings(userSettings);
      input.value = '';
      renderDomainLists();
    }
  });

  document.getElementById('btn-add-blocked-site').addEventListener('click', () => {
    const input = document.getElementById('new-blocked-site-input');
    const domain = input.value.trim().toLowerCase();
    if (domain && !(userSettings.blockedWebsites || []).includes(domain)) {
      if (!userSettings.blockedWebsites) userSettings.blockedWebsites = [];
      userSettings.blockedWebsites.push(domain);
      storage.saveSettings(userSettings);
      input.value = '';
      renderDomainLists();
    }
  });

  renderDomainLists();
}

function renderDomainLists() {
  const priorityContainer = document.getElementById('priority-sites-list');
  const blockedContainer = document.getElementById('blocked-sites-list');

  if (priorityContainer) {
    const html = (userSettings.priorityWebsites || []).map(d => `
      <span class="domain-pill">
        ⚡ ${escapeHTML(d)}
        <span class="domain-pill-remove" data-type="priority" data-domain="${d}">×</span>
      </span>
    `).join('');
    safeSetHTML(priorityContainer, html);
  }

  if (blockedContainer) {
    const html = (userSettings.blockedWebsites || []).map(d => `
      <span class="domain-pill" style="background: rgba(239, 68, 68, 0.2); border-color: rgba(239, 68, 68, 0.4); color: #f87171;">
        🛡️ ${escapeHTML(d)}
        <span class="domain-pill-remove" data-type="blocked" data-domain="${d}">×</span>
      </span>
    `).join('');
    safeSetHTML(blockedContainer, html);
  }

  document.querySelectorAll('.domain-pill-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const domain = e.currentTarget.dataset.domain;
      const type = e.currentTarget.dataset.type;
      if (type === 'priority') {
        userSettings.priorityWebsites = userSettings.priorityWebsites.filter(d => d !== domain);
      } else {
        userSettings.blockedWebsites = userSettings.blockedWebsites.filter(d => d !== domain);
      }
      await storage.saveSettings(userSettings);
      renderDomainLists();
    });
  });
}

/* --- TAB 6: SETTINGS & BACKUP --- */
let prefsEditMode = false;

function renderPrefsState() {
  const fields = document.querySelectorAll('.prefs-field');
  fields.forEach(f => f.disabled = !prefsEditMode);

  if (document.getElementById('setting-theme-select')) {
    document.getElementById('setting-theme-select').value = userSettings.theme || 'system';
  }
  if (document.getElementById('setting-sound-tone')) {
    document.getElementById('setting-sound-tone').value = userSettings.soundTone || 'chime';
  }
  if (document.getElementById('setting-volume-slider')) {
    document.getElementById('setting-volume-slider').value = userSettings.volume || 80;
  }
  if (document.getElementById('setting-auto-archive')) {
    document.getElementById('setting-auto-archive').value = String(userSettings.autoArchivePassed !== false);
  }
  if (document.getElementById('setting-auto-delete-archive')) {
    document.getElementById('setting-auto-delete-archive').value = userSettings.autoDeleteArchiveDays || 'never';
  }
  if (document.getElementById('setting-snooze-duration')) {
    document.getElementById('setting-snooze-duration').value = String(userSettings.defaultSnoozeMinutes || 10);
  }

  const grp = document.getElementById('grp-btn-prefs');
  if (grp) {
    if (prefsEditMode) {
      grp.innerHTML = `
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-primary btn-sm" id="btn-save-prefs">💾 Save</button>
          <button class="btn btn-ghost btn-sm" id="btn-cancel-prefs">✕ Cancel</button>
        </div>
      `;
    } else {
      grp.innerHTML = `<button class="btn btn-secondary btn-sm" id="btn-edit-prefs">✏️ Edit</button>`;
    }
  }

  document.getElementById('btn-edit-prefs')?.addEventListener('click', () => {
    prefsEditMode = true;
    renderPrefsState();
  });

  document.getElementById('btn-save-prefs')?.addEventListener('click', async () => {
    userSettings.theme = document.getElementById('setting-theme-select').value;
    userSettings.soundTone = document.getElementById('setting-sound-tone').value;
    userSettings.volume = parseInt(document.getElementById('setting-volume-slider').value, 10);
    if (document.getElementById('setting-auto-archive')) {
      userSettings.autoArchivePassed = document.getElementById('setting-auto-archive').value === 'true';
    }
    if (document.getElementById('setting-auto-delete-archive')) {
      userSettings.autoDeleteArchiveDays = document.getElementById('setting-auto-delete-archive').value;
    }
    if (document.getElementById('setting-snooze-duration')) {
      userSettings.defaultSnoozeMinutes = parseInt(document.getElementById('setting-snooze-duration').value, 10) || 10;
    }

    applyTheme(userSettings.theme);
    await storage.saveSettings(userSettings);
    showToast('Preferences & Audio settings saved!', 'success');
    prefsEditMode = false;
    renderPrefsState();
  });

  document.getElementById('btn-cancel-prefs')?.addEventListener('click', () => {
    prefsEditMode = false;
    renderPrefsState();
  });
}

function initSettingsAndBackup() {
  renderPrefsState();

  // --- User Profile Form Init ---
  const profile = userSettings.userProfile || {};
  const periodConfig = userSettings.periodTracker || {};
  const nameEl = document.getElementById('profile-name-input');
  const ageEl = document.getElementById('profile-age-input');
  const genderEl = document.getElementById('profile-gender-select');
  const periodSettingsDiv = document.getElementById('profile-period-settings');
  const trackingEnabledEl = document.getElementById('period-tracking-enabled');
  const lastDateEl = document.getElementById('period-last-date');
  const cycleLenEl = document.getElementById('period-cycle-length');
  const periodDurEl = document.getElementById('period-duration');
  const remindDaysEl = document.getElementById('period-remind-days-before');
  const remindTimeEl = document.getElementById('period-remind-time');
  const editBtn = document.getElementById('btn-edit-profile');
  const actionBtns = document.getElementById('profile-action-buttons');
  const cancelBtn = document.getElementById('btn-cancel-profile');

  // Helper: all profile fields
  const allProfileFields = () =>
    document.querySelectorAll('.profile-field');

  // Populate fields from settings
  const populateProfileFields = (p, pc) => {
    if (nameEl) nameEl.value = p.name || '';
    if (ageEl) ageEl.value = p.age || '';
    if (genderEl) genderEl.value = p.gender || 'prefer_not_to_say';
    if (trackingEnabledEl) trackingEnabledEl.checked = !!(pc.trackingEnabled);
    if (lastDateEl) lastDateEl.value = pc.lastPeriodDate || '';
    if (cycleLenEl) cycleLenEl.value = pc.cycleLength || 28;
    if (periodDurEl) periodDurEl.value = pc.periodDuration || 5;
    if (remindDaysEl) remindDaysEl.value = String(pc.remindDaysBefore ?? 3);
    if (remindTimeEl) remindTimeEl.value = pc.remindTime || '09:00';
  };
  populateProfileFields(profile, periodConfig);

  // Lock / Unlock helpers
  const setEditMode = (enabled) => {
    allProfileFields().forEach(el => {
      if (enabled) el.removeAttribute('disabled');
      else el.setAttribute('disabled', 'true');
    });
    if (editBtn) editBtn.style.display = enabled ? 'none' : 'flex';
    if (actionBtns) actionBtns.style.display = enabled ? 'flex' : 'none';
  };
  setEditMode(false); // start locked

  // ✏️ Edit Profile click
  editBtn?.addEventListener('click', () => setEditMode(true));

  // ✕ Cancel
  cancelBtn?.addEventListener('click', () => {
    // Restore from saved settings
    populateProfileFields(userSettings.userProfile || {}, userSettings.periodTracker || {});
    togglePeriodSettings(userSettings.userProfile?.gender || 'prefer_not_to_say');
    applyTrackingToggle(!!(userSettings.periodTracker?.trackingEnabled));
    setEditMode(false);
  });

  // Show/hide period config fields based on checkbox
  const periodConfigFieldsDiv = document.getElementById('period-config-fields');
  const applyTrackingToggle = (enabled) => {
    if (periodConfigFieldsDiv) {
      periodConfigFieldsDiv.style.display = enabled ? 'block' : 'none';
    }
  };
  applyTrackingToggle(!!(periodConfig.trackingEnabled));
  if (trackingEnabledEl) {
    trackingEnabledEl.addEventListener('change', () => applyTrackingToggle(trackingEnabledEl.checked));
  }

  // Show period sub-settings if female
  const togglePeriodSettings = (val) => {
    if (periodSettingsDiv) {
      periodSettingsDiv.style.display = val === 'female' ? 'block' : 'none';
    }
  };
  togglePeriodSettings(profile.gender || 'prefer_not_to_say');
  if (genderEl) {
    genderEl.addEventListener('change', () => togglePeriodSettings(genderEl.value));
  }

  // Last period date — only restrict future dates
  if (lastDateEl) {
    lastDateEl.max = new Date().toISOString().split('T')[0];
    lastDateEl.removeAttribute('min');
  }

  // 💾 Save Profile Button
  document.getElementById('btn-save-profile')?.addEventListener('click', async () => {
    const newGender = genderEl?.value || 'prefer_not_to_say';
    const newTrackingEnabled = !!(trackingEnabledEl?.checked);
    const newRemindDays = parseInt(remindDaysEl?.value, 10) || 0;
    const newRemindTime = remindTimeEl?.value || '09:00';
    const newLastDate = lastDateEl?.value || '';
    const newCycleLength = parseInt(cycleLenEl?.value, 10) || 28;

    // --- Date validation (only when tracking enabled) ---
    if (newGender === 'female' && newTrackingEnabled && newLastDate) {
      const entered = new Date(newLastDate);
      const today = new Date(); today.setHours(0,0,0,0);
      const maxDaysBack = newCycleLength * 2;
      const earliestAllowed = new Date(today);
      earliestAllowed.setDate(earliestAllowed.getDate() - maxDaysBack);

      if (entered > today) {
        showToast('⚠️ Last period date cannot be in the future. Please enter the actual start date of your most recent period.', 'error', 6000);
        lastDateEl?.focus();
        return;
      }
      if (entered < earliestAllowed) {
        const monthsBack = Math.round((today - entered) / (1000 * 60 * 60 * 24 * 30));
        const proceed = confirm(
          `⚠️ The date you entered is about ${monthsBack} month${monthsBack > 1 ? 's' : ''} ago.\n\n` +
          `That's totally fine if that's your most recent period date!\n` +
          `We'll automatically calculate forward from that date using your ${newCycleLength}-day cycle to estimate your current cycle.\n\n` +
          `➡️ Click OK to save and continue, or Cancel to re-enter a more recent date.`
        );
        if (!proceed) {
          lastDateEl?.focus();
          return;
        }
      }
    }
    const newPeriodDuration = parseInt(periodDurEl?.value, 10) || 5;

    userSettings.userProfile = {
      name: nameEl?.value.trim() || '',
      age: ageEl?.value || '',
      gender: newGender
    };
    userSettings.periodTracker = {
      trackingEnabled: newTrackingEnabled,
      lastPeriodDate: newLastDate,
      cycleLength: newCycleLength,
      periodDuration: newPeriodDuration,
      remindDaysBefore: newRemindDays,
      remindTime: newRemindTime
    };
    await storage.saveSettings(userSettings);

    // Schedule or clear pre-period reminder
    if (newGender === 'female' && newTrackingEnabled && newLastDate && newRemindDays > 0) {
      const today = new Date(); today.setHours(0,0,0,0);
      const last = new Date(newLastDate); last.setHours(0,0,0,0);
      const daysSince = Math.floor((today - last) / 86400000);
      const cyclesSince = Math.floor(daysSince / newCycleLength);
      const nextPeriod = new Date(last.getTime() + (cyclesSince + 1) * newCycleLength * 86400000);
      const reminderDate = new Date(nextPeriod);
      reminderDate.setDate(reminderDate.getDate() - newRemindDays);
      const [rHour, rMin] = newRemindTime.split(':').map(Number);
      reminderDate.setHours(rHour, rMin, 0, 0);

      if (reminderDate > new Date()) {
        const existingReminders = await storage.getReminders();
        const cleaned = existingReminders.filter(r => r.id !== 'auto_period_reminder');
        const periodReminder = {
          id: 'auto_period_reminder',
          title: newRemindDays === 1
            ? '🌸 Period Tomorrow — Be Prepared!'
            : newRemindDays <= 3
            ? `🌸 Period in ${newRemindDays} Days — Heads Up!`
            : `🌸 Period in About ${newRemindDays} Days — Plan Ahead!`,
          description: newRemindDays === 1
            ? 'Your period is expected tomorrow 🩸 Make sure you have pads/tampons/cup ready. Take care of yourself 💕'
            : newRemindDays <= 3
            ? `Your period is expected in ${newRemindDays} days. Stock up on supplies, stay hydrated, and be kind to yourself 💊💕 (Reminder set ${newRemindDays} days before your period)`
            : `Your next period is about ${newRemindDays} days away. A good time to stock up on period supplies and plan some self-care 🛁💕 (Reminder set ${newRemindDays} days before your period)`,
          category: 'health',
          priority: newRemindDays <= 2 ? 'high' : 'medium',
          repeat: 'once',
          time: reminderDate.getTime(),
          enabled: true,
          isPeriodReminder: true,
          remindDaysBefore: newRemindDays,
          createdAt: Date.now(),
          completedCount: 0
        };
        cleaned.push(periodReminder);
        await storage.saveReminders(cleaned);
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({ action: 'REFRESH_ALARMS' });
        }
      }
    } else {
      const existingReminders = await storage.getReminders();
      const cleaned = existingReminders.filter(r => r.id !== 'auto_period_reminder');
      if (cleaned.length !== existingReminders.length) {
        await storage.saveReminders(cleaned);
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({ action: 'REFRESH_ALARMS' });
        }
      }
    }

    renderPeriodTracker();
    setEditMode(false); // lock fields after save
    showToast('Profile saved successfully!', 'success');
  });

  // Link from period tracker setup message back to settings
  document.getElementById('link-to-profile-settings')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector('.nav-item[data-tab="tab-settings"]')?.classList.add('active');
    document.getElementById('tab-settings')?.classList.add('active');
  });

  document.getElementById('btn-test-sound')?.addEventListener('click', () => {
    const tone = document.getElementById('setting-sound-tone')?.value || 'chime';
    const vol = parseInt(document.getElementById('setting-volume-slider')?.value || '80', 10);
    soundEngine.playChime(tone, vol);
  });

  // Export JSON
  document.getElementById('btn-export-backup').addEventListener('click', async () => {
    const backupData = {
      reminders: await storage.getReminders(),
      settings: await storage.getSettings(),
      exportedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reminderly_backup_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Import JSON Trigger
  document.getElementById('btn-import-trigger').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });

  document.getElementById('import-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (imported.reminders) await storage.saveReminders(imported.reminders);
        if (imported.settings) await storage.saveSettings(imported.settings);
        showToast('Backup restored successfully! Reloading...', 'success');
        window.location.reload();
      } catch (err) {
        showToast('Invalid backup file format.', 'error');
      }
    };
    reader.readAsText(file);
  });

  // Reset to Default Factory Settings
  const handleResetToDefault = async () => {
    if (confirm('Are you sure you want to reset Reminderly to default factory settings?\n\nAll custom reminders, categories, daily stats, and settings will be permanently cleared and reset to defaults.')) {
      await storage.resetToDefaults();
      showToast('App successfully reset to default factory settings! 🚀', 'success');
      setTimeout(() => {
        window.location.reload();
      }, 400);
    }
  };

  document.getElementById('btn-reset-to-default')?.addEventListener('click', handleResetToDefault);
  document.getElementById('btn-load-sample-data')?.addEventListener('click', handleResetToDefault);
}

/* --- TAB 7: ARCHIVE MANAGER --- */
let archivedRemindersList = [];

function initArchiveManager() {
  document.getElementById('archive-search-input')?.addEventListener('input', renderArchiveTable);
  document.getElementById('archive-filter-category')?.addEventListener('change', renderArchiveTable);
  document.getElementById('btn-clear-all-archive')?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all archived reminders permanently?')) {
      await storage.clearArchivedReminders();
      await renderArchiveTable();
    }
  });
}

async function renderArchiveTable() {
  const tbody = document.getElementById('archive-table-body');
  if (!tbody) return;

  archivedRemindersList = await storage.getArchivedReminders();

  const searchQuery = document.getElementById('archive-search-input')?.value.toLowerCase() || '';
  const catFilter = document.getElementById('archive-filter-category')?.value || 'all';

  const filtered = archivedRemindersList.filter(rem => {
    const matchesSearch = rem.title.toLowerCase().includes(searchQuery) || 
                          (rem.description && rem.description.toLowerCase().includes(searchQuery));
    const matchesCat = catFilter === 'all' || rem.category === catFilter;
    return matchesSearch && matchesCat;
  });

  if (filtered.length === 0) {
    safeSetHTML(tbody, `
      <tr>
        <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 32px;">
          📦 Archive is empty. No archived reminders found.
        </td>
      </tr>
    `);
    return;
  }

  const html = filtered.map(rem => {
    const cat = getCategoryDetails(rem.category, userCustomCategories);
    const prio = PRIORITIES[rem.priority?.toUpperCase()] || PRIORITIES.MEDIUM;
    const archivedDateStr = rem.archivedAt ? new Date(rem.archivedAt).toLocaleString() : 'Passed';
    const cleanTitle = cleanReminderTitle(rem.title);

    return `
      <tr>
        <td style="font-weight: 600;">${cat.icon} ${escapeHTML(cleanTitle)}</td>
        <td>${cat.label}</td>
        <td><span class="badge ${prio.badgeClass}">${prio.label}</span></td>
        <td style="font-size: 0.825rem; color: var(--text-secondary);">${archivedDateStr}</td>
        <td>
          <button class="btn btn-danger btn-sm arc-act-del" data-id="${rem.id}">🗑️ Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  safeSetHTML(tbody, html);

  tbody.querySelectorAll('.arc-act-restore').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      await storage.restoreReminder(id);
      activeRemindersList = await storage.getReminders();
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({ action: 'REFRESH_ALARMS' });
      }
      await renderArchiveTable();
      renderRemindersTable();
      renderOverview();
    });
  });

  tbody.querySelectorAll('.arc-act-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      await storage.deleteArchivedReminder(id);
      await renderArchiveTable();
    });
  });
}

function promptDashEarlyLogConfirm(icon, title, msgText, onConfirmCallback) {
  const modal = document.getElementById('modal-early-log-confirm');
  const iconEl = document.getElementById('dash-early-log-icon');
  const titleEl = document.getElementById('dash-early-log-title');
  const txtEl = document.getElementById('dash-early-log-msg-text');
  const btnConfirm = document.getElementById('btn-dash-confirm-early-log');
  const btnCancel = document.getElementById('btn-dash-cancel-early-log');

  if (!modal) {
    onConfirmCallback();
    return;
  }

  if (iconEl) iconEl.textContent = icon || '⏰';
  if (titleEl) titleEl.textContent = title || 'Early Log Alert';
  if (txtEl) txtEl.textContent = msgText;
  modal.style.display = 'flex';

  const cleanup = () => {
    modal.style.display = 'none';
    btnConfirm.removeEventListener('click', handleConfirm);
    btnCancel.removeEventListener('click', handleCancel);
  };

  const handleConfirm = () => {
    cleanup();
    onConfirmCallback();
  };

  const handleCancel = () => {
    cleanup();
  };

  btnConfirm.addEventListener('click', handleConfirm);
  btnCancel.addEventListener('click', handleCancel);
}

/* --- PERIOD TRACKER --- */
function renderPeriodTracker() {
  const profile = userSettings.userProfile || {};
  const periodConfig = userSettings.periodTracker || {};
  const periodCard = document.getElementById('health-period-card');
  if (!periodCard) return;

  // Only show card if female
  if (profile.gender !== 'female') {
    periodCard.style.display = 'none';
    return;
  }
  periodCard.style.display = 'block';

  const setupMsg = document.getElementById('period-tracker-setup-msg');
  const activeView = document.getElementById('period-tracker-active-view');
  const badge = document.getElementById('period-status-badge');

  if (!periodConfig.trackingEnabled || !periodConfig.lastPeriodDate) {
    if (setupMsg) setupMsg.style.display = 'block';
    if (activeView) activeView.style.display = 'none';
    if (badge) {
      badge.textContent = periodConfig.trackingEnabled ? 'Setup Required' : 'Tracking Off';
      badge.style.color = '#94a3b8';
      badge.style.background = 'rgba(148,163,184,0.1)';
    }
    return;
  }
  if (setupMsg) setupMsg.style.display = 'none';
  if (activeView) activeView.style.display = 'block';

  const cycleLength = periodConfig.cycleLength || 28;
  const periodDuration = periodConfig.periodDuration || 5;
  const lastPeriod = new Date(periodConfig.lastPeriodDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  lastPeriod.setHours(0, 0, 0, 0);

  const daysSinceLast = Math.floor((today - lastPeriod) / (1000 * 60 * 60 * 24));
  const cycleDay = (daysSinceLast % cycleLength) + 1;

  // Next period
  const cyclesSinceStart = Math.floor(daysSinceLast / cycleLength);
  const nextPeriodDate = new Date(lastPeriod.getTime() + (cyclesSinceStart + 1) * cycleLength * 24 * 60 * 60 * 1000);
  const daysToNext = Math.max(0, Math.floor((nextPeriodDate - today) / (1000 * 60 * 60 * 24)));

  // Ovulation (typically day 14 of cycle, relative)
  const ovulationDay = Math.round(cycleLength / 2);
  const nextOvulationDate = new Date(lastPeriod.getTime() + (cyclesSinceStart * cycleLength + ovulationDay - 1) * 24 * 60 * 60 * 1000);
  if (nextOvulationDate < today) {
    nextOvulationDate.setDate(nextOvulationDate.getDate() + cycleLength);
  }

  // Phase detection
  let phase, phaseColor, fertility, fertilityColor;
  if (cycleDay <= periodDuration) {
    phase = '🩸 Menstruation'; phaseColor = '#ef4444'; fertility = '🔴 Low'; fertilityColor = '#ef4444';
  } else if (cycleDay <= ovulationDay - 2) {
    phase = '🌿 Follicular'; phaseColor = '#10b981'; fertility = '🟡 Low–Medium'; fertilityColor = '#f59e0b';
  } else if (cycleDay <= ovulationDay + 2) {
    phase = '🥚 Ovulation'; phaseColor = '#8b5cf6'; fertility = '🟢 High (Peak)'; fertilityColor = '#10b981';
  } else {
    phase = '🍂 Luteal'; phaseColor = '#f59e0b'; fertility = '🟠 Low–Medium'; fertilityColor = '#f59e0b';
  }

  // Update DOM
  const cycleDayEl = document.getElementById('period-cycle-day-val');
  const countdownEl = document.getElementById('period-countdown-val');
  const phaseEl = document.getElementById('period-phase-val');
  const fertilityEl = document.getElementById('period-fertility-val');
  const ovulLabelEl = document.getElementById('period-next-ovulation-date-label');
  const barEl = document.getElementById('period-cycle-bar');

  if (cycleDayEl) cycleDayEl.textContent = `Day ${cycleDay}`;
  if (countdownEl) countdownEl.textContent = daysToNext === 0 ? 'Today!' : `${daysToNext} days`;
  if (phaseEl) { phaseEl.textContent = phase; phaseEl.style.color = phaseColor; }
  if (fertilityEl) { fertilityEl.textContent = fertility; fertilityEl.style.color = fertilityColor; }
  if (ovulLabelEl) {
    ovulLabelEl.textContent = `Ovulation expected around: ${nextOvulationDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`;
  }

  // Update badge
  if (badge) {
    badge.textContent = phase.replace(/^[^\s]+\s/, '');
    badge.style.background = `${phaseColor}22`;
    badge.style.color = phaseColor;
  }

  // Cycle Progress Bar — 4 phase segments
  if (barEl) {
    const mensPct = Math.round((periodDuration / cycleLength) * 100);
    const follPct = Math.round(((ovulationDay - periodDuration - 2) / cycleLength) * 100);
    const ovulPct = Math.round((4 / cycleLength) * 100);
    const lutPct = 100 - mensPct - follPct - ovulPct;
    const markerPct = Math.round(((cycleDay - 1) / cycleLength) * 100);

    barEl.innerHTML = `
      <div style="width:${mensPct}%; background:#ef4444; height:100%;"></div>
      <div style="width:${follPct}%; background:#10b981; height:100%;"></div>
      <div style="width:${ovulPct}%; background:#8b5cf6; height:100%;"></div>
      <div style="width:${lutPct}%; background:#f59e0b; height:100%;"></div>
    `;

    // Position marker overlay
    barEl.style.position = 'relative';
    const existingMarker = barEl.parentElement.querySelector('.cycle-day-marker');
    if (existingMarker) existingMarker.remove();
    const marker = document.createElement('div');
    marker.className = 'cycle-day-marker';
    marker.style.cssText = `position:absolute; left:${markerPct}%; top:-3px; width:4px; height:18px; background:#ffffff; border-radius:2px; box-shadow:0 0 6px rgba(255,255,255,0.6); transform:translateX(-50%);`;
    barEl.style.position = 'relative';
    barEl.parentElement.style.position = 'relative';
    barEl.parentElement.appendChild(marker);
  }
}

/* --- TAB: HEALTH HUB --- */
function initHealthHub() {
  renderPeriodTracker();
  document.getElementById('btn-health-log-water')?.addEventListener('click', async () => {
    const stats = await storage.getDailyStats();
    const health = userSettings.healthSettings || {};
    const waterGoal = health.waterGoal || 8;
    const currentWater = stats.waterGlasses || 0;
    if (currentWater >= waterGoal) return;

    const doLog = () => {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({ action: 'LOG_WATER', amount: 1 }, async () => {
          await renderHealthHub();
          renderOverview();
        });
      }
    };

    promptDashEarlyLogConfirm(
      '💧',
      'Hydration Check',
      'Did you just drink a glass of water or is this a test log? 😄',
      doLog
    );
  });

  document.getElementById('btn-health-unlog-water')?.addEventListener('click', async () => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ action: 'DECREMENT_WATER' }, async () => {
        await renderHealthHub();
        renderOverview();
      });
    }
  });

  // Toggle custom frequency minute fields
  document.getElementById('health-water-freq-select')?.addEventListener('change', (e) => {
    const grp = document.getElementById('grp-custom-water');
    if (grp) grp.style.display = e.target.value === 'custom' ? 'block' : 'none';
  });
  document.getElementById('health-eye-freq-select')?.addEventListener('change', (e) => {
    const grp = document.getElementById('grp-custom-eye');
    if (grp) grp.style.display = e.target.value === 'custom' ? 'block' : 'none';
  });
  document.getElementById('health-posture-freq-select')?.addEventListener('change', (e) => {
    const grp = document.getElementById('grp-custom-posture');
    if (grp) grp.style.display = e.target.value === 'custom' ? 'block' : 'none';
  });

  // Save Health Preferences & Auto-Generate Active Reminders for Water, Eye Rest, Posture!
  const saveHealthConfig = async (msg) => {
    const health = userSettings.healthSettings || {};
    health.waterGoal = parseInt(document.getElementById('health-water-goal-input')?.value, 10) || 8;
    
    const waterSel = document.getElementById('health-water-freq-select')?.value;
    health.waterIntervalMinutes = waterSel === 'custom' 
      ? (parseInt(document.getElementById('health-water-custom-input')?.value, 10) || 60)
      : (parseInt(waterSel, 10) || 60);

    health.eyeRestEnabled = document.getElementById('health-eye-enabled-select')?.value === 'true';
    const eyeSel = document.getElementById('health-eye-freq-select')?.value;
    health.eyeRestIntervalMinutes = eyeSel === 'custom'
      ? (parseInt(document.getElementById('health-eye-custom-input')?.value, 10) || 20)
      : (parseInt(eyeSel, 10) || 20);

    health.postureEnabled = document.getElementById('health-posture-enabled-select')?.value === 'true';
    const postureSel = document.getElementById('health-posture-freq-select')?.value;
    health.postureIntervalMinutes = postureSel === 'custom'
      ? (parseInt(document.getElementById('health-posture-custom-input')?.value, 10) || 45)
      : (parseInt(postureSel, 10) || 45);

    userSettings.healthSettings = health;
    userSettings.waterGoalGlasses = health.waterGoal;
    await storage.saveSettings(userSettings);

    // Sync active recurring reminders for Hydration, Eye Rest, and Posture
    await syncHealthReminders(health);

    showToast(msg, msg.includes('⚠️') || msg.includes('Error') ? 'error' : 'success');
    await renderHealthHub();
    renderOverview();
  };
  window._saveHealthConfig = saveHealthConfig;

  document.getElementById('btn-save-health-settings')?.addEventListener('click', () => saveHealthConfig('All Health & Wellness preferences saved!'));

  // Open Custom Add Medication Modal

  // Open Custom Add Medication Modal
  const medModal = document.getElementById('modal-add-medication');
  document.getElementById('btn-add-medication')?.addEventListener('click', () => {
    document.getElementById('med-name-input').value = '';
    document.getElementById('med-dosage-input').value = '';
    document.getElementById('med-schedule-type-select').value = 'daily';
    document.getElementById('grp-med-weekly-day').style.display = 'none';
    document.getElementById('med-freq-count-input').value = '2';
    renderDynamicMedDoseTimeFields(2);
    if (medModal) medModal.style.display = 'flex';
  });

  document.getElementById('btn-close-med-modal')?.addEventListener('click', () => {
    if (medModal) medModal.style.display = 'none';
  });
  document.getElementById('btn-cancel-med-modal')?.addEventListener('click', () => {
    if (medModal) medModal.style.display = 'none';
  });

  document.getElementById('med-schedule-type-select')?.addEventListener('change', (e) => {
    const weeklyGrp = document.getElementById('grp-med-weekly-day');
    if (weeklyGrp) weeklyGrp.style.display = e.target.value === 'weekly' ? 'block' : 'none';
  });

  document.getElementById('med-freq-count-input')?.addEventListener('input', (e) => {
    const count = Math.max(1, Math.min(24, parseInt(e.target.value, 10) || 1));
    renderDynamicMedDoseTimeFields(count);
  });

  document.getElementById('btn-auto-calc-med-times')?.addEventListener('click', () => {
    autoCalculateMedTimes();
  });

  // Save Medication Schedule & Create ONE Unified Single Reminder Entry
  document.getElementById('btn-save-med-schedule')?.addEventListener('click', async () => {
    const title = document.getElementById('med-name-input')?.value.trim();
    if (!title) {
      showToast('Please enter a medication / pill name.', 'warning');
      return;
    }
    const dosage = document.getElementById('med-dosage-input')?.value.trim() || 'Take prescribed dose';
    const scheduleType = document.getElementById('med-schedule-type-select')?.value || 'daily';
    const weeklyDay = document.getElementById('med-weekly-day-select')?.value || '1';
    const doseCount = Math.max(1, Math.min(24, parseInt(document.getElementById('med-freq-count-input')?.value, 10) || 1));

    const times = [];
    for (let i = 1; i <= doseCount; i++) {
      const val = document.getElementById(`med-dose-time-${i}`)?.value || '08:00';
      times.push(val);
    }

    const health = userSettings.healthSettings || {};
    health.medications = health.medications || [];

    const medId = 'med_' + Date.now();
    health.medications.push({
      id: medId,
      title: title,
      dosage: dosage,
      scheduleType: scheduleType,
      weeklyDay: weeklyDay,
      doseCount: doseCount,
      times: times,
      takenTodayCount: 0
    });

    userSettings.healthSettings = health;
    await storage.saveSettings(userSettings);

    // Calculate next dose timestamp for ONE unified single reminder entry!
    const firstTimeStr = times[0] || '08:00';
    const [h, m] = firstTimeStr.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);

    // Filter out old individual reminders for this med if any
    activeRemindersList = activeRemindersList.filter(r => !r.id.startsWith(`med_rem_${medId}`));

    const unifiedRem = {
      id: `med_rem_${medId}`,
      title: title,
      description: `${dosage} (${doseCount} dose(s) scheduled: ${times.join(', ')})`,
      category: 'medicine',
      priority: 'high',
      repeat: scheduleType === 'weekly' ? 'weekly' : 'daily',
      repeatInterval: 1,
      time: d.getTime(),
      enabled: true,
      created: Date.now()
    };

    activeRemindersList.push(unifiedRem);
    await storage.saveReminders(activeRemindersList);

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ action: 'REFRESH_ALARMS' });
    }

    if (medModal) medModal.style.display = 'none';
    await renderHealthHub();
    renderOverview();
  });
}

function renderDynamicMedDoseTimeFields(count) {
  const container = document.getElementById('med-dose-times-container');
  if (!container) return;

  const existingTimes = [];
  container.querySelectorAll('input[type="time"]').forEach(input => {
    existingTimes.push(input.value);
  });

  container.innerHTML = '';
  const defaultTimes = ['08:00', '14:00', '20:00', '22:00', '06:00', '12:00', '18:00', '23:00'];

  for (let i = 1; i <= count; i++) {
    const defaultVal = existingTimes[i - 1] || defaultTimes[i - 1] || '08:00';
    const div = document.createElement('div');
    div.className = 'form-group';
    div.innerHTML = `
      <label class="form-label">⏰ Dose ${i} Time</label>
      <input type="time" class="input-field" id="med-dose-time-${i}" value="${defaultVal}">
    `;
    container.appendChild(div);
  }
}

function autoCalculateMedTimes() {
  const countInput = document.getElementById('med-freq-count-input');
  const count = Math.max(1, Math.min(24, parseInt(countInput?.value, 10) || 1));
  
  if (count <= 1) return;

  const dose1Input = document.getElementById('med-dose-time-1');
  const doseNInput = document.getElementById(`med-dose-time-${count}`);

  const startStr = dose1Input ? dose1Input.value : '08:00';
  const endStr = (doseNInput && count > 1) ? doseNInput.value : '22:00';

  const [h1, m1] = startStr.split(':').map(Number);
  const [hN, mN] = endStr.split(':').map(Number);

  const startMins = h1 * 60 + m1;
  let endMins = hN * 60 + mN;

  if (endMins <= startMins) {
    endMins += 24 * 60;
  }

  const totalSpan = endMins - startMins;
  const stepMins = totalSpan / (count - 1);

  for (let i = 1; i <= count; i++) {
    const doseMins = Math.round(startMins + (i - 1) * stepMins) % (24 * 60);
    const doseH = Math.floor(doseMins / 60);
    const doseM = doseMins % 60;
    const timeStr = `${String(doseH).padStart(2, '0')}:${String(doseM).padStart(2, '0')}`;
    const field = document.getElementById(`med-dose-time-${i}`);
    if (field) field.value = timeStr;
  }
}

async function syncHealthReminders(health) {
  const now = Date.now();
  let list = activeRemindersList.filter(r => !r.id.startsWith('auto_health_'));

  const waterMins = health.waterIntervalMinutes || 60;
  list.push({
    id: 'auto_health_water',
    title: '💧 Hydration Break - Drink Water',
    description: 'Drink 1 glass of water to stay hydrated and energized!',
    category: 'water',
    priority: 'medium',
    repeat: 'every_x_minutes',
    repeatInterval: waterMins,
    time: now + waterMins * 60 * 1000,
    enabled: true,
    created: now
  });

  if (health.eyeRestEnabled !== false) {
    const eyeMins = health.eyeRestIntervalMinutes || 20;
    list.push({
      id: 'auto_health_eye',
      title: '👀 Eye Rest (20-20-20 Rule)',
      description: 'Look away from your screen at an object 20 feet away for 20 seconds!',
      category: 'eye',
      priority: 'medium',
      repeat: 'every_x_minutes',
      repeatInterval: eyeMins,
      time: now + eyeMins * 60 * 1000,
      enabled: true,
      created: now
    });
  }

  if (health.postureEnabled !== false) {
    const postureMins = health.postureIntervalMinutes || 45;
    list.push({
      id: 'auto_health_posture',
      title: '🧍 Posture Check & Stretch Break',
      description: 'Adjust your back posture, roll your shoulders, and stand up to stretch!',
      category: 'posture',
      priority: 'medium',
      repeat: 'every_x_minutes',
      repeatInterval: postureMins,
      time: now + postureMins * 60 * 1000,
      enabled: true,
      created: now
    });
  }

  activeRemindersList = list;
  await storage.saveReminders(activeRemindersList);
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage({ action: 'REFRESH_ALARMS' });
  }
}

const healthEditModes = {
  water: false,
  eye: false,
  posture: false
};

function bindHealthHubCardButtonEvents() {
  // Hydration Card
  document.getElementById('btn-edit-water')?.addEventListener('click', async () => {
    healthEditModes.water = true;
    await renderHealthHub();
  });
  document.getElementById('btn-save-water')?.addEventListener('click', async () => {
    if (window._saveHealthConfig) await window._saveHealthConfig('Hydration Tracker settings saved!');
    healthEditModes.water = false;
    await renderHealthHub();
  });
  document.getElementById('btn-cancel-water')?.addEventListener('click', async () => {
    healthEditModes.water = false;
    await renderHealthHub();
  });

  // Eye Rest Card
  document.getElementById('btn-edit-eye')?.addEventListener('click', async () => {
    healthEditModes.eye = true;
    await renderHealthHub();
  });
  document.getElementById('btn-save-eye')?.addEventListener('click', async () => {
    if (window._saveHealthConfig) await window._saveHealthConfig('Eye Rest settings saved!');
    healthEditModes.eye = false;
    await renderHealthHub();
  });
  document.getElementById('btn-cancel-eye')?.addEventListener('click', async () => {
    healthEditModes.eye = false;
    await renderHealthHub();
  });

  // Posture Card
  document.getElementById('btn-edit-posture')?.addEventListener('click', async () => {
    healthEditModes.posture = true;
    await renderHealthHub();
  });
  document.getElementById('btn-save-posture')?.addEventListener('click', async () => {
    if (window._saveHealthConfig) await window._saveHealthConfig('Posture Break settings saved!');
    healthEditModes.posture = false;
    await renderHealthHub();
  });
  document.getElementById('btn-cancel-posture')?.addEventListener('click', async () => {
    healthEditModes.posture = false;
    await renderHealthHub();
  });
}

async function renderHealthHub() {
  const stats = await storage.getDailyStats();
  const health = userSettings.healthSettings || {};

  const waterGoal = health.waterGoal || 8;
  const currentWater = stats.waterGlasses || 0;

  const countLabel = document.getElementById('health-water-count-val');
  const dashUnlogWater = document.getElementById('btn-health-unlog-water');
  const dashLogWater = document.getElementById('btn-health-log-water');

  if (dashUnlogWater) dashUnlogWater.style.display = currentWater > 0 ? 'inline-block' : 'none';
  if (dashLogWater) dashLogWater.style.display = currentWater >= waterGoal ? 'none' : 'inline-block';

  if (countLabel) {
    if (currentWater >= waterGoal) {
      countLabel.innerHTML = `<span style="color: #10b981; font-weight: 700;">🎉 ${currentWater} / ${waterGoal} Glasses (Daily Goal Completed!)</span>`;
    } else {
      countLabel.textContent = `${currentWater} / ${waterGoal} Glasses`;
    }
  }

  // Hydration Card Edit/Save/Cancel State
  const isWaterEditing = !!healthEditModes.water;
  const waterGoalInput = document.getElementById('health-water-goal-input');
  if (waterGoalInput) {
    waterGoalInput.value = waterGoal;
    waterGoalInput.disabled = !isWaterEditing;
  }

  const waterFreqSelect = document.getElementById('health-water-freq-select');
  const waterCustomGroup = document.getElementById('grp-custom-water');
  const waterCustomInput = document.getElementById('health-water-custom-input');
  const wVal = health.waterIntervalMinutes || 60;
  if (waterFreqSelect) {
    waterFreqSelect.disabled = !isWaterEditing;
    if ([45, 60, 90, 120].includes(wVal)) {
      waterFreqSelect.value = String(wVal);
      if (waterCustomGroup) waterCustomGroup.style.display = 'none';
    } else {
      waterFreqSelect.value = 'custom';
      if (waterCustomGroup) waterCustomGroup.style.display = 'block';
      if (waterCustomInput) {
        waterCustomInput.value = wVal;
        waterCustomInput.disabled = !isWaterEditing;
      }
    }
  }
  const grpWater = document.getElementById('grp-btn-water');
  if (grpWater) {
    if (isWaterEditing) {
      grpWater.innerHTML = `
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-primary btn-sm" id="btn-save-water">💾 Save</button>
          <button class="btn btn-ghost btn-sm" id="btn-cancel-water">✕ Cancel</button>
        </div>
      `;
    } else {
      grpWater.innerHTML = `<button class="btn btn-secondary btn-sm" id="btn-edit-water">✏️ Edit</button>`;
    }
  }

  // Eye Rest Card Edit/Save/Cancel State
  const isEyeEditing = !!healthEditModes.eye;
  const eyeEnabled = document.getElementById('health-eye-enabled-select');
  if (eyeEnabled) {
    eyeEnabled.value = String(health.eyeRestEnabled !== false);
    eyeEnabled.disabled = !isEyeEditing;
  }

  const eyeFreqSelect = document.getElementById('health-eye-freq-select');
  const eyeCustomGroup = document.getElementById('grp-custom-eye');
  const eyeCustomInput = document.getElementById('health-eye-custom-input');
  const eVal = health.eyeRestIntervalMinutes || 20;
  if (eyeFreqSelect) {
    eyeFreqSelect.disabled = !isEyeEditing;
    if ([20, 30, 45].includes(eVal)) {
      eyeFreqSelect.value = String(eVal);
      if (eyeCustomGroup) eyeCustomGroup.style.display = 'none';
    } else {
      eyeFreqSelect.value = 'custom';
      if (eyeCustomGroup) eyeCustomGroup.style.display = 'block';
      if (eyeCustomInput) {
        eyeCustomInput.value = eVal;
        eyeCustomInput.disabled = !isEyeEditing;
      }
    }
  }
  const grpEye = document.getElementById('grp-btn-eye');
  if (grpEye) {
    if (isEyeEditing) {
      grpEye.innerHTML = `
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-primary btn-sm" id="btn-save-eye">💾 Save</button>
          <button class="btn btn-ghost btn-sm" id="btn-cancel-eye">✕ Cancel</button>
        </div>
      `;
    } else {
      grpEye.innerHTML = `<button class="btn btn-secondary btn-sm" id="btn-edit-eye">✏️ Edit</button>`;
    }
  }

  // Posture Card Edit/Save/Cancel State
  const isPostureEditing = !!healthEditModes.posture;
  const postureEnabled = document.getElementById('health-posture-enabled-select');
  if (postureEnabled) {
    postureEnabled.value = String(health.postureEnabled !== false);
    postureEnabled.disabled = !isPostureEditing;
  }

  const postureFreqSelect = document.getElementById('health-posture-freq-select');
  const postureCustomGroup = document.getElementById('grp-custom-posture');
  const postureCustomInput = document.getElementById('health-posture-custom-input');
  const pVal = health.postureIntervalMinutes || 45;
  if (postureFreqSelect) {
    postureFreqSelect.disabled = !isPostureEditing;
    if ([45, 60, 90].includes(pVal)) {
      postureFreqSelect.value = String(pVal);
      if (postureCustomGroup) postureCustomGroup.style.display = 'none';
    } else {
      postureFreqSelect.value = 'custom';
      if (postureCustomGroup) postureCustomGroup.style.display = 'block';
      if (postureCustomInput) {
        postureCustomInput.value = pVal;
        postureCustomInput.disabled = !isPostureEditing;
      }
    }
  }
  const grpPosture = document.getElementById('grp-btn-posture');
  if (grpPosture) {
    if (isPostureEditing) {
      grpPosture.innerHTML = `
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-primary btn-sm" id="btn-save-posture">💾 Save</button>
          <button class="btn btn-ghost btn-sm" id="btn-cancel-posture">✕ Cancel</button>
        </div>
      `;
    } else {
      grpPosture.innerHTML = `<button class="btn btn-secondary btn-sm" id="btn-edit-posture">✏️ Edit</button>`;
    }
  }

  bindHealthHubCardButtonEvents();

  // Render Medication Counter & List
  const medBox = document.getElementById('health-medications-list');
  const meds = health.medications || [];

  const medsCountEl = document.getElementById('health-meds-count-val');
  if (medsCountEl) {
    if (meds.length === 0) {
      medsCountEl.textContent = '0 Pills Configured';
    } else {
      let totalDoses = 0;
      let takenDoses = 0;
      meds.forEach(m => {
        totalDoses += (m.doseCount || 1);
        takenDoses += (m.takenTodayCount || 0);
      });
      medsCountEl.innerHTML = `<strong style="color: #ec4899;">${meds.length} Pill${meds.length > 1 ? 's' : ''} Active</strong> • Doses Taken: <strong style="color: ${takenDoses >= totalDoses ? '#10b981' : '#ec4899'};">${takenDoses} / ${totalDoses}</strong>`;
    }
  }

  if (medBox) {
    if (meds.length === 0) {
      medBox.innerHTML = `
        <div style="font-size: 0.825rem; color: var(--text-muted); padding: 12px 0;">
          No daily medications configured. Click "+ Add Pill" to set a pill schedule!
        </div>
      `;
    } else {
      medBox.innerHTML = meds.map(m => {
        const timesStr = Array.isArray(m.times) ? m.times.join(', ') : (m.timeStr || '08:00');
        const dosageStr = m.dosage ? ` • ${escapeHTML(m.dosage)}` : '';
        const taken = m.takenTodayCount || 0;
        const total = m.doseCount || 1;
        const isGoalMet = taken >= total;
        const cleanMedTitle = m.title ? m.title.replace(/^💊\s*/, '') : '';

        const progressStr = isGoalMet
          ? `<span style="color: #10b981; font-weight: 700;">🎉 Doses: ${taken} / ${total} (Goal Met!)</span>`
          : `<span>Doses Taken Today: <strong style="color: #ec4899;">${taken} / ${total}</strong></span>`;

        const unlogBtnHtml = taken > 0 ? `<button class="btn btn-ghost btn-sm med-unlog-btn" data-id="${m.id}" title="Undo Dose (-1)" style="padding: 4px 8px; font-size: 0.75rem;">-1</button>` : '';
        const logBtnHtml = taken < total ? `<button class="btn btn-secondary btn-sm med-log-btn" data-id="${m.id}" style="padding: 4px 12px; font-size: 0.75rem; white-space: nowrap;">+1 Dose</button>` : '';

        return `
          <div style="display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 8px; border: 1px solid var(--glass-border); margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong style="font-size: 0.95rem; color: var(--text-primary);">${escapeHTML(cleanMedTitle)}</strong>
                <div style="font-size: 0.775rem; color: var(--text-secondary); margin-top: 2px;">
                  Schedule: <strong>${timesStr}</strong>${dosageStr}
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 6px;">
                ${unlogBtnHtml}
                ${logBtnHtml}
                <button class="btn btn-ghost btn-sm med-del-btn" data-id="${m.id}" style="color: var(--text-muted); padding: 4px 6px;" title="Delete Medication">🗑️</button>
              </div>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-secondary); display: flex; justify-content: space-between; align-items: center;">
              ${progressStr}
            </div>
          </div>
        `;
      }).join('');

      medBox.querySelectorAll('.med-log-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.dataset.id;
          const doLog = async () => {
            const s = await storage.getSettings();
            const h = s.healthSettings || {};
            const medList = h.medications || [];
            const m = medList.find(x => x.id === id);
            if (m) {
              m.takenTodayCount = Math.min(m.doseCount || 1, (m.takenTodayCount || 0) + 1);
              s.healthSettings = h;
              await storage.saveSettings(s);
              userSettings = s;
            }
            await renderHealthHub();
            renderOverview();
          };

          const medRem = activeRemindersList.find(r => r.category === 'medicine');
          if (medRem && medRem.time > Date.now() + 10 * 60 * 1000) {
            promptDashEarlyLogConfirm(
              '💊',
              'Medication Check',
              `You are logging this medicine earlier than scheduled (${formatRelativeTime(medRem.time)}). Did you take it early or forget to log earlier?`,
              doLog
            );
          } else {
            await doLog();
          }
        });
      });

      medBox.querySelectorAll('.med-unlog-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.dataset.id;
          const s = await storage.getSettings();
          const h = s.healthSettings || {};
          const medList = h.medications || [];
          const m = medList.find(x => x.id === id);
          if (m) {
            m.takenTodayCount = Math.max(0, (m.takenTodayCount || 0) - 1);
            s.healthSettings = h;
            await storage.saveSettings(s);
            userSettings = s;
          }
          await renderHealthHub();
          renderOverview();
        });
      });

      medBox.querySelectorAll('.med-del-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.dataset.id;
          health.medications = (health.medications || []).filter(m => m.id !== id);
          userSettings.healthSettings = health;
          await storage.saveSettings(userSettings);

          // Also remove associated active medication reminders
          activeRemindersList = activeRemindersList.filter(r => !r.id.startsWith(`med_rem_${id}`));
          await storage.saveReminders(activeRemindersList);
          if (typeof chrome !== 'undefined' && chrome.runtime) {
            chrome.runtime.sendMessage({ action: 'REFRESH_ALARMS' });
          }

          renderHealthHub();
          renderOverview();
        });
      });
    }
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}
