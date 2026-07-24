/**
 * Reminderly Dashboard & Settings Logic
 */

import { storage, STORAGE_KEYS } from '../common/storage.js';
import { CATEGORIES, PRIORITIES } from '../common/constants.js';
import { getMascotSVG, MASCOT_EMOTIONS } from '../common/mascots.js';
import { soundEngine } from '../common/audio.js';
import { generateId, formatRelativeTime, toInputDate, toInputTime, parseDateTime, formatDate, getDateKeyOffset, getTodayKey, formatTime, getCategoryDetails, formatTimeStringToUserDevice, checkRestorableStreak, calculateNextFutureTime } from '../common/utils.js';

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
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    await new Promise(res => chrome.runtime.sendMessage({ action: 'SYNC_PERIOD_REMINDER' }, res));
  }
  activeRemindersList = await storage.getReminders();

  const health = userSettings.healthSettings || {};
  let needsSync = false;
  if (health.waterEnabled !== false && !activeRemindersList.some(r => r.id === 'auto_health_water')) needsSync = true;
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
    { value: 'health', label: '🩺 Health Hub' },
    { value: 'workout', label: '🏋️ Workout' },
    { value: 'study', label: '📚 Study' },
    { value: 'meetings', label: '📅 Meetings' },
    { value: 'reading', label: '📖 Reading' },
    { value: 'break', label: '☕ Break' },
    { value: 'sleep', label: '🌙 Sleep' }
  ];

  if (selectElem) {
    const currentVal = selectElem.value;
    let html = `<option value="" disabled ${!currentVal ? 'selected' : ''}>Select Category</option>`;
    html += defaultOptions.map(o => `<option value="${o.value}">${o.label}</option>`).join('');

    userCustomCategories.forEach(c => {
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
  if (activeTab === 'tab-archive') await renderArchiveTable();
  if (activeTab === 'tab-settings') renderPrefsState();
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
  
  if (streakValEl) {
    const allDailyStats = await storage.getAllDailyStats();
    const restorable = checkRestorableStreak(allDailyStats);
    const completedToday = (todayStats.completedCount || 0) + (todayStats.waterGlasses || 0) + (todayStats.focusMinutesToday || 0);
    const isDoneToday = completedToday > 0;
    const streakDays = todayStats.streakDays || 0;
    const isStreakBroken = streakDays <= 0 || (!isDoneToday && restorable);

    if (isStreakBroken) {
      streakValEl.textContent = `0 Days 🔥`;
      streakValEl.style.color = '#94a3b8';
      streakValEl.style.opacity = '0.6';
    } else if (!isDoneToday) {
      streakValEl.textContent = `${streakDays} Days 🔥`;
      streakValEl.style.color = '#94a3b8';
      streakValEl.style.opacity = '0.6';
    } else {
      streakValEl.textContent = `${streakDays} Day${streakDays === 1 ? '' : 's'} 🔥`;
      streakValEl.style.color = '#f59e0b';
      streakValEl.style.opacity = '1';
    }
  }
}

/* --- IN-PLACE DASHBOARD HANGMAN STREAK RESTORATION --- */
const HANGMAN_WORDS = [
  // --- ANIMALS (30) ---
  { word: "DOLPHIN", category: "Animals 🐬", hint: "A 7-letter intelligent marine animal that loves jumping out of water!" },
  { word: "ELEPHANT", category: "Animals 🐘", hint: "An 8-letter giant land animal with big ears and a long trunk!" },
  { word: "PENGUIN", category: "Animals 🐧", hint: "A 7-letter flightless bird that loves swimming in icy waters!" },
  { word: "KANGAROO", category: "Animals 🦘", hint: "An 8-letter Australian animal that hops around with a pouch for its baby!" },
  { word: "GIRAFFE", category: "Animals 🦒", hint: "A 7-letter tall African animal with a super long neck to eat leaves!" },
  { word: "TIGER", category: "Animals 🐅", hint: "A 5-letter wild orange big cat with dark black stripes!" },
  { word: "CHEETAH", category: "Animals 🐆", hint: "A 7-letter spotted big cat known as the fastest land animal!" },
  { word: "LEOPARD", category: "Animals 🐆", hint: "A 7-letter wild cat with dark rosette spots that climbs trees!" },
  { word: "PANTHER", category: "Animals 🐆", hint: "A 7-letter sleek black big cat that hunts silently at night!" },
  { word: "GORILLA", category: "Animals 🦍", hint: "A 7-letter powerful ape that lives in African rainforests!" },
  { word: "HAMSTER", category: "Animals 🐹", hint: "A 7-letter cute small furry rodent that loves running on a wheel!" },
  { word: "RABBIT", category: "Animals 🐰", hint: "A 6-letter fluffy animal with long ears that loves eating carrots!" },
  { word: "SQUIRREL", category: "Animals 🐿️", hint: "An 8-letter bushy-tailed woodland animal that collects nuts!" },
  { word: "PEACOCK", category: "Animals 🦚", hint: "A 7-letter colorful bird with large fan-like tail feathers!" },
  { word: "FLAMINGO", category: "Animals 🦩", hint: "An 8-letter tall pink wading bird that stands on one leg!" },
  { word: "OCTOPUS", category: "Animals 🐙", hint: "An 7-letter sea creature with eight flexible arms and blue blood!" },
  { word: "JELLYFISH", category: "Animals 🪼", hint: "A 9-letter translucent sea creature with stinging tentacles!" },
  { word: "LOBSTER", category: "Animals 🦞", hint: "A 7-letter hard-shelled marine creature with big claws!" },
  { word: "TORTOISE", category: "Animals 🐢", hint: "An 8-letter slow-moving land reptile with a hard dome shell!" },
  { word: "CHAMELEON", category: "Animals 🦎", hint: "A 9-letter lizard that can change color to blend into surroundings!" },
  { word: "BUFFALO", category: "Animals 🦬", hint: "A 7-letter large wild horned ox found on plains and grasslands!" },
  { word: "HEDGEHOG", category: "Animals 🦔", hint: "An 8-letter small nocturnal mammal covered in spiky quills!" },
  { word: "PELICAN", category: "Animals 🐦", hint: "A 7-letter water bird with a large pouch under its beak to scoop fish!" },
  { word: "WALRUS", category: "Animals 🦭", hint: "A 6-letter large Arctic marine mammal with long ivory tusks!" },
  { word: "MEERKAT", category: "Animals 🦡", hint: "A 7-letter small desert mammal that stands upright on look-out!" },
  { word: "RACCOON", category: "Animals 🦝", hint: "A 7-letter clever nocturnal animal with a black mask around its eyes!" },
  { word: "OSTRICH", category: "Animals 🦤", hint: "A 7-letter giant flightless bird that can run super fast!" },
  { word: "KOALA", category: "Animals 🐨", hint: "A 5-letter Australian tree-dwelling marsupial that eats eucalyptus!" },
  { word: "SLOTH", category: "Animals 🦥", hint: "A 5-letter slow-moving tree mammal that hangs upside down!" },
  { word: "ZEBRA", category: "Animals 🦓", hint: "A 5-letter wild African horse with distinct black and white stripes!" },

  // --- FRUITS & VEGETABLES (25) ---
  { word: "BANANA", category: "Fruit 🍌", hint: "A 6-letter long yellow fruit rich in potassium that monkeys love!" },
  { word: "MANGO", category: "Fruit 🥭", hint: "A 5-letter juicy tropical stone fruit known as the king of fruits!" },
  { word: "WATERMELON", category: "Fruit 🍉", hint: "A 10-letter large green juicy summer fruit with sweet red pulp!" },
  { word: "STRAWBERRY", category: "Fruit 🍓", hint: "A 10-letter sweet red heart-shaped berry with tiny seeds outside!" },
  { word: "PINEAPPLE", category: "Fruit 🍍", hint: "A 9-letter spiky tropical fruit with sweet yellow flesh!" },
  { word: "AVOCADO", category: "Fruit 🥑", hint: "A 7-letter creamy green fruit with a large pit, used for guacamole!" },
  { word: "BLUEBERRY", category: "Fruit 🫐", hint: "A 9-letter small round dark blue berry packed with antioxidants!" },
  { word: "CHERRIES", category: "Fruit 🍒", hint: "An 8-letter pair of small sweet red stone fruits on slender stems!" },
  { word: "COCONUT", category: "Fruit 🥥", hint: "A 7-letter hard brown tropical fruit filled with sweet water and milk!" },
  { word: "GRAPEFRUIT", category: "Fruit 🍊", hint: "A 10-letter large citrus fruit with tangy pink or yellow pulp!" },
  { word: "KIWIFRUIT", category: "Fruit 🥝", hint: "A 9-letter fuzzy brown fruit with bright green speckled interior!" },
  { word: "POMEGRANATE", category: "Fruit 🍎", hint: "An 11-letter ruby red fruit filled with juicy edible seeds!" },
  { word: "RASPBERRY", category: "Fruit 🫐", hint: "A 9-letter soft red berry with a sweet and tart flavor!" },
  { word: "TANGERINE", category: "Fruit 🍊", hint: "A 9-letter small sweet orange citrus fruit that is easy to peel!" },
  { word: "BROCCOLI", category: "Vegetables 🥦", hint: "An 8-letter green vegetable resembling tiny miniature trees!" },
  { word: "CARROT", category: "Vegetables 🥕", hint: "A 6-letter crunchy orange root vegetable that is great for eyes!" },
  { word: "CUCUMBER", category: "Vegetables 🥒", hint: "An 8-letter long green crisp vegetable packed with hydration!" },
  { word: "EGGPLANT", category: "Vegetables 🍆", hint: "An 8-letter glossy purple vegetable used in Mediterranean dishes!" },
  { word: "MUSHROOM", category: "Vegetables 🍄", hint: "An 8-letter cap-shaped edible fungus used in cooking!" },
  { word: "POTATO", category: "Vegetables 🥔", hint: "A 6-letter starchy tuber vegetable used to make french fries!" },
  { word: "PUMPKIN", category: "Vegetables 🎃", hint: "A 7-letter large round orange squash carved during Halloween!" },
  { word: "SPINACH", category: "Vegetables 🥬", hint: "A 7-letter nutrient-rich green leafy vegetable that gives strength!" },
  { word: "TOMATO", category: "Vegetables 🍅", hint: "A 6-letter juicy red fruit commonly eaten as a salad vegetable!" },
  { word: "ZUCCHINI", category: "Vegetables 🥒", hint: "An 8-letter green summer squash variety popular in cooking!" },
  { word: "GARLIC", category: "Vegetables 🧄", hint: "A 6-letter aromatic bulb vegetable with pungent cloves!" },

  // --- FOODS & DESSERTS (25) ---
  { word: "CHOCOLATE", category: "Treats 🍫", hint: "A 9-letter sweet brown treat made from cocoa beans!" },
  { word: "PANCAKE", category: "Breakfast 🥞", hint: "A 7-letter flat round fluffy breakfast cake topped with syrup!" },
  { word: "PIZZA", category: "Food 🍕", hint: "A 5-letter cheesy Italian dish served in triangular slices!" },
  { word: "BURGER", category: "Food 🍔", hint: "A 6-letter grilled patty in a bun with lettuce and cheese!" },
  { word: "SANDWICH", category: "Food 🥪", hint: "An 8-letter meal made of fillings between two slices of bread!" },
  { word: "SPAGHETTI", category: "Food 🍝", hint: "A 9-letter long thin Italian pasta topped with savory sauce!" },
  { word: "CUPCAKE", category: "Treats 🧁", hint: "A 7-letter small individual cake baked in a paper cup with frosting!" },
  { word: "DONUT", category: "Treats 🍩", hint: "A 5-letter fried ring-shaped sweet pastry with glaze or sprinkles!" },
  { word: "POPCORN", category: "Snacks 🍿", hint: "A 7-letter puffed corn snack popular at movie theaters!" },
  { word: "ICECREAM", category: "Dessert 🍦", hint: "An 8-letter frozen dairy dessert served in cones or bowls!" },
  { word: "WAFFLE", category: "Breakfast 🧇", hint: "A 6-letter grid-patterned crisp breakfast cake made from batter!" },
  { word: "OMELLETTE", category: "Breakfast 🍳", hint: "A 9-letter dish of beaten eggs cooked with cheese and veggies!" },
  { word: "NACHOS", category: "Snacks 🧀", hint: "A 6-letter crispy tortilla chip dish covered in melted cheese!" },
  { word: "COOKIES", category: "Treats 🍪", hint: "A 7-letter baked sweet flat treat often filled with chocolate chips!" },
  { word: "BROWNIE", category: "Treats 🟫", hint: "A 7-letter rich dense chocolate square dessert!" },
  { word: "CROISSANT", category: "Bakery 🥐", hint: "A 9-letter flaky buttery crescent-shaped French pastry!" },
  { word: "MACARONI", category: "Food 🧀", hint: "An 8-letter elbow-shaped pasta cooked with rich cheese sauce!" },
  { word: "LASAGNA", category: "Food 🍝", hint: "A 7-letter baked Italian pasta dish layered with meat and cheese!" },
  { word: "NOODLES", category: "Food 🍜", hint: "A 7-letter long thin strips of dough cooked in broth or fried!" },
  { word: "BURRITO", category: "Food 🌯", hint: "A 7-letter Mexican wrapped flour tortilla stuffed with rice and beans!" },
  { word: "TACOS", category: "Food 🌮", hint: "A 5-letter folded crispy tortilla stuffed with seasoned meat!" },
  { word: "CHEESECAKE", category: "Dessert 🍰", hint: "A 10-letter rich dessert with a thick creamy cheese filling on crust!" },
  { word: "MILKSHAKE", category: "Drinks 🥤", hint: "A 9-letter sweet cold beverage made of blended milk and ice cream!" },
  { word: "SMOOTHIE", category: "Drinks 🥤", hint: "An 8-letter thick creamy beverage made from blended fresh fruit!" },
  { word: "LEMONADE", category: "Drinks 🍋", hint: "An 8-letter refreshing drink made from lemon juice, water, and sugar!" },

  // --- NATURE & SPACE (30) ---
  { word: "RAINBOW", category: "Nature 🌈", hint: "A 7-letter colorful arc that appears in the sky after rain!" },
  { word: "SUNSHINE", category: "Weather ☀️", hint: "An 8-letter bright warm light sent down to Earth from the sun!" },
  { word: "MOUNTAIN", category: "Nature 🏔️", hint: "An 8-letter huge natural elevation of the Earth's surface with a peak!" },
  { word: "OCEAN", category: "Nature 🌊", hint: "A 5-letter vast body of salty water covering most of the Earth!" },
  { word: "VOLCANO", category: "Nature 🌋", hint: "A 7-letter mountain with an opening that erupts molten lava and ash!" },
  { word: "WATERFALL", category: "Nature 🌊", hint: "A 9-letter cascade of water falling from a steep high cliff!" },
  { word: "TORNADO", category: "Weather 🌪️", hint: "A 7-letter violently rotating column of air extending to the ground!" },
  { word: "HURRICANE", category: "Weather 🌀", hint: "A 9-letter massive tropical storm system with powerful swirling winds!" },
  { word: "LIGHTNING", category: "Weather ⚡", hint: "A 9-letter flash of electricity produced inside a thunderstorm cloud!" },
  { word: "SNOWFLAKE", category: "Weather ❄️", hint: "A 9-letter delicate six-sided ice crystal falling from the sky!" },
  { word: "ASTRONAUT", category: "Space 🧑‍🚀", hint: "A 9-letter person trained to travel and work in outer space!" },
  { word: "SPACESHIP", category: "Space 🚀", hint: "A 9-letter vehicle designed for space travel beyond Earth!" },
  { word: "SATELLITE", category: "Space 🛰️", hint: "A 9-letter object orbiting Earth to transmit communication signal!" },
  { word: "TELESCOPE", category: "Space 🔭", hint: "A 9-letter optical device used to view distant stars and planets!" },
  { word: "METEORITE", category: "Space ☄️", hint: "A 9-letter space rock that survives passage through atmosphere!" },
  { word: "GALAXY", category: "Space 🌌", hint: "A 6-letter system of millions or billions of stars bound by gravity!" },
  { word: "PLANET", category: "Space 🪐", hint: "A 6-letter large celestial body that orbits around a star!" },
  { word: "STARLIGHT", category: "Space ✨", hint: "An 9-letter soft light coming from distant stars in night sky!" },
  { word: "MOONLIGHT", category: "Space 🌙", hint: "A 9-letter silvery light reflected down from the moon at night!" },
  { word: "FOREST", category: "Nature 🌲", hint: "A 6-letter large area covered densely with trees and wild plants!" },
  { word: "JUNGLE", category: "Nature 🌿", hint: "A 6-letter dense tropical forest tangled with thick vegetation!" },
  { word: "GLACIER", category: "Nature 🧊", hint: "A 7-letter slowly moving mass of ice formed by snow accumulation!" },
  { word: "DESERT", category: "Nature 🏜️", hint: "A 6-letter dry barren land with low rainfall and sand dunes!" },
  { word: "ISLAND", category: "Nature 🏝️", hint: "A 6-letter piece of land entirely surrounded by water!" },
  { word: "VOLCANIC", category: "Nature 🌋", hint: "An 8-letter adjective relating to or produced by a volcano!" },
  { word: "THUNDER", category: "Weather 🌩️", hint: "A 7-letter loud booming sound produced by lightning discharge!" },
  { word: "BLIZZARD", category: "Weather 🌨️", hint: "An 8-letter severe snowstorm with strong winds and poor visibility!" },
  { word: "SUNRISE", category: "Nature 🌅", hint: "A 7-letter daily appearance of the sun above the horizon in morning!" },
  { word: "SUNSET", category: "Nature 🌇", hint: "A 6-letter daily disappearance of the sun below horizon in evening!" },
  { word: "HORIZON", category: "Nature 🌅", hint: "A 7-letter line where the Earth's surface appears to meet the sky!" },

  // --- GEOGRAPHY & PLACES (25) ---
  { word: "PYRAMID", category: "Places 🔺", hint: "A 7-letter ancient triangular stone monument in Egypt!" },
  { word: "CASTLE", category: "Places 🏰", hint: "A 6-letter large fortified medieval building with towers!" },
  { word: "STADIUM", category: "Places 🏟️", hint: "A 7-letter large arena for sports events and concerts!" },
  { word: "LIBRARY", category: "Places 📚", hint: "A 7-letter quiet building where books are kept for reading!" },
  { word: "MUSEUM", category: "Places 🏛️", hint: "A 6-letter building displaying historical or artistic artifacts!" },
  { word: "AIRPORT", category: "Places ✈️", hint: "A 7-letter location with runways for airplanes to land and take off!" },
  { word: "HOSPITAL", category: "Places 🏥", hint: "An 8-letter medical institution where patients receive care!" },
  { word: "AQUARIUM", category: "Places 🐠", hint: "An 8-letter facility with transparent tanks housing aquatic life!" },
  { word: "CATHEDRAL", category: "Places ⛪", hint: "A 9-letter grand principal church with imposing architecture!" },
  { word: "LIGHTHOUSE", category: "Places 🚨", hint: "A 10-letter tall tower with a bright light guiding ships near coast!" },
  { word: "MONUMENT", category: "Places 🗽", hint: "An 8-letter structure built to commemorate a person or event!" },
  { word: "SKYSCRAPER", category: "Places 🏙️", hint: "A 10-letter extremely tall multi-story building in a city skyline!" },
  { word: "BRIDGES", category: "Places 🌉", hint: "A 7-letter structure built over water or roads to connect paths!" },
  { word: "FOUNTAIN", category: "Places ⛲", hint: "An 8-letter decorative structure that shoots jets of water into air!" },
  { word: "NATIONAL", category: "General 🏛️", hint: "An 8-letter word relating to a whole country or nation!" },
  { word: "PARADISE", category: "Places 🏝️", hint: "An 8-letter place of supreme beauty, peace, and happiness!" },
  { word: "TOWN", category: "Places 🏘️", hint: "A 4-letter urban area smaller than a city!" },
  { word: "VILLAGE", category: "Places 🏡", hint: "A 7-letter small settlement in a rural setting!" },
  { word: "CAPITAL", category: "Places 🏛️", hint: "A 7-letter city that serves as the seat of government!" },
  { word: "HARBOR", category: "Places ⚓", hint: "A 6-letter sheltered port where ships dock safely!" },
  { word: "HIGHWAY", category: "Places 🛣️", hint: "A 7-letter main public road connecting major towns and cities!" },
  { word: "STATION", category: "Places 🚉", hint: "A 7-letter stopping place for trains or buses to pick up passengers!" },
  { word: "KINGDOM", category: "Places 👑", hint: "A 7-letter country ruled by a king or queen!" },
  { word: "EMPIRE", category: "Places ⚔️", hint: "A 6-letter extensive group of states under a single supreme authority!" },
  { word: "TERRITORY", category: "Places 🗺️", hint: "A 9-letter area of land under the jurisdiction of a ruler or state!" },

  // --- VEHICLES & TRANSPORT (15) ---
  { word: "BICYCLE", category: "Transport 🚲", hint: "A 7-letter two-wheeled vehicle powered by pedaling!" },
  { word: "MOTORCYCLE", category: "Transport 🏍️", hint: "A 10-letter two-wheeled motor vehicle for fast road travel!" },
  { word: "HELICOPTER", category: "Transport 🚁", hint: "A 10-letter aircraft powered by large rotating overhead blades!" },
  { word: "SUBMARINE", category: "Transport 🌊", hint: "A 9-letter naval vessel capable of operating deep underwater!" },
  { word: "AMBULANCE", category: "Transport 🚑", hint: "A 9-letter emergency vehicle for transporting sick or injured people!" },
  { word: "FIRETRUCK", category: "Transport 🚒", hint: "An 9-letter emergency vehicle equipped for fighting fires!" },
  { word: "LOCOMOTIVE", category: "Transport 🚂", hint: "A 10-letter powered rail vehicle used for pulling trains!" },
  { word: "SAILBOAT", category: "Transport ⛵", hint: "An 8-letter boat propelled primarily by sails caught in the wind!" },
  { word: "SPACECRAFT", category: "Transport 🚀", hint: "A 10-letter vehicle designed for flight in outer space!" },
  { word: "TRAM", category: "Transport 🚃", hint: "A 4-letter passenger rail vehicle running on tracks along city streets!" },
  { word: "SCOOTER", category: "Transport 🛴", hint: "A 7-letter light two-wheeled vehicle with low step-through frame!" },
  { word: "TRACTOR", category: "Transport 🚜", hint: "A 7-letter heavy motor vehicle with large tires used on farms!" },
  { word: "GONDOLA", category: "Transport 🚣", hint: "A 7-letter traditional narrow flat-bottomed Venetian rowing boat!" },
  { word: "AIRSHIP", category: "Transport 🎈", hint: "A 7-letter power-driven aircraft kept afloat by lighter-than-air gas!" },
  { word: "CARAVAN", category: "Transport 🚐", hint: "A 7-letter vehicle equipped for living in while traveling!" },

  // --- MUSIC & SPORTS (30) ---
  { word: "GUITAR", category: "Music 🎸", hint: "A 6-letter string musical instrument played with fingers or a plectrum!" },
  { word: "PIANO", category: "Music 🎹", hint: "A 5-letter keyboard instrument with black and white keys!" },
  { word: "VIOLIN", category: "Music 🎻", hint: "A 6-letter wooden string instrument played with a horsehair bow!" },
  { word: "TRUMPET", category: "Music 🎺", hint: "A 7-letter brass musical instrument with three valves!" },
  { word: "DRUMS", category: "Music 🥁", hint: "A 5-letter percussion instruments played by striking with sticks!" },
  { word: "SAXOPHONE", category: "Music 🎷", hint: "A 9-letter brass wind instrument popular in jazz music!" },
  { word: "FLUTE", category: "Music 🪈", hint: "A 5-letter high-pitched woodwind instrument played by blowing across hole!" },
  { word: "ACCORDION", category: "Music 🪗", hint: "A 9-letter portable box-shaped instrument played by expanding bellows!" },
  { word: "HARMONICA", category: "Music 🪗", hint: "A 9-letter small mouth-blown wind instrument with metal reeds!" },
  { word: "UKULELE", category: "Music 🪕", hint: "A 7-letter small four-stringed Hawaiian guitar!" },
  { word: "ORCHESTRA", category: "Music 🎻", hint: "A 9-letter large classical ensemble of musicians playing instruments!" },
  { word: "FOOTBALL", category: "Sports ⚽", hint: "An 8-letter team sport played by kicking a round ball into a goal!" },
  { word: "BASKETBALL", category: "Sports 🏀", hint: "A 10-letter game played by shooting a ball through a raised hoop!" },
  { word: "VOLLEYBALL", category: "Sports 🏐", hint: "A 10-letter sport where teams hit a ball over a high net with hands!" },
  { word: "BADMINTON", category: "Sports 🏸", hint: "A 9-letter racket sport played by hitting a shuttlecock over net!" },
  { word: "MARATHON", category: "Sports 🏃", hint: "An 8-letter long-distance running race over 26.2 miles!" },
  { word: "SWIMMING", category: "Sports 🏊", hint: "An 8-letter sport or activity of propelling oneself through water!" },
  { word: "GYMNASTICS", category: "Sports 🤸", hint: "A 10-letter sport involving exercises demonstrating balance and agility!" },
  { word: "SKATEBOARD", category: "Sports 🛹", hint: "A 10-letter narrow board with wheels used for riding and tricks!" },
  { word: "SURFING", category: "Sports 🏄", hint: "A 7-letter sport of riding ocean waves while standing on a board!" },
  { word: "ARCHERY", category: "Sports 🏹", hint: "A 7-letter sport of shooting arrows with a bow at a target!" },
  { word: "BOWLING", category: "Sports 🎳", hint: "A 7-letter game of rolling a heavy ball down a lane to knock down pins!" },
  { word: "ATHLETICS", category: "Sports 🏃", hint: "A 9-letter collection of competitive sporting events like running and jumping!" },
  { word: "CHAMPION", category: "Success 🏆", hint: "An 8-letter title for the winner of a tournament or contest!" },
  { word: "VICTORY", category: "Success 🏆", hint: "A 7-letter word for winning a challenge or achieving a great triumph!" },
  { word: "TROPHY", category: "Success 🏆", hint: "A 6-letter prize or cup awarded to celebrate a victory!" },
  { word: "MEDAL", category: "Success 🥇", hint: "A 5-letter metal disc awarded for bravery or sporting excellence!" },
  { word: "TOURNAMENT", category: "Sports 🏟️", hint: "A 10-letter series of contests between several competitors!" },
  { word: "ATHLETE", category: "Sports 🏃", hint: "A 7-letter person who is proficient in sports and physical exercise!" },
  { word: "STADIUM", category: "Sports 🏟️", hint: "A 7-letter venue for sports competitions with seating for spectators!" },

  // --- EVERYDAY OBJECTS & FUN CONCEPTS (30) ---
  { word: "BALLOON", category: "Party 🎈", hint: "A 7-letter inflatable rubber bag filled with air or helium!" },
  { word: "JOURNEY", category: "Travel 🧳", hint: "A 7-letter word for traveling from one place to another!" },
  { word: "TREASURE", category: "Adventure 🪙", hint: "An 8-letter collection of valuable gold, jewels, or precious items!" },
  { word: "DIAMOND", category: "Gems 💎", hint: "A 7-letter precious crystal gemstone known for exceptional hardness!" },
  { word: "COMPASS", category: "Tools 🧭", hint: "A 7-letter navigation tool with a magnetic needle pointing north!" },
  { word: "KEYBOARD", category: "Items ⌨️", hint: "An 8-letter panel of keys used to type input into computers!" },
  { word: "UMBRELLA", category: "Items ☂️", hint: "An 8-letter folding canopy used to protect from rain or sunlight!" },
  { word: "CALENDAR", category: "Items 📅", hint: "An 8-letter chart displaying dates, days, and months of the year!" },
  { word: "BACKPACK", category: "Items 🎒", hint: "An 8-letter bag carried on one's back with shoulder straps!" },
  { word: "BINOCULARS", category: "Tools 🔭", hint: "A 10-letter optical instrument with two lenses for viewing far objects!" },
  { word: "SUNGLASSES", category: "Items 🕶️", hint: "A 10-letter protective eyewear with tinted lenses against sunlight!" },
  { word: "LANTERN", category: "Items 🏮", hint: "A 7-letter portable lamp with a protective case for outdoor light!" },
  { word: "HOURGLASS", category: "Items ⏳", hint: "A 9-letter glass timer with trickling sand measuring an hour!" },
  { word: "FIREWORKS", category: "Party 🎆", hint: "An 9-letter explosive device creating colorful lights and noises!" },
  { word: "CAROUSEL", category: "Fun 🎠", hint: "An 8-letter revolving amusement ride with wooden horses!" },
  { word: "ADVENTURE", category: "Fun 🤠", hint: "A 9-letter exciting and unusual experience full of exploration!" },
  { word: "DISCOVERY", category: "Fun 🔍", hint: "A 9-letter act of finding or learning something new for the first time!" },
  { word: "HARMONY", category: "Life 🎵", hint: "A 7-letter pleasing arrangement of parts or peaceful agreement!" },
  { word: "CREATIVITY", category: "Mind 🎨", hint: "A 10-letter ability to use imagination to create original ideas!" },
  { word: "KNOWLEDGE", category: "Mind 📚", hint: "A 9-letter information and skills acquired through learning!" },
  { word: "FRIENDSHIP", category: "Life 🤝", hint: "A 10-letter bond of mutual affection between people!" },
  { word: "HAPPINESS", category: "Life 😊", hint: "A 9-letter state of feeling joyful, content, and happy!" },
  { word: "CURIOSITY", category: "Mind 🧐", hint: "A 9-letter strong desire to know, learn, or discover things!" },
  { word: "CELEBRATE", category: "Party 🎉", hint: "A 9-letter action to perform festivities for a special occasion!" },
  { word: "EXPLORER", category: "Adventure 🧭", hint: "An 8-letter person who travels into unfamiliar regions to learn!" },
  { word: "WONDERLAND", category: "Fun 🏰", hint: "A 10-letter imaginary land full of magical and marvelous things!" },
  { word: "SUNRISE", category: "Nature 🌅", hint: "A 7-letter daily morning appearance of the sun above horizon!" },
  { word: "MOONBEAM", category: "Nature 🌙", hint: "An 8-letter ray of moonlight shining down from the sky!" },
  { word: "MIRACLE", category: "Life ✨", hint: "A 7-letter extraordinary event bringing wonder and joy!" },
  { word: "HARVEST", category: "Nature 🌾", hint: "A 7-letter process of gathering ripe crops from fields!" }
];

let dashHangmanState = {
  selectedItem: {},
  guessedLetters: new Set(),
  wrongCount: 0,
  maxWrong: 6,
  attemptsLeft: 3,
  isGameActive: false,
  missedDateKey: null
};

// Bind physical computer keyboard listener for Hangman typing ('A'-'Z')
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    const gameBox = document.getElementById('dash-hangman-game-box');
    if (!gameBox || gameBox.style.display !== 'block' || !dashHangmanState.isGameActive) return;

    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;

    if (/^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault();
      handleDashLetterGuess(e.key.toUpperCase());
    }
  });
}

function updateAttemptsBadge() {
  const badge = document.getElementById('dash-attempts-badge');
  if (badge) {
    badge.textContent = `❤️ Attempts: ${dashHangmanState.attemptsLeft}/3`;
  }
}

function startDashHangmanGame() {
  if (dashHangmanState.attemptsLeft <= 0) return;

  dashHangmanState.guessedLetters.clear();
  dashHangmanState.wrongCount = 0;
  dashHangmanState.isGameActive = true;
  updateAttemptsBadge();

  const statusEl = document.getElementById('dash-hangman-status');
  if (statusEl) {
    statusEl.textContent = "";
    statusEl.style.color = "var(--text-primary)";
  }

  const retryContainer = document.getElementById('dash-retry-container');
  if (retryContainer) {
    retryContainer.style.display = 'none';
    retryContainer.innerHTML = '';
  }

  // Reset SVG parts
  for (let i = 0; i < dashHangmanState.maxWrong; i++) {
    const el = document.getElementById(`dash-hp-${i}`);
    if (el) el.style.display = "none";
  }

  dashHangmanState.selectedItem = HANGMAN_WORDS[Math.floor(Math.random() * HANGMAN_WORDS.length)];
  const catEl = document.getElementById('dash-hangman-category');
  if (catEl) catEl.textContent = `Category: ${dashHangmanState.selectedItem.category}`;

  const hintEl = document.getElementById('dash-hangman-hint');
  if (hintEl) hintEl.textContent = `💡 Hint: ${dashHangmanState.selectedItem.hint}`;

  renderDashHangmanWord();
  renderDashHangmanKeyboard();
}

function handleDashLetterGuess(letter) {
  if (!dashHangmanState.isGameActive || dashHangmanState.guessedLetters.has(letter)) return;

  dashHangmanState.guessedLetters.add(letter);
  const btn = document.querySelector(`.dash-key-btn[data-key="${letter}"]`);
  if (btn) btn.disabled = true;

  if (!dashHangmanState.selectedItem.word.includes(letter)) {
    if (btn) {
      btn.style.background = 'rgba(239, 68, 68, 0.2)';
      btn.style.color = '#ef4444';
    }
    const partEl = document.getElementById(`dash-hp-${dashHangmanState.wrongCount}`);
    if (partEl) partEl.style.display = "block";
    dashHangmanState.wrongCount++;

    if (dashHangmanState.wrongCount >= dashHangmanState.maxWrong) {
      dashHangmanState.isGameActive = false;
      dashHangmanState.attemptsLeft--;
      updateAttemptsBadge();

      const statusEl = document.getElementById('dash-hangman-status');
      const retryContainer = document.getElementById('dash-retry-container');

      if (dashHangmanState.attemptsLeft > 0) {
        if (statusEl) {
          statusEl.innerHTML = `❌ Attempt Failed! The word was <strong>${dashHangmanState.selectedItem.word}</strong>.`;
          statusEl.style.color = "#ef4444";
        }
        if (retryContainer) {
          retryContainer.style.display = 'block';
          retryContainer.innerHTML = `
            <button class="btn btn-secondary btn-sm" id="btn-dash-retry-hangman" style="width: 100%; font-weight: 700; font-size: 0.775rem; padding: 6px 12px; background: rgba(245,158,11,0.12); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3); border-radius: 8px; cursor: pointer; transition: all 0.2s ease;">
              🔄 Try Next Attempt (${dashHangmanState.attemptsLeft}/3 left)
            </button>
          `;
          document.getElementById('btn-dash-retry-hangman')?.addEventListener('click', startDashHangmanGame);
        }
      } else {
        const lostStreak = dashHangmanState.pastStreakValue || 1;
        if (statusEl) {
          statusEl.innerHTML = `💔 <strong>All 3 attempts used!</strong> Your ${lostStreak}-Day Streak is permanently lost.`;
          statusEl.style.color = "#ef4444";
        }
        if (retryContainer) {
          retryContainer.style.display = 'none';
          retryContainer.innerHTML = '';
        }

        if (dashHangmanState.missedDateKey) {
          try {
            localStorage.setItem(`streak_failed_permanently_${dashHangmanState.missedDateKey}`, 'true');
          } catch (e) {}
        }

        setTimeout(() => {
          renderOverview();
        }, 3000);
      }
      disableDashHangmanKeys();
    }
  } else {
    if (btn) {
      btn.style.background = 'rgba(16, 185, 129, 0.2)';
      btn.style.color = '#10b981';
    }
  }

  renderDashHangmanWord();
}

function renderDashHangmanWord() {
  const wordBox = document.getElementById('dash-hangman-word');
  if (!wordBox) return;
  wordBox.innerHTML = "";
  let isWin = true;

  for (const char of dashHangmanState.selectedItem.word) {
    const slot = document.createElement('div');
    slot.style.width = '36px';
    slot.style.height = '46px';
    slot.style.borderBottom = '4px solid #f59e0b';
    slot.style.background = 'rgba(245, 158, 11, 0.12)';
    slot.style.borderRadius = '6px 6px 0 0';
    slot.style.display = 'flex';
    slot.style.alignItems = 'center';
    slot.style.justifyContent = 'center';
    slot.style.fontSize = '1.35rem';
    slot.style.fontWeight = '800';
    slot.style.color = 'var(--text-primary)';
    slot.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';

    if (dashHangmanState.guessedLetters.has(char)) {
      slot.textContent = char;
    } else {
      slot.textContent = "\u00A0";
      isWin = false;
    }
    wordBox.appendChild(slot);
  }

  if (isWin && dashHangmanState.selectedItem.word && dashHangmanState.wrongCount < dashHangmanState.maxWrong && dashHangmanState.isGameActive) {
    dashHangmanState.isGameActive = false;
    const statusEl = document.getElementById('dash-hangman-status');
    if (statusEl) {
      statusEl.textContent = "🎉 Word Solved! Restoring your streak...";
      statusEl.style.color = "#10b981";
    }
    disableDashHangmanKeys();
    handleDashStreakRestoration();
  }
}

function renderDashHangmanKeyboard() {
  const kbBox = document.getElementById('dash-hangman-keyboard');
  if (!kbBox) return;
  kbBox.innerHTML = "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  for (const letter of alphabet) {
    const btn = document.createElement('button');
    btn.textContent = letter;
    btn.className = 'btn btn-ghost btn-sm dash-key-btn';
    btn.dataset.key = letter;
    btn.style.width = '34px';
    btn.style.height = '34px';
    btn.style.padding = '0';
    btn.style.fontWeight = '700';

    if (dashHangmanState.guessedLetters.has(letter)) {
      btn.disabled = true;
      btn.style.opacity = '0.4';
    }

    btn.addEventListener('click', () => {
      handleDashLetterGuess(letter);
    });

    kbBox.appendChild(btn);
  }
}

function disableDashHangmanKeys() {
  const kbBox = document.getElementById('dash-hangman-keyboard');
  if (kbBox) {
    kbBox.querySelectorAll('button').forEach(b => b.disabled = true);
  }
}

async function handleDashStreakRestoration() {
  try {
    const allStats = await storage.getAllDailyStats();
    const restorable = checkRestorableStreak(allStats);
    if (restorable) {
      await storage.updateDailyStatsForDate(restorable.missedDateKey, curr => ({
        ...curr,
        completedCount: Math.max(1, curr.completedCount || 0),
        restoredStreak: true
      }));

      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({ action: 'REFRESH_ALARMS' }).catch(() => {});
      }

      showToast(`🎉 Streak Restored! Your streak has been successfully recovered 💕`, 'success', 6000);
      userSettings = await storage.getSettings();
      renderOverview();
    }
  } catch (e) {
    console.error("Failed to restore streak:", e);
  }
}

/* --- TAB 1: OVERVIEW --- */
async function renderOverview() {
  const stats = await storage.getDailyStats();
  const scoreEl = document.getElementById('sidebar-score-val');
  if (scoreEl) scoreEl.style.display = 'none';
  const kpiDone = document.getElementById('dash-kpi-done');
  if (kpiDone) kpiDone.textContent = stats.completedCount || 0;
  const kpiFocus = document.getElementById('dash-kpi-focus');
  if (kpiFocus) kpiFocus.textContent = `${stats.focusMinutesToday || 0} Min`;
  // Restorable Streak Banner Check
  const allDailyStats = await storage.getAllDailyStats();
  const restorable = checkRestorableStreak(allDailyStats);
  const restoreCard = document.getElementById('dash-streak-restore-card');
  const restoreValEl = document.getElementById('dash-restore-days-val');

  if (restorable) {
    if (dashHangmanState.missedDateKey !== restorable.missedDateKey) {
      dashHangmanState.missedDateKey = restorable.missedDateKey;
      dashHangmanState.attemptsLeft = 3;
      dashHangmanState.isGameActive = false;
    }
    dashHangmanState.pastStreakValue = restorable.pastStreakValue;
    if (restoreCard) restoreCard.style.display = 'block';
    if (restoreValEl) restoreValEl.textContent = restorable.pastStreakValue;
  } else {
    if (restoreCard) restoreCard.style.display = 'none';
  }

  const completedToday = (stats.completedCount || 0) + (stats.waterGlasses || 0) + (stats.focusMinutesToday || 0);
  const isDoneToday = completedToday > 0;
  const streakDays = stats.streakDays || 0;
  const isStreakBroken = streakDays <= 0 || (!isDoneToday && restorable);

  const streakKpiEl = document.getElementById('dash-kpi-streak');
  if (streakKpiEl) {
    if (isStreakBroken) {
      streakKpiEl.textContent = `0 Days 🔥`;
      streakKpiEl.style.color = '#94a3b8';
      streakKpiEl.style.opacity = '0.6';
      streakKpiEl.style.filter = 'grayscale(100%)';
    } else if (!isDoneToday) {
      streakKpiEl.textContent = `${streakDays} Days 🔥`;
      streakKpiEl.style.color = '#94a3b8';
      streakKpiEl.style.opacity = '0.6';
      streakKpiEl.style.filter = 'grayscale(100%)';
    } else {
      streakKpiEl.textContent = `${streakDays} Day${streakDays === 1 ? '' : 's'} 🔥`;
      streakKpiEl.style.color = '#f59e0b';
      streakKpiEl.style.opacity = '1';
      streakKpiEl.style.filter = 'none';
    }
  }

  // Bind Open Hangman Toggle
  const btnHangman = document.getElementById('btn-dash-open-hangman');
  if (btnHangman) {
    btnHangman.onclick = () => {
      const gameBox = document.getElementById('dash-hangman-game-box');
      if (gameBox) {
        const isVisible = gameBox.style.display === 'block';
        gameBox.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) {
          startDashHangmanGame();
        }
      }
    };
  }
  
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
        <button class="btn btn-ghost btn-sm" id="btn-dash-pin-focus" style="padding: 4px 8px; border: none; background: transparent; opacity: ${focusState.pinned !== false ? '1' : '0.45'}; font-size: 1.1rem;" title="${focusState.pinned !== false ? 'Unpin Clock' : 'Pin Clock'}">📌</button>
        <button class="btn btn-secondary btn-sm" id="btn-dash-pause-focus">⏸ Pause</button>
        <button class="btn btn-danger btn-sm" id="btn-dash-stop-focus">Stop</button>
      `;

      const tick = () => {
        const remainingMs = focusState.endTime - Date.now();
        if (remainingMs <= 0) {
          clearInterval(dashFocusInterval);
          if (typeof chrome !== 'undefined' && chrome.runtime) {
            chrome.runtime.sendMessage({ action: 'COMPLETE_FOCUS_MODE' }, async () => {
              showToast('🎉 Focus session completed! Outstanding work!', 'success');
              await updateDashboardFocusWidget();
              renderOverview();
            });
          }
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

      document.getElementById('btn-dash-pin-focus')?.addEventListener('click', async () => {
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({ action: 'TOGGLE_PIN_FOCUS_CLOCK' }, async () => {
            await updateDashboardFocusWidget();
          });
        }
      });
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
      <div id="row-dash-focus-btns" style="display: flex; flex-direction: row; align-items: center; justify-content: flex-end; gap: 8px;">
        <button class="btn btn-primary btn-sm" id="btn-dash-focus-25" style="padding: 6px 14px;">25m</button>
        <button class="btn btn-secondary btn-sm" id="btn-dash-focus-45" style="padding: 6px 14px;">45m</button>
        <button class="btn btn-ghost btn-sm" id="btn-dash-show-custom" style="padding: 6px 12px;">Custom</button>
      </div>
      <div id="box-dash-custom-focus" style="display: none; flex-direction: row; align-items: center; justify-content: flex-end; gap: 8px;">
        <input type="number" id="dash-input-custom-focus" class="input-field" placeholder="Mins" min="1" max="480" style="width: 75px; height: 34px; padding: 4px 8px; font-size: 0.85rem;">
        <button class="btn btn-primary btn-sm" id="btn-dash-focus-custom" style="height: 34px; padding: 0 14px;">▶ Start</button>
        <button class="btn btn-ghost btn-sm" id="btn-dash-cancel-custom" style="height: 34px; padding: 0 8px;">✕</button>
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

function updateUndoTimerCountdown() {
  const cardUndoBtn = document.getElementById('period-card-undo-btn');
  if (!cardUndoBtn) return;

  const pc = userSettings?.periodTracker || {};
  if (!pc.previousLastPeriodDate || !pc.periodLoggedAt) {
    cardUndoBtn.style.display = 'none';
    return;
  }

  const TEN_MINUTES_MS = 10 * 60 * 1000;
  const elapsed = Date.now() - pc.periodLoggedAt;
  const remainingMs = TEN_MINUTES_MS - elapsed;

  if (remainingMs > 0) {
    const remSec = Math.ceil(remainingMs / 1000);
    const mins = Math.floor(remSec / 60);
    const secs = remSec % 60;
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    cardUndoBtn.innerHTML = `↩️ Undo Last Log (${timeStr})`;
    cardUndoBtn.style.display = 'inline-block';
  } else {
    cardUndoBtn.style.display = 'none';
  }
}

function updateAllLiveCountdowns() {
  document.querySelectorAll('.live-countdown').forEach(el => {
    const ts = parseInt(el.dataset.timestamp, 10);
    if (ts) {
      el.textContent = formatRelativeTime(ts);
    }
  });
  updateUndoTimerCountdown();
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

function renderTodayTasksTable() {
  const box = document.getElementById('dash-today-reminders-box');
  if (!box) return;

  const todayReminders = activeRemindersList.filter(r => {
    if (!r.enabled) return false;
    if (r.id === 'auto_health_water') return false;
    if (r.id === 'auto_period_reminder' || r.isPeriodReminder) {
      const pc = userSettings.periodTracker || {};
      const profile = userSettings.userProfile || {};
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
    }
    return true;
  });

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
          <button class="btn btn-secondary btn-sm dash-act-done" data-id="${rem.id}" style="padding: 4px 10px; font-size: 0.75rem;">${rem.category === 'period' ? 'Got It 👍' : 'Done ✓'}</button>
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

  document.getElementById('mgr-search-input')?.addEventListener('input', () => {
    renderRemindersTable();
  });
  document.getElementById('mgr-filter-category')?.addEventListener('change', () => {
    renderRemindersTable();
  });
  document.getElementById('mgr-filter-priority')?.addEventListener('change', () => {
    renderRemindersTable();
  });

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
    if (rem.id === 'auto_period_reminder' || rem.isPeriodReminder || rem.category === 'period') {
      if (rem.enabled === false) return false;
      const pc = userSettings.periodTracker || {};
      const profile = userSettings.userProfile || {};
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
    }
    const matchesSearch = rem.title.toLowerCase().includes(searchQuery) || 
                          (rem.description && rem.description.toLowerCase().includes(searchQuery));
    const matchesCat = catFilter === 'all' || 
                       (catFilter === 'health' && (['water', 'medicine', 'health', 'eye', 'posture'].includes(rem.category) || rem.id.startsWith('auto_health_') || rem.id.startsWith('med_rem_'))) ||
                       rem.category === catFilter;
    const matchesPrio = prioFilter === 'all' || rem.priority === prioFilter;
    return matchesSearch && matchesCat && matchesPrio;
  });

  // Sort Health Hub reminders to the top
  filtered.sort((a, b) => {
    const aHealth = a.id.startsWith('auto_health_') || a.id.startsWith('med_rem_') || a.id === 'auto_period_reminder' || ['water', 'medicine', 'health', 'eye', 'posture'].includes(a.category);
    const bHealth = b.id.startsWith('auto_health_') || b.id.startsWith('med_rem_') || b.id === 'auto_period_reminder' || ['water', 'medicine', 'health', 'eye', 'posture'].includes(b.category);
    if (aHealth && !bHealth) return -1;
    if (!aHealth && bHealth) return 1;
    return 0;
  });

  if (filtered.length === 0) {
    safeSetHTML(tbody, `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 32px;">
          No matching reminders found.
        </td>
      </tr>
    `);
    return;
  }

  const html = filtered.map((rem, index) => {
    const cat = getCategoryDetails(rem.category, userCustomCategories);
    const prio = PRIORITIES[rem.priority?.toUpperCase()] || PRIORITIES.MEDIUM;
    const cleanTitle = cleanReminderTitle(rem.title);

    const isFixedHealth = rem.id.startsWith('auto_health_') || rem.id.startsWith('med_rem_') || rem.id === 'auto_period_reminder' || ['water', 'medicine', 'health', 'eye', 'posture'].includes(rem.category);
    
    const editBtnHtml = isFixedHealth
      ? `<button class="btn-health-hub-link mgr-act-goto-health" title="Edit in Health Hub tab">Health Hub</button>`
      : `<button class="btn-icon-action mgr-act-edit" data-id="${rem.id}" title="Edit Reminder">✏️</button>`;

    const deleteBtnHtml = isFixedHealth 
      ? '' 
      : `<button class="btn-icon-action btn-del-action mgr-act-del" data-id="${rem.id}" title="Delete Reminder">🗑️</button>`;

    const isPassedOneTime = (rem.repeat === 'once' || !rem.repeat) && rem.time && rem.time < now && !isFixedHealth;
    const isPaused = rem.enabled === false;

    const toggleBtnHtml = isPassedOneTime
      ? `<button class="btn-icon-action mgr-act-archive-now" data-id="${rem.id}" style="color: #f59e0b; border-color: rgba(245, 158, 11, 0.3);" title="Archive Now">📦</button>`
      : `<button class="btn-icon-action mgr-act-toggle" data-id="${rem.id}" title="${!isPaused ? 'Pause Reminder' : 'Activate Reminder'}">
           ${!isPaused ? '⏸️' : '▶️'}
         </button>`;

    const countdownHtml = isPaused
      ? ''
      : isPassedOneTime
        ? `<div style="font-size: 0.775rem; color: #f59e0b; margin-top: 2px;">(Passed)</div>`
        : `<div style="font-size: 0.775rem; color: #38bdf8; margin-top: 2px;" class="live-countdown" data-timestamp="${rem.time}">${formatRelativeTime(rem.time)}</div>`;

    const prioClass = `prio-row-${(rem.priority || 'medium').toLowerCase()}`;

    return `
      <tr class="${prioClass}">
        <td style="text-align: center; font-weight: 700; color: var(--text-muted); font-size: 0.8rem;">${index + 1}</td>
        <td class="col-title" style="font-weight: 600;" title="${escapeHTML(cleanTitle)}">${cat.icon} ${escapeHTML(cleanTitle)}</td>
        <td class="col-center">${cat.label}</td>
        <td class="col-center"><span class="badge ${prio.badgeClass}">${prio.label}</span></td>
        <td class="col-center">
          <div style="font-weight: 600;">${getScheduleLabel(rem)}</div>
          ${countdownHtml}
        </td>
        <td class="col-center">
          <span style="color: ${isPassedOneTime ? '#f59e0b' : !isPaused ? '#10b981' : '#64748b'}; font-weight: 600;">
            ${isPassedOneTime ? 'Passed' : !isPaused ? 'Active' : 'Paused'}
          </span>
        </td>
        <td class="col-center">
          <div class="action-btn-group">
            ${toggleBtnHtml}
            ${editBtnHtml}
            ${deleteBtnHtml}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  safeSetHTML(tbody, html);

  initTableScrollIndicators();

  tbody.querySelectorAll('.mgr-act-toggle').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      const idx = activeRemindersList.findIndex(r => r.id === id);
      if (idx !== -1) {
        const targetRem = activeRemindersList[idx];
        targetRem.enabled = !targetRem.enabled;

        // Bi-directional sync with Health Hub settings for auto health reminders
        const health = userSettings.healthSettings || {};
        if (targetRem.id === 'auto_health_water' || targetRem.category === 'water') {
          health.waterEnabled = targetRem.enabled;
        } else if (targetRem.id === 'auto_health_eye' || targetRem.category === 'eye') {
          health.eyeRestEnabled = targetRem.enabled;
        } else if (targetRem.id === 'auto_health_posture' || targetRem.category === 'posture') {
          health.postureEnabled = targetRem.enabled;
        }
        userSettings.healthSettings = health;
        await storage.saveSettings(userSettings);

        await storage.saveReminders(activeRemindersList);
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({ action: 'REFRESH_ALARMS' });
        }
        renderRemindersTable();
        renderOverview();
      }
    });
  });

  const attachMedData = (rem) => {
    if (!rem) return rem;
    if (rem.id.startsWith('med_rem_') || rem.category === 'medicine') {
      const rawId = rem.id.replace('med_rem_', '');
      const healthMeds = userSettings.healthSettings?.medications || [];
      const matched = healthMeds.find(m => m.id === rawId || m.id === 'med_' + rawId || rem.title.includes(m.name));
      if (matched) {
        return { ...rem, medData: { ...matched } };
      }
    }
    return rem;
  };

  tbody.querySelectorAll('.mgr-act-archive-now').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      const rem = activeRemindersList.find(r => r.id === id);
      if (rem) {
        await storage.archiveReminder(attachMedData(rem));
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
      const remToArchive = activeRemindersList.find(r => r.id === id);
      if (remToArchive) {
        await storage.archiveReminder(attachMedData(remToArchive));
        activeRemindersList = activeRemindersList.filter(r => r.id !== id);
        await storage.saveReminders(activeRemindersList);
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({ action: 'REFRESH_ALARMS' });
        }
        await renderArchiveTable();
        renderRemindersTable();
        renderOverview();
        showToast('Reminder moved to Completed Reminders (Archive) 📦', 'success');
      }
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
    catSelect.value = '';
  }
  const customBox = document.getElementById('box-custom-category-fields');
  if (customBox) customBox.style.display = 'none';

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
  document.getElementById('modal-reminder-title').textContent = 'Add Reminder';
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
  const catInput = document.getElementById('edit-rem-category');
  let category = catInput ? catInput.value : '';
  if (!category || category === '') {
    highlightFieldError(catInput, 'Please select a category!');
    return;
  }

  const customName = document.getElementById('edit-rem-custom-name')?.value.trim();
  const customEmoji = document.getElementById('edit-rem-custom-emoji')?.value.trim() || '';

  if (category === 'new_custom' || customName || customEmoji) {
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

  if (restoringArchivedId) {
    const archivedRem = archivedRemindersList.find(r => r.id === restoringArchivedId);
    await storage.deleteArchivedReminder(restoringArchivedId);
    restoringArchivedId = null;
    await syncRestoredMedicationToHealthHub(archivedRem);
    await renderArchiveTable();
  }

  const existingIdx = activeRemindersList.findIndex(r => r.id === id);
  if (existingIdx !== -1) {
    activeRemindersList[existingIdx] = {
      ...activeRemindersList[existingIdx],
      title,
      description: desc,
      category,
      priority,
      repeat,
      repeatInterval,
      enabled,
      time: scheduledTimestamp
    };
  } else {
    const newRem = {
      id: id || generateId(),
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
      <td>${(m.times || []).map(t => formatTimeStringToUserDevice(t)).join(', ') || 'N/A'}</td>
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
      const last = parseLocalDate(pt.lastPeriodDate);
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
function renderContextState() {
  const isContextOn = userSettings.contextAwarenessEnabled !== false;
  const toggleContext = document.getElementById('toggle-context-enabled');
  const labelContext = document.getElementById('label-context-status');
  const optionsBox = document.getElementById('box-context-options');

  if (toggleContext) toggleContext.checked = isContextOn;
  if (labelContext) {
    labelContext.textContent = isContextOn ? 'Enabled' : 'Disabled';
    labelContext.style.color = isContextOn ? '#10b981' : '#64748b';
  }
  if (optionsBox) {
    optionsBox.style.display = isContextOn ? 'block' : 'none';
  }

  const blockMode = userSettings.contextBlockMode || 'remi_overlay';
  const radioOverlay = document.getElementById('radio-mode-overlay');
  const radioAll = document.getElementById('radio-mode-all');
  if (radioOverlay && radioAll) {
    if (blockMode === 'all_notifications') radioAll.checked = true;
    else radioOverlay.checked = true;
  }

  const isBlockerOn = userSettings.websiteBlockerEnabled !== false;
  const toggleBlocker = document.getElementById('toggle-blocker-enabled');
  const labelBlocker = document.getElementById('label-blocker-status');

  if (toggleBlocker) toggleBlocker.checked = isBlockerOn;
  if (labelBlocker) {
    labelBlocker.textContent = isBlockerOn ? 'Enabled' : 'Disabled';
    labelBlocker.style.color = isBlockerOn ? '#10b981' : '#64748b';
  }
}

function parseDomainsInput(rawInput) {
  if (!rawInput) return [];
  const items = rawInput.split(/[\s,]+/);
  const cleanList = [];
  for (let item of items) {
    let domain = item.trim().toLowerCase();
    if (!domain) continue;
    domain = domain.replace(/^https?:\/\//i, '');
    domain = domain.replace(/^www\./i, '');
    domain = domain.split('/')[0];
    if (domain && !cleanList.includes(domain)) {
      cleanList.push(domain);
    }
  }
  return cleanList;
}

function initContextBlocker() {
  renderContextState();

  document.getElementById('toggle-context-enabled')?.addEventListener('change', async (e) => {
    const isChecked = e.target.checked;
    userSettings.contextAwarenessEnabled = isChecked;
    await storage.saveSettings(userSettings);
    showToast(`Smart Context Queueing ${isChecked ? 'Enabled ⚡' : 'Disabled'}`, isChecked ? 'success' : 'info');
    renderContextState();
  });

  const handleRadioChange = async (e) => {
    userSettings.contextBlockMode = e.target.value;
    await storage.saveSettings(userSettings);
    showToast(`Notification Blocking Mode set to ${e.target.value === 'remi_overlay' ? 'Remi Overlay Only 👦' : 'All Notifications & Sounds 🔕'}`, 'success');
  };

  document.getElementById('radio-mode-overlay')?.addEventListener('change', handleRadioChange);
  document.getElementById('radio-mode-all')?.addEventListener('change', handleRadioChange);

  document.getElementById('toggle-blocker-enabled')?.addEventListener('change', async (e) => {
    const isChecked = e.target.checked;
    userSettings.websiteBlockerEnabled = isChecked;
    await storage.saveSettings(userSettings);
    showToast(`Website Blocker ${isChecked ? 'Enabled 🛡️' : 'Disabled'}`, isChecked ? 'success' : 'info');
    renderContextState();
  });

  const prioInput = document.getElementById('new-priority-site-input');
  const prioBtn = document.getElementById('btn-add-priority-site');
  if (prioInput && prioBtn) {
    prioInput.addEventListener('input', () => {
      prioBtn.style.display = prioInput.value.trim() ? 'inline-flex' : 'none';
    });
  }

  const addPriorityDomains = async () => {
    const input = document.getElementById('new-priority-site-input');
    const rawVal = input ? input.value : '';
    const newDomains = parseDomainsInput(rawVal);
    if (newDomains.length === 0) return;

    if (!userSettings.priorityWebsites) userSettings.priorityWebsites = [];
    let addedCount = 0;
    for (const d of newDomains) {
      if (!userSettings.priorityWebsites.includes(d)) {
        userSettings.priorityWebsites.push(d);
        addedCount++;
      }
    }
    if (addedCount > 0) {
      await storage.saveSettings(userSettings);
      showToast(`Added ${addedCount} priority domain${addedCount > 1 ? 's' : ''}! 🌐`, 'success');
      if (input) input.value = '';
      if (prioBtn) prioBtn.style.display = 'none';
      renderDomainLists();
    } else {
      showToast('Domain(s) already in list!', 'info');
    }
  };

  document.getElementById('btn-add-priority-site')?.addEventListener('click', addPriorityDomains);
  document.getElementById('new-priority-site-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addPriorityDomains();
    }
  });

  const blockInput = document.getElementById('new-blocked-site-input');
  const blockBtn = document.getElementById('btn-add-blocked-site');
  if (blockInput && blockBtn) {
    blockInput.addEventListener('input', () => {
      blockBtn.style.display = blockInput.value.trim() ? 'inline-flex' : 'none';
    });
  }

  const addBlockedDomains = async () => {
    const input = document.getElementById('new-blocked-site-input');
    const rawVal = input ? input.value : '';
    const newDomains = parseDomainsInput(rawVal);
    if (newDomains.length === 0) return;

    if (!userSettings.blockedWebsites) userSettings.blockedWebsites = [];
    let addedCount = 0;
    for (const d of newDomains) {
      if (!userSettings.blockedWebsites.includes(d)) {
        userSettings.blockedWebsites.push(d);
        addedCount++;
      }
    }
    if (addedCount > 0) {
      await storage.saveSettings(userSettings);
      showToast(`Added ${addedCount} blocked domain${addedCount > 1 ? 's' : ''}! 🌐`, 'success');
      if (input) input.value = '';
      if (blockBtn) blockBtn.style.display = 'none';
      renderDomainLists();
    } else {
      showToast('Domain(s) already in list!', 'info');
    }
  };

  document.getElementById('btn-add-blocked-site')?.addEventListener('click', addBlockedDomains);
  document.getElementById('new-blocked-site-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addBlockedDomains();
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
        🌐 ${escapeHTML(d)}
        <span class="domain-pill-remove" data-type="priority" data-domain="${d}">×</span>
      </span>
    `).join('');
    safeSetHTML(priorityContainer, html);
  }

  if (blockedContainer) {
    const html = (userSettings.blockedWebsites || []).map(d => `
      <span class="domain-pill domain-pill-blocked">
        🌐 ${escapeHTML(d)}
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

function updateVolumeSliderVisuals() {
  const slider = document.getElementById('setting-volume-slider');
  const badge = document.getElementById('setting-volume-badge');
  if (!slider) return;

  const val = parseInt(slider.value, 10);
  if (badge) {
    if (val === 0) {
      badge.textContent = 'Muted 🔇 (0%)';
      badge.style.color = '#94a3b8';
    } else if (val === 100) {
      badge.textContent = '100% 🔊';
      badge.style.color = '#10b981';
    } else if (val < 50) {
      badge.textContent = `${val}% 🔈`;
      badge.style.color = '#3b82f6';
    } else {
      badge.textContent = `${val}% 🔉`;
      badge.style.color = '#3b82f6';
    }
  }

  if (val === 0) {
    slider.style.background = 'rgba(255, 255, 255, 0.1)';
    slider.classList.add('is-muted');
  } else if (val === 100) {
    slider.style.background = 'linear-gradient(90deg, #3b82f6 0%, #10b981 100%)';
    slider.classList.remove('is-muted');
  } else {
    slider.style.background = `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${val}%, rgba(255, 255, 255, 0.1) ${val}%, rgba(255, 255, 255, 0.1) 100%)`;
    slider.classList.remove('is-muted');
  }
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
    const slider = document.getElementById('setting-volume-slider');
    slider.value = userSettings.volume !== undefined ? userSettings.volume : 100;
    updateVolumeSliderVisuals();
    slider.addEventListener('input', updateVolumeSliderVisuals);
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

  // Expand / collapse period config body (hidden by default in View mode)
  const configBody = document.getElementById('period-config-body');
  const configArrow = document.getElementById('period-config-arrow');
  const toggleBtn = document.getElementById('btn-toggle-period-config');

  const setPeriodConfigExpanded = (expanded) => {
    if (configBody) configBody.style.display = expanded ? 'block' : 'none';
    if (configArrow) configArrow.textContent = expanded ? '▲' : '▼';
  };

  toggleBtn?.addEventListener('click', () => {
    const isExpanded = configBody?.style.display === 'block';
    setPeriodConfigExpanded(!isExpanded);
  });

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
  setPeriodConfigExpanded(false); // hidden by default in View mode

  // ✏️ Edit Profile click
  editBtn?.addEventListener('click', () => {
    setEditMode(true);
    setPeriodConfigExpanded(true); // automatically expand fields when editing
  });

  // ✕ Cancel
  cancelBtn?.addEventListener('click', () => {
    // Restore from saved settings
    populateProfileFields(userSettings.userProfile || {}, userSettings.periodTracker || {});
    togglePeriodSettings(userSettings.userProfile?.gender || 'prefer_not_to_say');
    applyTrackingToggle(!!(userSettings.periodTracker?.trackingEnabled));
    setEditMode(false);
    setPeriodConfigExpanded(false); // collapse back in View mode
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
    const newPeriodDuration = parseInt(periodDurEl?.value, 10) || 5;

    // --- Validation before saving if Period Tracking is Enabled ---
    if (newGender === 'female' && newTrackingEnabled) {
      if (lastDateEl) lastDateEl.style.borderColor = '';
      if (cycleLenEl) cycleLenEl.style.borderColor = '';
      if (periodDurEl) periodDurEl.style.borderColor = '';

      if (!newLastDate) {
        showToast('⚠️ Please select your Last Period Start Date to enable cycle tracking.', 'warning', 5000);
        if (lastDateEl) {
          lastDateEl.style.borderColor = '#ef4444';
          lastDateEl.focus();
        }
        return;
      }

      if (!cycleLenEl?.value || isNaN(newCycleLength) || newCycleLength < 15 || newCycleLength > 45) {
        showToast('⚠️ Please enter a valid Average Cycle Length (between 15 and 45 days).', 'warning', 5000);
        if (cycleLenEl) {
          cycleLenEl.style.borderColor = '#ef4444';
          cycleLenEl.focus();
        }
        return;
      }

      if (!periodDurEl?.value || isNaN(newPeriodDuration) || newPeriodDuration < 1 || newPeriodDuration > 15) {
        showToast('⚠️ Please enter a valid Average Period Duration (between 1 and 15 days).', 'warning', 5000);
        if (periodDurEl) {
          periodDurEl.style.borderColor = '#ef4444';
          periodDurEl.focus();
        }
        return;
      }
    }

    // --- Date validation (only when tracking enabled) ---
    if (newGender === 'female' && newTrackingEnabled && newLastDate) {
      const entered = new Date(newLastDate);
      const today = new Date(); today.setHours(0,0,0,0);
      const maxDaysBack = newCycleLength * 2;
      const earliestAllowed = new Date(today);
      earliestAllowed.setDate(earliestAllowed.getDate() - maxDaysBack);

      if (entered > today) {
        showToast('⚠️ Last period date cannot be in the future. Please enter the actual start date of your most recent period.', 'error', 6000);
        if (lastDateEl) {
          lastDateEl.style.borderColor = '#ef4444';
          lastDateEl.focus();
        }
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
          if (lastDateEl) {
            lastDateEl.style.borderColor = '#ef4444';
            lastDateEl.focus();
          }
          return;
        }
      }
    }

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

    // Sync pre-period reminder state according to rules (only visible during pre-period window)
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: 'SYNC_PERIOD_REMINDER' });
    }

    renderPeriodTracker();
    setEditMode(false); // lock fields after save
    setPeriodConfigExpanded(false); // collapse back in View mode
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

  const handleUndoPeriodStart = async () => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: 'REVERT_PERIOD_START' }, async (response) => {
        if (response && response.success) {
          showToast(`↩️ Period date reverted! Cycle phase restored 💕`, 'info', 5000);
          userSettings = await storage.getSettings();
          const periodConfig = userSettings.periodTracker || {};
          if (document.getElementById('period-last-date')) {
            document.getElementById('period-last-date').value = periodConfig.lastPeriodDate || '';
          }
          renderPeriodTracker();
          renderRemindersTable();
          renderTodayTasksTable();
        }
      });
    }
  };

  // 🩸 Early Period Start Logger Handler
  document.getElementById('btn-log-period-early')?.addEventListener('click', async () => {
    const daysBackOffset = parseInt(document.getElementById('period-log-early-select')?.value || '0', 10);
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: 'LOG_PERIOD_START', daysBackOffset }, async (response) => {
        const offsetLabels = ['Today', '1 Day Early', '2 Days Early', '3 Days Early'];
        const label = offsetLabels[daysBackOffset] || 'Today';
        showToast(`🩸 Period start logged (${label})! Predictions & cycle phase updated 💕`, 'success', 5000);

        userSettings = await storage.getSettings();
        const periodConfig = userSettings.periodTracker || {};
        if (document.getElementById('period-last-date')) {
          document.getElementById('period-last-date').value = periodConfig.lastPeriodDate || '';
        }
        renderPeriodTracker();
        renderRemindersTable();
        renderTodayTasksTable();
      });
    }
  });

  // ↩️ Revert / Undo Period Logger Handler (Top Header Button)
  document.getElementById('period-card-undo-btn')?.addEventListener('click', handleUndoPeriodStart);

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(async (msg) => {
      if (msg.action === 'PERIOD_LOGGED') {
        userSettings = await storage.getSettings();
        const periodConfig = userSettings.periodTracker || {};
        if (document.getElementById('period-last-date')) {
          document.getElementById('period-last-date').value = periodConfig.lastPeriodDate || '';
        }
        renderPeriodTracker();
        renderRemindersTable();
        renderTodayTasksTable();
      }
    });
  }

  document.getElementById('btn-test-sound')?.addEventListener('click', async () => {
    const toneSelect = document.getElementById('setting-sound-tone');
    const volSlider = document.getElementById('setting-volume-slider');
    const settings = await storage.getSettings();
    const tone = toneSelect?.value || settings.soundTone || 'chime';
    const vol = volSlider?.value !== undefined && volSlider?.value !== '' 
      ? parseInt(volSlider.value, 10) 
      : (settings.volume !== undefined ? settings.volume : 100);
    soundEngine.playChime(tone, vol);
  });

  // Export JSON (All Data Values)
  document.getElementById('btn-export-backup').addEventListener('click', async () => {
    const backupData = {
      reminders: await storage.getReminders(),
      settings: await storage.getSettings(),
      archivedReminders: await storage.getArchivedReminders(),
      customCategories: await storage.getCustomCategories(),
      dailyStats: await storage.getAllDailyStats(),
      dailyProgress: await storage.getAllReminderDailyProgress(),
      focusState: await storage.getFocusState(),
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
        const now = Date.now();
        const activeReminders = [];
        let archivedList = Array.isArray(imported.archivedReminders) ? imported.archivedReminders : [];

        if (Array.isArray(imported.reminders)) {
          for (const rem of imported.reminders) {
            if (!rem) continue;

            // Normalize time string e.g. "09:00" or ISO string to numeric timestamp
            let remTime = rem.time;
            if (typeof remTime === 'string') {
              if (remTime.includes(':')) {
                const [h, m] = remTime.split(':').map(Number);
                const d = new Date();
                d.setHours(h || 0, m || 0, 0, 0);
                remTime = d.getTime();
              } else {
                const parsed = new Date(remTime).getTime();
                if (!isNaN(parsed)) remTime = parsed;
              }
            }

            rem.time = remTime || now;

            // Check if scheduled time is in the past relative to restore upload time
            if (rem.time <= now) {
              if (rem.repeat && rem.repeat !== 'once') {
                // Repeating / interval reminder: Recalculate next future execution time AFTER restore upload time!
                const nextFuture = calculateNextFutureTime(rem, now);
                rem.time = nextFuture || (now + 60 * 1000);
                rem.enabled = true;
                activeReminders.push(rem);
              } else {
                // Passed one-time reminder: Move to Archive!
                rem.enabled = false;
                rem.archivedAt = rem.archivedAt || new Date().toISOString();
                archivedList.push(rem);
              }
            } else {
              activeReminders.push(rem);
            }
          }
        }

        await storage.saveReminders(activeReminders);
        await storage.saveArchivedReminders(archivedList);
        if (imported.settings) {
          const s = imported.settings;
          if (s.contextBlocker) {
            s.priorityWebsites = s.priorityWebsites || s.contextBlocker.prioritySites || [];
            s.blockedWebsites = s.blockedWebsites || s.contextBlocker.blocklist || [];
          }
          await storage.saveSettings(s);
        }
        if (imported.customCategories) {
          if (typeof storage.saveCustomCategories === 'function') {
            await storage.saveCustomCategories(imported.customCategories);
          } else {
            await storage.set(STORAGE_KEYS.CUSTOM_CATEGORIES, imported.customCategories);
          }
        }
        if (imported.dailyStats) await storage.set(STORAGE_KEYS.DAILY_STATS, imported.dailyStats);
        if (imported.dailyProgress) await storage.set(STORAGE_KEYS.REMINDER_DAILY_PROGRESS, imported.dailyProgress);
        if (imported.focusState) await storage.saveFocusState(imported.focusState);
        showToast('Backup restored successfully! Reloading...', 'success');
        setTimeout(() => {
          window.location.reload();
        }, 500);
      } catch (err) {
        console.error("Backup Restore Failed:", err);
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

let restoringArchivedId = null;

async function syncRestoredMedicationToHealthHub(rem) {
  if (!rem) return;
  const isMed = rem.id.startsWith('med_rem_') || rem.category === 'medicine' || rem.title.includes('Medication:');
  if (!isMed) return;

  const rawMedId = rem.id.replace('med_rem_', '');
  userSettings = await storage.getSettings();
  const health = userSettings.healthSettings || {};
  health.medications = health.medications || [];

  let restoredMed = null;

  if (rem.medData) {
    restoredMed = {
      ...rem.medData,
      id: rawMedId || rem.medData.id || generateId(),
      takenTodayCount: 0
    };
  } else {
    const match = rem.title.match(/Medication:\s*(.*?)(?:\s*\((.*?)\))?$/i);
    const medName = match ? match[1].trim() : rem.title.replace(/^[💊\s]+/, '').replace(/Medication:\s*/i, '').trim();
    const medDosage = match && match[2] ? match[2].trim() : (rem.description ? rem.description.replace(/\s*\(Dose.*?\)/gi, '').trim() : '1 Dose');

    const countMatch = rem.description ? (rem.description.match(/Dose\s*\d+\/(\d+)/i) || rem.description.match(/(\d+)\s*dose/i)) : null;
    const doseCount = countMatch ? parseInt(countMatch[1], 10) : 1;

    restoredMed = {
      id: rawMedId || generateId(),
      title: medName,
      name: medName,
      dosage: medDosage || 'Take prescribed dose',
      doseCount: doseCount || 1,
      times: ['08:00'],
      scheduleType: rem.repeat === 'weekly' ? 'weekly' : 'daily',
      takenTodayCount: 0
    };
  }

  const existingIdx = health.medications.findIndex(m => m.id === restoredMed.id || (m.name && m.name.toLowerCase() === (restoredMed.name || '').toLowerCase()));
  if (existingIdx !== -1) {
    health.medications[existingIdx] = restoredMed;
  } else {
    health.medications.push(restoredMed);
  }

  userSettings.healthSettings = health;
  await storage.saveSettings(userSettings);

  await renderHealthHub();
}

async function handleRestoreReminder(id) {
  const rem = archivedRemindersList.find(r => r.id === id);
  if (!rem) return;

  const isRecurring = rem.repeat && rem.repeat !== 'once';
  const isFutureOneTime = (rem.repeat === 'once' || !rem.repeat) && rem.time && rem.time > Date.now() - 60000;

  if (isRecurring || isFutureOneTime) {
    await storage.restoreReminder(id);
    activeRemindersList = await storage.getReminders();
    await syncRestoredMedicationToHealthHub(rem);
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ action: 'REFRESH_ALARMS' });
    }
    await renderArchiveTable();
    renderRemindersTable();
    renderOverview();
    showToast('Reminder & Health Hub medication restored! 🔄', 'success');
  } else {
    openRestoreModal(id);
  }
}

function openRestoreModal(id) {
  const rem = archivedRemindersList.find(r => r.id === id);
  if (!rem) return;

  restoringArchivedId = id;

  const repeatPattern = rem.repeat || 'once';
  document.getElementById('edit-rem-id').value = rem.id;
  document.getElementById('edit-rem-title').value = cleanReminderTitle(rem.title);
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

  const targetTime = Date.now() + 10 * 60 * 1000;
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
    document.getElementById('edit-rem-status').value = 'true';
  }

  updateDynamicModalFields(repeatPattern);
  document.getElementById('modal-reminder-title').textContent = '🔄 Restore & Reschedule Reminder';
  document.getElementById('edit-reminder-modal').classList.add('active');
  startLivePreviewCountdown();
}

function initTableScrollIndicators() {
  const mgrContainer = document.getElementById('mgr-table-container');
  const mgrIndicator = document.getElementById('mgr-scroll-indicator');

  const checkScroll = (container, indicator) => {
    if (!container || !indicator) return;
    const canScrollMore = container.scrollTop + container.clientHeight < container.scrollHeight - 6;
    if (canScrollMore) {
      indicator.classList.remove('hidden');
    } else {
      indicator.classList.add('hidden');
    }
  };

  if (mgrContainer && mgrIndicator) {
    checkScroll(mgrContainer, mgrIndicator);
    mgrContainer.onscroll = () => checkScroll(mgrContainer, mgrIndicator);
  }

  const arcContainer = document.getElementById('archive-table-container');
  const arcIndicator = document.getElementById('archive-scroll-indicator');
  if (arcContainer && arcIndicator) {
    checkScroll(arcContainer, arcIndicator);
    arcContainer.onscroll = () => checkScroll(arcContainer, arcIndicator);
  }

  const medList = document.getElementById('health-medications-list');
  const medIndicator = document.getElementById('health-med-scroll-indicator');
  if (medList && medIndicator) {
    checkScroll(medList, medIndicator);
    medList.onscroll = () => checkScroll(medList, medIndicator);
  }
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
        <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 32px;">
          📦 No completed reminders found.
        </td>
      </tr>
    `);
    initTableScrollIndicators();
    return;
  }

  const html = filtered.map((rem, index) => {
    const cat = getCategoryDetails(rem.category, userCustomCategories);
    const prio = PRIORITIES[rem.priority?.toUpperCase()] || PRIORITIES.MEDIUM;
    const archivedDateStr = rem.archivedAt ? new Date(rem.archivedAt).toLocaleString() : 'Completed';
    const cleanTitle = cleanReminderTitle(rem.title);

    const prioClass = `prio-row-${(rem.priority || 'medium').toLowerCase()}`;

    return `
      <tr class="${prioClass}">
        <td style="text-align: center; font-weight: 700; color: var(--text-muted); font-size: 0.8rem;">${index + 1}</td>
        <td style="font-weight: 600;">${cat.icon} ${escapeHTML(cleanTitle)}</td>
        <td class="col-center">${cat.label}</td>
        <td class="col-center"><span class="badge ${prio.badgeClass}">${prio.label}</span></td>
        <td class="col-center" style="font-size: 0.825rem; color: var(--text-secondary); white-space: nowrap;">${archivedDateStr}</td>
        <td class="col-center">
          <div class="action-btn-group">
            <button class="btn-icon-action arc-act-restore" data-id="${rem.id}" title="Restore & Reschedule Reminder">🔄</button>
            <button class="btn-icon-action btn-del-action arc-act-del" data-id="${rem.id}" title="Delete Permanently">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  safeSetHTML(tbody, html);
  initTableScrollIndicators();

  tbody.querySelectorAll('.arc-act-restore').forEach(btn => {
    btn.addEventListener('click', (e) => {
      handleRestoreReminder(e.currentTarget.dataset.id);
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
  const lastPeriod = parseLocalDate(periodConfig.lastPeriodDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

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
    const ovulStr = nextOvulationDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const remindDays = Number(periodConfig.remindDaysBefore ?? 3);
    const remindTimeStr = periodConfig.remindTime || '09:00';
    
    // Calculate alert start date
    const alertDate = new Date(nextPeriodDate);
    alertDate.setDate(alertDate.getDate() - remindDays);
    const formattedTime = formatTimeStringToUserDevice(remindTimeStr);
    const alertDateStr = alertDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

    if (remindDays > 0) {
      ovulLabelEl.innerHTML = `
        <div>🥚 <strong>Ovulation expected around:</strong> ${ovulStr}</div>
        <div style="margin-top: 6px; color: #f472b6; font-size: 0.775rem;">
          ⏰ <strong>Pre-Period Reminder:</strong> Alerts from <strong>${alertDateStr} at ${formattedTime}</strong> (${remindDays} days before period).
        </div>
      `;
    } else {
      ovulLabelEl.innerHTML = `
        <div>🥚 <strong>Ovulation expected around:</strong> ${ovulStr}</div>
        <div style="margin-top: 6px; color: var(--text-muted); font-size: 0.775rem;">
          🔕 Pre-Period Reminder is disabled.
        </div>
      `;
    }
  }

  // Early period log box visibility (strictly visible when daysToNext <= 10)
  const earlyBox = document.getElementById('period-log-early-box');
  if (earlyBox) {
    earlyBox.style.display = daysToNext <= 10 ? 'flex' : 'none';
  }

  // Live 10-minute countdown for top header Undo button
  updateUndoTimerCountdown();

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
      <div class="cycle-bar-segment" title="🩸 Menstruation Phase (Days 1–${periodDuration}): Active period. Prioritize rest, hydration & self-care." style="width:${mensPct}%; background:#ef4444;"></div>
      <div class="cycle-bar-segment" title="🌿 Follicular Phase (Days ${periodDuration + 1}–${ovulationDay - 2}): Estrogen rising! High energy, mood & productivity." style="width:${follPct}%; background:#10b981;"></div>
      <div class="cycle-bar-segment" title="🥚 Ovulation Window (Days ${ovulationDay - 1}–${ovulationDay + 2}): Peak fertility window! High energy & confidence." style="width:${ovulPct}%; background:#8b5cf6;"></div>
      <div class="cycle-bar-segment" title="🍂 Luteal Phase (Days ${ovulationDay + 3}–${cycleLength}): Progesterone rising. Prepare for cycle reset; focus on nourishment & rest." style="width:${lutPct}%; background:#f59e0b;"></div>
    `;

    // Position marker overlay
    barEl.style.position = 'relative';
    const existingMarker = barEl.parentElement.querySelector('.cycle-day-marker');
    if (existingMarker) existingMarker.remove();
    const marker = document.createElement('div');
    marker.className = 'cycle-day-marker';
    marker.style.cssText = `position:absolute; left:${markerPct}%; top:-4px; width:6px; height:20px; background:var(--text-primary, #ffffff); border:1px solid rgba(0,0,0,0.5); border-radius:3px; box-shadow:0 2px 6px rgba(0,0,0,0.4), 0 0 6px rgba(255,255,255,0.8); transform:translateX(-50%); z-index:10;`;
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
      'Did you just drink a glass of water? 💧',
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
  const saveHealthConfig = async (msg, targetCard = null) => {
    const health = userSettings.healthSettings || {};

    health.waterEnabled = health.waterEnabled !== false;
    health.eyeRestEnabled = health.eyeRestEnabled !== false;
    health.postureEnabled = health.postureEnabled !== false;

    if (!targetCard || targetCard === 'water') {
      const wEnabledEl = document.getElementById('health-water-enabled-select');
      if (wEnabledEl && healthEditModes.water) {
        health.waterEnabled = wEnabledEl.value === 'true';
      }
      const wGoalInput = document.getElementById('health-water-goal-input');
      if (wGoalInput && healthEditModes.water) {
        health.waterGoal = parseInt(wGoalInput.value, 10) || 8;
      }
      const waterSel = document.getElementById('health-water-freq-select')?.value;
      if (waterSel && healthEditModes.water) {
        health.waterIntervalMinutes = waterSel === 'custom' 
          ? (parseInt(document.getElementById('health-water-custom-input')?.value, 10) || 60)
          : (parseInt(waterSel, 10) || 60);
      }
    }

    if (!targetCard || targetCard === 'eye') {
      const eEnabledEl = document.getElementById('health-eye-enabled-select');
      if (eEnabledEl && healthEditModes.eye) {
        health.eyeRestEnabled = eEnabledEl.value === 'true';
      }
      const eyeSel = document.getElementById('health-eye-freq-select')?.value;
      if (eyeSel && healthEditModes.eye) {
        health.eyeRestIntervalMinutes = eyeSel === 'custom'
          ? (parseInt(document.getElementById('health-eye-custom-input')?.value, 10) || 20)
          : (parseInt(eyeSel, 10) || 20);
      }
    }

    if (!targetCard || targetCard === 'posture') {
      const pEnabledEl = document.getElementById('health-posture-enabled-select');
      if (pEnabledEl && healthEditModes.posture) {
        health.postureEnabled = pEnabledEl.value === 'true';
      }
      const postureSel = document.getElementById('health-posture-freq-select')?.value;
      if (postureSel && healthEditModes.posture) {
        health.postureIntervalMinutes = postureSel === 'custom'
          ? (parseInt(document.getElementById('health-posture-custom-input')?.value, 10) || 45)
          : (parseInt(postureSel, 10) || 45);
      }
    }

    userSettings.healthSettings = health;
    if (health.waterGoal) userSettings.waterGoalGlasses = health.waterGoal;
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
  const medModal = document.getElementById('modal-add-medication');
  document.getElementById('btn-add-medication-modal')?.addEventListener('click', () => {
    document.getElementById('med-edit-id').value = '';
    document.getElementById('med-modal-title-text').textContent = 'Add Medication Schedule';
    document.getElementById('med-name-input').value = '';
    document.getElementById('med-dosage-input').value = '';
    document.getElementById('med-schedule-type-select').value = 'daily';
    document.getElementById('grp-med-weekly-day').style.display = 'none';
    document.getElementById('med-time-format-select').value = '12h';
    document.getElementById('med-freq-count-input').value = '2';
    renderDynamicMedDoseTimeFields(2, ['08:00', '14:00']);
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
    const editingId = document.getElementById('med-edit-id')?.value;
    const title = document.getElementById('med-name-input')?.value.trim();
    if (!title) {
      showToast('Please enter a medication / pill name.', 'warning');
      return;
    }
    const dosage = document.getElementById('med-dosage-input')?.value.trim() || 'Take prescribed dose';
    const scheduleType = document.getElementById('med-schedule-type-select')?.value || 'daily';
    const weeklyDay = document.getElementById('med-weekly-day-select')?.value || '1';
    const timeFormat = document.getElementById('med-time-format-select')?.value || '12h';
    const doseCount = Math.max(1, Math.min(24, parseInt(document.getElementById('med-freq-count-input')?.value, 10) || 1));

    const times = [];
    for (let i = 1; i <= doseCount; i++) {
      const val = document.getElementById(`med-dose-time-${i}`)?.value || '08:00';
      times.push(val);
    }

    const health = userSettings.healthSettings || {};
    health.medications = health.medications || [];

    let medId = editingId;
    if (editingId) {
      const idx = health.medications.findIndex(m => m.id === editingId);
      if (idx !== -1) {
        health.medications[idx] = {
          ...health.medications[idx],
          name: title,
          title: title,
          dosage: dosage,
          scheduleType: scheduleType,
          weeklyDay: weeklyDay,
          timeFormat: timeFormat,
          doseCount: doseCount,
          times: times
        };
      }
    } else {
      medId = 'med_' + Date.now();
      health.medications.push({
        id: medId,
        name: title,
        title: title,
        dosage: dosage,
        scheduleType: scheduleType,
        weeklyDay: weeklyDay,
        timeFormat: timeFormat,
        doseCount: doseCount,
        times: times,
        takenTodayCount: 0
      });
    }

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

    const initialDoseDesc = (dosage && dosage !== 'Take prescribed dose')
      ? `${dosage} (Dose 1/${doseCount})`
      : `Dose 1/${doseCount}`;

    const unifiedRem = {
      id: `med_rem_${medId}`,
      title: title,
      description: initialDoseDesc,
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
    showToast(editingId ? 'Medication schedule updated! 💊' : 'Medication schedule added! 💊', 'success');
  });
}

function openEditMedicationModal(medId) {
  const medModal = document.getElementById('modal-add-medication');
  if (!medModal) return;

  const health = userSettings.healthSettings || {};
  const meds = health.medications || [];
  const med = meds.find(m => m.id === medId || m.id === 'med_' + medId);
  if (!med) return;

  document.getElementById('med-edit-id').value = med.id;
  document.getElementById('med-modal-title-text').textContent = 'Edit Medication Schedule';
  document.getElementById('med-name-input').value = med.name || med.title || '';
  document.getElementById('med-dosage-input').value = med.dosage || '';
  document.getElementById('med-schedule-type-select').value = med.scheduleType || 'daily';
  document.getElementById('med-weekly-day-select').value = med.weeklyDay || '1';
  document.getElementById('med-time-format-select').value = med.timeFormat || '12h';

  const count = med.doseCount || (med.times ? med.times.length : 2);
  document.getElementById('med-freq-count-input').value = count;
  document.getElementById('grp-med-weekly-day').style.display = (med.scheduleType === 'weekly') ? 'block' : 'none';

  renderDynamicMedDoseTimeFields(count, med.times || ['08:00', '14:00']);
  medModal.style.display = 'flex';
}

function renderDynamicMedDoseTimeFields(count, presetTimes = null) {
  const container = document.getElementById('med-dose-times-container');
  if (!container) return;

  const existingTimes = presetTimes || [];
  if (!presetTimes) {
    container.querySelectorAll('input[type="time"]').forEach(input => {
      existingTimes.push(input.value);
    });
  }

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

  const upsertHealthRem = (id, title, desc, cat, defaultMins, isEnabled) => {
    const mins = health[`${cat === 'water' ? 'waterIntervalMinutes' : cat === 'eye' ? 'eyeRestIntervalMinutes' : 'postureIntervalMinutes'}`] || defaultMins;
    const existing = activeRemindersList.find(r => r.id === id);
    if (existing) {
      existing.enabled = isEnabled;
      existing.repeatInterval = mins;
      if (!existing.time || existing.time < now) {
        existing.time = now + mins * 60 * 1000;
      }
    } else {
      activeRemindersList.push({
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
    }
  };

  upsertHealthRem(
    'auto_health_water',
    '💧 Hydration Break - Drink Water',
    'Time for a quick hydration break! Take a sip of water to stay refreshed, focused, and healthy. 🥛✨',
    'water',
    60,
    health.waterEnabled !== false
  );

  upsertHealthRem(
    'auto_health_eye',
    '👀 Eye Rest',
    "Now's the time to follow the 20-20-20 rule! Look at an object 20 feet away for 20 seconds to protect your eyes. 👀✨",
    'eye',
    20,
    health.eyeRestEnabled !== false
  );

  upsertHealthRem(
    'auto_health_posture',
    '🧍 Posture Check & Stretch Break',
    'Time for a quick posture break! Stretch your spine, roll your shoulders back, and stand up to stay energized. 🧍✨',
    'posture',
    45,
    health.postureEnabled !== false
  );

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
    if (window._saveHealthConfig) await window._saveHealthConfig('Hydration Tracker settings saved!', 'water');
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
    if (window._saveHealthConfig) await window._saveHealthConfig('Eye Rest settings saved!', 'eye');
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
    if (window._saveHealthConfig) await window._saveHealthConfig('Posture Break settings saved!', 'posture');
    healthEditModes.posture = false;
    await renderHealthHub();
  });
  document.getElementById('btn-cancel-posture')?.addEventListener('click', async () => {
    healthEditModes.posture = false;
    await renderHealthHub();
  });
}

async function renderHealthHub() {
  renderPeriodTracker();
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
  const waterRem = activeRemindersList.find(r => r.id === 'auto_health_water' || r.category === 'water');
  const eyeRem = activeRemindersList.find(r => r.id === 'auto_health_eye' || r.category === 'eye');
  const postureRem = activeRemindersList.find(r => r.id === 'auto_health_posture' || r.category === 'posture');

  const isWaterActive = health.waterEnabled !== false && (!waterRem || waterRem.enabled !== false);
  const isEyeActive = health.eyeRestEnabled !== false && (!eyeRem || eyeRem.enabled !== false);
  const isPostureActive = health.postureEnabled !== false && (!postureRem || postureRem.enabled !== false);

  const isWaterEditing = !!healthEditModes.water;
  const waterEnabledSelect = document.getElementById('health-water-enabled-select');
  if (waterEnabledSelect) {
    waterEnabledSelect.value = isWaterActive ? 'true' : 'false';
    waterEnabledSelect.disabled = !isWaterEditing;
  }
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
      grpWater.innerHTML = `<button class="btn btn-ghost btn-sm" id="btn-edit-water" title="Edit Hydration Settings" style="padding: 4px 6px;">✏️</button>`;
    }
  }

  // Eye Rest Card Edit/Save/Cancel State
  const isEyeEditing = !!healthEditModes.eye;
  const eyeEnabled = document.getElementById('health-eye-enabled-select');
  if (eyeEnabled) {
    eyeEnabled.value = isEyeActive ? 'true' : 'false';
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
      grpEye.innerHTML = `<button class="btn btn-ghost btn-sm" id="btn-edit-eye" title="Edit Eye Rest Settings" style="padding: 4px 6px;">✏️</button>`;
    }
  }

  // Posture Card Edit/Save/Cancel State
  const isPostureEditing = !!healthEditModes.posture;
  const postureEnabled = document.getElementById('health-posture-enabled-select');
  if (postureEnabled) {
    postureEnabled.value = isPostureActive ? 'true' : 'false';
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
      grpPosture.innerHTML = `<button class="btn btn-ghost btn-sm" id="btn-edit-posture" title="Edit Posture Settings" style="padding: 4px 6px;">✏️</button>`;
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
      medsCountEl.innerHTML = `<strong style="color: #ec4899;">${meds.length} Pill${meds.length > 1 ? 's' : ''} Active</strong>`;
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
        const fmt = m.timeFormat || '12h';
        const timesStr = Array.isArray(m.times)
          ? m.times.map(t => formatTimeStringToUserDevice(t, fmt)).join(', ')
          : formatTimeStringToUserDevice(m.timeStr || '08:00', fmt);
        const dosageHtml = (m.dosage && m.dosage !== 'Take prescribed dose')
          ? `<div style="margin-top: 3px; color: var(--text-muted); font-size: 0.75rem;">📝 ${escapeHTML(m.dosage)}</div>`
          : '';
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
          <div style="display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border-radius: 8px; border: 1px solid var(--glass-border); margin-bottom: 0; width: 100%; box-sizing: border-box;">
            <!-- Header Row: Title & Action Buttons -->
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; min-width: 0;">
              <strong class="med-card-title" style="font-size: 0.95rem; color: var(--text-primary); min-width: 0; flex: 1;">${escapeHTML(cleanMedTitle)}</strong>
              <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                ${unlogBtnHtml}
                ${logBtnHtml}
                <button class="btn btn-ghost btn-sm med-edit-btn" data-id="${m.id}" style="color: var(--text-muted); padding: 4px 6px;" title="Edit Medication">✏️</button>
                <button class="btn btn-ghost btn-sm med-del-btn" data-id="${m.id}" style="color: var(--text-muted); padding: 4px 6px;" title="Delete Medication">🗑️</button>
              </div>
            </div>

            <!-- Schedule & Notes Row: Full Width Below Header -->
            <div class="med-card-notes" style="font-size: 0.775rem; color: var(--text-secondary); width: 100%;">
              <div>Schedule: <strong>${timesStr}</strong></div>
              ${dosageHtml}
            </div>

            <!-- Footer Row: Progress Status -->
            <div style="font-size: 0.8rem; color: var(--text-secondary); display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
              ${progressStr}
            </div>
          </div>
        `;
      }).join('');

      medBox.querySelectorAll('.med-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = e.currentTarget.dataset.id;
          openEditMedicationModal(id);
        });
      });

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
          const medToRemove = (health.medications || []).find(m => m.id === id);
          if (medToRemove) {
            const medRem = activeRemindersList.find(r => r.id.startsWith(`med_rem_${id}`));
            const archivePayload = {
              ...(medRem || {}),
              id: `med_rem_${medToRemove.id}`,
              title: medRem ? medRem.title : (medToRemove.title || medToRemove.name || 'Medication'),
              description: medRem ? medRem.description : (medToRemove.dosage || `Dose 1/${medToRemove.doseCount || 1}`),
              category: 'medicine',
              priority: 'high',
              repeat: medToRemove.scheduleType === 'weekly' ? 'weekly' : 'daily',
              time: medRem ? medRem.time : Date.now(),
              medData: { ...medToRemove }
            };

            await storage.archiveReminder(archivePayload);

            health.medications = (health.medications || []).filter(m => m.id !== id);
            userSettings.healthSettings = health;
            await storage.saveSettings(userSettings);

            activeRemindersList = activeRemindersList.filter(r => !r.id.startsWith(`med_rem_${id}`));
            await storage.saveReminders(activeRemindersList);
            if (typeof chrome !== 'undefined' && chrome.runtime) {
              chrome.runtime.sendMessage({ action: 'REFRESH_ALARMS' });
            }

            await renderArchiveTable();
            renderHealthHub();
            renderOverview();
            showToast('Medication schedule moved to Completed Reminders (Archive) 📦', 'success');
          }
        });
      });
    }
  }

  initTableScrollIndicators();
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}
