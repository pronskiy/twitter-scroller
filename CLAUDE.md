# Twitter Scroller

Chrome extension (Manifest V3) that auto-scrolls your X/Twitter feed to the last liked tweet. Vanilla JS, no build system, no dependencies.

## Files

- `manifest.json` — Extension manifest. Content script injected on `https://x.com/*` at `document_end`; declares the `scroll` command (Ctrl+Shift+Y / Cmd+Shift+Y on Mac), the background service worker, the `storage` permission, `host_permissions` for `openrouter.ai`, and the options page.
- `background.js` — Service worker. Relays the `chrome.commands` shortcut to the active tab as a `'toggle-scroll'` message, and handles `{type: 'classify'}` messages by calling OpenRouter's chat-completions API with the configured model and rubrics.
- `script.js` — All other logic. Injects a "Skrl" button next to the compose button, scrolls the feed on an interval, stops at the newest bookmarked tweet (X bookmarks mark the reading position), and collapses noisy tweets (regexp pass + LLM pass).
- `options.html` / `options.js` — Options page: regexp filter list, OpenRouter API key, model picker (datalist populated from OpenRouter's public `/api/v1/models`), and LLM filter rubrics. Regexps/model/rubrics in `chrome.storage.sync` (keys `filters`, `model`, `rubrics`); the API key in `chrome.storage.local` (key `openrouter_key`, deliberately not synced).
- `README.md` — User-facing install/usage docs. **Outdated**: still references `twitter.com`, but the extension only matches `x.com`; doesn't mention the Skrl button.

## Development

1. Load unpacked at `chrome://extensions` pointing to this directory.
2. After changes to `script.js`, reload the extension and refresh the Twitter tab.
3. No tests, no linter, no CI. Manual testing only.

## Key Details

- **Keyboard shortcuts**: two paths toggle scrolling — (a) the `chrome.commands` `scroll` command (Ctrl+Shift+Y, Cmd+Shift+Y on Mac) relayed via `background.js`, and (b) an in-page `keyup` listener checking `ctrlKey && shiftKey && (key === 'Y' || key === 'Н')` (Ctrl on all platforms; Cyrillic `Н` for Russian layouts). Clicking the Skrl button also toggles.
- **Init flow**: `waitForElement()` polls every 200 ms (10 s timeout) for the compose button — desktop `a[aria-label="Post"]` or mobile-style `a[aria-label="Compose a post"]`. The Skrl button is inserted after it; the mobile-style variant additionally gets hidden.
- **SPA navigation**: a 2 s `setInterval` poller watches `location.pathname` and re-runs init when navigating back to `/home` (if no `.skrl` button is present). Re-init only re-creates the button — document-level listeners and scroll state live at module scope and are registered exactly once.
- **Scrolling**: interval randomized 1000–1200 ms; auto-stops after `MAX_SCROLL_ITERATIONS = 60`. The Skrl button turns red and reads "Stop" while scrolling is active.
- **Stop condition**: the first tweet with a `button[data-testid="removeBookmark"]` (i.e. bookmarked by the user) found while scrolling down — that's the *newest* bookmarked tweet. X bookmarks are the persistent reading-position markers: the user bookmarks the last tweet they read, reads upward next session. No local storage involved.
- **Noise filter, pass 0 (links only)**: optional toggle (`chrome.storage.sync` key `links_only`). Collapses any tweet without an absolute-href anchor (`a[href^="http"]` — external t.co links and link cards are absolute; mentions/hashtags/permalinks/media are relative). Runs before the other passes, so the LLM only ever sees link-tweets. Quote tweets are `role="link"` divs, not anchors, so a bare quote-RT counts as link-less.
- **Noise filter, pass 1 (regexp)**: regexp sources from `chrome.storage.sync` key `filters`, compiled with the `i` flag (invalid ones skipped with a warning) and recompiled live via `chrome.storage.onChanged`. A 1.5 s interval scans `article`s not yet marked `data-skrl-checked`, matching the joined text of all `div[data-testid="tweetText"]` nodes (covers quoted tweets). Matches collapse to a `.skrl-filter-stub` link showing the pattern; clicking restores the tweet (and the scan mark keeps it open). Tweets with `removeBookmark` are exempt — the scroll loop must stop and scroll to the marker.
- **Noise filter, pass 2 (LLM)**: tweets that pass the regexps are batched (≤20 per request, flushed each scan tick) and sent to `background.js`, which asks the configured OpenRouter model which rubric each tweet matches (rubric format: `label: description`, one per line; the model must return a known label or null — unknown labels fail open). Verdicts are cached in `localStorage` key `ts_llm_verdicts` by tweet permalink (capped at 1000), so each tweet is classified once ever. Collapsed stubs show the rubric label. Disabled unless key + model + rubrics are all set; all errors fail open (tweet stays visible). Editing model/rubrics clears the verdict cache and re-evaluates the feed.
- **DOM selectors depend on Twitter's markup** — `a[aria-label="Post"]`, `a[aria-label="Compose a post"]`, `button[data-testid="removeBookmark"]`, `div[data-testid="tweetText"]`. These break when Twitter changes their DOM.
