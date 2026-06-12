# Twitter Scroller

Chrome extension (Manifest V3) that auto-scrolls your X/Twitter feed to the last liked tweet. Vanilla JS, no build system, no dependencies.

## Files

- `manifest.json` — Extension manifest. Content script injected on `https://x.com/*` at `document_end`. The `commands` block (Cmd+Shift+Y suggestion) is **dead code** — there is no background service worker listening to `chrome.commands`.
- `script.js` — All logic. Injects a "Skrl" button next to the compose button, scrolls the feed on an interval, stops when it finds a liked tweet or the hardcoded `last_read_tweet` link.
- `README.md` — User-facing install/usage docs. **Outdated**: still references `twitter.com`, but the extension only matches `x.com`; doesn't mention the Skrl button.

## Development

1. Load unpacked at `chrome://extensions` pointing to this directory.
2. After changes to `script.js`, reload the extension and refresh the Twitter tab.
3. No tests, no linter, no CI. Manual testing only.

## Key Details

- **Keyboard shortcut**: an in-page `keyup` listener checks `ctrlKey && shiftKey && (key === 'Y' || key === 'Н')` — so it's `Ctrl+Shift+Y` on **all** platforms (not Cmd on Mac), with Cyrillic `Н` matched for Russian keyboard layouts. Toggles scrolling, as does clicking the Skrl button.
- **Init flow**: `waitForElement()` polls every 200 ms (10 s timeout) for the compose button — desktop `a[aria-label="Post"]` or mobile-style `a[aria-label="Compose a post"]`. The Skrl button is inserted after it; the mobile-style variant additionally gets hidden.
- **SPA navigation**: a 2 s `setInterval` poller watches `location.pathname` and re-runs init when navigating back to `/home` (if no `.skrl` button is present). Note: re-init re-registers document-level listeners.
- **Scrolling**: interval randomized 1000–1200 ms; auto-stops after `MAX_SCROLL_ITERATIONS = 60`. The Skrl button turns red and reads "Stop" while scrolling is active.
- **Stop conditions**: (a) the hardcoded `last_read_tweet` anchor (`/exakat/status/...` — a stop-scrolling anchor, not dynamically set), or (b) the first liked tweet not in the skip list. On (b), a "Skip" link is injected into the tweet's `[role="group"]` action bar.
- **Skip list**: pressing "Skip" stores the tweet's permalink in `localStorage` under key `ts_skipped` (capped at 200 entries, oldest dropped) so scrolling continues past it next time.
- **DOM selectors depend on Twitter's markup** — `a[aria-label="Post"]`, `div[aria-label~="Liked,"]`, `a:has(time)`, `[role="group"]`. These break when Twitter changes their DOM.
