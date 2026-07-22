/**
 * Reminderly Alarms & Scheduler Engine
 */

import { storage } from '../common/storage.js';
import { soundEngine } from '../common/audio.js';
import { isDomainMatch } from '../common/utils.js';

export function calculateNextFutureTime(reminder, now = Date.now()) {
  if (!reminder || !reminder.repeat || reminder.repeat === 'once') return null;

  const interval = reminder.repeatInterval || 1;
  let intervalMs = 24 * 3600 * 1000;

  switch (reminder.repeat) {
    case 'every_x_minutes':
      intervalMs = Math.max(1, interval) * 60 * 1000;
      break;
    case 'every_x_hours':
      intervalMs = Math.max(1, interval) * 3600 * 1000;
      break;
    case 'daily':
      intervalMs = 24 * 3600 * 1000 * interval;
      break;
    case 'weekly':
      intervalMs = 7 * 24 * 3600 * 1000 * interval;
      break;
    case 'monthly':
      intervalMs = 30 * 24 * 3600 * 1000 * interval;
      break;
    case 'every_x_days':
      intervalMs = Math.max(1, interval) * 24 * 3600 * 1000;
      break;
  }

  let nextTime = reminder.time || now;
  // Keep advancing nextTime by intervalMs until it is strictly in the future (> now)
  while (nextTime <= now) {
    nextTime += intervalMs;
  }
  return nextTime;
}

export async function setupAlarms() {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;

  await chrome.alarms.clearAll();
  await checkAutoArchiveAndCleanup();
  await ensureAutoHealthReminders();

  const reminders = await storage.getReminders();
  const now = Date.now();

  for (const rem of reminders) {
    if (rem.enabled !== false && rem.time) {
      if (rem.time <= now) {
        if (rem.repeat && rem.repeat !== 'once') {
          // Time passed while Chrome was closed: advance repeating reminder to next future time without firing old past notifications!
          rem.time = calculateNextFutureTime(rem, now);
        } else {
          // One-time reminder whose time has already passed: disable it without showing old past notification!
          rem.enabled = false;
        }
      }

      if (rem.enabled !== false && rem.time && rem.time > now) {
        const delayMs = rem.time - now;
        chrome.alarms.create(rem.id, { when: Date.now() + delayMs });
      }
    }
  }
  await storage.saveReminders(reminders);

  // Background heart-beat / sync alarm every 1 minute
  chrome.alarms.create('reminderly_system_check', { periodInMinutes: 1 });
}

async function ensureAutoHealthReminders() {
  const settings = await storage.getSettings();
  const health = settings.healthSettings || {};
  let reminders = await storage.getReminders();
  const now = Date.now();
  let modified = false;

  // Water Hydration
  const waterMins = health.waterIntervalMinutes || 60;
  if (!reminders.some(r => r.id === 'auto_health_water')) {
    reminders.push({
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
    modified = true;
  }

  // Eye Rest (20-20-20 rule)
  if (health.eyeRestEnabled !== false) {
    const eyeMins = health.eyeRestIntervalMinutes || 20;
    if (!reminders.some(r => r.id === 'auto_health_eye')) {
      reminders.push({
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
      modified = true;
    }
  }

  // Posture & Stretch Check
  if (health.postureEnabled !== false) {
    const postureMins = health.postureIntervalMinutes || 45;
    if (!reminders.some(r => r.id === 'auto_health_posture')) {
      reminders.push({
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
      modified = true;
    }
  }

  if (modified) {
    await storage.saveReminders(reminders);
  }
}

export async function handleAlarmTriggered(alarm) {
  if (alarm.name === 'reminderly_system_check') {
    await checkFocusTimerExpired();
    await checkAutoArchiveAndCleanup();
    return;
  }

  const reminders = await storage.getReminders();
  const reminder = reminders.find(r => r.id === alarm.name);
  if (!reminder || !reminder.enabled) return;

  const now = Date.now();

  // If this reminder was scheduled for a time in the past (e.g. Chrome was closed or system was asleep for > 3 minutes), do NOT fire stale notification!
  if (reminder.time && (now - reminder.time > 3 * 60 * 1000)) {
    if (reminder.repeat && reminder.repeat !== 'once') {
      await rescheduleRepeatReminder(reminder);
    } else {
      reminder.enabled = false;
      await storage.saveReminders(reminders);
      await storage.archiveReminder(reminder);
    }
    return;
  }

  const settings = await storage.getSettings();
  const focusState = await storage.getFocusState();
  const isFocusActive = focusState && focusState.active && Date.now() < focusState.endTime;

  // Check current active tab context
  const activeTab = await getActiveTab();
  const activeUrl = activeTab ? activeTab.url : '';
  const isPrioritySite = isDomainMatch(activeUrl, settings.priorityWebsites);

  // Context Awareness Rules:
  // 1. Health Hub items (Eye Rest, Posture, Water, Medicine) & Critical priority: ALWAYS show immediately
  // 2. High priority: Show unless in Focus Mode
  // 3. Medium & Low priority: Pause & queue if on Priority Site or in Focus Mode
  const isHealthItem = reminder.id.startsWith('auto_health_') || reminder.category === 'medicine' || reminder.category === 'water';
  const isCritical = reminder.priority === 'critical' || isHealthItem;
  const isHigh = reminder.priority === 'high';

  let shouldQueue = false;

  if (!isCritical) {
    if (isFocusActive) {
      shouldQueue = true; // Focus mode pauses non-critical
    } else if (isPrioritySite && !isHigh) {
      shouldQueue = true; // Priority site pauses low and medium
    }
  }

  if (shouldQueue) {
    // Queue silently
    const queue = await storage.getPendingQueue();
    if (!queue.some(q => q.id === reminder.id)) {
      queue.push({ ...reminder, queuedAt: Date.now() });
      await storage.savePendingQueue(queue);
    }
  } else {
    // Deliver reminder immediately
    await deliverReminder(reminder, activeTab, settings);
  }

  // Reschedule repeating reminder if applicable
  await rescheduleRepeatReminder(reminder);
}

async function deliverReminder(reminder, activeTab, settings) {
  // Check if this is a water reminder and if daily goal has already been met!
  if (reminder.category === 'water' || reminder.id === 'auto_health_water') {
    const stats = await storage.getDailyStats();
    const targetGoal = settings.healthSettings?.waterGoal || settings.waterGoalGlasses || 8;
    if ((stats.waterGlasses || 0) >= targetGoal) {
      // Goal met for today! Skip reminder delivery & reschedule for next cycle
      await rescheduleRepeatReminder(reminder);
      return;
    }
  }

  // Save active reminder in storage so page refreshes re-display it until completed/snoozed/skipped!
  await storage.saveActiveReminder(reminder);
  const activeQueue = await storage.getActiveQueue();

  // 1. Try to display floating Remi mascot strictly on the single active focused tab
  let deliveredToTab = false;
  const mascotEnabled = settings.mascot?.enabled !== false;

  if (mascotEnabled) {
    const tabs = await new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.tabs) return resolve([]);
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (result) => resolve(result || []));
    });
    let targetTab = (tabs && tabs.length > 0) ? tabs[0] : (activeTab || null);

    if (!targetTab) {
      const allActiveTabs = await new Promise((resolve) => {
        if (typeof chrome === 'undefined' || !chrome.tabs) return resolve([]);
        chrome.tabs.query({ active: true }, (result) => resolve(result || []));
      });
      if (allActiveTabs && allActiveTabs.length > 0) targetTab = allActiveTabs[0];
    }

    if (targetTab && targetTab.id && targetTab.url && !targetTab.url.startsWith('chrome://') && !targetTab.url.startsWith('chrome-extension://')) {
      try {
        await chrome.tabs.sendMessage(targetTab.id, {
          action: 'SHOW_REMI_REMINDER',
          reminder: reminder,
          queue: activeQueue
        });
        deliveredToTab = true;
      } catch (err) {
        // Content script missing on tab! Inject scripts now and retry delivery!
        try {
          if (chrome.scripting) {
            await chrome.scripting.insertCSS({
              target: { tabId: targetTab.id },
              files: ['css/design-system.css', 'css/content.css', 'css/mascot.css']
            }).catch(() => {});
            
            await chrome.scripting.executeScript({
              target: { tabId: targetTab.id },
              files: ['js/content/content-script.js']
            }).catch(() => {});

            const ok = await new Promise((resolve) => {
              setTimeout(async () => {
                try {
                  await chrome.tabs.sendMessage(targetTab.id, {
                    action: 'SHOW_REMI_REMINDER',
                    reminder: reminder,
                    queue: activeQueue
                  });
                  resolve(true);
                } catch (e) {
                  resolve(false);
                }
              }, 120);
            });
            if (ok) deliveredToTab = true;
          }
        } catch (e) {}
      }
    }
  }

  // 2. System notification delivery: ALWAYS trigger native macOS notification when Chrome is minimized or not focused!
  if (!deliveredToTab || (typeof document !== 'undefined' && document.hidden)) {
    reminder._deliveredAsSystemNotification = true;
    await storage.saveActiveReminder(reminder);
    showSystemNotification(reminder);
  } else {
    reminder._deliveredAsSystemNotification = false;
    await storage.saveActiveReminder(reminder);
  }
}

function showSystemNotification(reminder) {
  if (typeof chrome === 'undefined' || !chrome.notifications) return;
  const iconUrl = (typeof chrome.runtime !== 'undefined' && chrome.runtime.getURL)
    ? chrome.runtime.getURL('icons/128x128.png')
    : 'icons/128x128.png';

  const buttons = reminder.isPeriodReminder
    ? [{ title: 'Got it 🩸' }, { title: '📅 Remind Tomorrow' }]
    : [{ title: 'Done' }, { title: 'Snooze 10m' }];

  chrome.notifications.create(reminder.id, {
    type: 'basic',
    iconUrl: iconUrl,
    title: `${reminder.title}`,
    message: reminder.description || 'Time to complete your task!',
    priority: reminder.priority === 'critical' ? 2 : 1,
    buttons
  });
}

async function rescheduleRepeatReminder(reminder) {
  if (!reminder || !reminder.repeat || reminder.repeat === 'once') return;

  const now = Date.now();
  const nextTime = calculateNextFutureTime(reminder, now);

  const reminders = await storage.getReminders();
  const idx = reminders.findIndex(r => r.id === reminder.id);
  if (idx !== -1 && nextTime) {
    reminders[idx].time = nextTime;
    await storage.saveReminders(reminders);
    chrome.alarms.create(reminder.id, { when: nextTime });
  }
}

export async function snoozeReminder(reminderId, minutes = 10) {
  const remainingQueue = await storage.removeFromActiveQueue(reminderId);

  if (typeof chrome !== 'undefined' && chrome.tabs) {
    if (remainingQueue.length === 0) {
      chrome.tabs.query({}, (tabs) => {
        tabs?.forEach(t => { if (t.id) try { chrome.tabs.sendMessage(t.id, { action: 'HIDE_REMI_REMINDER' }).catch(() => {}); } catch(e){} });
      });
    } else {
      // Send updated queue strictly to the active focused tab to update in place
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        if (tabs && tabs.length > 0 && tabs[0].id) {
          try {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'SHOW_REMI_REMINDER',
              reminder: remainingQueue[0],
              queue: remainingQueue
            }).catch(() => {});
          } catch (e) {}
        }
      });
    }
  }

  const snoozeTime = Date.now() + minutes * 60 * 1000;

  // Persist snooze target time in storage so UI countdown reflects snooze and next repeat cycle calculates from snooze completion
  const reminders = await storage.getReminders();
  const idx = reminders.findIndex(r => r.id === reminderId);
  if (idx !== -1) {
    reminders[idx].time = snoozeTime;
    await storage.saveReminders(reminders);
  }

  chrome.alarms.create(reminderId, { when: snoozeTime });
}

async function checkFocusTimerExpired() {
  const focusState = await storage.getFocusState();
  if (focusState && focusState.active && !focusState.paused && focusState.endTime && Date.now() >= focusState.endTime) {
    // Focus Mode Completed!
    await storage.saveFocusState({ active: false, endTime: null, durationMinutes: 0, startTime: null });
    
    // Increment focus minutes in daily stats
    await storage.updateDailyStats(current => ({
      ...current,
      focusMinutesToday: (current.focusMinutesToday || 0) + (focusState.durationMinutes || 25)
    }));

    // Notify active tab to trigger celebration
    const activeTab = await getActiveTab();
    if (activeTab && activeTab.id) {
      try {
        await chrome.tabs.sendMessage(activeTab.id, { action: 'FOCUS_COMPLETED_CELEBRATION' }).catch(() => {});
      } catch (e) {}
    }
  }
}

async function getActiveTab() {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.tabs) return resolve(null);
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0) return resolve(tabs[0]);
      chrome.tabs.query({ active: true }, (allActive) => {
        resolve(allActive && allActive.length > 0 ? allActive[0] : null);
      });
    });
  });
}

export async function checkAutoArchiveAndCleanup() {
  try {
    const settings = await storage.getSettings();

    // 1. Auto-Archive Passed One-Time Reminders
    if (settings.autoArchivePassed !== false) {
      const reminders = await storage.getReminders();
      const now = Date.now();
      const active = [];

      for (const r of reminders) {
        if (r.repeat === 'once' && r.time && r.time <= now - 5 * 60 * 1000) {
          await storage.archiveReminder(r);
        } else {
          active.push(r);
        }
      }

      if (active.length !== reminders.length) {
        await storage.saveReminders(active);
      }
    }

    // 2. Auto-Delete Old Archived Reminders
    const deleteDaysStr = settings.autoDeleteArchiveDays || 'never';
    if (deleteDaysStr !== 'never') {
      const daysMap = { '7_days': 7, '30_days': 30, '90_days': 90 };
      const maxDays = daysMap[deleteDaysStr] || 30;
      const maxAgeMs = maxDays * 24 * 3600 * 1000;
      const now = Date.now();

      const archived = await storage.getArchivedReminders();
      const remaining = archived.filter(a => {
        const age = now - (a.archivedAt || now);
        return age < maxAgeMs;
      });

      if (remaining.length !== archived.length) {
        await storage.saveArchivedReminders(remaining);
      }
    }
  } catch (e) {
    console.warn('[AutoArchive] Cleanup error:', e);
  }
}
