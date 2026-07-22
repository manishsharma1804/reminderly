/**
 * Reminderly Website Blocker Overlay Engine (Content Script)
 */

export function renderBlockerOverlay(domain, isFocusMode, settings = {}) {
  if (document.getElementById('reminderly-blocker-root')) return;

  const root = document.createElement('div');
  root.id = 'reminderly-blocker-root';

  const userTheme = settings.theme || 'system';
  const effectiveTheme = (userTheme === 'system' || !userTheme)
    ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : userTheme;
  root.className = `theme-${effectiveTheme}`;

  root.innerHTML = `
    <div class="blocker-modal">
      <div class="blocker-icon-badge">🛡️</div>
      <div class="blocker-title">You planned to stay focused</div>
      <div class="blocker-subtitle">
        Access to <span class="blocker-site-pill">${escapeHTML(domain)}</span> is currently blocked ${isFocusMode ? 'during Focus Mode' : 'by your productivity rules'}.
      </div>
      <div class="blocker-actions-grid">
        <button class="blocker-btn blocker-btn-back" id="blocker-action-back">
          ← Go Back to Safety
        </button>
        <button class="blocker-btn blocker-btn-temp" id="blocker-action-10">
          Continue for 10 min
        </button>
        <button class="blocker-btn blocker-btn-temp" id="blocker-action-30">
          Continue for 30 min
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(root);

  // Disable page scrolling while blocked
  document.body.style.overflow = 'hidden';

  root.querySelector('#blocker-action-back').addEventListener('click', () => {
    window.history.back();
    setTimeout(() => {
      window.location.href = 'https://google.com';
    }, 200);
  });

  root.querySelector('#blocker-action-10').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'ALLOW_TEMP_DOMAIN', domain: domain, minutes: 10 }, () => {
      document.body.style.overflow = '';
      root.remove();
    });
  });

  root.querySelector('#blocker-action-30').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'ALLOW_TEMP_DOMAIN', domain: domain, minutes: 30 }, () => {
      document.body.style.overflow = '';
      root.remove();
    });
  });
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}
