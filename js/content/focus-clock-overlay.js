/**
 * Reminderly Floating Draggable Focus Clock Overlay (Content Script)
 */

let clockInterval = null;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let initialTop = 0;
let initialLeft = 0;

export function renderFocusClockOverlay(focusState, settings = {}) {
  removeFocusClockOverlay();

  if (!focusState || !focusState.active || focusState.pinned === false) {
    return;
  }

  const root = document.createElement('div');
  root.id = 'remi-focus-clock-root';

  const userTheme = settings.theme || 'system';
  const effectiveTheme = (userTheme === 'system' || !userTheme)
    ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : userTheme;
  root.className = `theme-${effectiveTheme}`;

  // Restore saved position if available
  const savedPos = getSavedPosition();
  if (savedPos) {
    root.style.top = savedPos.top;
    root.style.left = savedPos.left;
    root.style.bottom = 'auto';
    root.style.right = 'auto';
  } else {
    // Default top-right position
    root.style.top = '24px';
    root.style.right = '24px';
  }

  const playSVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  const pauseSVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
  const pinSVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M9 2h6l-1 5 4 4v2H6v-2l4-4-1-5z"/></svg>`;

  root.innerHTML = `
    <div class="remi-focus-clock-pill" id="remi-focus-drag-handle">
      <div class="remi-focus-drag-dots" title="Click & Drag to move overlay">⋮⋮</div>
      <div class="remi-focus-icon">🧠</div>
      <div class="remi-focus-timer-text" id="remi-focus-timer-val">00:00</div>
      <div class="remi-focus-actions">
        <button class="remi-focus-action-btn" id="remi-focus-btn-toggle-pause" title="${focusState.paused ? 'Resume Focus' : 'Pause Focus'}">
          ${focusState.paused ? playSVG : pauseSVG}
        </button>
        <button class="remi-focus-action-btn active-pin" id="remi-focus-btn-unpin" title="Unpin Overlay from Screen">
          ${pinSVG}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(root);

  // Setup live clock update
  updateClockDisplay(focusState);
  clockInterval = setInterval(() => {
    if (!isContextValid()) {
      removeFocusClockOverlay();
      return;
    }
    updateClockDisplay(focusState);
  }, 1000);

  // Make Overlay Draggable
  const handle = root.querySelector('#remi-focus-drag-handle');
  if (handle) {
    handle.addEventListener('mousedown', onDragStart);
    handle.addEventListener('touchstart', onDragStart, { passive: false });
  }

  // Button Listeners
  root.querySelector('#remi-focus-btn-toggle-pause')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const action = focusState.paused ? 'RESUME_FOCUS_MODE' : 'PAUSE_FOCUS_MODE';
    safeSendMessage({ action });
  });

  root.querySelector('#remi-focus-btn-unpin')?.addEventListener('click', (e) => {
    e.stopPropagation();
    safeSendMessage({ action: 'TOGGLE_PIN_FOCUS_CLOCK' });
  });
}

function isContextValid() {
  try {
    return typeof chrome !== 'undefined' && Boolean(chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

function safeSendMessage(message) {
  if (!isContextValid()) {
    removeFocusClockOverlay();
    return;
  }
  try {
    const p = chrome.runtime.sendMessage(message);
    if (p && typeof p.catch === 'function') {
      p.catch(() => {});
    }
  } catch (e) {
    removeFocusClockOverlay();
  }
}

export function removeFocusClockOverlay() {
  if (clockInterval) {
    clearInterval(clockInterval);
    clockInterval = null;
  }
  const existing = document.getElementById('remi-focus-clock-root');
  if (existing) {
    existing.remove();
  }
}

function updateClockDisplay(focusState) {
  const el = document.getElementById('remi-focus-timer-val');
  if (!el) return;

  if (focusState.paused) {
    const remainingMs = focusState.remainingMs || 0;
    const totalSecs = Math.max(0, Math.floor(remainingMs / 1000));
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    el.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return;
  }

  if (focusState.endTime) {
    const now = Date.now();
    const remainingMs = Math.max(0, focusState.endTime - now);
    const totalSecs = Math.floor(remainingMs / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    el.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    if (remainingMs <= 0) {
      el.textContent = '00:00';
      if (clockInterval) {
        clearInterval(clockInterval);
        clockInterval = null;
      }
      removeFocusClockOverlay();
      safeSendMessage({ action: 'COMPLETE_FOCUS_MODE' });
      return;
    }
  }
}

/* Drag & Drop Logic */
function onDragStart(e) {
  const root = document.getElementById('remi-focus-clock-root');
  if (!root) return;

  isDragging = true;
  root.classList.add('is-dragging');

  const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
  const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;

  dragStartX = clientX;
  dragStartY = clientY;

  const rect = root.getBoundingClientRect();
  initialTop = rect.top;
  initialLeft = rect.left;

  document.addEventListener('mousemove', onDragging);
  document.addEventListener('mouseup', onDragEnd);
  document.addEventListener('touchmove', onDragging, { passive: false });
  document.addEventListener('touchend', onDragEnd);
}

function onDragging(e) {
  if (!isDragging) return;
  const root = document.getElementById('remi-focus-clock-root');
  if (!root) return;

  if (e.cancelable) e.preventDefault();

  const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
  const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;

  const deltaX = clientX - dragStartX;
  const deltaY = clientY - dragStartY;

  let newTop = initialTop + deltaY;
  let newLeft = initialLeft + deltaX;

  // Clamp within viewport boundaries
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const rect = root.getBoundingClientRect();

  newTop = Math.max(10, Math.min(viewportHeight - rect.height - 10, newTop));
  newLeft = Math.max(10, Math.min(viewportWidth - rect.width - 10, newLeft));

  root.style.top = `${newTop}px`;
  root.style.left = `${newLeft}px`;
  root.style.right = 'auto';
  root.style.bottom = 'auto';
}

function onDragEnd() {
  if (!isDragging) return;
  isDragging = false;
  const root = document.getElementById('remi-focus-clock-root');
  if (root) {
    root.classList.remove('is-dragging');
    savePosition(`${root.style.top}`, `${root.style.left}`);
  }

  document.removeEventListener('mousemove', onDragging);
  document.removeEventListener('mouseup', onDragEnd);
  document.removeEventListener('touchmove', onDragging);
  document.removeEventListener('touchend', onDragEnd);
}

function savePosition(top, left) {
  try {
    localStorage.setItem('remi_focus_clock_pos', JSON.stringify({ top, left }));
  } catch (e) { }
}

function getSavedPosition() {
  try {
    const raw = localStorage.getItem('remi_focus_clock_pos');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
