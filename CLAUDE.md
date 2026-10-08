# Twitter Scroller

Auto-scrolls your X/Twitter feed to the newest bookmarked tweet (your reading
position) and collapses noisy tweets. Ships in two forms — a Chrome extension
(Manifest V3, desktop) and an iOS Safari userscript — that share one settings
file. Vanilla JS, no dependencies; the only "build" is a shell script that bakes
settings into the userscript.

## Spec-driven workflow

**`SPEC.md` is the task list and source of truth.** Start at its **Current focus** pointer, which names the next actionable step, so you don't have to scan the whole file. Work the spec this way: implement that step's deliverable, move its status 🔲 → 🔄 → ✅ in the phase tracker, and advance Current focus. Don't go past a phase's exit guardrails. At a phase boundary, verify the criteria, fill in the **Actual outcome** column, and only then move on.

- **Autonomous:** pure-logic steps, i.e. classifier code, filter logic, config plumbing, and docs. Verify them with `node --check` and the Node harnesses described in the spec.
- **Needs a human:** anything that has to be checked in the live x.com feed or on the iPhone, guardrail sign-offs that depend on those checks, and new Decision Log entries.
- **When blocked or ambiguous:** mark the step ⏸️ with a note, add an Open Question to the spec, and surface it instead of guessing.
- **Commits:** short, lowercase, human-sounding messages that match the history (e.g. "scroll faster"). No co-author lines. Commit only when asked.
- **Version bump on every commit:** bump both `manifest.json` `"version"` and the userscript's `// @version` in the same commit. Use a minor bump for features and a patch bump for fixes. Without the bump, Chrome and the Userscripts app don't see the change as a new version.

## Settings: `config.js` (single source of truth)

- `config.js` — **gitignored**, holds all settings: `globalThis.SKRL_CONFIG = { filters, keep, links_only, hide, model, threshold, rubrics, key }`. Required for the extension to load. Create it with `cp config.example.js config.js`.
- `config.example.js` — committed template documenting the keys.
- Both runtimes read `globalThis.SKRL_CONFIG`; empty values disable the corresponding feature. There is **no options page** and no `chrome.storage` — edit `config.js` and reload.

## Files

- `manifest.json` — MV3 manifest. Content scripts on `https://x.com/*` at `document_end`: `["config.js", "script.js"]` (config first so `script.js` sees the global). Declares the `scroll` command (Ctrl+Shift+Y / Cmd+Shift+Y on Mac), the background service worker, and `host_permissions` for `openrouter.ai`. No `storage` permission, no options page.
- `background.js` — Service worker. `importScripts('config.js')`, relays the `chrome.commands` shortcut to the active tab as `'toggle-scroll'`, and handles `{type: 'classify'}` by calling OpenRouter with `SKRL_CONFIG.model`/`rubrics`/`key`/`threshold`. `classify()` dispatches to `classifyJev()` (Decisions API) or `classifyChat()` (chat completions) by model id.
- `script.js` — Desktop content script. Skrl button, scroll-to-bookmark, and the noise filter (links-only + regexp + LLM). Reads settings from `globalThis.SKRL_CONFIG`.
- `userscript/skrl.user.js` — iOS Safari userscript (Userscripts app). Standalone port of the same behavior: scroll-to-bookmark, video-unloading for memory safety, and the noise filter. The LLM pass calls OpenRouter directly via `GM.xmlHttpRequest` (`@grant GM.xmlHttpRequest`, `@connect openrouter.ai`) — no background relay. Contains a `/* __CONFIG__ */` marker where the build injects `config.js`.
- `userscript/sync-ios.sh` — Build+sync: splices `config.js` into the `/* __CONFIG__ */` marker (via `awk`) and writes the result to the iCloud Userscripts folder (`~/Library/Mobile Documents/com~apple~CloudDocs/Userscripts`), which syncs to the iPhone. Overridable with `USERSCRIPTS_DIR`.
- `README.md` — User-facing install/usage docs (desktop + iPhone).
- `SPEC.md` — Living build plan: epics, phase trackers, guardrails, decision log.

## Development

1. `cp config.example.js config.js` and fill it in (the extension won't load without it).
2. Desktop: load unpacked at `chrome://extensions`. After changes, reload the extension and refresh the X tab. No live reload — config changes need an extension reload.
3. iOS: run `./userscript/sync-ios.sh`, then reload `x.com` in Safari on the phone.
4. No tests, no linter, no CI. Run `node --check` on changed files. Live behavior is tested manually. Calls to the OpenRouter API can be exercised from Node by loading `background.js` in a `vm` context with a stubbed `chrome`. Node's `fetch` needs `NODE_USE_ENV_PROXY=1` in the sandbox. `node --check` does **not** catch missing-semicolon bugs: `script.js` mostly leaves semicolons off, so a line ending in `{}` right before a `(function () {…})()` block crashes at load. Load the file in jsdom against fake X markup to catch those runtime errors (install jsdom in the scratchpad with `npm install --cache <scratch-dir>`, since `~/.npm` isn't writable in the sandbox).

## Key Details

- **Keyboard shortcuts**: (a) the `chrome.commands` `scroll` command relayed via `background.js` (desktop only), and (b) an in-page `keyup` listener checking `ctrlKey && shiftKey && (key === 'Y' || key === 'Н')` (Cyrillic `Н` for Russian layouts). Clicking/tapping the Skrl button also toggles.
- **Init flow**: `waitForElement()` polls every 200 ms (10 s timeout) for the compose button — `a[aria-label="Post"]` (desktop) or `a[aria-label="Compose a post"]` (mobile-style). Skrl is inserted after it. The userscript adds a floating-button fallback when no compose anchor is found (mobile web layout).
- **SPA navigation**: a 2 s poller watches `location.pathname` and re-inits on return to `/home` (if no `.skrl` present). Document-level listeners and scroll state live at module scope, registered once.
- **Scrolling (memory-safe poll loop)**: a fast poll (desktop 400 ms / mobile 500 ms) checks for the bookmark *first*; the feed advances only every Nth poll (desktop 3rd ≈1.2 s / mobile 4th ≈2 s) by ~0.85 of a viewport — never a jump to the bottom. This keeps the bookmarked tweet in the rendered window when a poll lands on it. Auto-stops after `MAX_SCROLL_ITERATIONS` (desktop 60 / mobile 80). The userscript additionally pauses + unloads all `<video>` each step so iOS Safari doesn't kill the tab on memory.
- **Stop condition**: the first `button[data-testid="removeBookmark"]` found scrolling down — the *newest* bookmark. X bookmarks are the persistent reading-position markers; bookmark the last tweet you read, read upward next session.
- **Universal allow-list (`keep`)**: `SKRL_CONFIG.keep` — case-insensitive regexp sources compiled with `i`, tested against the tweet's text **plus** its anchor hrefs (so `"github"` matches github.com links). A match exempts the tweet from every *content* pass (`isKept()` runs right after the structural `hide` pass, before links_only/regexp/LLM). It doesn't exempt from `hide`. E.g. `["php", "github"]` keeps PHP-related and GitHub-linked tweets visible even when other filters would hide them.
- **Structural pass (`hide`)**: runs first, right after the `removeBookmark` exemption and **before `keep`**. It judges the kind of post, not its topic. `SKRL_CONFIG.hide` lists any of:
  - `"reposts"`: the article has a `[data-testid="socialContext"]` whose text ends in "reposted". Other social contexts, like "Pinned", aren't touched.
  - `"replies"`: a `div` whose `textContent` starts with "Replying to", skipping the tweet text and any div that contains it.
  - `"duplicates"`: the article's `[data-testid="card.wrapper"]` text (normalized) was already seen this session on a different permalink. `seenCards` maps card text to the first permalink, so the first copy stays visible across re-renders.
  - Each match collapses to a stub (`repost` / `reply` / `duplicate`). Duplicates never reach the LLM.
  - Ads and "Who to follow" modules aren't handled: a DOM probe of 87 tweets found neither. `placementTracking` marks video players, not ads.
- **Noise filter, pass 0 (links only)**: `SKRL_CONFIG.links_only`. Collapses any tweet without an absolute-href anchor (`a[href^="http"]`). Runs first (after `keep`), so the LLM only sees link-tweets.
- **Noise filter, pass 1 (regexp)**: `SKRL_CONFIG.filters` is a `{ label: regexp-source }` object compiled with the `i` flag (invalid skipped with a warning). A 1.5 s interval scans `article`s not yet marked `data-skrl-checked`, matching the joined text of all `div[data-testid="tweetText"]` nodes. Matches collapse to a `.skrl-filter-stub` showing the matched **label**; clicking restores. `removeBookmark` tweets are exempt.
- **Noise filter, pass 2 (LLM)**: tweets that pass the regexps are queued, and each 1.5 s tick flushes up to 20 of them. They're classified by `SKRL_CONFIG.model` against `SKRL_CONFIG.rubrics`, a `{ label: description }` object. The model id picks the backend (`isDecisionsModel()`):
  - **Jev** (`~typesafe/jev-latest`, `typesafe/jev-<version>`; *not* `typesafe/jev-router`): sends one `POST https://openrouter.ai/api/alpha/decisions` per tweet, in parallel (`Promise.allSettled`). The body is `{model, state: text, questions: {noise: {type: 'choice', instructions, criteria: {...rubrics, _none}}}}`. The reply is `answers.noise.{choice, probabilities, confidence}`. A tweet is hidden only when `choice` is a rubric label and `probabilities[choice] >= SKRL_CONFIG.threshold` (default 0.7). `jevPost()` retries 429/5xx/network errors twice (1 s, then 3 s backoff) because Jev is often overloaded. Tweets that still fail are left out of `verdicts` and retry later.
  - **Chat** (any other id, e.g. `x-ai/grok-4.3`): one `chat/completions` request per batch. The model replies with a JSON array of `{id, label|null}`.
  - Verdicts are `{label, p}` or `null`, where `p` is Jev's probability and `null` for chat models. Unknown labels fail open. The stub reads `filtered: <label> NN%` when `p` is set.
  - Desktop routes through `background.js`; the userscript calls OpenRouter directly via `GM.xmlHttpRequest`. Verdicts are cached in `localStorage` key `ts_llm_verdicts` (capped at 1000), and only ids present in the response are cached.
  - The pass is disabled unless model, rubrics, and key are all set. All errors fail open.
  - The cache is invalidated on load when a stored signature changes (`localStorage` key `ts_llm_sig`). The signature is `'v2' + model + rubrics + threshold`.
- **DOM selectors depend on Twitter's markup** — `a[aria-label="Post"]`, `a[aria-label="Compose a post"]`, `button[data-testid="removeBookmark"]`, `div[data-testid="tweetText"]`, `[data-testid="socialContext"]`, `[data-testid="card.wrapper"]`, and the "Replying to" text. These break when Twitter changes their DOM.
