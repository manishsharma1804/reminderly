/**
 * Remi Assistant Mascot Settings & Layout Engine
 * Manages the assets and container wrapping for Remi's animated states.
 */

export const MASCOT_TYPES = {
  REMI: 'remi'
};

export const MASCOT_EMOTIONS = {
  NEUTRAL: 'neutral',
  HAPPY: 'happy',
  SNOOZE: 'snooze',
  SKIP: 'skip'
};

export const MASCOT_POSITIONS = {
  BOTTOM_RIGHT: 'bottom-right',
  TOP_RIGHT: 'top-right'
};

export function getMascotSVG(type = MASCOT_TYPES.REMI, emotion = MASCOT_EMOTIONS.NEUTRAL, size = 180, phase = 'welcome') {
  let file = '4s1.gif';
  if (phase === 'idle') {
    file = '1.8Sec2.gif';
  } else if (phase === 'wait') {
    file = 'wait.gif';
  } else if (phase === 'outro') {
    file = '3.5s3.gif';
  }

  let src = `remi/${file}`;
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    try {
      src = chrome.runtime.getURL(`remi/${file}`);
    } catch (e) {
      src = `../remi/${file}`;
    }
  } else {
    src = `../remi/${file}`;
  }

  return `
    <div class="remi-video-avatar" style="width: ${size}px !important; height: ${size}px !important; background: transparent !important; border: none !important; overflow: hidden !important; border-radius: 16px !important; display: flex !important; align-items: center !important; justify-content: center !important; position: relative !important; top: 50px !important;">
      <img id="remi-gif-element" src="${src}" style="width: 100% !important; height: 100% !important; object-fit: cover !important; border-radius: 16px !important; pointer-events: none !important;" alt="">
    </div>
  `;
}
