# 🔔 Reminderly – Smart Reminder & Focus Assistant

> **Tagline:** *REMEMBER SMARTER | STAY FOCUSED*

**Reminderly** is a production-ready, context-aware productivity assistant built with **Manifest V3**. Designed with a modern glassmorphic aesthetic, Reminderly pairs you with **Remi**, your intelligent animated assistant, while enforcing deep work focus sessions, blocking distracting websites, and tracking wellness micro-breaks.

---

## 🌟 Key Features

### 1. 👦 Remi Assistant
- **3-Stage Animation Sequence**: Remi automatically plays a 3-stage animated sequence when a reminder triggers (Welcome Wave → Idle Transition → Waiting Loop). After taking action or completing the reminder, Remi plays a celebration outro before closing.
- **Floating Web Overlay**: Floats in your configured position (Top Right or Bottom Right) on active web pages.
- **Smart Fallback**: Chrome security policy prohibits content script overlays on internal browser tabs (`chrome://newtab`, `chrome://settings`, `chrome://extensions`, Web Store). On these tabs, Reminderly automatically falls back to native OS desktop notifications.

### 2. 🧠 Smart Context Awareness
- **Priority Work Websites**: Automatically detects when you are working on productive platforms (e.g. Notion, Figma, GitHub).
- **Silent Queueing**: Holds Low and Medium priority reminders silently in the queue while you're in flow, protecting your deep work state.
- **Critical & Health Overrides**: High-priority tasks and health breaks (Water, Eye Rest, Posture, Medicine) always deliver immediately.

### 3. 🛡️ Focus Mode & Website Blocker
- **Timed Focus Sessions**: 25m (Pomodoro), 45m (Deep Work), or Custom minute focus timers.
- **Distracting Site Interceptor**: Blocks distracting websites (Instagram, YouTube, Reddit, Netflix, X, custom domains) with a glassmorphic full-page overlay.

### 4. 🏥 Health Hub & Wellness Micro-Breaks
- **Hydration Tracker**: +1 Glass quick water log with daily goal tracking.
- **20-20-20 Eye Rest**: Timed micro-breaks with live 20-second countdown timer.
- **Posture Checks**: Timed ergonomic posture reminders.
- **Menstrual Cycle Tracker**: 100% private, offline period predictions and pre-period reminders.
- **Auto Health Sync**: Fixed health break schedules automatically sync with your main active reminders list.

### 4. 📊 Glassmorphic Analytics Dashboard
- **Productivity Score**: Dynamic rating based on completion rate, focus duration, and streak.
- **Interactive SVG Charts**: Weekly completion breakdown, Water intake tracker, Focus session minutes, and Priority distribution.
- **Hydration Log**: +1 Glass water quick tracker with daily goal progress.
- **Backup & Sync**: 100% local Chrome storage with JSON import/export backup capabilities.

---

## 🏗️ Folder Structure

```
reminderly/
├── manifest.json                  # Manifest V3 extension configuration
├── README.md                      # Complete extension guide
├── install_instructions.md        # Step-by-step Chrome Developer Mode guide
├── sample_data.json               # Sample dataset for instant demo import
├── icons/                         # PNG extension icons (16x16, 48x48, 128x128)
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── css/
│   ├── design-system.css          # Glassmorphic tokens, HSL themes, typography
│   ├── popup.css                  # Quick action popup layout
│   ├── dashboard.css              # Full-page Dashboard SPA styling
│   ├── content.css                # Blocker modal & pending banner overlay CSS
│   └── mascot.css                 # Remi mascot keyframe animation engine
├── js/
│   ├── common/
│   │   ├── constants.js           # Categories, priorities, default site lists
│   │   ├── storage.js             # Promisified chrome.storage manager
│   │   ├── audio.js               # Web Audio API sound synthesizer
│   │   ├── utils.js               # Date helpers, productivity score, domain matching
│   │   └── mascots.js             # Remi vector SVG generator engine
│   ├── background/
│   │   ├── service-worker.js      # Main MV3 background service worker
│   │   ├── alarms-engine.js       # Smart alarm scheduler & priority filter
│   │   ├── context-detector.js    # Active tab watcher & queue notification trigger
│   │   └── focus-manager.js       # Focus timer & website blocker coordinator
│   ├── content/
│   │   ├── content-script.js      # Content script message receiver
│   │   ├── mascot-overlay.js      # Floating Remi overlay renderer
│   │   └── blocker-overlay.js     # Blocker modal renderer
│   ├── popup/
│   │   ├── popup.html             # Quick action popup HTML
│   │   └── popup.js               # Popup interactions & live timer
│   └── dashboard/
│       ├── dashboard.html          # Dashboard & Settings SPA HTML
│       └── dashboard.js           # Tab navigation, CRUD, SVG charts, Backup/Restore
```

---

## 🔒 Security & Privacy

- **100% Local & Private**: All reminders, focus sessions, and settings remain inside your local browser (`chrome.storage.local`).
- **No External Servers**: Zero network tracking, analytics, or external API calls.
- **Offline Audio**: Custom notification chimes are synthesized directly in your browser using the native Web Audio API.

---

## 🚀 Quick Setup

1. Open `chrome://extensions` in Google Chrome.
2. Enable **Developer mode** in the top right corner.
3. Click **Load unpacked** and select the folder `/Users/anish/Documents/reminderly`.
4. Open the popup or dashboard to start managing your smart reminders!
