/**
 * Reminderly App Constants
 */

export const APP_VERSION = '1.0.18';

export const CATEGORIES = {
  WORKOUT: { id: 'workout', label: 'Workout', icon: '🏋️‍♂️', color: '#10b981' },
  STUDY: { id: 'study', label: 'Study', icon: '📚', color: '#8b5cf6' },
  MEETINGS: { id: 'meetings', label: 'Meetings', icon: '📅', color: '#3b82f6' },
  READING: { id: 'reading', label: 'Reading', icon: '📖', color: '#f59e0b' },
  BREAK: { id: 'break', label: 'Break', icon: '☕', color: '#14b8a6' },
  SLEEP: { id: 'sleep', label: 'Sleep', icon: '🌙', color: '#6366f1' },
  HEALTH: { id: 'health', label: 'Health', icon: '🩺', color: '#f472b6' },
  CUSTOM: { id: 'custom', label: 'General', icon: '🔔', color: '#a855f7' }
};

export const PRIORITIES = {
  LOW: { id: 'low', label: 'Low', badgeClass: 'badge-low', weight: 1 },
  MEDIUM: { id: 'medium', label: 'Medium', badgeClass: 'badge-medium', weight: 2 },
  HIGH: { id: 'high', label: 'High', badgeClass: 'badge-high', weight: 3 },
  CRITICAL: { id: 'critical', label: 'Critical', badgeClass: 'badge-critical', weight: 4 }
};

export const REPEAT_TYPES = {
  ONCE: 'once',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  MINUTES: 'every_x_minutes',
  HOURS: 'every_x_hours',
  DAYS: 'every_x_days'
};

export const DEFAULT_PRIORITY_SITES = [];

export const DEFAULT_BLOCKLIST = [];

export const DEFAULT_SETTINGS = {
  theme: 'system', // 'system' | 'dark' | 'light'
  soundEnabled: true,
  volume: 100, // 0 - 100
  soundTone: 'chime', // 'chime' | 'gentle' | 'energetic' | 'classic'
  autoStartup: true,
  animationsEnabled: true,
  waterGoalGlasses: 8, // glasses per day (250ml each)
  mascot: {
    enabled: true,
    type: 'remi', // 'remi' (Remi Assistant)
    position: 'bottom-right',
    size: 220,
    opacity: 1.0,
  },
  priorityWebsites: [],
  blockedWebsites: [],
  websiteBlockerEnabled: true,
  contextAwarenessEnabled: true,
  autoArchivePassed: true,
  autoDeleteArchiveDays: 'never', // 'never' | '7_days' | '30_days' | '90_days'
  defaultSnoozeMinutes: 10, // 5 | 10 | 15 | 30
  userProfile: {
    name: '',
    age: '',
    gender: 'prefer_not_to_say' // 'male' | 'female' | 'other' | 'prefer_not_to_say'
  },
  periodTracker: {
    trackingEnabled: false,
    lastPeriodDate: '',
    cycleLength: 28,
    periodDuration: 5,
    remindDaysBefore: 3,
    remindTime: '09:00'
  },
  healthSettings: {
    waterEnabled: true,
    waterGoal: 8,
    waterIntervalMinutes: 60,
    eyeRestEnabled: true,
    eyeRestIntervalMinutes: 20,
    postureEnabled: true,
    postureIntervalMinutes: 45,
    screenWalkEnabled: false,
    screenWalkIntervalMinutes: 60,
    medications: []
  }
};

export const FOCUS_PRESETS = [
  { minutes: 25, label: '25 Min (Pomodoro)' },
  { minutes: 45, label: '45 Min (Deep Work)' },
  { minutes: 60, label: '60 Min (Power Hour)' },
  { minutes: 90, label: '90 Min (Focus Cycle)' }
];
