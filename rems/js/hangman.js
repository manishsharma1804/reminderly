/**
 * Reminderly Hangman Game Logic
 */

import { storage } from './common/storage.js';
import { checkRestorableStreak } from './common/utils.js';

const WORDS = [
  { word: "DEVELOPER", category: "Technology" },
  { word: "JAVASCRIPT", category: "Programming" },
  { word: "EXTENSION", category: "Chrome" },
  { word: "ALGORITHM", category: "Computer Science" },
  { word: "GLASSMORPHISM", category: "UI/UX Design" },
  { word: "PRODUCTIVITY", category: "Workflows" },
  { word: "ASYNC", category: "Programming" }
];

let selectedItem = {};
let guessedLetters = new Set();
let wrongCount = 0;
const maxWrong = 7;

const wordContainer = document.getElementById('word-container');
const keyboardContainer = document.getElementById('keyboard-container');
const statusMsg = document.getElementById('status-msg');
const categoryLabel = document.getElementById('category-label');
const restartBtn = document.getElementById('restart-btn');

async function handleStreakRestoration() {
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
        chrome.runtime.sendMessage({ action: 'REFRESH_ALARMS' });
      }

      statusMsg.innerHTML = `🎉 Streak Restored! Your streak of <strong>${restorable.pastStreakValue + 1} days</strong> is safe! 🔥`;
    }
  } catch (e) {
    console.error("Failed to restore streak:", e);
  }
}

function initGame() {
  guessedLetters.clear();
  wrongCount = 0;
  statusMsg.textContent = "";
  statusMsg.className = "status-message";

  // Reset SVG parts
  for (let i = 0; i < maxWrong; i++) {
    const el = document.getElementById(`part-${i}`);
    if (el) el.style.display = "none";
  }

  // Select random word
  selectedItem = WORDS[Math.floor(Math.random() * WORDS.length)];
  categoryLabel.textContent = `Category: ${selectedItem.category}`;

  renderWord();
  renderKeyboard();
}

function renderWord() {
  wordContainer.innerHTML = "";
  let isWin = true;

  for (const char of selectedItem.word) {
    const slot = document.createElement('div');
    slot.className = 'letter-slot';
    if (guessedLetters.has(char)) {
      slot.textContent = char;
    } else {
      slot.textContent = "";
      isWin = false;
    }
    wordContainer.appendChild(slot);
  }

  if (isWin && selectedItem.word && wrongCount < maxWrong) {
    statusMsg.textContent = "🎉 Congratulations! You Won!";
    statusMsg.className = "status-message win";
    disableAllKeys();
    handleStreakRestoration();
  }
}

function renderKeyboard() {
  keyboardContainer.innerHTML = "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  for (const letter of alphabet) {
    const btn = document.createElement('button');
    btn.className = 'key-btn';
    btn.textContent = letter;
    
    if (guessedLetters.has(letter)) {
      btn.disabled = true;
      if (selectedItem.word.includes(letter)) {
        btn.classList.add('correct');
      } else {
        btn.classList.add('wrong');
      }
    }

    btn.addEventListener('click', () => handleGuess(letter));
    keyboardContainer.appendChild(btn);
  }
}

function handleGuess(letter) {
  if (guessedLetters.has(letter) || wrongCount >= maxWrong) return;

  guessedLetters.add(letter);

  if (!selectedItem.word.includes(letter)) {
    // Show next part from top to bottom
    const partEl = document.getElementById(`part-${wrongCount}`);
    if (partEl) partEl.style.display = "block";
    wrongCount++;

    if (wrongCount >= maxWrong) {
      statusMsg.textContent = `💥 Game Over! The word was: ${selectedItem.word}`;
      statusMsg.className = "status-message lose";
      // Reveal full word
      for (const char of selectedItem.word) guessedLetters.add(char);
      disableAllKeys();
    }
  }

  renderWord();
  renderKeyboard();
}

function disableAllKeys() {
  const keys = keyboardContainer.querySelectorAll('.key-btn');
  keys.forEach(k => k.disabled = true);
}

if (restartBtn) {
  restartBtn.addEventListener('click', initGame);
}

// Keyboard support
window.addEventListener('keydown', (e) => {
  if (
    e.key === 'F12' ||
    ((e.ctrlKey || e.metaKey || e.altKey) && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'C' || e.key === 'c' || e.key === 'J' || e.key === 'j')) ||
    ((e.ctrlKey || e.metaKey || e.altKey) && (e.key === 'U' || e.key === 'u'))
  ) {
    e.preventDefault();
    return;
  }

  const key = e.key.toUpperCase();
  if (/^[A-Z]$/.test(key)) {
    handleGuess(key);
  }
});

// Disable right-click context menus
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

// Rules Modal handlers
const rulesModal = document.getElementById('rules-modal');
const showRulesBtn = document.getElementById('btn-show-rules');
const closeRulesBtn = document.getElementById('btn-close-rules');

if (showRulesBtn && rulesModal) {
  showRulesBtn.addEventListener('click', () => {
    rulesModal.style.display = 'flex';
  });
}
if (closeRulesBtn && rulesModal) {
  closeRulesBtn.addEventListener('click', () => {
    rulesModal.style.display = 'none';
  });
}
window.addEventListener('click', (e) => {
  if (e.target === rulesModal) {
    rulesModal.style.display = 'none';
  }
});

// Initialize game
initGame();
