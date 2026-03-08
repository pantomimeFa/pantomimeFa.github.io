// ============ DISABLE BROWSER ZOOM ============
document.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
    e.preventDefault();
  }
});
document.addEventListener('wheel', function(e) {
  if (e.ctrlKey) e.preventDefault();
}, { passive: false });
document.addEventListener('gesturestart', function(e) {
  e.preventDefault();
});
document.addEventListener('gesturechange', function(e) {
  e.preventDefault();
});
document.addEventListener('touchstart', function(e) {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

// ============ STATE ============
const state = {
  mode: 'normal', // 'normal' or 'fast'
  teams: [
    { name: 'تیم ۱', score: 0 },
    { name: 'تیم ۲', score: 0 }
  ],
  currentTeam: 0,       // 0 or 1
  currentRound: 0,
  totalRounds: 6,
  roundTime: 120,
  selectedCategory: null,
  selectedLevel: null,
  funMode: false, // Fun mode toggle
  normalFunData: null,
  fastFunData: null,
  usedWords: { normal: new Set(), fast: new Set() },
  // Track used category+level per team: usedCombos[teamIndex] = Set of "catId-level"
  usedCombos: [new Set(), new Set()],
  normalData: null,
  fastData: null,
  timerInterval: null,
  timeLeft: 0,
  roundStartTime: 0,
  // Fast mode state
  fastWords: [],
  fastCurrentIndex: 0,
  fastResults: [],
  // Audio
  audioCtx: null,
  audioOsc: null,
  tickPlaying: false
};

// ============ INIT ============
async function init() {
  const [normalRes, fastRes, normalFunRes, fastFunRes] = await Promise.all([
    fetch('data/normal.json').then(r => r.json()),
    fetch('data/fast.json').then(r => r.json()),
    fetch('data/normal_fun.json').then(r => r.json()).catch(() => null),
    fetch('data/fast_fun.json').then(r => r.json()).catch(() => null)
  ]);
  state.normalData = normalRes;
  state.fastData = fastRes;
  state.normalFunData = normalFunRes;
  state.fastFunData = fastFunRes;

  bindEvents();
}

// ============ AUDIO ============
function initAudio() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function startTickSound() {
  initAudio();
  if (state.tickPlaying) return;
  state.tickPlaying = true;
}

function playTick() {
  if (!state.audioCtx) return;
  const ctx = state.audioCtx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  if (state.timeLeft <= 10) {
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
  } else if (state.timeLeft <= 30) {
    osc.frequency.value = 660;
    gain.gain.value = 0.1;
  } else {
    osc.frequency.value = 440;
    gain.gain.value = 0.06;
  }

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.08);
}

function stopTickSound() {
  state.tickPlaying = false;
}

// ============ SCREEN NAVIGATION ============
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ============ EVENTS ============
function bindEvents() {
  // Mode toggle
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.mode;
    });
  });

  // Start game
  document.getElementById('btn-start-game').addEventListener('click', startGame);

  // Level buttons
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', () => selectLevel(parseInt(btn.dataset.level)));
  });

  // Ready → Go
  document.getElementById('btn-go').addEventListener('click', startRound);

  // Normal mode buttons
  document.getElementById('btn-correct-normal').addEventListener('click', () => answerNormal(true));
  document.getElementById('btn-fail-normal').addEventListener('click', () => answerNormal(false));

  // Fast mode buttons
  document.getElementById('btn-correct-fast').addEventListener('click', () => answerFast(true));
  document.getElementById('btn-fail-fast').addEventListener('click', () => answerFast(false));

  // Next round buttons
  document.getElementById('btn-next-round').addEventListener('click', nextTurn);
  document.getElementById('btn-next-summary').addEventListener('click', nextTurn);

  // Exit game
  document.getElementById('btn-exit-game').addEventListener('click', () => {
    if (confirm('آیا از خروج از بازی مطمئن هستید؟')) {
      clearInterval(state.timerInterval);
      stopTickSound();
      clearSavedState();
      showScreen('screen-home');
    }
  });

  // Play again
  document.getElementById('btn-play-again').addEventListener('click', () => {
    clearSavedState();
    showScreen('screen-home');
  });
}

// ============ GAME FLOW ============
function startGame() {
  state.teams[0].name = document.getElementById('team1-name').value || 'تیم ۱';
  state.teams[1].name = document.getElementById('team2-name').value || 'تیم ۲';
  state.teams[0].score = 0;
  state.teams[1].score = 0;
  state.currentTeam = 0;
  state.currentRound = 0;
  state.roundTime = parseInt(document.getElementById('round-time').value) || 120;
  state.totalRounds = parseInt(document.getElementById('total-rounds').value) || 6;
  state.usedWords = { normal: new Set(), fast: new Set() };
  state.usedCombos = [new Set(), new Set()];

  showCategoryScreen();
}

function showCategoryScreen() {
  const team = state.teams[state.currentTeam];
  const indicator = document.getElementById('turn-indicator');
  indicator.textContent = `نوبت ${team.name}`;
  indicator.className = 'turn-indicator team' + (state.currentTeam + 1);

  document.getElementById('round-info').textContent =
    `دور ${toPersianNum(state.currentRound + 1)} از ${toPersianNum(state.totalRounds)}`;

  renderCategories();
  showScreen('screen-categories');
}

function renderCategories() {
  const grid = document.getElementById('categories-grid');
  const data = getActiveData();
  const teamCombos = state.usedCombos[state.currentTeam];
  grid.innerHTML = '';

  data.categories.forEach(cat => {
    // Check if all levels for this category are used by this team
    const levels = ['2', '4', '6'];
    const allUsed = levels.every(l => teamCombos.has(`${cat.id}-${l}`));

    const card = document.createElement('div');
    card.className = 'category-card' + (allUsed ? ' disabled' : '') + (state.funMode ? ' fun-glow' : '');
    card.innerHTML = `
      <img class="category-icon" src="assets/icons/${cat.icon}" alt="${cat.name}">
      <span class="category-name">${cat.name}</span>
    `;
    if (!allUsed) {
      card.addEventListener('click', () => selectCategory(cat));
    }
    grid.appendChild(card);
  });

  // Add FF (Fun) button
  const ffCard = document.createElement('div');
  ffCard.className = 'category-card ff-card' + (state.funMode ? ' ff-active' : '');
  ffCard.innerHTML = `
    <span class="ff-icon">🤪</span>
    <span class="category-name">FF</span>
  `;
  ffCard.addEventListener('click', toggleFunMode);
  grid.appendChild(ffCard);
}

function getActiveData() {
  if (state.funMode) {
    return state.mode === 'fast' ? (state.fastFunData || state.fastData) : (state.normalFunData || state.normalData);
  }
  return state.mode === 'fast' ? state.fastData : state.normalData;
}

function toggleFunMode() {
  state.funMode = !state.funMode;
  renderCategories();
}

function selectCategory(cat) {
  state.selectedCategory = cat;

  // Show level selection for both modes
  const indicator = document.getElementById('level-turn-indicator');
  indicator.textContent = `نوبت ${state.teams[state.currentTeam].name}`;
  indicator.className = 'turn-indicator team' + (state.currentTeam + 1);
  document.getElementById('selected-category-name').textContent = cat.name;

  // Disable already-used levels for this team
  const teamCombos = state.usedCombos[state.currentTeam];
  document.querySelectorAll('.level-btn').forEach(btn => {
    const level = btn.dataset.level;
    const used = teamCombos.has(`${cat.id}-${level}`);
    btn.classList.toggle('disabled', used);
    btn.disabled = used;
  });

  showScreen('screen-levels');
}

function selectLevel(level) {
  state.selectedLevel = level;
  showReadyScreen();
}

function showReadyScreen() {
  const team = state.teams[state.currentTeam];
  const teamEl = document.getElementById('ready-team-name');
  teamEl.textContent = team.name;
  teamEl.className = 'ready-team';
  teamEl.style.color = state.currentTeam === 0 ? 'var(--team1-color)' : 'var(--team2-color)';

  document.getElementById('ready-category').textContent = state.selectedCategory.name;

  if (state.mode === 'normal') {
    document.getElementById('ready-level').textContent = `سطح ${toPersianNum(state.selectedLevel)}`;
  } else {
    document.getElementById('ready-level').textContent = `حالت جنگی — سطح ${toPersianNum(state.selectedLevel)}`;
  }

  showScreen('screen-ready');
}

function startRound() {
  initAudio();
  state.timeLeft = state.roundTime;
  state.roundStartTime = Date.now();

  // Record this category+level as used for this team
  const comboKey = `${state.selectedCategory.id}-${state.selectedLevel}`;
  state.usedCombos[state.currentTeam].add(comboKey);

  if (state.mode === 'normal') {
    startNormalRound();
  } else {
    startFastRound();
  }
}

// ============ NORMAL MODE ============
function startNormalRound() {
  const word = getRandomWord('normal');
  document.getElementById('word-normal').textContent = word;
  updateTimerDisplay('normal');
  updateBonusIndicator();
  showScreen('screen-play-normal');
  startTimer('normal');
}

function answerNormal(correct) {
  clearInterval(state.timerInterval);
  stopTickSound();

  const elapsed = Math.floor((Date.now() - state.roundStartTime) / 1000);
  let basePoints = 0;
  let speedBonus = 0;

  if (correct) {
    basePoints = state.selectedLevel;
    if (elapsed <= 30) speedBonus = 3;
    else if (elapsed <= 60) speedBonus = 2;
    else if (elapsed <= 90) speedBonus = 1;
    state.teams[state.currentTeam].score += basePoints + speedBonus;
  }

  showNormalResult(correct, basePoints, speedBonus);
}

function showNormalResult(correct, basePoints, speedBonus) {
  document.getElementById('result-icon').textContent = correct ? '✅' : '❌';
  document.getElementById('result-title').textContent = correct ? 'درست!' : 'نادرست!';

  let details = '';
  if (correct) {
    details = `<div>امتیاز سطح: ${toPersianNum(basePoints)}</div>`;
    if (speedBonus > 0) {
      details += `<div>امتیاز سرعت: +${toPersianNum(speedBonus)}</div>`;
    }
    details += `<div class="points-line">مجموع: ${toPersianNum(basePoints + speedBonus)} امتیاز</div>`;
  } else {
    details = '<div>امتیازی کسب نشد</div>';
  }
  document.getElementById('result-details').innerHTML = details;

  renderScoreCards('result');
  showScreen('screen-result');
}

// ============ FAST MODE ============
function startFastRound() {
  const words = getRandomWords('fast', 8);
  state.fastWords = words;
  state.fastCurrentIndex = 0;
  state.fastResults = [];

  renderFastProgress();
  showFastWord();
  showScreen('screen-play-fast');
  startTimer('fast');
}

function showFastWord() {
  if (state.fastCurrentIndex < state.fastWords.length) {
    document.getElementById('word-fast').textContent = state.fastWords[state.fastCurrentIndex];
    renderFastProgress();
  }
}

function renderFastProgress() {
  const container = document.getElementById('fast-progress');
  container.innerHTML = '';
  for (let i = 0; i < state.fastWords.length; i++) {
    const dot = document.createElement('span');
    dot.className = 'fast-dot';
    if (i < state.fastResults.length) {
      dot.classList.add(state.fastResults[i] ? 'correct' : 'wrong');
    } else if (i === state.fastCurrentIndex) {
      dot.classList.add('current');
    }
    container.appendChild(dot);
  }
}

function answerFast(correct) {
  state.fastResults.push(correct);
  if (correct) {
    state.teams[state.currentTeam].score += state.selectedLevel;
  }
  state.fastCurrentIndex++;

  if (state.fastCurrentIndex >= state.fastWords.length) {
    // All 8 done
    clearInterval(state.timerInterval);
    stopTickSound();
    showFastSummary();
  } else {
    showFastWord();
  }
}

function showFastSummary() {
  const team = state.teams[state.currentTeam];
  document.getElementById('summary-title').textContent = `نتایج ${team.name}`;

  const list = document.getElementById('summary-list');
  list.innerHTML = '';

  let totalCorrect = 0;
  state.fastWords.forEach((word, i) => {
    const answered = i < state.fastResults.length;
    const correct = answered && state.fastResults[i];
    if (correct) totalCorrect++;

    const item = document.createElement('div');
    item.className = 'summary-item ' + (answered ? (correct ? 'correct' : 'wrong') : 'wrong');
    item.innerHTML = `
      <span class="word">${word}</span>
      <span class="status">${answered ? (correct ? '✓' : '✗') : '⏱'}</span>
    `;
    list.appendChild(item);
  });

  document.getElementById('summary-total').textContent =
    `${toPersianNum(totalCorrect)} از ${toPersianNum(state.fastWords.length)} درست — ${toPersianNum(totalCorrect * state.selectedLevel)} امتیاز`;

  renderScoreCards('summary');
  showScreen('screen-summary');
}

// ============ TIMER ============
function startTimer(mode) {
  updateTimerDisplay(mode);
  startTickSound();

  state.timerInterval = setInterval(() => {
    state.timeLeft--;
    updateTimerDisplay(mode);

    if (state.tickPlaying) playTick();

    if (mode === 'normal') {
      updateBonusIndicator();
    }

    if (state.timeLeft <= 0) {
      clearInterval(state.timerInterval);
      stopTickSound();
      if (mode === 'normal') {
        answerNormal(false);
      } else {
        showFastSummary();
      }
    }
  }, 1000);
}

function updateTimerDisplay(mode) {
  const el = document.getElementById('timer-' + mode);
  const circle = document.getElementById('timer-circle-' + mode);
  el.textContent = toPersianNum(state.timeLeft);

  circle.classList.remove('warning', 'danger');
  if (state.timeLeft <= 10) {
    circle.classList.add('danger');
  } else if (state.timeLeft <= 30) {
    circle.classList.add('warning');
  }
}

function updateBonusIndicator() {
  const elapsed = Math.floor((Date.now() - state.roundStartTime) / 1000);
  const bonusEl = document.getElementById('bonus-value');

  if (elapsed <= 30) {
    bonusEl.textContent = '+۳';
    bonusEl.style.color = 'var(--success)';
  } else if (elapsed <= 60) {
    bonusEl.textContent = '+۲';
    bonusEl.style.color = 'var(--gold)';
  } else if (elapsed <= 90) {
    bonusEl.textContent = '+۱';
    bonusEl.style.color = 'var(--accent)';
  } else {
    bonusEl.textContent = '+۰';
    bonusEl.style.color = 'var(--text-secondary)';
  }
}

// ============ TURN MANAGEMENT ============
function nextTurn() {
  state.currentRound++;

  if (state.currentRound >= state.totalRounds) {
    showGameOver();
    return;
  }

  // Switch team
  state.currentTeam = state.currentTeam === 0 ? 1 : 0;
  showCategoryScreen();
}

function showGameOver() {
  document.getElementById('gameover-title').textContent = 'بازی تمام شد!';

  const s0 = state.teams[0].score;
  const s1 = state.teams[1].score;
  let winnerText;
  if (s0 > s1) {
    winnerText = `🏆 ${state.teams[0].name} برنده شد!`;
  } else if (s1 > s0) {
    winnerText = `🏆 ${state.teams[1].name} برنده شد!`;
  } else {
    winnerText = '🤝 مساوی!';
  }
  document.getElementById('gameover-winner').textContent = winnerText;

  renderScoreCards('final');
  showScreen('screen-gameover');
}

// ============ SCORE RENDERING ============
function renderScoreCards(prefix) {
  for (let i = 0; i < 2; i++) {
    const card = document.getElementById(`${prefix}-score-${i + 1}`);
    card.className = `score-card team${i + 1}`;
    card.innerHTML = `
      <div class="team-name">${state.teams[i].name}</div>
      <div class="team-score">${toPersianNum(state.teams[i].score)}</div>
    `;
  }
}

// ============ WORD SELECTION ============
function getRandomWord(type) {
  const data = getActiveData();
  const cat = data.categories.find(c => c.id === state.selectedCategory.id);
  const words = cat.levels[String(state.selectedLevel)];
  const usedSet = state.usedWords[type];

  const available = words.filter(w => !usedSet.has(w));
  if (available.length === 0) {
    // Reset used words for this type if exhausted
    usedSet.clear();
    return words[Math.floor(Math.random() * words.length)];
  }

  const word = available[Math.floor(Math.random() * available.length)];
  usedSet.add(word);
  return word;
}

function getRandomWords(type, count) {
  const data = getActiveData();
  const cat = data.categories.find(c => c.id === state.selectedCategory.id);
  const words = cat.levels[String(state.selectedLevel)];
  const usedSet = state.usedWords[type];

  let available = words.filter(w => !usedSet.has(w));
  if (available.length < count) {
    usedSet.clear();
    available = [...words];
  }

  // Shuffle and pick
  const shuffled = available.sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, count);
  picked.forEach(w => usedSet.add(w));
  return picked;
}

// ============ UTILS ============
const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

function toPersianNum(num) {
  return String(num).replace(/\d/g, d => persianDigits[d]);
}

// ============ STATE PERSISTENCE ============
const SAVE_KEY = 'panto-game-state';

function saveState(screenId) {
  const data = {
    mode: state.mode,
    teams: state.teams,
    currentTeam: state.currentTeam,
    currentRound: state.currentRound,
    totalRounds: state.totalRounds,
    roundTime: state.roundTime,
    usedCombos: [
      Array.from(state.usedCombos[0]),
      Array.from(state.usedCombos[1])
    ],
    usedWords: {
      normal: Array.from(state.usedWords.normal),
      fast: Array.from(state.usedWords.fast)
    },
    screenId: screenId
  };
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

function clearSavedState() {
  localStorage.removeItem(SAVE_KEY);
}

function loadSavedState() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function restoreGame(saved) {
  state.mode = saved.mode;
  state.teams = saved.teams;
  state.currentTeam = saved.currentTeam;
  state.currentRound = saved.currentRound;
  state.totalRounds = saved.totalRounds;
  state.roundTime = saved.roundTime;
  state.usedCombos = [
    new Set(saved.usedCombos[0]),
    new Set(saved.usedCombos[1])
  ];
  state.usedWords = {
    normal: new Set(saved.usedWords.normal),
    fast: new Set(saved.usedWords.fast)
  };

  // Restore home screen inputs to match
  document.getElementById('team1-name').value = state.teams[0].name;
  document.getElementById('team2-name').value = state.teams[1].name;
  document.getElementById('round-time').value = state.roundTime;
  document.getElementById('total-rounds').value = state.totalRounds;
  document.querySelectorAll('.toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === state.mode);
  });

  // Go back to category selection (safest restore point)
  showCategoryScreen();
}

// ============ START ============
async function boot() {
  await init();

  // Auto-save at key moments by wrapping showScreen
  const origShowScreen = showScreen;
  showScreen = function(id) {
    origShowScreen(id);
    // Save on screens that represent stable states
    if (id === 'screen-categories' || id === 'screen-result' || id === 'screen-summary') {
      saveState(id);
    }
  };

  // Check for saved game
  const saved = loadSavedState();
  if (saved) {
    restoreGame(saved);
  }
}

boot();
