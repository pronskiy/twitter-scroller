# Twitter Scroller

Auto-scrolls your X/Twitter feed to the newest bookmarked tweet (your reading
position) and collapses noisy tweets. Ships in two forms — a Chrome extension
(Manifest V3, desktop) and an iOS Safari userscript — that share one settings
file. Vanilla JS, no dependencies; the only "build" is a shell script that bakes
settings into the userscript.

## Settings: `config.js` (single source of truth)

- `config.js` — **gitignored**, holds all settings: `globalThis.SKRL_CONFIG = { filters, keep, links_only, model, rubrics, key }`. Required for the extension to load. Create it with `cp config.example.js config.js`.
- `config.example.js` — committed template documenting the keys.
- Both runtimes read `globalThis.SKRL_CONFIG`; empty values disable the corresponding feature. There is **no options page** and no `chrome.storage` — edit `config.js` and reload.

## Files

- `manifest.json` — MV3 manifest. Content scripts on `https://x.com/*` at `document_end`: `["config.js", "script.js"]` (config first so `script.js` sees the global). Declares the `scroll` command (Ctrl+Shift+Y / Cmd+Shift+Y on Mac), the background service worker, and `host_permissions` for `openrouter.ai`. No `storage` permission, no options page.
- `background.js` — Service worker. `importScripts('config.js')`, relays the `chrome.commands` shortcut to the active tab as `'toggle-scroll'`, and handles `{type: 'classify'}` by calling OpenRouter with `SKRL_CONFIG.model`/`rubrics`/`key`.
- `script.js` — Desktop content script. Skrl button, scroll-to-bookmark, and the noise filter (links-only + regexp + LLM). Reads settings from `globalThis.SKRL_CONFIG`.
- `userscript/skrl.user.js` — iOS Safari userscript (Userscripts app). Standalone port of the same behavior: scroll-to-bookmark, video-unloading for memory safety, and the noise filter. The LLM pass calls OpenRouter directly via `GM.xmlHttpRequest` (`@grant GM.xmlHttpRequest`, `@connect openrouter.ai`) — no background relay. Contains a `/* __CONFIG__ */` marker where the build injects `config.js`.
- `userscript/sync-ios.sh` — Build+sync: splices `config.js` into the `/* __CONFIG__ */` marker (via `awk`) and writes the result to the iCloud Userscripts folder (`~/Library/Mobile Documents/com~apple~CloudDocs/Userscripts`), which syncs to the iPhone. Overridable with `USERSCRIPTS_DIR`.
- `README.md` — User-facing install/usage docs (desktop + iPhone).

## Development

1. `cp config.example.js config.js` and fill it in (the extension won't load without it).
2. Desktop: load unpacked at `chrome://extensions`. After changes, reload the extension and refresh the X tab. No live reload — config changes need an extension reload.
3. iOS: run `./userscript/sync-ios.sh`, then reload `x.com` in Safari on the phone.
4. No tests, no linter, no CI. Manual testing only.

## Key Details

- **Keyboard shortcuts**: (a) the `chrome.commands` `scroll` command relayed via `background.js` (desktop only), and (b) an in-page `keyup` listener checking `ctrlKey && shiftKey && (key === 'Y' || key === 'Н')` (Cyrillic `Н` for Russian layouts). Clicking/tapping the Skrl button also toggles.
- **Init flow**: `waitForElement()` polls every 200 ms (10 s timeout) for the compose button — `a[aria-label="Post"]` (desktop) or `a[aria-label="Compose a post"]` (mobile-style). Skrl is inserted after it. The userscript adds a floating-button fallback when no compose anchor is found (mobile web layout).
- **SPA navigation**: a 2 s poller watches `location.pathname` and re-inits on return to `/home` (if no `.skrl` present). Document-level listeners and scroll state live at module scope, registered once.
- **Scrolling (memory-safe poll loop)**: a fast poll (desktop 400 ms / mobile 500 ms) checks for the bookmark *first*; the feed advances only every Nth poll (desktop 3rd ≈1.2 s / mobile 4th ≈2 s) by ~0.85 of a viewport — never a jump to the bottom. This keeps the bookmarked tweet in the rendered window when a poll lands on it. Auto-stops after `MAX_SCROLL_ITERATIONS` (desktop 60 / mobile 80). The userscript additionally pauses + unloads all `<video>` each step so iOS Safari doesn't kill the tab on memory.
- **Stop condition**: the first `button[data-testid="removeBookmark"]` found scrolling down — the *newest* bookmark. X bookmarks are the persistent reading-position markers; bookmark the last tweet you read, read upward next session.
- **Universal allow-list (`keep`)**: `SKRL_CONFIG.keep` — case-insensitive regexp sources compiled with `i`, tested against the tweet's text **plus** its anchor hrefs (so `"github"` matches github.com links). A match exempts the tweet from *every* pass (`isKept()` runs right after the `removeBookmark` exemption, before links_only/regexp/LLM). E.g. `["php", "github"]` keeps PHP-related and GitHub-linked tweets visible even when other filters would hide them.
- **Noise filter, pass 0 (links only)**: `SKRL_CONFIG.links_only`. Collapses any tweet without an absolute-href anchor (`a[href^="http"]`). Runs first (after `keep`), so the LLM only sees link-tweets.
- **Noise filter, pass 1 (regexp)**: `SKRL_CONFIG.filters` is a `{ label: regexp-source }` object compiled with the `i` flag (invalid skipped with a warning). A 1.5 s interval scans `article`s not yet marked `data-skrl-checked`, matching the joined text of all `div[data-testid="tweetText"]` nodes. Matches collapse to a `.skrl-filter-stub` showing the matched **label**; clicking restores. `removeBookmark` tweets are exempt.
- **Noise filter, pass 2 (LLM)**: tweets passing the regexps are batched (≤20/request) and classified by `SKRL_CONFIG.model` against `SKRL_CONFIG.rubrics` (a `{ label: description }` object; the model returns a label or null, unknown labels fail open; the label shows on the stub). Desktop routes through `background.js`; the userscript calls OpenRouter directly via `GM.xmlHttpRequest`. Verdicts cached in `localStorage` key `ts_llm_verdicts` (capped 1000). Disabled unless model + rubrics + key are all set; all errors fail open. The cache is invalidated when a stored signature of `model + rubrics` (`localStorage` key `ts_llm_sig`) changes on load — replaces the old `chrome.storage.onChanged` invalidation.
- **DOM selectors depend on Twitter's markup** — `a[aria-label="Post"]`, `a[aria-label="Compose a post"]`, `button[data-testid="removeBookmark"]`, `div[data-testid="tweetText"]`. These break when Twitter changes their DOM.
