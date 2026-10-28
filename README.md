# Reflex Lab

**Reflex Lab** is a browser game that measures your visual reaction time to the millisecond. A 3D shape built with Three.js waits on amber, then flashes green at a random moment. You click, tap or press <kbd>Space</kbd> as fast as you can. Each round is scored, and your session stats and a history chart update as you play.

It is plain HTML, CSS and JavaScript. There is no build step and no framework, and nothing to install.

---

## Table of contents

- [Features](#features)
- [How to play](#how-to-play)
- [Getting started](#getting-started)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [How it works](#how-it-works)
- [Clean code practices](#clean-code-practices)
- [Accessibility](#accessibility)
- [Performance](#performance)
- [Browser support](#browser-support)
- [Ideas for future improvements](#ideas-for-future-improvements)

---

## Features

- **Accurate timing.** The clock starts on the exact animation frame where green appears, and it uses the input event's own timestamp.
- **Fair rounds.** The wait before green is random (1 to 5 seconds) and comes from the browser's cryptographic random generator.
- **False start detection.** Reacting before green, or faster than 100 ms (quicker than a human can react), counts as a false start.
- **Timeouts.** A round with no reaction within 2 seconds is marked as timed out and not counted.
- **Score tiers.** Each result is rated Excellent, Good, Average, Slow or Way slow, and the matching tier lights up in the score guide.
- **Session stats.** Last time, average, median, best, consistency (standard deviation), attempt count, false starts and timeouts.
- **History chart.** A bar chart of your last 12 attempts with a "typical 250 ms" reference line and your best attempt highlighted.
- **Animated 3D scene.** A faceted core, a wireframe shell, orbit rings, satellites, a star field and particle bursts that react to the game state.
- **2D fallback.** If WebGL is not available, or its context is lost, the game keeps running without 3D. Timing is unaffected.
- **Responsive layout.** Works on phones, tablets and desktops.
- **Accessible.** Keyboard play, screen reader announcements and support for reduced motion.

---

## How to play

1. Press **Start**, or click the shape.
2. Wait for the shape to turn **green** (1 to 5 seconds).
3. React as fast as you can: **Click**, **tap** or press <kbd>Space</kbd>.
4. Reacting before green is a **false start** and does not count.
5. Press <kbd>Esc</kbd> to stop a game. **Reset** clears the session (it asks you to click twice to confirm).

### Score guide

| Rating    | Reaction time |
|-----------|---------------|
| Excellent | under 200 ms  |
| Good      | 200–249 ms    |
| Average   | 250–299 ms    |
| Slow      | 300–399 ms    |
| Way slow  | 400 ms or more |

---

## Getting started

There is nothing to install. Clone the repository and open the page:

```bash
git clone <your-repo-url>
cd AI_Reaction_Game
```

Then either:

- **Open `index.html` directly** in your browser, or
- **Serve the folder locally** (recommended, as it behaves the same as a real deploy):

  ```bash
  # Python 3
  python -m http.server 8000

  # or Node.js
  npx serve .
  ```

  Then visit `http://localhost:8000`.

An internet connection is needed the first time, because Three.js and the fonts load from a CDN.

### Deploying

The project is three static files, so it can be hosted on any static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages and so on) with no configuration.

---

## Tech stack

| Technology | Purpose |
|---|---|
| **HTML5** | Semantic page structure (`header`, `main`, `section`, `dl`, `ol`) and ARIA attributes for accessibility. |
| **CSS3** | Styling with custom properties (design tokens), CSS Grid, Flexbox, `clamp()` for fluid sizing, media queries, keyframe animations and `prefers-reduced-motion`. |
| **JavaScript (ES2020+)** | All game logic, written in vanilla JS with no framework. Uses `const`/`let`, arrow functions, template literals, destructuring, spread, nullish coalescing (`??`) and `Object.freeze`. |
| **[Three.js](https://threejs.org/) r128** | WebGL 3D rendering of the animated shape, loaded from the cdnjs CDN. |
| **Google Fonts** | *Outfit* for headings and *Inter* for body text. |

### Browser APIs used

| API | Why |
|---|---|
| `requestAnimationFrame` | Drives the render loop and lines the green stimulus up with a real frame. |
| `performance.now()` and `event.timeStamp` | High resolution timing for the reaction measurement. |
| `crypto.getRandomValues()` | Unpredictable random delays (with a `Math.random()` fallback). |
| Pointer Events (`pointerdown`) | One handler for mouse, touch and pen, fired on press rather than release for faster response. |
| `ResizeObserver` | Keeps the 3D canvas sharp and the shape in frame at any size. |
| `matchMedia('(prefers-reduced-motion: reduce)')` | Tones down animation for users who ask for less motion. |
| Page Visibility API (`visibilitychange`) and `pagehide` | Cancels unfair rounds when the tab is hidden, and frees GPU memory when the page is closed. |
| `aria-live` region | Announces state changes to screen readers. |

---

## Project structure

```
AI_Reaction_Game/
├── index.html   # Page markup: header, instructions, game board, stats and chart
├── styles.css   # All styling, organised into 8 numbered sections
├── script.js    # All game logic, organised into 10 numbered sections
└── README.md
```

### `script.js` sections

1. **Settings and constants:** timing values, chart settings, game states, colors, text and score tiers
2. **Utility functions:** random numbers, average, median, standard deviation, formatting
3. **Page elements:** one cached lookup of every DOM element the script uses
4. **Game and session state:** two plain objects, `session` and `game`
5. **Updating the page:** rendering state, stats and the history chart
6. **Game flow:** starting rounds, recording reactions, false starts, timeouts, stop and reset
7. **3D scene (Three.js):** building and animating the scene
8. **Render loop:** the single `requestAnimationFrame` loop
9. **Player input and browser events:** pointer, keyboard, visibility and page hide
10. **Start the app:** `initializeApp()`

### `styles.css` sections

1. Design tokens (colors, fonts, sizes)
2. Base elements
3. Page layout and header
4. Instructions card
5. Game board (status panel, controls, 3D scene, score guide)
6. Buttons
7. Results (session stats and history chart)
8. Responsive rules

---

## How it works

### Game states

The game is a small **state machine** with six states, defined once in `GAME_STATE`:

```
IDLE ──Start──▶ WAITING ──random 1–5 s delay──▶ GO
                   │                             │
                   │ react before green          ├─ react in ≥ 100 ms ──▶ RESULT
                   ▼                             ├─ react in < 100 ms ──▶ FALSE_START
              FALSE_START                        └─ no reaction in 2 s ─▶ TIMED_OUT

RESULT / FALSE_START / TIMED_OUT ──click or Space──▶ WAITING (next round)
Any state ──Stop, Esc or Reset──▶ IDLE
```

Every state change goes through one function, `setGameState()`. It updates the text, colors, buttons, screen reader announcement and 3D scene together, so the page can never show a mix of two states.

### Frame-accurate timing

Measuring reaction time in a browser has a subtle problem: when a timer fires, the green color is not on screen yet. It only appears on the next painted frame, which can be up to ~16 ms later. Starting the clock in the timer would make every result look slower than it really was.

Reflex Lab avoids this:

1. When the random delay ends, the timer only sets a flag (`isStimulusPending = true`). It does not change the screen.
2. On the next animation frame, the render loop switches the state to **GO** and draws the green frame.
3. Right after that frame is drawn, the loop starts the reaction clock (`stimulusShownAt = performance.now()`).
4. When the player reacts, the time is taken from the **input event's own timestamp** (`event.timeStamp`), which records when the click or key press actually happened, not when the handler ran.

The 3D scene also skips its color easing on the GO frame, so green appears instantly rather than fading in.

### Protecting against unfair or broken rounds

- **Stale timers:** each round gets an `activeRoundId`. Timers check it before acting, so a timer left over from a stopped round can never fire into a new one.
- **Double taps:** a 300 ms cooldown after each round stops one fast double tap from starting the next round by accident.
- **Hidden tabs:** browsers slow down timers and pause rendering in background tabs, so a round in progress is cancelled when the tab is hidden instead of recording a wrong number.
- **Key repeat:** holding <kbd>Space</kbd> does not trigger repeated reactions.
- **Buttons and Space:** after Start is pressed, focus moves to the game board so Space reacts instead of pressing the button again.

### Statistics

- **Average** and **median** of all valid reactions
- **Best** time and which attempt it was
- **Consistency:** the sample standard deviation (needs at least 2 attempts)
- **False starts** and **timeouts**, counted separately and never mixed into the averages

All data lives in memory only. Nothing is saved to browser storage, and refreshing the page starts a new session.

---

## Clean code practices

The code is written to be easy to read, change and extend.

### Clear, descriptive naming
Names say what something is or does, without abbreviations: `getRandomStimulusDelay`, `calculateStandardDeviation`, `handleFalseStart`, `isStimulusPending`, `ignoreInputUntil`. Booleans read as questions (`isRunning`, `isNewBest`, `sessionIsEmpty`), and event handlers start with `handle`.

### No magic numbers
Every tuning value lives in a named, frozen constant at the top of the file, with a comment explaining it:

```js
const TIMING = Object.freeze({
  MIN_STIMULUS_DELAY_MS: 1000,      // shortest wait before the shape turns green
  MAX_STIMULUS_DELAY_MS: 5000,      // longest wait before the shape turns green
  REACTION_TIMEOUT_MS: 2000,        // no reaction after this long counts as "timed out"
  MIN_HUMAN_REACTION_MS: 100,       // faster than this is physically a guess
  ...
});
```

Units are part of the name (`_MS`, `_S`), so there is no confusion between seconds and milliseconds.

### Data-driven configuration
Text, colors, score tiers and per-state 3D animation settings are lookup tables keyed by game state (`STATE_TEXT`, `STATE_COLORS`, `SCORE_TIERS`, `SHAPE_ANIMATION`). Adding or changing a state means editing data, not hunting through `if`/`else` chains.

### Single source of truth
- All state changes go through `setGameState()`.
- One CSS variable, `--color-current-state`, is set by JavaScript and read by everything in the CSS that should follow the state (title, glow, status dot).
- DOM elements are looked up once and cached in the `elements` object.

### Small, single-purpose functions
Each function does one job: `calculateMedian`, `formatMilliseconds`, `showReactionTime`, `updateControls`, `renderHistoryChart`. The 3D render step is split into `easeAnimationValues`, `updateShape`, `updateRingsAndSatellites`, `updateShake` and `updateParticles`.

### Separation of concerns
- **HTML** holds structure and content, **CSS** holds presentation, **JS** holds behaviour.
- Inside the script, game logic, page rendering and the 3D scene are separate sections. The game only talks to the 3D scene through a small interface (`renderFrame`, `setGameState`, `setColor`, `playParticleBurst`, `dispose`), so the game works the same with or without it.

### Encapsulation
The whole script runs inside an IIFE (`(() => { ... })()`) in strict mode, so nothing leaks into the global scope. `createReactionScene()` uses a closure to keep the Three.js objects private.

### Immutability where it matters
Configuration objects are wrapped in `Object.freeze()` so they cannot be changed by accident at runtime. Statistics functions copy arrays before sorting (`[...numbers].sort(...)`) instead of mutating the input.

### Defensive programming and graceful degradation
- Three.js failing to load, WebGL being unavailable, the WebGL context being lost, or an error during rendering all switch the game to **2D mode** instead of breaking it.
- `crypto.getRandomValues` falls back to `Math.random`.
- Input timestamps are validated before use, with `performance.now()` as the fallback.

### Organised, documented files
Both `script.js` and `styles.css` start with a numbered table of contents, and each section has a matching header. Comments explain **why** something is done (for example, why the clock starts after the frame is drawn), not what the code literally says. Public-facing functions have short JSDoc comments.

### Consistent CSS
- Design tokens (colors, fonts, radii) are defined once as custom properties on `:root`.
- Class names are readable and component based (`.status-panel`, `.score-tier`, `.chart-bar`) with state modifiers (`.is-active`, `.is-best`, `.is-latest`, `.is-updated`).
- Game state is exposed to CSS through `data-state` on the board, so styles react to state without extra classes.

---

## Accessibility

- **Keyboard play:** <kbd>Space</kbd> to react, <kbd>Esc</kbd> to stop; the game board is focusable.
- **Screen readers:** an `aria-live="assertive"` region announces "Wait for green", "Go!", results and false starts. The status area uses `role="status"`, and the board has a descriptive `aria-label`.
- **Semantic HTML:** headings, ordered lists, a description list for stats, and `aria-labelledby` on sections.
- **Reduced motion:** with `prefers-reduced-motion`, 3D motion is scaled down, and the shake and particle effects are turned off.
- **Not color alone:** every state also has a text title and message, so the game does not rely only on color.
- **Decorative canvas:** the 3D canvas is `aria-hidden`, since all information is also shown as text.

---

## Performance

- **One draw call for satellites** using `THREE.InstancedMesh`.
- **Reused particle pool:** the burst reuses one fixed buffer instead of creating new objects every round.
- **Capped pixel ratio** (max 2x) to avoid rendering huge canvases on high-DPI screens.
- **Frame-rate independent animation:** easing uses `1 - Math.exp(-delta * speed)`, so motion feels the same at 60 Hz or 144 Hz, and the time step is capped to avoid jumps after a stall.
- **Batched DOM updates:** chart bars are built in a `DocumentFragment` and inserted with one `replaceChildren()` call.
- **Paused when hidden:** the render loop stops while the tab is in the background.
- **Cleanup:** geometries, materials, the renderer and the `ResizeObserver` are disposed on `pagehide`.

---

## Browser support

Works in current versions of Chrome, Edge, Firefox and Safari, on desktop and mobile. 3D needs WebGL; without it the game runs in 2D mode with the same timing.

> **A note on accuracy:** browser reaction times include small, unavoidable delays from your mouse or keyboard, display refresh rate and operating system. Results are great for comparing yourself over time, but are not a lab-grade measurement.

---

## Ideas for future improvements

- Save best scores and history with `localStorage`
- Additional modes (audio cue, choice reaction, multiple targets)
- An online leaderboard
- Unit tests for the statistics and state logic (for example with Vitest or Jest)
- Moving to ES modules and a newer Three.js version
- Export session results as CSV
