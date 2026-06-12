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

Tweets can be hidden by two filters, configured in the extension options
(chrome://extensions → Twitter scroller → Details → Extension options). Filtered tweets collapse
to a one-line `filtered: …` stub in the feed; click the stub to reveal the tweet. Changes apply
to the open feed immediately — no reload needed. Your bookmarked position tweet is never hidden.

**Links only** — a checkbox that hides every tweet not containing a link (external URL or link
card). Checked before the other filters.

**Regexp filters** — one pattern per line, matched case-insensitively against tweet text
(e.g. `giveaway` or `crypto ?bro`). Instant and free.

**LLM filter (optional)** — tweets that pass the regexps are classified by an LLM via
[OpenRouter](https://openrouter.ai) against rubrics you write in plain language, one per line as
`label: what to filter` (e.g. `politics: elections, politicians, geopolitics`). To enable, fill in
all three fields: your OpenRouter API key, a model (pick a fast cheap one from the list), and at
least one rubric. Each tweet is classified once and the verdict cached, so cost stays negligible.
Note: tweet text is sent to OpenRouter and the model's provider. There's a brief moment before a
noisy tweet collapses while classification is in flight.
