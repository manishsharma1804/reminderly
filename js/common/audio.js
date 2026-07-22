/**
 * Reminderly Web Audio API Sound Synthesizer
 * Provides crisp, offline notification chimes and celebratory sounds.
 * AudioContext is created lazily on first play (must be after a user gesture).
 */

class SoundEngine {
  constructor() {
    this.audioCtx = null;
  }

  async getAudioContext() {
    if (typeof window === 'undefined') {
      return null; // Web Audio API is not supported in Chrome Extension Service Workers without DOM context
    }

    if (!this.audioCtx) {
      try {
        const AudioCtxClass = typeof AudioContext !== 'undefined'
          ? AudioContext
          : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
        if (AudioCtxClass) {
          this.audioCtx = new AudioCtxClass();
        }
      } catch (e) {
        this.audioCtx = null;
      }
    }

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      try {
        await this.audioCtx.resume().catch(() => {});
      } catch (e) {}
    }

    if (!this.audioCtx || this.audioCtx.state !== 'running') {
      return null;
    }
    return this.audioCtx;
  }

  async playChime(tone = 'chime', volumePercent = 80) {
    const ctx = await this.getAudioContext();
    if (!ctx) return;

    const gainNode = ctx.createGain();
    const masterVolume = (volumePercent / 100) * 0.25;
    gainNode.gain.setValueAtTime(masterVolume, ctx.currentTime);
    gainNode.connect(ctx.destination);

    const now = ctx.currentTime;

    switch (tone) {
      case 'energetic': {
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + idx * 0.08);

          const oscGain = ctx.createGain();
          oscGain.gain.setValueAtTime(0, now + idx * 0.08);
          oscGain.gain.linearRampToValueAtTime(masterVolume, now + idx * 0.08 + 0.02);
          oscGain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.35);

          osc.connect(oscGain);
          oscGain.connect(ctx.destination);
          osc.start(now + idx * 0.08);
          osc.stop(now + idx * 0.08 + 0.4);
        });
        break;
      }
      case 'gentle': {
        [440, 554.37].forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.12);

          const oscGain = ctx.createGain();
          oscGain.gain.setValueAtTime(0.001, now + idx * 0.12);
          oscGain.gain.linearRampToValueAtTime(masterVolume * 0.8, now + idx * 0.12 + 0.05);
          oscGain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.8);

          osc.connect(oscGain);
          oscGain.connect(ctx.destination);
          osc.start(now + idx * 0.12);
          osc.stop(now + idx * 0.12 + 0.9);
        });
        break;
      }
      case 'classic': {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.5);

        gainNode.gain.setValueAtTime(masterVolume, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

        osc.connect(gainNode);
        osc.start(now);
        osc.stop(now + 0.5);
        break;
      }
      case 'chime':
      default: {
        [587.33, 880, 1174.66].forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.07);

          const oscGain = ctx.createGain();
          oscGain.gain.setValueAtTime(0.001, now + idx * 0.07);
          oscGain.gain.linearRampToValueAtTime(masterVolume, now + idx * 0.07 + 0.015);
          oscGain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.07 + 0.6);

          osc.connect(oscGain);
          oscGain.connect(ctx.destination);
          osc.start(now + idx * 0.07);
          osc.stop(now + idx * 0.07 + 0.65);
        });
        break;
      }
    }
  }

  async playCelebration() {
    const ctx = await this.getAudioContext();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51];
    const now = ctx.currentTime;

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.09);

      const oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(0.001, now + idx * 0.09);
      oscGain.gain.linearRampToValueAtTime(0.2, now + idx * 0.09 + 0.02);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.5);

      osc.connect(oscGain);
      oscGain.connect(ctx.destination);
      osc.start(now + idx * 0.09);
      osc.stop(now + idx * 0.09 + 0.55);
    });
  }
}

export const soundEngine = new SoundEngine();

// Auto-unlock Web Audio API context silently when user interacts with the page
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    try {
      soundEngine.getAudioContext().catch(() => {});
    } catch (e) {}
    window.removeEventListener('click', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('click', unlockAudio, { passive: true, once: true });
  window.addEventListener('keydown', unlockAudio, { passive: true, once: true });
}
