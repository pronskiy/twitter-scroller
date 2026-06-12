Chrome extension to "emulate" Tweetbot feed behavior.

It auto-scrolls your X feed down to the spot where you stopped reading last time, so you can read upward into the newer tweets. Your reading position is marked with X's own bookmarks — no extra accounts, no extension storage.

## Installation

- Download the repo
- Go to [chrome://extensions](chrome://extensions)
- Press Load unpacked
- Choose the repo folder

## Usage

- Go to your X [home](https://x.com/home) page.
- Press **Ctrl+Shift+Y** (or **Cmd+Shift+Y** on Mac, or click the **Skrl** button next to the compose button).
- The feed scrolls down and stops at your most recent bookmarked tweet.
- Read upward. When you stop reading, **bookmark** the last tweet you read (the native bookmark icon in the tweet's action bar) — that's where scrolling will stop next time.

Tip: to keep your bookmarks tidy, you can remove the previous position bookmark after setting a new one. Note that if you bookmark tweets you haven't read yet, scrolling will stop at the newest bookmark rather than your actual reading position.

## Filtering noise

You can hide tweets matching a list of regular expressions:

- Open the extension options (chrome://extensions → Twitter scroller → Details → Extension options).
- Add one pattern per line (matched case-insensitively against tweet text, e.g. `giveaway` or `crypto ?bro`) and press Save.
- Matching tweets collapse to a one-line `filtered: /…/` stub in the feed; click the stub to reveal the tweet.

Changes apply to the open feed immediately — no reload needed. Your bookmarked position tweet is never hidden.
