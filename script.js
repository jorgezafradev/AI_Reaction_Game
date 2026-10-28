/* ==========================================================================
   Reflex Lab: game logic
   --------------------------------------------------------------------------
   1. Settings and constants
   2. Utility functions
   3. Page elements
   4. Game and session state
   5. Updating the page
   6. Game flow
   7. 3D scene (Three.js)
   8. Render loop
   9. Player input and browser events
   10. Start the app
   ========================================================================== */

(() => {
  'use strict';


  /* 1. Settings and constants
     ======================================================================== */

  const TIMING = Object.freeze({
    MIN_STIMULUS_DELAY_MS: 1000,      // shortest wait before the shape turns green
    MAX_STIMULUS_DELAY_MS: 5000,      // longest wait before the shape turns green
    REACTION_TIMEOUT_MS: 2000,        // no reaction after this long counts as "timed out"
    MIN_HUMAN_REACTION_MS: 100,       // faster than this is physically a guess
    NEXT_ROUND_COOLDOWN_MS: 300,      // stops a double tap from starting the next round
    RESET_CONFIRM_WINDOW_MS: 3000     // time to click Reset a second time
  });

  const CHART = Object.freeze({
    VISIBLE_ATTEMPTS: 12,
    MIN_SCALE_MS: 400,
    TYPICAL_REACTION_MS: 250
  });

  const GAME_STATE = Object.freeze({
    IDLE: 'idle',
    WAITING: 'waiting',          // shape is amber, player must wait
    GO: 'go',                    // shape is green, player must react
    RESULT: 'result',            // a valid reaction was recorded
    FALSE_START: 'false-start',  // player reacted before green
    TIMED_OUT: 'timed-out'       // player did not react in time
  });

  // Colors for each game state: "hex" for Three.js, "css" for the page
  const STATE_COLORS = Object.freeze({
    [GAME_STATE.IDLE]:        { hex: 0x94A3B8, css: 'var(--color-text-secondary)' },
    [GAME_STATE.WAITING]:     { hex: 0xF59E0B, css: 'var(--color-waiting)' },
    [GAME_STATE.GO]:          { hex: 0x10B981, css: 'var(--color-go)' },
    [GAME_STATE.RESULT]:      { hex: 0x3B82F6, css: 'var(--color-result)' },
    [GAME_STATE.FALSE_START]: { hex: 0xEF4444, css: 'var(--color-error)' },
    [GAME_STATE.TIMED_OUT]:   { hex: 0xEF4444, css: 'var(--color-error)' }
  });

  // Text shown for each game state
  const STATE_TEXT = Object.freeze({
    [GAME_STATE.IDLE]: {
      badge: 'Idle',
      title: 'Ready when you are',
      subtitle: 'Reaction test',
      message: 'Press Start, then hit the stage the instant the shape turns green.'
    },
    [GAME_STATE.WAITING]: {
      badge: 'Waiting',
      title: 'Wait for green',
      subtitle: 'Hold…',
      message: 'Keep your finger ready. Do not react yet.'
    },
    [GAME_STATE.GO]: {
      badge: 'Go',
      title: 'Now',
      subtitle: 'React!',
      message: ''
    },
    [GAME_STATE.RESULT]: {
      badge: 'Result',
      title: 'Reaction time',
      subtitle: '',
      message: 'Click, tap or press Space for the next round.'
    },
    [GAME_STATE.FALSE_START]: {
      badge: 'False start',
      title: 'False start',
      subtitle: 'Too soon',
      message: 'You reacted before the shape turned green. This round does not count.'
    },
    [GAME_STATE.TIMED_OUT]: {
      badge: 'Timed out',
      title: 'Timed out',
      subtitle: 'Missed it',
      message: 'No reaction within 2 seconds. This round does not count.'
    }
  });

  // Score tiers, in the same order as the score guide in index.html
  const SCORE_TIERS = Object.freeze([
    { label: 'Excellent', maxMs: 200,      hex: 0xA78BFA, css: 'var(--color-excellent)' },
    { label: 'Good',      maxMs: 250,      hex: 0x3B82F6, css: 'var(--color-result)' },
    { label: 'Average',   maxMs: 300,      hex: 0xE2E8F0, css: 'var(--color-text)' },
    { label: 'Slow',      maxMs: 400,      hex: 0xF59E0B, css: 'var(--color-waiting)' },
    { label: 'Way slow',  maxMs: Infinity, hex: 0xEF4444, css: 'var(--color-error)' }
  ]);

  const reducedMotionSetting = window.matchMedia('(prefers-reduced-motion: reduce)');


  /* 2. Utility functions
     ======================================================================== */

  /** Random number between 0 and 1 from the browser's cryptographic generator. */
  function getSecureRandomNumber() {
    try {
      const randomValues = new Uint32Array(1);
      crypto.getRandomValues(randomValues);
      return randomValues[0] / 4294967296;
    } catch (error) {
      return Math.random();
    }
  }

  function getRandomStimulusDelay() {
    const range = TIMING.MAX_STIMULUS_DELAY_MS - TIMING.MIN_STIMULUS_DELAY_MS;
    return TIMING.MIN_STIMULUS_DELAY_MS + getSecureRandomNumber() * range;
  }

  function calculateAverage(numbers) {
    const total = numbers.reduce((sum, value) => sum + value, 0);
    return total / numbers.length;
  }

  function calculateMedian(numbers) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  }

  /** Sample standard deviation. Needs at least two values. */
  function calculateStandardDeviation(numbers) {
    if (numbers.length < 2) return null;
    const average = calculateAverage(numbers);
    const squaredDifferences = numbers.reduce((sum, value) => sum + (value - average) ** 2, 0);
    return Math.sqrt(squaredDifferences / (numbers.length - 1));
  }

  function formatMilliseconds(milliseconds) {
    return Math.round(milliseconds).toString();
  }

  function getScoreTier(reactionTimeMs) {
    return SCORE_TIERS.find((tier) => reactionTimeMs < tier.maxMs);
  }

  /**
   * Input events carry a timestamp on the same clock as performance.now(),
   * taken when the click or key press happened. Use it when it looks valid,
   * otherwise fall back to the current time.
   */
  function getInputTimestamp(eventTimestamp) {
    const now = performance.now();
    const isValid = typeof eventTimestamp === 'number'
      && eventTimestamp > 0
      && eventTimestamp <= now + 1
      && now - eventTimestamp < 1000;
    return isValid ? eventTimestamp : now;
  }

  function isSpaceKey(keyboardEvent) {
    return keyboardEvent.code === 'Space' || keyboardEvent.key === ' ' || keyboardEvent.key === 'Spacebar';
  }


  /* 3. Page elements
     ======================================================================== */

  function getElement(id) {
    return document.getElementById(id);
  }

  const elements = {
    root: document.documentElement,

    statusBadgeText: getElement('statusBadgeText'),
    screenReaderAnnouncer: getElement('screenReaderAnnouncer'),

    gameBoard: getElement('gameBoard'),
    statusTitle: getElement('statusTitle'),
    newBestBadge: getElement('newBestBadge'),
    reactionTime: getElement('reactionTime'),
    statusSubtitle: getElement('statusSubtitle'),
    statusMessage: getElement('statusMessage'),

    startStopButton: getElement('startStopButton'),
    resetButton: getElement('resetButton'),
    roundCounter: getElement('roundCounter'),

    sceneCanvas: getElement('sceneCanvas'),
    webglFallbackMessage: getElement('webglFallbackMessage'),
    scoreTierItems: document.querySelectorAll('.score-tier'),

    stats: {
      lastTime: getElement('lastTimeStat'),
      averageTime: getElement('averageTimeStat'),
      bestTime: getElement('bestTimeStat'),
      consistency: getElement('consistencyStat'),
      attemptCount: getElement('attemptCountStat'),
      falseStarts: getElement('falseStartStat')
    },

    chart: {
      bars: getElement('chartBars'),
      emptyMessage: getElement('chartEmptyMessage'),
      axisMax: getElement('chartAxisMax'),
      axisMiddle: getElement('chartAxisMiddle'),
      referenceLine: getElement('chartReferenceLine')
    }
  };


  /* 4. Game and session state
     ========================================================================
     Everything lives in memory only. Nothing is saved to browser storage. */

  const session = {
    reactionTimes: [],
    falseStartCount: 0,
    timeoutCount: 0,
    roundsPlayed: 0
  };

  const game = {
    currentState: GAME_STATE.IDLE,
    isRunning: false,
    activeRoundId: 0,               // increases every round so old timers can tell they're stale
    stimulusDelayTimer: null,
    reactionTimeoutTimer: null,
    isStimulusPending: false,       // the delay is over; the render loop will show green next frame
    stimulusShownAt: 0,             // performance.now() right after the green frame was drawn
    ignoreInputUntil: 0
  };

  let resetConfirmTimer = null;
  let scene3D = null;               // the Three.js scene, or null in 2D fallback mode


  /* 5. Updating the page
     ======================================================================== */

  /**
   * Switches the game to a new state and updates every part of the page that
   * depends on it: text, colors, buttons and the 3D scene.
   * `options` can override the default text for this one update.
   */
  function setGameState(newState, options = {}) {
    game.currentState = newState;
    const text = STATE_TEXT[newState];

    elements.gameBoard.dataset.state = newState;
    elements.root.style.setProperty('--color-current-state', STATE_COLORS[newState].css);

    elements.statusBadgeText.textContent = text.badge;
    elements.statusTitle.textContent = text.title;
    elements.statusSubtitle.textContent = options.subtitle ?? text.subtitle;
    elements.statusMessage.textContent = options.message ?? text.message;
    elements.statusSubtitle.hidden = !elements.statusSubtitle.textContent;
    elements.statusMessage.hidden = !elements.statusMessage.textContent;

    showReactionTime(options.reactionTimeMs);
    elements.newBestBadge.hidden = !options.isNewBest;

    updateControls();

    if (options.announcement) announceToScreenReader(options.announcement);
    if (newState !== GAME_STATE.RESULT) highlightScoreTier(null);
    if (scene3D) scene3D.setGameState(newState);
  }

  function showReactionTime(reactionTimeMs) {
    if (reactionTimeMs == null) {
      elements.reactionTime.hidden = true;
      return;
    }
    elements.reactionTime.innerHTML =
      `${formatMilliseconds(reactionTimeMs)}<small class="reaction-time-unit">ms</small>`;
    elements.reactionTime.hidden = false;
  }

  function updateControls() {
    const button = elements.startStopButton;
    button.dataset.action = game.isRunning ? 'stop' : 'start';
    button.textContent = game.isRunning ? 'Stop' : 'Start';
    elements.roundCounter.textContent = `Round ${session.roundsPlayed + 1}`;
  }

  /** Colors the shape, glow and title with the tier color of a result. */
  function applyScoreTierColor(tier) {
    elements.root.style.setProperty('--color-current-state', tier.css);
    if (scene3D) scene3D.setColor(tier.hex);
  }

  /** Highlights the tier of the latest result in the score guide. Pass null to clear. */
  function highlightScoreTier(reactionTimeMs) {
    const activeTier = reactionTimeMs == null ? null : getScoreTier(reactionTimeMs);
    elements.scoreTierItems.forEach((item, index) => {
      item.classList.toggle('is-active', SCORE_TIERS[index] === activeTier);
    });
  }

  function announceToScreenReader(message) {
    elements.screenReaderAnnouncer.textContent = message;
  }

  function updateStatItem(statElement, value, unit = '', detail = null) {
    const valueElement = statElement.querySelector('.stat-value');
    valueElement.innerHTML = unit ? `${value}<small class="stat-unit">${unit}</small>` : value;
    if (detail !== null) statElement.querySelector('.stat-detail').textContent = detail;
  }

  function playStatUpdateAnimation(statElement) {
    statElement.classList.remove('is-updated');
    void statElement.offsetWidth; // forces a reflow so the animation can restart
    statElement.classList.add('is-updated');
  }

  function renderSessionStats() {
    const times = session.reactionTimes;
    const stats = elements.stats;
    const emptyValue = '—';

    if (times.length > 0) {
      const lastTime = times[times.length - 1];
      const bestTime = Math.min(...times);
      const standardDeviation = calculateStandardDeviation(times);

      updateStatItem(stats.lastTime, formatMilliseconds(lastTime), 'ms', getScoreTier(lastTime).label);
      updateStatItem(stats.averageTime, formatMilliseconds(calculateAverage(times)), 'ms',
        `median ${formatMilliseconds(calculateMedian(times))} ms`);
      updateStatItem(stats.bestTime, formatMilliseconds(bestTime), 'ms', `attempt #${times.indexOf(bestTime) + 1}`);

      if (standardDeviation === null) {
        updateStatItem(stats.consistency, emptyValue, '', 'std. deviation');
      } else {
        updateStatItem(stats.consistency, `±${formatMilliseconds(standardDeviation)}`, 'ms', 'std. deviation');
      }
    } else {
      updateStatItem(stats.lastTime, emptyValue, '', ' ');
      updateStatItem(stats.averageTime, emptyValue, '', ' ');
      updateStatItem(stats.bestTime, emptyValue, '', ' ');
      updateStatItem(stats.consistency, emptyValue, '', 'std. deviation');
    }

    updateStatItem(stats.attemptCount, String(times.length), '', 'valid reactions');
    updateStatItem(stats.falseStarts, String(session.falseStartCount), '', `${session.timeoutCount} timed out`);

    const sessionIsEmpty = times.length === 0 && session.falseStartCount === 0 && session.timeoutCount === 0;
    elements.resetButton.disabled = sessionIsEmpty;

    renderHistoryChart();
  }

  function renderHistoryChart() {
    const allTimes = session.reactionTimes;
    const recentTimes = allTimes.slice(-CHART.VISIBLE_ATTEMPTS);
    const chart = elements.chart;

    chart.emptyMessage.hidden = recentTimes.length > 0;

    // Round the scale up to the next 100 ms so the axis labels stay readable
    const slowestTime = Math.max(CHART.MIN_SCALE_MS, ...recentTimes);
    const scaleMaxMs = Math.ceil(slowestTime / 100) * 100;
    chart.axisMax.textContent = scaleMaxMs;
    chart.axisMiddle.textContent = scaleMaxMs / 2;
    chart.referenceLine.style.bottom = `${(CHART.TYPICAL_REACTION_MS / scaleMaxMs) * 100}%`;

    const bestTime = allTimes.length > 0 ? Math.min(...allTimes) : null;
    const bars = document.createDocumentFragment();

    recentTimes.forEach((time, index) => {
      const bar = document.createElement('div');
      bar.className = 'chart-bar';
      bar.classList.toggle('is-best', time === bestTime);
      bar.classList.toggle('is-latest', index === recentTimes.length - 1);
      bar.style.height = `${Math.max(1.5, (time / scaleMaxMs) * 100)}%`;
      bar.title = `${formatMilliseconds(time)} ms`;
      bar.setAttribute('aria-label', `${formatMilliseconds(time)} milliseconds`);
      bars.appendChild(bar);
    });

    chart.bars.replaceChildren(bars);
  }


  /* 6. Game flow
     ======================================================================== */

  function clearRoundTimers() {
    clearTimeout(game.stimulusDelayTimer);
    clearTimeout(game.reactionTimeoutTimer);
    game.stimulusDelayTimer = null;
    game.reactionTimeoutTimer = null;
    game.isStimulusPending = false;
  }

  function startRound() {
    clearRoundTimers();
    game.isRunning = true;
    game.activeRoundId += 1;
    const roundId = game.activeRoundId;

    setGameState(GAME_STATE.WAITING, { announcement: 'Wait for green.' });

    game.stimulusDelayTimer = setTimeout(() => {
      const roundIsStillActive = roundId === game.activeRoundId && game.currentState === GAME_STATE.WAITING;
      if (!roundIsStillActive) return;
      // Don't change the screen here. The render loop shows green on the next
      // frame, so the color change and the clock start land on the same frame.
      game.isStimulusPending = true;
    }, getRandomStimulusDelay());
  }

  /** Called by the render loop just before drawing the frame that shows green. */
  function showStimulus() {
    game.isStimulusPending = false;
    setGameState(GAME_STATE.GO, { announcement: 'Go!' });
  }

  /** Called by the render loop right after the green frame was drawn. */
  function startReactionClock() {
    game.stimulusShownAt = performance.now();
    const roundId = game.activeRoundId;

    game.reactionTimeoutTimer = setTimeout(() => {
      if (roundId === game.activeRoundId && game.currentState === GAME_STATE.GO) {
        handleTimeout();
      }
    }, TIMING.REACTION_TIMEOUT_MS);
  }

  function finishRound() {
    clearRoundTimers();
    session.roundsPlayed += 1;
    game.ignoreInputUntil = performance.now() + TIMING.NEXT_ROUND_COOLDOWN_MS;
  }

  function recordReaction(reactionTimeMs) {
    const previousBest = session.reactionTimes.length > 0 ? Math.min(...session.reactionTimes) : Infinity;
    const isNewBest = session.reactionTimes.length > 0 && reactionTimeMs < previousBest;
    const tier = getScoreTier(reactionTimeMs);

    finishRound();
    session.reactionTimes.push(reactionTimeMs);

    setGameState(GAME_STATE.RESULT, {
      reactionTimeMs,
      subtitle: tier.label,
      isNewBest,
      announcement: `${formatMilliseconds(reactionTimeMs)} milliseconds, ${tier.label}.${isNewBest ? ' New best.' : ''}`
    });

    applyScoreTierColor(tier);
    highlightScoreTier(reactionTimeMs);
    renderSessionStats();
    playStatUpdateAnimation(elements.stats.lastTime);
    if (isNewBest) playStatUpdateAnimation(elements.stats.bestTime);
    if (scene3D) scene3D.playParticleBurst(tier.hex);
  }

  /** @param {number} [guessedTimeMs] set when the reaction was too fast to be real */
  function handleFalseStart(guessedTimeMs) {
    finishRound();
    session.falseStartCount += 1;

    const options = { announcement: 'False start. Round not counted.' };
    if (guessedTimeMs !== undefined) {
      options.subtitle = `${formatMilliseconds(guessedTimeMs)} ms is a guess`;
      options.message = `Reactions under ${TIMING.MIN_HUMAN_REACTION_MS} ms are faster than the eye-to-hand limit, so they count as a false start.`;
    }

    setGameState(GAME_STATE.FALSE_START, options);
    renderSessionStats();
    playStatUpdateAnimation(elements.stats.falseStarts);
    if (scene3D) scene3D.playParticleBurst(STATE_COLORS[GAME_STATE.FALSE_START].hex, 0.5);
  }

  function handleTimeout() {
    finishRound();
    session.timeoutCount += 1;
    setGameState(GAME_STATE.TIMED_OUT, { announcement: 'Timed out. Round not counted.' });
    renderSessionStats();
  }

  function stopGame(message) {
    clearRoundTimers();
    game.activeRoundId += 1; // invalidates any timer still waiting to fire
    game.isRunning = false;
    const options = message ? { message, announcement: message } : { announcement: 'Stopped.' };
    setGameState(GAME_STATE.IDLE, options);
  }

  /** First click asks for confirmation, second click within 3 seconds clears the session. */
  function handleResetClick() {
    const isConfirming = elements.resetButton.dataset.confirming === 'true';
    if (!isConfirming) {
      elements.resetButton.dataset.confirming = 'true';
      elements.resetButton.textContent = 'Confirm reset';
      clearTimeout(resetConfirmTimer);
      resetConfirmTimer = setTimeout(cancelResetConfirmation, TIMING.RESET_CONFIRM_WINDOW_MS);
      return;
    }

    cancelResetConfirmation();
    resetSession();
  }

  function cancelResetConfirmation() {
    clearTimeout(resetConfirmTimer);
    elements.resetButton.dataset.confirming = 'false';
    elements.resetButton.textContent = 'Reset';
  }

  function resetSession() {
    session.reactionTimes = [];
    session.falseStartCount = 0;
    session.timeoutCount = 0;
    session.roundsPlayed = 0;
    stopGame('Session cleared. Press Start for a fresh run.');
    renderSessionStats();
  }

  function handleStartStopClick() {
    cancelResetConfirmation();
    if (game.isRunning) stopGame();
    else startRound();
    // Move focus to the board so Space reacts instead of pressing the button again
    elements.gameBoard.focus({ preventScroll: true });
  }

  /** Handles a click, tap or Space press on the game board. */
  function handlePlayerInput(eventTimestamp) {
    const inputTime = getInputTimestamp(eventTimestamp);

    switch (game.currentState) {
      case GAME_STATE.IDLE:
        startRound();
        break;

      case GAME_STATE.WAITING:
        handleFalseStart();
        break;

      case GAME_STATE.GO: {
        const reactionTimeMs = inputTime - game.stimulusShownAt;
        if (reactionTimeMs < 0) {
          handleFalseStart();                 // pressed before the green frame was on screen
        } else if (reactionTimeMs < TIMING.MIN_HUMAN_REACTION_MS) {
          handleFalseStart(reactionTimeMs);   // too fast to be a real reaction
        } else {
          recordReaction(reactionTimeMs);
        }
        break;
      }

      case GAME_STATE.RESULT:
      case GAME_STATE.FALSE_START:
      case GAME_STATE.TIMED_OUT:
        if (performance.now() >= game.ignoreInputUntil) startRound();
        break;
    }
  }


  /* 7. 3D scene (Three.js)
     ========================================================================
     Builds the animated shape and returns a small interface the rest of the
     app uses: renderFrame, setGameState, setColor, playParticleBurst, dispose. */

  // How the shape looks and moves in each game state
  const SHAPE_ANIMATION = Object.freeze({
    [GAME_STATE.IDLE]:        { glow: 0.25, size: 1.0,  spinSpeed: 0.22, ringSize: 1.0,  orbitSpeed: 0.25, pulses: false },
    [GAME_STATE.WAITING]:     { glow: 0.6,  size: 0.86, spinSpeed: 0.1,  ringSize: 0.84, orbitSpeed: 0.12, pulses: true },
    [GAME_STATE.GO]:          { glow: 1.25, size: 1.24, spinSpeed: 1.5,  ringSize: 1.22, orbitSpeed: 1.6,  pulses: false },
    [GAME_STATE.RESULT]:      { glow: 0.65, size: 1.04, spinSpeed: 0.35, ringSize: 1.06, orbitSpeed: 0.4,  pulses: false },
    [GAME_STATE.FALSE_START]: { glow: 0.8,  size: 0.94, spinSpeed: 0.05, ringSize: 0.95, orbitSpeed: 0.05, pulses: false },
    [GAME_STATE.TIMED_OUT]:   { glow: 0.35, size: 0.92, spinSpeed: 0.08, ringSize: 0.95, orbitSpeed: 0.08, pulses: false }
  });

  const SCENE_SETTINGS = Object.freeze({
    SATELLITE_COUNT: 26,
    STAR_COUNT: 420,
    PARTICLE_COUNT: 240,
    SHAPE_FIT_RADIUS: 3.1,       // radius (in scene units) that must always fit on screen
    MIN_CAMERA_DISTANCE: 8,
    MAX_CAMERA_DISTANCE: 18,
    MAX_PIXEL_RATIO: 2,
    EASING_SPEED: 7,
    SHAKE_DURATION_S: 0.45
  });

  function createReactionScene(canvas) {
    const THREE = window.THREE;
    if (!THREE) throw new Error('Three.js did not load');

    const idleColor = STATE_COLORS[GAME_STATE.IDLE].hex;
    const X_AXIS = new THREE.Vector3(1, 0, 0);

    // Renderer, scene and camera
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, SCENE_SETTINGS.MAX_PIXEL_RATIO));
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0F172A, 9, 26);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0.35, SCENE_SETTINGS.MIN_CAMERA_DISTANCE);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    const keyLight = new THREE.PointLight(0xF1F5F9, 1.1, 40);
    keyLight.position.set(4, 5, 6);
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(0x3B82F6, 0.9, 40);
    rimLight.position.set(-6, -3, -4);
    scene.add(rimLight);

    const stateGlowLight = new THREE.PointLight(idleColor, 1.5, 10);
    stateGlowLight.position.set(0, 0, 2.6);
    scene.add(stateGlowLight);

    // Everything that moves with the shape is grouped so it can shake together
    const shapeGroup = new THREE.Group();
    scene.add(shapeGroup);

    // Core: faceted icosahedron
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: 0x1E293B,
      emissive: idleColor,
      emissiveIntensity: 0.25,
      roughness: 0.32,
      metalness: 0.45,
      flatShading: true
    });
    const coreShape = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 1), coreMaterial);
    shapeGroup.add(coreShape);

    // Wireframe shell around the core
    const shellSourceGeometry = new THREE.IcosahedronGeometry(1.5, 1);
    const shellMaterial = new THREE.LineBasicMaterial({ color: idleColor, transparent: true, opacity: 0.35 });
    const wireframeShell = new THREE.LineSegments(new THREE.EdgesGeometry(shellSourceGeometry), shellMaterial);
    shellSourceGeometry.dispose();
    shapeGroup.add(wireframeShell);

    // Two orbit rings
    const ringMaterial = new THREE.MeshBasicMaterial({ color: idleColor, transparent: true, opacity: 0.45 });
    const innerRing = new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.012, 8, 180), ringMaterial);
    const outerRing = new THREE.Mesh(new THREE.TorusGeometry(2.65, 0.008, 8, 180), ringMaterial);
    innerRing.rotation.x = Math.PI * 0.42;
    outerRing.rotation.x = Math.PI * 0.58;
    outerRing.rotation.y = Math.PI * 0.18;
    shapeGroup.add(innerRing, outerRing);

    // Satellites: small cubes on the rings, drawn in a single draw call
    const satelliteMaterial = new THREE.MeshStandardMaterial({
      color: 0x334155,
      emissive: idleColor,
      emissiveIntensity: 0.4,
      roughness: 0.4,
      metalness: 0.3
    });
    const satellites = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.11, 0.11, 0.11),
      satelliteMaterial,
      SCENE_SETTINGS.SATELLITE_COUNT
    );
    const satelliteOrbits = Array.from({ length: SCENE_SETTINGS.SATELLITE_COUNT }, (_, index) => ({
      startAngle: (index / SCENE_SETTINGS.SATELLITE_COUNT) * Math.PI * 2,
      radius: 2.25 + (index % 3) * 0.2,
      tilt: (index % 2 ? 0.42 : 0.58) * Math.PI,
      speed: 0.6 + getSecureRandomNumber() * 0.8
    }));
    const satellitePlacement = new THREE.Object3D();
    shapeGroup.add(satellites);

    // Star field in the background
    const starPositions = new Float32Array(SCENE_SETTINGS.STAR_COUNT * 3);
    for (let index = 0; index < SCENE_SETTINGS.STAR_COUNT; index++) {
      const distance = 14 + getSecureRandomNumber() * 14;
      const [x, y, z] = getRandomDirection();
      starPositions.set([x * distance, y * distance, z * distance], index * 3);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starField = new THREE.Points(starGeometry, new THREE.PointsMaterial({
      color: 0x94A3B8, size: 0.06, transparent: true, opacity: 0.55, depthWrite: false
    }));
    scene.add(starField);

    // Particle burst: one fixed pool, reused every round to avoid new allocations
    const particlePositions = new Float32Array(SCENE_SETTINGS.PARTICLE_COUNT * 3);
    const particleVelocities = new Float32Array(SCENE_SETTINGS.PARTICLE_COUNT * 3);
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({
      color: 0x3B82F6, size: 0.07, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const particleBurst = new THREE.Points(particleGeometry, particleMaterial);
    particleBurst.visible = false;
    shapeGroup.add(particleBurst);
    let particleLifetime = 0;

    // Animation state: current values ease toward the target values every frame
    let targetAnimation = SHAPE_ANIMATION[GAME_STATE.IDLE];
    const currentAnimation = { ...targetAnimation };
    const currentColor = new THREE.Color(idleColor);
    const targetColor = new THREE.Color(idleColor);
    let elapsedSeconds = 0;
    let spinAngle = 0;
    let orbitAngle = 0;
    let shakeTimeLeft = 0;

    /** Random point on a unit sphere, returned as [x, y, z]. */
    function getRandomDirection() {
      const horizontalAngle = getSecureRandomNumber() * Math.PI * 2;
      const verticalAngle = Math.acos(2 * getSecureRandomNumber() - 1);
      return [
        Math.sin(verticalAngle) * Math.cos(horizontalAngle),
        Math.sin(verticalAngle) * Math.sin(horizontalAngle),
        Math.cos(verticalAngle)
      ];
    }

    function applyCurrentColor() {
      coreMaterial.emissive.copy(currentColor);
      shellMaterial.color.copy(currentColor);
      ringMaterial.color.copy(currentColor);
      satelliteMaterial.emissive.copy(currentColor);
      stateGlowLight.color.copy(currentColor);
    }

    function setGameState(state) {
      targetAnimation = SHAPE_ANIMATION[state] || SHAPE_ANIMATION[GAME_STATE.IDLE];
      targetColor.setHex(STATE_COLORS[state].hex);

      if (state === GAME_STATE.GO) {
        // The go signal must be instant: skip easing on the frame that matters
        currentColor.copy(targetColor);
        currentAnimation.glow = targetAnimation.glow;
        currentAnimation.size = targetAnimation.size;
        applyCurrentColor();
      }

      if (state === GAME_STATE.FALSE_START && !reducedMotionSetting.matches) {
        shakeTimeLeft = SCENE_SETTINGS.SHAKE_DURATION_S;
      }
    }

    function setColor(hexColor) {
      targetColor.setHex(hexColor);
    }

    function playParticleBurst(hexColor, strength = 1) {
      if (reducedMotionSetting.matches) return;
      particleMaterial.color.setHex(hexColor);

      for (let index = 0; index < SCENE_SETTINGS.PARTICLE_COUNT; index++) {
        const [x, y, z] = getRandomDirection();
        const speed = (2.2 + getSecureRandomNumber() * 3.2) * strength;
        particlePositions.set([x * 1.05, y * 1.05, z * 1.05], index * 3);
        particleVelocities.set([x * speed, y * speed, z * speed], index * 3);
      }

      particleGeometry.attributes.position.needsUpdate = true;
      particleLifetime = 1;
      particleBurst.visible = true;
    }

    /** Keeps the canvas sharp and the whole shape in frame at any size. */
    function resizeToCanvas() {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;

      renderer.setSize(width, height, false);
      camera.aspect = width / height;

      const halfFieldOfView = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const distanceToFitHeight = SCENE_SETTINGS.SHAPE_FIT_RADIUS / halfFieldOfView;
      const distanceToFitWidth = SCENE_SETTINGS.SHAPE_FIT_RADIUS / (halfFieldOfView * camera.aspect);
      const cameraDistance = Math.min(
        SCENE_SETTINGS.MAX_CAMERA_DISTANCE,
        Math.max(SCENE_SETTINGS.MIN_CAMERA_DISTANCE, distanceToFitHeight, distanceToFitWidth)
      );

      camera.position.z = cameraDistance;
      scene.fog.near = cameraDistance + 1;
      scene.fog.far = cameraDistance + 18;
      camera.updateProjectionMatrix();
    }

    const canvasResizeObserver = new ResizeObserver(resizeToCanvas);
    canvasResizeObserver.observe(canvas);
    resizeToCanvas();

    function easeAnimationValues(easing) {
      currentColor.lerp(targetColor, easing);
      for (const property of ['glow', 'size', 'spinSpeed', 'ringSize', 'orbitSpeed']) {
        currentAnimation[property] += (targetAnimation[property] - currentAnimation[property]) * easing;
      }
      applyCurrentColor();
      coreMaterial.emissiveIntensity = currentAnimation.glow;
      stateGlowLight.intensity = 0.8 + currentAnimation.glow * 1.2;
    }

    function updateShape(deltaSeconds, motionScale) {
      const pulse = targetAnimation.pulses ? 1 + Math.sin(elapsedSeconds * 3.2) * 0.035 * motionScale : 1;
      coreShape.scale.setScalar(currentAnimation.size * pulse);
      wireframeShell.scale.setScalar(currentAnimation.size * (2 - pulse));

      spinAngle += deltaSeconds * currentAnimation.spinSpeed * motionScale;
      coreShape.rotation.set(spinAngle * 0.7, spinAngle, 0);
      wireframeShell.rotation.set(-spinAngle * 0.4, -spinAngle * 0.6, 0);
    }

    function updateRingsAndSatellites(deltaSeconds, motionScale) {
      orbitAngle += deltaSeconds * currentAnimation.orbitSpeed * motionScale;

      innerRing.scale.setScalar(currentAnimation.ringSize);
      outerRing.scale.setScalar(currentAnimation.ringSize);
      innerRing.rotation.z = orbitAngle * 0.5;
      outerRing.rotation.z = -orbitAngle * 0.35;

      satelliteOrbits.forEach((orbit, index) => {
        const angle = orbit.startAngle + orbitAngle * orbit.speed;
        const radius = orbit.radius * currentAnimation.ringSize;
        satellitePlacement.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
        satellitePlacement.position.applyAxisAngle(X_AXIS, orbit.tilt - Math.PI / 2);
        satellitePlacement.rotation.set(angle * 2, angle, 0);
        satellitePlacement.updateMatrix();
        satellites.setMatrixAt(index, satellitePlacement.matrix);
      });
      satellites.instanceMatrix.needsUpdate = true;
    }

    function updateShake(deltaSeconds) {
      if (shakeTimeLeft > 0) {
        shakeTimeLeft = Math.max(0, shakeTimeLeft - deltaSeconds);
        const strength = shakeTimeLeft / SCENE_SETTINGS.SHAKE_DURATION_S;
        shapeGroup.position.x = Math.sin(elapsedSeconds * 70) * 0.12 * strength;
      } else if (shapeGroup.position.x !== 0) {
        shapeGroup.position.x = 0;
      }
    }

    function updateParticles(deltaSeconds) {
      if (particleLifetime <= 0) return;

      particleLifetime = Math.max(0, particleLifetime - deltaSeconds * 1.15);
      const drag = Math.exp(-deltaSeconds * 2.2);
      for (let index = 0; index < particlePositions.length; index++) {
        particleVelocities[index] *= drag;
        particlePositions[index] += particleVelocities[index] * deltaSeconds;
      }

      particleGeometry.attributes.position.needsUpdate = true;
      particleMaterial.opacity = particleLifetime;
      if (particleLifetime === 0) particleBurst.visible = false;
    }

    function renderFrame(deltaSeconds) {
      const motionScale = reducedMotionSetting.matches ? 0.15 : 1;
      const easing = 1 - Math.exp(-deltaSeconds * SCENE_SETTINGS.EASING_SPEED); // same feel at any frame rate
      elapsedSeconds += deltaSeconds;

      easeAnimationValues(easing);
      updateShape(deltaSeconds, motionScale);
      updateRingsAndSatellites(deltaSeconds, motionScale);
      starField.rotation.y += deltaSeconds * 0.01 * motionScale;
      updateShake(deltaSeconds);
      updateParticles(deltaSeconds);

      renderer.render(scene, camera);
    }

    /** Frees GPU memory used by every geometry, material and the renderer. */
    function dispose() {
      canvasResizeObserver.disconnect();
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) [].concat(object.material).forEach((material) => material.dispose());
      });
      renderer.dispose();
    }

    return { renderFrame, setGameState, setColor, playParticleBurst, dispose };
  }

  /** Turns off 3D and keeps the game running with the 2D interface only. */
  function switchTo2DMode(reason) {
    if (scene3D) {
      try { scene3D.dispose(); } catch (error) { /* already released */ }
    }
    scene3D = null;
    elements.sceneCanvas.hidden = true;
    elements.webglFallbackMessage.hidden = false;
    if (reason) console.warn('[Reflex Lab] 3D disabled:', reason);
  }

  function setUp3DScene() {
    try {
      scene3D = createReactionScene(elements.sceneCanvas);
      elements.sceneCanvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        switchTo2DMode('WebGL context lost');
      }, { once: true });
    } catch (error) {
      switchTo2DMode(error && error.message);
    }
  }


  /* 8. Render loop
     ========================================================================
     One loop draws the 3D scene and also places the green stimulus on an
     exact frame boundary, so the timer starts when green is really on screen. */

  const MAX_FRAME_STEP_S = 0.05;
  let animationFrameId = null;
  let lastFrameTime = 0;

  function runAnimationFrame(frameTime) {
    animationFrameId = requestAnimationFrame(runAnimationFrame);
    const deltaSeconds = Math.min(MAX_FRAME_STEP_S, Math.max(0, (frameTime - lastFrameTime) / 1000));
    lastFrameTime = frameTime;

    const showsStimulusThisFrame = game.isStimulusPending;
    if (showsStimulusThisFrame) showStimulus();

    if (scene3D) {
      try {
        scene3D.renderFrame(deltaSeconds);
      } catch (error) {
        switchTo2DMode(error && error.message);
      }
    }

    if (showsStimulusThisFrame) startReactionClock();
  }

  function startRenderLoop() {
    if (animationFrameId !== null) return;
    lastFrameTime = performance.now();
    animationFrameId = requestAnimationFrame(runAnimationFrame);
  }

  function stopRenderLoop() {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }


  /* 9. Player input and browser events
     ======================================================================== */

  function handleBoardPointerDown(event) {
    const isNonPrimaryMouseButton = event.pointerType === 'mouse' && event.button !== 0;
    const isOnControls = event.target.closest('.game-controls');
    if (isNonPrimaryMouseButton || isOnControls) return;

    event.preventDefault();
    handlePlayerInput(event.timeStamp);
  }

  function handleKeyDown(event) {
    const typingTags = ['INPUT', 'TEXTAREA', 'SELECT'];
    if (event.target && typingTags.includes(event.target.tagName)) return;

    if (event.key === 'Escape') {
      if (!event.repeat && game.isRunning) stopGame();
      return;
    }

    if (!isSpaceKey(event)) return;
    event.preventDefault(); // stops page scrolling and a focused button from being pressed
    if (event.repeat) return;
    handlePlayerInput(event.timeStamp);
  }

  // Some browsers press a focused button when Space is released, so block that too
  function handleKeyUp(event) {
    if (isSpaceKey(event) && event.target && event.target.tagName === 'BUTTON') {
      event.preventDefault();
    }
  }

  // Hidden tabs throttle timers and pause rendering, so a round in progress
  // can no longer be timed fairly. Cancel it instead of recording a bad number.
  function handleVisibilityChange() {
    if (!document.hidden) {
      startRenderLoop();
      return;
    }

    stopRenderLoop();
    const roundInProgress = game.currentState === GAME_STATE.WAITING || game.currentState === GAME_STATE.GO;
    if (roundInProgress) {
      stopGame('Round cancelled because the tab was hidden. Press Start to continue.');
    }
  }

  function handlePageHide() {
    stopRenderLoop();
    clearRoundTimers();
    if (scene3D) scene3D.dispose();
    scene3D = null;
  }

  function setUpEventListeners() {
    elements.gameBoard.addEventListener('pointerdown', handleBoardPointerDown);
    elements.gameBoard.addEventListener('contextmenu', (event) => event.preventDefault());
    elements.startStopButton.addEventListener('click', handleStartStopClick);
    elements.resetButton.addEventListener('click', handleResetClick);

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
  }


  /* 10. Start the app
     ======================================================================== */

  function initializeApp() {
    setUp3DScene();
    setUpEventListeners();
    setGameState(GAME_STATE.IDLE);
    renderSessionStats();
    startRenderLoop();
  }

  initializeApp();
})();
