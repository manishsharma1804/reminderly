/**
 * Reminderly Utility Helpers
 */

import { CATEGORIES } from './constants.js';

export function generateId() {
  return 'rem_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
}

export function getCategoryDetails(catId, customCategories = []) {
  if (!catId) return CATEGORIES.CUSTOM;
  
  const rawStr = String(catId).trim();
  const upperKey = rawStr.toUpperCase();
  if (CATEGORIES[upperKey]) {
    return CATEGORIES[upperKey];
  }

  const lowerKey = rawStr.toLowerCase();

  const HEALTH_MAP = {
    water: { id: 'water', label: 'Water', icon: '💧', color: '#06b6d4' },
    medicine: { id: 'medicine', label: 'Medicine', icon: '💊', color: '#ec4899' },
    health: { id: 'health', label: 'Health', icon: '🩺', color: '#f472b6' },
    eye: { id: 'eye', label: 'Eye Rest', icon: '👀', color: '#38bdf8' },
    eyerest: { id: 'eye', label: 'Eye Rest', icon: '👀', color: '#38bdf8' },
    posture: { id: 'posture', label: 'Posture & Stretch', icon: '🧍', color: '#10b981' }
  };

  if (HEALTH_MAP[lowerKey]) {
    return HEALTH_MAP[lowerKey];
  }

  // Search built-in categories case-insensitively
  const foundBuiltIn = Object.values(CATEGORIES).find(c => 
    c.id.toLowerCase() === lowerKey || c.label.toLowerCase() === lowerKey
  );
  if (foundBuiltIn) return foundBuiltIn;

  // Search user saved custom categories case-insensitively
  const foundCustom = customCategories.find(c =>
    (c.id && c.id.toLowerCase() === lowerKey) ||
    (c.key && c.key.toLowerCase() === lowerKey) ||
    (c.label && c.label.toLowerCase() === lowerKey)
  );

  if (foundCustom) {
    const rawIcon = foundCustom.icon ? Array.from(foundCustom.icon.trim())[0] : '🔔';
    let label = foundCustom.label || 'General';
    if (label.toLowerCase() === 'custom_reminder' || label.toLowerCase() === 'reminder' || label.toLowerCase() === 'custom') {
      label = 'General';
    }
    return {
      id: foundCustom.id || `custom_${lowerKey}`,
      label: label,
      icon: rawIcon || '🔔',
      color: foundCustom.color || '#a855f7'
    };
  }

  // If catId is a custom string (e.g. "Gym", "custom_gym", "Custom_general")
  let cleanLabel = rawStr;
  if (cleanLabel.toLowerCase().startsWith('custom_')) {
    cleanLabel = cleanLabel.slice(7);
  }
  cleanLabel = cleanLabel.trim();
  const lowerClean = cleanLabel.toLowerCase();

  if (!cleanLabel || lowerClean === 'custom' || lowerClean === 'reminder' || lowerClean === 'general') {
    cleanLabel = 'General';
  } else {
    cleanLabel = cleanLabel.charAt(0).toUpperCase() + cleanLabel.slice(1);
  }

  return {
    id: lowerKey,
    label: cleanLabel,
    icon: '🔔',
    color: '#a855f7'
  };
}

export function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const diff = timestamp - now;
  
  if (diff < -10000) return 'Due Now';
  if (diff <= 0) return 'Just now';
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `In ${days}d ${hours % 24}h`;
  if (hours > 0) return `In ${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `In ${minutes}m ${seconds % 60}s`;
  return `In ${seconds}s`;
}

export function getDomainFromUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    let hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4);
    }
    return hostname;
  } catch (e) {
    return '';
  }
}

export function isDomainMatch(targetUrl, domainList = []) {
  const domain = getDomainFromUrl(targetUrl);
  if (!domain) return false;
  
  return domainList.some(item => {
    const cleanItem = item.toLowerCase().replace(/^www\./, '').trim();
    return domain === cleanItem || domain.endsWith('.' + cleanItem);
  });
}

export function calculateProductivityScore(stats = {}) {
  // Formula based on completion rate, focus time, and streak
  const completed = stats.completedCount || 0;
  const total = (stats.completedCount || 0) + (stats.skippedCount || 0) + (stats.missedCount || 0);
  const focusMinutes = stats.focusMinutesToday || 0;
  const streak = stats.streakDays || 1;

  const completionRate = total > 0 ? (completed / total) * 60 : 60;
  const focusScore = Math.min(30, (focusMinutes / 120) * 30); // max 30 points for 2h focus
  const streakScore = Math.min(10, streak * 2); // max 10 points for 5d streak

  const totalScore = Math.min(100, Math.round(completionRate + focusScore + streakScore));
  return totalScore;
}

export function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getDateKeyOffset(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function calculateStreakFromStats(allStatsMap = {}) {
  const todayKey = getTodayKey();
  const todayStats = allStatsMap[todayKey];
  const todayActive = todayStats && ((todayStats.completedCount || 0) > 0 || (todayStats.waterGlasses || 0) > 0 || (todayStats.focusMinutesToday || 0) > 0);

  let streak = 0;
  let offset = todayActive ? 0 : 1;

  while (true) {
    const key = getDateKeyOffset(offset);
    const dayStat = allStatsMap[key];
    const isActive = dayStat && ((dayStat.completedCount || 0) > 0 || (dayStat.waterGlasses || 0) > 0 || (dayStat.focusMinutesToday || 0) > 0);
    
    if (isActive) {
      streak++;
      offset++;
    } else {
      break;
    }
  }

  return Math.max(1, streak);
}

export function toInputDate(timestamp = Date.now()) {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function toInputTime(timestamp = Date.now()) {
  const d = new Date(timestamp);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function parseDateTime(dateStr, timeStr) {
  if (!dateStr) return Date.now() + 15 * 60 * 1000;
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = (timeStr || '12:00').split(':').map(Number);
  const date = new Date(year, month - 1, day, hours || 0, minutes || 0, 0, 0);
  return date.getTime();
}

export function checkRestorableStreak(allStatsMap = {}) {
  const todayKey = getTodayKey();
  const yesterdayKey = getDateKeyOffset(1);

  // If yesterday was active, the streak is NOT broken
  const yesterdayStat = allStatsMap[yesterdayKey];
  const isYesterdayActive = yesterdayStat && ((yesterdayStat.completedCount || 0) > 0 || (yesterdayStat.waterGlasses || 0) > 0 || (yesterdayStat.focusMinutesToday || 0) > 0);
  if (isYesterdayActive) return null;

  // Check if they had a streak before yesterday
  let pastStreak = 0;
  let offset = 2; // Start checking from 2 days ago
  while (true) {
    const key = getDateKeyOffset(offset);
    const dayStat = allStatsMap[key];
    const isActive = dayStat && ((dayStat.completedCount || 0) > 0 || (dayStat.waterGlasses || 0) > 0 || (dayStat.focusMinutesToday || 0) > 0);
    if (isActive) {
      pastStreak++;
      offset++;
    } else {
      break;
    }
  }

  if (pastStreak > 0) {
    return {
      missedDateKey: yesterdayKey,
      pastStreakValue: pastStreak
    };
  }
  return null;
}

export function showButtonLoader(btn, minDurationMs = 300) {
  if (!btn || !(btn instanceof HTMLElement)) return () => {};
  if (btn.classList.contains('btn-loading')) return () => {};

  const originalContent = btn.innerHTML;
  const originalWidth = btn.offsetWidth ? `${btn.offsetWidth}px` : '';

  if (originalWidth) btn.style.minWidth = originalWidth;
  btn.classList.add('btn-loading');

  if (!btn.querySelector('.btn-spinner')) {
    const spinner = document.createElement('span');
    spinner.className = 'btn-spinner';
    btn.insertBefore(spinner, btn.firstChild);
  }

  const startTime = Date.now();

  return () => {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, minDurationMs - elapsed);

    setTimeout(() => {
      btn.classList.remove('btn-loading');
      btn.innerHTML = originalContent;
      btn.style.minWidth = '';
    }, remaining);
  };
}

// Global button click interceptor for instant UI loader feedback on all buttons
if (typeof window !== 'undefined') {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button, .btn, .icon-btn, .remi-btn');
    if (!btn || btn.classList.contains('no-loader') || btn.classList.contains('btn-loading')) return;

    const stopLoader = showButtonLoader(btn, 300);
    setTimeout(() => stopLoader(), 350);
  }, true);
}
