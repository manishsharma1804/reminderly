/**
 * Reminderly Main Service Worker (MV3)
 */

import { setupAlarms, handleAlarmTriggered, snoozeReminder } from './alarms-engine.js';
import { initContextDetector } from './context-detector.js';
import { initFocusManager, tempAllowDomain } from './focus-manager.js';
import { storage } from '../common/storage.js';

// Installation & Activation Lifecycle
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Reminderly] Extension installed/updated:', details.reason);
  await storage.getSettings(); // Initialize default settings if first run
  await storage.getReminders(); // Initialize seed reminders
  await setupAlarms();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[Reminderly] Browser startup - refreshing alarms');
  await setupAlarms();
});

// Initialize Background Controllers
initContextDetector();
initFocusManager();

// Global Keyboard Shortcuts Listener (Alt+R, Alt+F, Alt+D)
if (chrome.commands) {
  chrome.commands.onCommand.addListener(async (command) => {
    console.log('[Reminderly] Command shortcut triggered:', command);
    if (command === 'add_quick_reminder') {
      const dashboardUrl = chrome.runtime.getURL('dashboard/dashboard.html?action=new_reminder');
      chrome.tabs.query({ url: chrome.runtime.getURL('dashboard/dashboard.html*') }, (tabs) => {
        if (tabs && tabs.length > 0 && tabs[0].id) {
          chrome.tabs.update(tabs[0].id, { active: true, url: dashboardUrl });
          if (tabs[0].windowId) chrome.windows.update(tabs[0].windowId, { focused: true });
        } else {
          chrome.tabs.create({ url: dashboardUrl });
        }
      });
    } else if (command === 'toggle_focus_mode') {
      const focusState = await storage.getFocusState();
      if (focusState && focusState.active) {
        await storage.saveFocusState({ active: false, paused: false, remainingMs: null, endTime: null, durationMinutes: 0, startTime: null });
      } else {
        const duration = 25;
        const startTime = Date.now();
        const endTime = startTime + duration * 60 * 1000;
        await storage.saveFocusState({ active: true, paused: false, startTime, endTime, durationMinutes: duration });
      }
    } else if (command === 'open_dashboard') {
      const dashboardUrl = chrome.runtime.getURL('dashboard/dashboard.html');
      chrome.tabs.query({ url: chrome.runtime.getURL('dashboard/dashboard.html*') }, (tabs) => {
        if (tabs && tabs.length > 0 && tabs[0].id) {
          chrome.tabs.update(tabs[0].id, { active: true });
          if (tabs[0].windowId) chrome.windows.update(tabs[0].windowId, { focused: true });
        } else {
          chrome.tabs.create({ url: dashboardUrl });
        }
      });
    }
  });
}

// Alarm Listener
chrome.alarms.onAlarm.addListener(async (alarm) => {
  await handleAlarmTriggered(alarm);
});

// Notification Button Handler
if (chrome.notifications) {
  chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
    const reminders = await storage.getReminders();
    const reminder = reminders.find(r => r.id === notificationId);
    if (buttonIndex === 0) {
      // Done / "Got it 🩸"
      await markReminderDone(notificationId);
    } else if (buttonIndex === 1) {
      // Snooze
      const settings = await storage.getSettings();
      const defaultMins = settings.defaultSnoozeMinutes || 10;
      const snoozeMinutes = reminder?.isPeriodReminder ? 1440 : defaultMins;
      await snoozeReminder(notificationId, snoozeMinutes);
    }
    chrome.notifications.clear(notificationId);
  });
}

// Runtime Message Dispatcher
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    switch (request.action) {
      case 'REFRESH_ALARMS':
        await setupAlarms();
        sendResponse({ success: true });
        break;

      case 'MARK_DONE':
        await markReminderDone(request.id);
        sendResponse({ success: true });
        break;

      case 'SNOOZE_REMINDER': {
        const settings = await storage.getSettings();
        const mins = request.minutes || settings.defaultSnoozeMinutes || 10;
        await snoozeReminder(request.id, mins);
        sendResponse({ success: true });
        break;
      }

      case 'SKIP_REMINDER':
        await markReminderSkipped(request.id);
        sendResponse({ success: true });
        break;

      case 'START_FOCUS_MODE':
        const endTime = Date.now() + request.durationMinutes * 60 * 1000;
        await storage.saveFocusState({
          active: true,
          paused: false,
          remainingMs: null,
          endTime: endTime,
          durationMinutes: request.durationMinutes,
          startTime: Date.now()
        });
        sendResponse({ success: true });
        break;

      case 'PAUSE_FOCUS_MODE': {
        const current = await storage.getFocusState();
        if (current && current.active && !current.paused && current.endTime) {
          const remainingMs = Math.max(0, current.endTime - Date.now());
          await storage.saveFocusState({
            ...current,
            paused: true,
            remainingMs: remainingMs,
            endTime: null
          });
        }
        sendResponse({ success: true });
        break;
      }

      case 'RESUME_FOCUS_MODE': {
        const current = await storage.getFocusState();
        if (current && current.active && current.paused && current.remainingMs) {
          const newEndTime = Date.now() + current.remainingMs;
          await storage.saveFocusState({
            ...current,
            paused: false,
            remainingMs: null,
            endTime: newEndTime
          });
        }
        sendResponse({ success: true });
        break;
      }

      case 'STOP_FOCUS_MODE':
        await storage.saveFocusState({ active: false, paused: false, remainingMs: null, endTime: null, durationMinutes: 0, startTime: null });
        sendResponse({ success: true });
        break;

      case 'ALLOW_TEMP_DOMAIN':
        tempAllowDomain(request.domain, request.minutes);
        sendResponse({ success: true });
        break;

      case 'CLEAR_PENDING_QUEUE':
        await storage.savePendingQueue([]);
        sendResponse({ success: true });
        break;

      case 'LOG_WATER': {
        const updatedStats = await storage.updateDailyStats(curr => ({
          ...curr,
          waterGlasses: Math.min(20, (curr.waterGlasses || 0) + (request.amount || 1))
        }));

        // Track per-reminder progress for water
        await storage.incrementReminderProgress('auto_health_water');

        // Reset & advance next water reminder time to 1 full interval from now
        const settings = await storage.getSettings();
        const waterMins = settings.healthSettings?.waterIntervalMinutes || settings.waterIntervalMinutes || 60;
        const nextWaterTime = Date.now() + waterMins * 60 * 1000;

        const reminders = await storage.getReminders();
        const waterIdx = reminders.findIndex(r => r.id === 'auto_health_water' || r.category === 'water');
        if (waterIdx !== -1) {
          reminders[waterIdx].time = nextWaterTime;
          await storage.saveReminders(reminders);
          if (typeof chrome !== 'undefined' && chrome.alarms) {
            chrome.alarms.create(reminders[waterIdx].id, { when: nextWaterTime });
          }
        }

        sendResponse({ success: true, stats: updatedStats });
        break;
      }

      case 'DECREMENT_WATER': {
        const updatedStats = await storage.updateDailyStats(curr => ({
          ...curr,
          waterGlasses: Math.max(0, (curr.waterGlasses || 0) - 1)
        }));
        await storage.decrementReminderProgress('auto_health_water');
        sendResponse({ success: true, stats: updatedStats });
        break;
      }

      case 'LOG_MED_DOSE': {
        const settings = await storage.getSettings();
        const health = settings.healthSettings || {};
        const meds = health.medications || [];
        const med = meds.find(m => m.id === request.id);
        if (med) {
          med.takenTodayCount = Math.min(med.doseCount || 1, (med.takenTodayCount || 0) + 1);
          settings.healthSettings = health;
          await storage.saveSettings(settings);
          // Track per-reminder progress for medicine
          const medRemId = `med_rem_${med.id}`;
          await storage.incrementReminderProgress(medRemId);
        }
        sendResponse({ success: true });
        break;
      }

      case 'DECREMENT_MED_DOSE': {
        const settings = await storage.getSettings();
        const health = settings.healthSettings || {};
        const meds = health.medications || [];
        const med = meds.find(m => m.id === request.id);
        if (med) {
          med.takenTodayCount = Math.max(0, (med.takenTodayCount || 0) - 1);
          settings.healthSettings = health;
          await storage.saveSettings(settings);
          const medRemId = `med_rem_${med.id}`;
          await storage.decrementReminderProgress(medRemId);
        }
        sendResponse({ success: true });
        break;
      }

      default:
        sendResponse({ success: false, reason: 'Unknown action' });
        break;
    }
  })();
  return true; // Keep async response channel open
});

async function broadcastHideMascot() {
  if (typeof chrome === 'undefined' || !chrome.tabs) return;
  chrome.tabs.query({}, (tabs) => {
    if (tabs) {
      tabs.forEach(t => {
        if (t.id) {
          try {
            chrome.tabs.sendMessage(t.id, { action: 'HIDE_REMI_REMINDER' }).catch(() => {});
          } catch (e) {}
        }
      });
    }
  });
}

async function handleQueueUpdate(id) {
  const remainingQueue = await storage.removeFromActiveQueue(id);
  if (remainingQueue.length === 0) {
    broadcastHideMascot();
  } else {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
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
}

async function markReminderDone(id) {
  await handleQueueUpdate(id);

  let isWaterReminder = false;
  const reminders = await storage.getReminders();
  const idx = reminders.findIndex(r => r.id === id);
  if (idx !== -1) {
    const rem = reminders[idx];
    rem.completedCount = (rem.completedCount || 0) + 1;
    rem.lastCompletedAt = Date.now();

    if (rem.category === 'water' || rem.id === 'auto_health_water') {
      isWaterReminder = true;
    }

    // Reschedule repeat reminders or disable one-time reminders
    if (rem.repeat && rem.repeat !== 'once') {
      let nextTime = Date.now();
      const interval = rem.repeatInterval || 1;
      switch (rem.repeat) {
        case 'daily':
          nextTime += 24 * 3600 * 1000 * interval;
          break;
        case 'weekly':
          nextTime += 7 * 24 * 3600 * 1000 * interval;
          break;
        case 'monthly':
          nextTime += 30 * 24 * 3600 * 1000 * interval;
          break;
        case 'every_x_minutes':
          nextTime += interval * 60 * 1000;
          break;
        case 'every_x_hours':
          nextTime += interval * 3600 * 1000;
          break;
        case 'every_x_days':
          nextTime += interval * 24 * 3600 * 1000;
          break;
        default:
          nextTime += 24 * 3600 * 1000;
          break;
      }
      rem.time = nextTime;
      if (typeof chrome !== 'undefined' && chrome.alarms) {
        chrome.alarms.create(rem.id, { when: nextTime });
      }
    } else {
      rem.enabled = false;
    }

    await storage.saveReminders(reminders);
  }

  // Update daily stats
  await storage.updateDailyStats(curr => {
    const updates = {
      ...curr,
      completedCount: (curr.completedCount || 0) + 1
    };
    if (isWaterReminder) {
      updates.waterGlasses = (curr.waterGlasses || 0) + 1;
    }
    return updates;
  });

  // Remove from pending queue if present
  const queue = await storage.getPendingQueue();
  const newQueue = queue.filter(q => q.id !== id);
  await storage.savePendingQueue(newQueue);

  // Track per-reminder daily progress
  await storage.incrementReminderProgress(id);
}

async function markReminderSkipped(id) {
  await handleQueueUpdate(id);

  await storage.updateDailyStats(curr => ({
    ...curr,
    skippedCount: (curr.skippedCount || 0) + 1
  }));
  await storage.incrementReminderDismissed(id);

  const queue = await storage.getPendingQueue();
  const newQueue = queue.filter(q => q.id !== id);
  await storage.savePendingQueue(newQueue);
}
