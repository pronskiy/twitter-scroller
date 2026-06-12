# Twitter Scroller

Chrome extension (Manifest V3) that auto-scrolls your X/Twitter feed to the last liked tweet. Vanilla JS, no build system, no dependencies.

## Files

- `manifest.json` — Extension manifest. Content script injected on `x.com` at `document_end`.
- `script.js` — All logic. Injects a "Skrl" button into the sidebar, scrolls the feed on an interval, stops when it finds a liked tweet or the hardcoded `last_read_tweet` link.
- `README.md` — User-facing install/usage docs.

## Development

1. Load unpacked at `chrome://extensions` pointing to this directory.
2. After changes to `script.js`, reload the extension and refresh the Twitter tab.
3. No tests, no linter, no CI. Manual testing only.

## Key Details

- **Keyboard shortcut**: `Ctrl+Shift+Y` (or `Cmd+Shift+Y` on Mac) toggles scrolling.
- **DOM selectors depend on Twitter's markup** — `a[aria-label="Post"]`, `div[aria-label~="Liked,"]`, `a:has(time)`, `[role="group"]`. These break when Twitter changes their DOM.
- **Skip list**: Liked tweets can be marked "Skip" so scrolling continues past them. Stored in `localStorage` under key `ts_skipped`.
- **`last_read_tweet`** is hardcoded (`/exakat/status/...`). This is a stop-scrolling anchor, not dynamically set.
