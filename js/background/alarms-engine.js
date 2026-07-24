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
  await syncPeriodReminderState();

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

  const syncRem = (id, title, desc, cat, defaultMins, isEnabled) => {
    const mins = health[`${cat === 'water' ? 'waterIntervalMinutes' : cat === 'eye' ? 'eyeRestIntervalMinutes' : 'postureIntervalMinutes'}`] || defaultMins;
    const existing = reminders.find(r => r.id === id);
    if (existing) {
      if (existing.enabled !== isEnabled || existing.repeatInterval !== mins) {
        existing.enabled = isEnabled;
        existing.repeatInterval = mins;
        modified = true;
      }
    } else {
      reminders.push({
        id: id,
        title: title,
        description: desc,
        category: cat,
        priority: 'medium',
        repeat: 'every_x_minutes',
        repeatInterval: mins,
        time: now + mins * 60 * 1000,
        enabled: isEnabled,
        created: now
      });
      modified = true;
    }
  };

  syncRem(
    'auto_health_water',
    '💧 Hydration Break - Drink Water',
    'Time for a quick hydration break! Take a sip of water to stay refreshed, focused, and healthy. 🥛✨',
    'water',
    60,
    health.waterEnabled !== false
  );

  syncRem(
    'auto_health_eye',
    '👀 Eye Rest',
    "Now's the time to follow the 20-20-20 rule! Look at an object 20 feet away for 20 seconds to protect your eyes. 👀✨",
    'eye',
    20,
    health.eyeRestEnabled !== false
  );

  syncRem(
    'auto_health_posture',
    '🧍 Posture Check & Stretch Break',
    'Time for a quick posture break! Stretch your spine, roll your shoulders back, and stand up to stay energized. 🧍✨',
    'posture',
    45,
    health.postureEnabled !== false
  );

  if (modified) {
    await storage.saveReminders(reminders);
  }
}

export async function handleAlarmTriggered(alarm) {
  if (alarm.name === 'reminderly_focus_timer_end') {
    await completeFocusMode();
    return;
  }

  if (alarm.name === 'reminderly_system_check') {
    await checkFocusTimerExpired();
    await checkAutoArchiveAndCleanup();
    await syncPeriodReminderState();
    return;
  }

  if (alarm.name === 'reminderly_period_alert_start') {
    await syncPeriodReminderState();
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
  const isContextEnabled = settings.contextAwarenessEnabled !== false;
  const isPrioritySite = isContextEnabled && isDomainMatch(activeUrl, settings.priorityWebsites);
  const blockMode = settings.contextBlockMode || 'remi_overlay';

  // Context Awareness Rules:
  // 1. Health Hub items (Eye Rest, Posture, Water, Medicine) & Critical priority: ALWAYS show immediately
  // 2. High priority: Show unless in Focus Mode
  // 3. Medium & Low priority: Queue or suppress overlay if on Priority Site
  const isHealthItem = reminder.id.startsWith('auto_health_') || reminder.category === 'medicine' || reminder.category === 'water';
  const isCritical = reminder.priority === 'critical' || isHealthItem;
  const isHigh = reminder.priority === 'high';

  let shouldQueue = false;

  if (!isCritical) {
    if (isFocusActive) {
      shouldQueue = true; // Focus mode pauses non-critical
    } else if (isPrioritySite && !isHigh) {
      if (blockMode === 'all_notifications') {
        shouldQueue = true; // All notifications mode: queue overall
      } else {
        // remi_overlay mode: deliver system notification but suppress Remi overlay on work tab!
        reminder._suppressRemiOverlay = true;
      }
    }
  }

  if (shouldQueue) {
    // Queue silently
    const queue = await storage.getPendingQueue();
    if (!queue.some(q => q.id === reminder.id)) {
      queue.push({ ...reminder, _wasDelayedByFocus: isFocusActive, queuedAt: Date.now() });
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
  // Format medication dose tag dynamically (e.g. Dose 2/6 or fiy (Dose 2/6))
  if (reminder.category === 'medicine' || reminder.id.startsWith('med_rem_')) {
    const medId = reminder.id.replace('med_rem_', '');
    const health = settings.healthSettings || {};
    const medList = health.medications || [];
    const med = medList.find(m => m.id === medId || m.id === 'med_' + medId || reminder.title.includes(m.name));

    let currentDose = 1;
    let totalDoses = 1;

    if (med) {
      currentDose = Math.min((med.takenTodayCount || 0) + 1, med.doseCount || 1);
      totalDoses = med.doseCount || 1;
    } else {
      const match = reminder.description ? reminder.description.match(/(\d+)\s*dose\(s\)\s*scheduled/i) : null;
      if (match) {
        totalDoses = parseInt(match[1], 10) || 1;
      }
    }

    const doseTag = `Dose ${currentDose}/${totalDoses}`;
    let baseDosage = reminder.description || '';
    baseDosage = baseDosage.replace(/\s*\(\d+\s*dose\(s\)\s*scheduled:.*?\)/gi, '')
                           .replace(/\s*\(Dose\s*\d+\/\d+\)/gi, '')
                           .trim();

    if (baseDosage && baseDosage !== 'Take prescribed dose' && !baseDosage.startsWith('Dose ')) {
      reminder.description = `${baseDosage} (${doseTag})`;
    } else {
      reminder.description = doseTag;
    }
  }

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
  const mascotEnabled = (settings.mascot?.enabled !== false) && !reminder._suppressRemiOverlay;

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

export async function playBackgroundAudio(soundTone = 'chime', volume = 100) {
  try {
    if (typeof chrome !== 'undefined' && chrome.offscreen) {
      const hasDoc = await chrome.offscreen.hasDocument();
      if (!hasDoc) {
        await chrome.offscreen.createDocument({
          url: 'offscreen/offscreen.html',
          reasons: ['AUDIO_PLAYBACK'],
          justification: 'Play reminder sound chime for system notifications'
        });
      }
      chrome.runtime.sendMessage({
        action: 'PLAY_BACKGROUND_SOUND',
        soundTone,
        volume
      }).catch(() => {});
    }
  } catch (e) {
    console.error('Failed to play offscreen background audio:', e);
  }
}

async function showSystemNotification(reminder) {
  if (typeof chrome === 'undefined' || !chrome.notifications) return;

  const settings = await storage.getSettings();
  if (settings.soundEnabled !== false) {
    playBackgroundAudio(settings.soundTone, settings.volume);
  }

  const iconUrl = (typeof chrome.runtime !== 'undefined' && chrome.runtime.getURL)
    ? chrome.runtime.getURL('icons/128x128.png')
    : 'icons/128x128.png';

  const isPeriod = reminder.isPeriodReminder || reminder.id === 'auto_period_reminder' || reminder.category === 'period';
  const buttons = isPeriod
    ? [{ title: 'Got it 👍' }]
    : [{ title: 'Done' }, { title: 'Snooze 10m' }];

  const notifId = `${reminder.id}::${Date.now()}`;
  chrome.notifications.create(notifId, {
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

export async function completeFocusMode() {
  const focusState = await storage.getFocusState();
  if (focusState && focusState.active && (!focusState.endTime || Date.now() >= focusState.endTime || !focusState.paused)) {
    const duration = focusState.durationMinutes || 25;

    // Focus Mode Completed!
    await storage.saveFocusState({ active: false, paused: false, remainingMs: null, endTime: null, durationMinutes: 0, startTime: null, pinned: focusState.pinned });
    
    // Increment focus minutes in daily stats
    await storage.updateDailyStats(current => ({
      ...current,
      focusMinutesToday: (current.focusMinutesToday || 0) + duration
    }));

    // 1. Move pending queue items to active queue with _wasDelayedByFocus flag
    const pendingQueue = await storage.getPendingQueue();
    if (pendingQueue && pendingQueue.length > 0) {
      for (const rem of pendingQueue) {
        rem._wasDelayedByFocus = true;
        await storage.saveActiveReminder(rem);
      }
      await storage.clearPendingQueue();
    }

    // 2. Deliver Focus Completed Celebration via Remi Assistant on active tab
    let deliveredToTab = false;
    const targetTab = await getActiveTab();

    if (targetTab && targetTab.id && targetTab.url && !targetTab.url.startsWith('chrome://') && !targetTab.url.startsWith('chrome-extension://')) {
      try {
        await chrome.tabs.sendMessage(targetTab.id, {
          action: 'FOCUS_COMPLETED_CELEBRATION',
          durationMinutes: duration
        });
        deliveredToTab = true;
      } catch (err) {
        // Content script missing on active tab! Inject scripts now and retry delivery!
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
                    action: 'FOCUS_COMPLETED_CELEBRATION',
                    durationMinutes: duration
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

    // 3. Fallback: Native system notification if Chrome is minimized or not on an active webpage
    if (!deliveredToTab && typeof chrome !== 'undefined' && chrome.notifications) {
      const iconUrl = (typeof chrome.runtime !== 'undefined' && chrome.runtime.getURL)
        ? chrome.runtime.getURL('icons/128x128.png')
        : 'icons/128x128.png';

      chrome.notifications.create('focus_completed_' + Date.now(), {
        type: 'basic',
        iconUrl: iconUrl,
        title: '🎉 Focus Session Completed!',
        message: `Fantastic job staying focused and productive for ${duration} minute${duration === 1 ? '' : 's'}!`,
        priority: 2
      });
    }
  }
}

export async function checkFocusTimerExpired() {
  const focusState = await storage.getFocusState();
  if (focusState && focusState.active && !focusState.paused && focusState.endTime && Date.now() >= focusState.endTime) {
    await completeFocusMode();
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

export async function syncPeriodReminderState() {
  const settings = await storage.getSettings();
  const pc = settings.periodTracker || {};
  const profile = settings.userProfile || {};

  const isEnabled = profile.gender === 'female' && !!pc.trackingEnabled && !!pc.lastPeriodDate;
  const remindDays = pc.remindDaysBefore ?? 3;
  const remindTime = pc.remindTime || '09:00';
  const cycleLength = pc.cycleLength || 28;

  const reminders = await storage.getReminders();
  let cleaned = reminders.filter(r => r.id !== 'auto_period_reminder');

  // Always remove auto_period_reminder if period tracking is disabled or remindDays <= 0
  if (!isEnabled || remindDays <= 0) {
    if (cleaned.length !== reminders.length) {
      await storage.saveReminders(cleaned);
    }
    await storage.removeFromActiveQueue('auto_period_reminder');
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      chrome.alarms.clear('reminderly_period_alert_start');
    }
    return;
  }

  // Calculate current cycle progress & next period start date
  const today = new Date(); today.setHours(0,0,0,0);
  const last = parseLocalDate(pc.lastPeriodDate);
  const daysSince = Math.floor((today - last) / 86400000);
  const cyclesSince = Math.floor(daysSince / cycleLength);
  const nextPeriod = new Date(last.getTime() + (cyclesSince + 1) * cycleLength * 86400000);
  const [rHour, rMin] = remindTime.split(':').map(Number);

  // Exact days left until next period
  const diffDays = Math.ceil((nextPeriod.getTime() - today.getTime()) / 86400000);

  // Start date when pre-period reminders should begin (e.g. 3 days before period)
  const startNotificationDate = new Date(nextPeriod);
  startNotificationDate.setDate(startNotificationDate.getDate() - remindDays);
  startNotificationDate.setHours(rHour, rMin, 0, 0);

  const nowMs = Date.now();

  // RULE: Only show in active reminders list when within pre-period window (diffDays <= remindDays && nowMs >= startNotificationDate.getTime())
  const isWithinReminderWindow = diffDays <= remindDays && nowMs >= (startNotificationDate.getTime() - 60000);

  if (isWithinReminderWindow) {
    let title = '';
    let description = '';
    if (diffDays === 1) {
      title = '🌸 Period Tomorrow — Be Prepared!';
      description = 'Your period is expected tomorrow 🩸 Make sure you have supplies ready and keep comfortable 💕';
    } else if (diffDays === 0) {
      title = '🌸 Period Starting Today 🩸';
      description = 'Your period is expected today! Stay hydrated, comfortable, and keep supplies ready 💕';
    } else if (diffDays <= 3) {
      title = `🌸 Period in ${diffDays} Days — Heads Up!`;
      description = `Your period is expected in ${diffDays} days (${nextPeriod.toLocaleDateString()}) 🩸 Stock up on supplies, stay hydrated & take care of yourself 💕`;
    } else {
      title = `🌸 Period in ${diffDays} Days — Plan Ahead!`;
      description = `Your period is expected in ${diffDays} days (${nextPeriod.toLocaleDateString()}) 🩸 A good time to check your supplies & plan some self-care 💕`;
    }

    let targetTime = new Date();
    targetTime.setHours(rHour, rMin, 0, 0);
    if (targetTime.getTime() < nowMs) {
      targetTime.setDate(targetTime.getDate() + 1);
    }

    const periodReminder = {
      id: 'auto_period_reminder',
      title: title,
      description: description,
      category: 'health',
      priority: diffDays <= 2 ? 'high' : 'medium',
      repeat: 'daily',
      repeatInterval: 1,
      time: targetTime.getTime(),
      enabled: true,
      isPeriodReminder: true,
      remindDaysBefore: remindDays,
      createdAt: Date.now(),
      completedCount: 0
    };

    cleaned.push(periodReminder);
    await storage.saveReminders(cleaned);
  } else {
    // NOT IN PRE-PERIOD WINDOW (e.g. period is 27 days away):
    // 1. Remove from active reminders list so it does NOT clog up table!
    if (cleaned.length !== reminders.length) {
      await storage.saveReminders(cleaned);
    }
    // 2. Remove from active queue
    await storage.removeFromActiveQueue('auto_period_reminder');

    // 3. Schedule Chrome Alarm to wake up on startNotificationDate!
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      const alarmTime = Math.max(nowMs + 5000, startNotificationDate.getTime());
      chrome.alarms.create('reminderly_period_alert_start', { when: alarmTime });
    }
  }
}

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

export async function logPeriodStart(customDateStr = null, daysBackOffset = 0) {
  const settings = await storage.getSettings();
  const pc = settings.periodTracker || {};

  let startDate = new Date();
  if (customDateStr) {
    startDate = parseLocalDate(customDateStr);
  }
  if (daysBackOffset > 0) {
    startDate.setDate(startDate.getDate() - daysBackOffset);
  }
  startDate.setHours(0, 0, 0, 0);

  const year = startDate.getFullYear();
  const month = String(startDate.getMonth() + 1).padStart(2, '0');
  const day = String(startDate.getDate()).padStart(2, '0');
  const newLastDateStr = `${year}-${month}-${day}`;
  const prevDateStr = pc.lastPeriodDate || null;

  const updatedPc = {
    ...pc,
    trackingEnabled: true,
    previousLastPeriodDate: prevDateStr,
    periodLoggedAt: Date.now(),
    lastPeriodDate: newLastDateStr
  };

  settings.periodTracker = updatedPc;
  await storage.saveSettings(settings);

  // Sync state & update reminders list
  await syncPeriodReminderState();

  if (typeof chrome !== 'undefined' && chrome.alarms) {
    await setupAlarms();
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: 'PERIOD_LOGGED' }).catch(() => {});
  }

  return { success: true, lastPeriodDate: newLastDateStr, previousLastPeriodDate: prevDateStr, settings };
}

export async function revertPeriodStart() {
  const settings = await storage.getSettings();
  const pc = settings.periodTracker || {};
  if (!pc.previousLastPeriodDate) return { success: false };

  const restoredDateStr = pc.previousLastPeriodDate;
  const updatedPc = {
    ...pc,
    lastPeriodDate: restoredDateStr,
    previousLastPeriodDate: null,
    periodLoggedAt: null
  };

  settings.periodTracker = updatedPc;
  await storage.saveSettings(settings);

  await syncPeriodReminderState();

  if (typeof chrome !== 'undefined' && chrome.alarms) {
    await setupAlarms();
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: 'PERIOD_LOGGED' }).catch(() => {});
  }

  return { success: true, restoredDate: restoredDateStr, settings };
}
