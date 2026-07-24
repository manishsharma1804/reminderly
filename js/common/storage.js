/**
 * Reminderly Promisified Chrome Storage Handler
 */

import { DEFAULT_SETTINGS } from './constants.js';
import { getTodayKey, calculateStreakFromStats } from './utils.js';

export const STORAGE_KEYS = {
  REMINDERS: 'reminderly_reminders',
  SETTINGS: 'reminderly_settings',
  FOCUS_STATE: 'reminderly_focus_state',
  DAILY_STATS: 'reminderly_daily_stats',
  PENDING_QUEUE: 'reminderly_pending_queue',
  ACTIVE_REMINDER: 'reminderly_active_reminder',
  ARCHIVED_REMINDERS: 'reminderly_archived_reminders',
  INSTALL_DATE: 'reminderly_install_date',
  REMINDER_DAILY_PROGRESS: 'reminderly_reminder_daily_progress',
  REMINDER_DAILY_DISMISSED: 'reminderly_reminder_daily_dismissed',
  CUSTOM_CATEGORIES: 'reminderly_custom_categories'
};

class StorageManager {
  async get(key, defaultValue = null) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([key], (result) => {
          resolve(result[key] !== undefined ? result[key] : defaultValue);
        });
      } else {
        const item = localStorage.getItem(key);
        try {
          resolve(item ? JSON.parse(item) : defaultValue);
        } catch (e) {
          resolve(defaultValue);
        }
      }
    });
  }

  async set(key, value) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [key]: value }, () => resolve());
      } else {
        localStorage.setItem(key, JSON.stringify(value));
        resolve();
      }
    });
  }

  async getReminders() {
    const list = await this.get(STORAGE_KEYS.REMINDERS, null);
    if (!list) {
      const initialSeed = this.getInitialSeedReminders();
      await this.set(STORAGE_KEYS.REMINDERS, initialSeed);
      return initialSeed;
    }
    // Filter out initial seed reminders if present
    const cleaned = list.filter(r => !r.id.startsWith('seed_'));
    if (cleaned.length !== list.length) {
      await this.set(STORAGE_KEYS.REMINDERS, cleaned);
    }
    return cleaned;
  }

  async saveReminders(reminders) {
    await this.set(STORAGE_KEYS.REMINDERS, reminders);
  }

  async getSettings() {
    const settings = await this.get(STORAGE_KEYS.SETTINGS, null);
    if (!settings) {
      await this.set(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }
    return { ...DEFAULT_SETTINGS, ...settings };
  }

  async saveSettings(settings) {
    await this.set(STORAGE_KEYS.SETTINGS, settings);
  }

  async getCustomCategories() {
    return await this.get(STORAGE_KEYS.CUSTOM_CATEGORIES, []);
  }

  async saveCustomCategory(customCat) {
    const rawLabel = (customCat && customCat.label) ? customCat.label.trim() : '';
    const label = rawLabel || 'General';

    let icon = '🔔';
    if (customCat && customCat.icon && customCat.icon.trim()) {
      const graphemes = Array.from(customCat.icon.trim());
      if (graphemes.length > 0) {
        icon = graphemes[0];
      }
    }

    const normalizedKey = label.toLowerCase();
    const categories = await this.getCustomCategories();

    // Case-insensitive check: find existing category with same normalized key
    const existingIndex = categories.findIndex(c =>
      (c.key || '').toLowerCase() === normalizedKey ||
      (c.label || '').toLowerCase() === normalizedKey
    );

    const catObj = {
      id: customCat?.id || `custom_${normalizedKey.replace(/[^a-z0-9]/g, '_')}`,
      key: normalizedKey,
      label: label,
      icon: icon,
      color: customCat?.color || '#a855f7'
    };

    if (existingIndex !== -1) {
      // Merge / update existing entry (case-insensitive deduplication)
      categories[existingIndex] = {
        ...categories[existingIndex],
        ...catObj,
        label: label,
        icon: icon
      };
    } else {
      categories.push(catObj);
    }

    await this.set(STORAGE_KEYS.CUSTOM_CATEGORIES, categories);
    return categories[existingIndex !== -1 ? existingIndex : categories.length - 1];
  }

  async saveCustomCategories(categories) {
    await this.set(STORAGE_KEYS.CUSTOM_CATEGORIES, categories || []);
  }

  async getFocusState() {
    return await this.get(STORAGE_KEYS.FOCUS_STATE, {
      active: false,
      endTime: null,
      durationMinutes: 25,
      startTime: null
    });
  }

  async saveFocusState(state) {
    await this.set(STORAGE_KEYS.FOCUS_STATE, state);
  }

  async getInstallDate() {
    let installDate = await this.get(STORAGE_KEYS.INSTALL_DATE, null);
    if (!installDate) {
      installDate = Date.now();
      await this.set(STORAGE_KEYS.INSTALL_DATE, installDate);
    }
    return installDate;
  }

  async getAllDailyStats() {
    return await this.get(STORAGE_KEYS.DAILY_STATS, {});
  }

  async getDailyStats() {
    const today = getTodayKey();
    const allStats = await this.get(STORAGE_KEYS.DAILY_STATS, {});
    const streak = calculateStreakFromStats(allStats);

    if (!allStats[today]) {
      allStats[today] = {
        date: today,
        completedCount: 0,
        skippedCount: 0,
        missedCount: 0,
        waterGlasses: 0,
        focusMinutesToday: 0,
        streakDays: streak
      };
      await this.set(STORAGE_KEYS.DAILY_STATS, allStats);
    } else {
      allStats[today].streakDays = streak;
    }
    return allStats[today];
  }

  async updateDailyStats(updaterFn) {
    const today = getTodayKey();
    const allStats = await this.get(STORAGE_KEYS.DAILY_STATS, {});
    const current = allStats[today] || {
      date: today,
      completedCount: 0,
      skippedCount: 0,
      missedCount: 0,
      waterGlasses: 0,
      focusMinutesToday: 0,
      streakDays: 1
    };

    const updated = updaterFn(current);
    allStats[today] = updated;

    // Recalculate streak after stats update
    const streak = calculateStreakFromStats(allStats);
    allStats[today].streakDays = streak;
    updated.streakDays = streak;

    await this.set(STORAGE_KEYS.DAILY_STATS, allStats);
    return updated;
  }

  async updateDailyStatsForDate(dateKey, updaterFn) {
    const allStats = await this.get(STORAGE_KEYS.DAILY_STATS, {});
    const current = allStats[dateKey] || {
      date: dateKey,
      completedCount: 0,
      skippedCount: 0,
      missedCount: 0,
      waterGlasses: 0,
      focusMinutesToday: 0,
      streakDays: 1
    };

    const updated = updaterFn(current);
    allStats[dateKey] = updated;

    const streak = calculateStreakFromStats(allStats);
    const today = getTodayKey();
    if (allStats[today]) {
      allStats[today].streakDays = streak;
    }

    await this.set(STORAGE_KEYS.DAILY_STATS, allStats);
    return updated;
  }

  async getPendingQueue() {
    return await this.get(STORAGE_KEYS.PENDING_QUEUE, []);
  }

  async savePendingQueue(queue) {
    await this.set(STORAGE_KEYS.PENDING_QUEUE, queue);
  }

  async clearPendingQueue() {
    await this.savePendingQueue([]);
  }

  async getActiveReminder() {
    const queue = await this.getActiveQueue();
    return queue.length > 0 ? queue[0] : null;
  }

  async getActiveQueue() {
    const raw = await this.get(STORAGE_KEYS.ACTIVE_REMINDER, null);
    if (!raw) return [];
    let list = Array.isArray(raw) ? raw : [raw];

    // Filter out stale health interval breaks (> 15 mins old) & deduplicate health breaks
    const now = Date.now();
    const isHealthBreak = (r) => r.id?.startsWith('auto_health_') || ['water', 'eye', 'posture'].includes(r.category);

    const healthBreaks = list.filter(isHealthBreak);
    const regularReminders = list.filter(r => !isHealthBreak(r));

    if (healthBreaks.length > 0) {
      // Keep only the single latest health break that is fresh (created <= 15m ago)
      const latestHealth = healthBreaks[healthBreaks.length - 1];
      const age = now - (latestHealth._queuedAt || latestHealth.created || now);
      if (age <= 15 * 60 * 1000) {
        regularReminders.push(latestHealth);
      }
    }

    return regularReminders;
  }

  async saveActiveReminder(reminder) {
    await this.pushActiveQueue(reminder);
  }

  async pushActiveQueue(reminder) {
    reminder._queuedAt = Date.now();
    const queue = await this.getActiveQueue();
    const idx = queue.findIndex(q => q.id === reminder.id);
    if (idx !== -1) {
      queue[idx] = reminder;
    } else {
      queue.push(reminder);
    }
    await this.set(STORAGE_KEYS.ACTIVE_REMINDER, queue);
    return queue;
  }

  async addActiveQueue(reminder) {
    return await this.pushActiveQueue(reminder);
  }

  async removeFromActiveQueue(id) {
    const queue = await this.getActiveQueue();
    const remaining = queue.filter(q => q.id !== id);
    await this.set(STORAGE_KEYS.ACTIVE_REMINDER, remaining.length > 0 ? remaining : null);
    return remaining;
  }

  async clearActiveReminder() {
    await this.set(STORAGE_KEYS.ACTIVE_REMINDER, null);
  }

  async getArchivedReminders() {
    return await this.get(STORAGE_KEYS.ARCHIVED_REMINDERS, []);
  }

  async saveArchivedReminders(list) {
    await this.set(STORAGE_KEYS.ARCHIVED_REMINDERS, list);
  }

  async archiveReminder(reminder) {
    const archived = await this.getArchivedReminders();
    if (!archived.some(a => a.id === reminder.id)) {
      archived.push({
        ...reminder,
        archivedAt: Date.now()
      });
      await this.saveArchivedReminders(archived);
    }
  }

  async restoreReminder(id) {
    const archived = await this.getArchivedReminders();
    const item = archived.find(a => a.id === id);
    if (item) {
      const remainingArchived = archived.filter(a => a.id !== id);
      await this.saveArchivedReminders(remainingArchived);

      const reminders = await this.getReminders();
      const restoredItem = { ...item };
      delete restoredItem.archivedAt;
      restoredItem.enabled = true;

      // Reset next trigger time for repeating reminders
      const now = Date.now();
      if (restoredItem.repeat === 'every_x_minutes' && restoredItem.repeatInterval) {
        restoredItem.time = now + restoredItem.repeatInterval * 60 * 1000;
      } else if (restoredItem.repeat === 'every_x_hours' && restoredItem.repeatInterval) {
        restoredItem.time = now + restoredItem.repeatInterval * 3600 * 1000;
      } else if (restoredItem.repeat === 'daily' && restoredItem.time) {
        const d = new Date(restoredItem.time);
        const next = new Date();
        next.setHours(d.getHours(), d.getMinutes(), 0, 0);
        if (next.getTime() <= now) next.setDate(next.getDate() + 1);
        restoredItem.time = next.getTime();
      } else if (restoredItem.repeat === 'weekly' && restoredItem.time) {
        const d = new Date(restoredItem.time);
        const next = new Date();
        next.setHours(d.getHours(), d.getMinutes(), 0, 0);
        while (next.getDay() !== d.getDay() || next.getTime() <= now) {
          next.setDate(next.getDate() + 1);
        }
        restoredItem.time = next.getTime();
      } else if (restoredItem.repeat === 'monthly' && restoredItem.time) {
        const d = new Date(restoredItem.time);
        const next = new Date();
        next.setHours(d.getHours(), d.getMinutes(), 0, 0);
        next.setDate(d.getDate());
        if (next.getTime() <= now) next.setMonth(next.getMonth() + 1);
        restoredItem.time = next.getTime();
      }

      // Avoid duplicate
      if (!reminders.some(r => r.id === restoredItem.id)) {
        reminders.push(restoredItem);
        await this.saveReminders(reminders);
      }
    }
  }

  async deleteArchivedReminder(id) {
    const archived = await this.getArchivedReminders();
    const remaining = archived.filter(a => a.id !== id);
    await this.saveArchivedReminders(remaining);
  }

  async clearArchivedReminders() {
    await this.saveArchivedReminders([]);
  }

  // Per-Reminder Daily Progress Tracking
  async getReminderDailyProgress() {
    const today = getTodayKey();
    const allProgress = await this.get(STORAGE_KEYS.REMINDER_DAILY_PROGRESS, {});
    return allProgress[today] || {};
  }

  async getAllReminderDailyProgress() {
    return await this.get(STORAGE_KEYS.REMINDER_DAILY_PROGRESS, {});
  }

  async incrementReminderProgress(reminderId) {
    const today = getTodayKey();
    const allProgress = await this.get(STORAGE_KEYS.REMINDER_DAILY_PROGRESS, {});
    if (!allProgress[today]) allProgress[today] = {};
    allProgress[today][reminderId] = (allProgress[today][reminderId] || 0) + 1;
    await this.set(STORAGE_KEYS.REMINDER_DAILY_PROGRESS, allProgress);
    return allProgress[today];
  }

  async getReminderDailyDismissed() {
    const today = getTodayKey();
    const allDismissed = await this.get(STORAGE_KEYS.REMINDER_DAILY_DISMISSED, {});
    return allDismissed[today] || {};
  }

  async incrementReminderDismissed(reminderId) {
    const today = getTodayKey();
    const allDismissed = await this.get(STORAGE_KEYS.REMINDER_DAILY_DISMISSED, {});
    if (!allDismissed[today]) allDismissed[today] = {};
    allDismissed[today][reminderId] = (allDismissed[today][reminderId] || 0) + 1;
    await this.set(STORAGE_KEYS.REMINDER_DAILY_DISMISSED, allDismissed);
    return allDismissed[today];
  }

  async decrementReminderProgress(reminderId) {
    const today = getTodayKey();
    const allProgress = await this.get(STORAGE_KEYS.REMINDER_DAILY_PROGRESS, {});
    if (!allProgress[today]) allProgress[today] = {};
    allProgress[today][reminderId] = Math.max(0, (allProgress[today][reminderId] || 0) - 1);
    await this.set(STORAGE_KEYS.REMINDER_DAILY_PROGRESS, allProgress);
    return allProgress[today];
  }

  getInitialSeedReminders() {
    return [];
  }

  async resetToDefaults() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.clear(async () => {
          if (chrome.alarms) {
            try { await chrome.alarms.clearAll(); } catch (e) { }
          }
          try { localStorage.clear(); } catch (e) { }
          await this.set(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
          await this.set(STORAGE_KEYS.REMINDERS, []);
          await this.set(STORAGE_KEYS.CUSTOM_CATEGORIES, []);
          resolve();
        });
      } else {
        try { localStorage.clear(); } catch (e) { }
        this.set(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
        this.set(STORAGE_KEYS.REMINDERS, []);
        this.set(STORAGE_KEYS.CUSTOM_CATEGORIES, []);
        resolve();
      }
    });
  }
}

export const storage = new StorageManager();
