/**
 * Reminderly Offscreen Audio Player
 * Listens for background audio playback requests from Service Worker
 */

import { soundEngine } from '../js/common/audio.js';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === 'PLAY_BACKGROUND_SOUND') {
    (async () => {
      try {
        await soundEngine.playChime(msg.soundTone || 'chime', msg.volume !== undefined ? msg.volume : 100);
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
});
