# Twitter Scroller

Chrome extension (Manifest V3) that auto-scrolls your X/Twitter feed to the last liked tweet. Vanilla JS, no build system, no dependencies.

## Files

- `manifest.json` — Extension manifest. Content script injected on `https://x.com/*` at `document_end`; declares the `scroll` command (Ctrl+Shift+Y / Cmd+Shift+Y on Mac) and the background service worker.
- `background.js` — Service worker. Relays the `chrome.commands` shortcut to the active tab as a `'toggle-scroll'` message.
- `script.js` — All other logic. Injects a "Skrl" button next to the compose button, scrolls the feed on an interval, stops at the newest bookmarked tweet (X bookmarks mark the reading position).
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
- **DOM selectors depend on Twitter's markup** — `a[aria-label="Post"]`, `a[aria-label="Compose a post"]`, `button[data-testid="removeBookmark"]`. These break when Twitter changes their DOM.
