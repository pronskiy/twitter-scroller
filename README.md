# Twitter Scroller

Chrome extension (and iOS Safari userscript) to "emulate" Tweetbot feed behavior.

It auto-scrolls your X feed down to the spot where you stopped reading last time, so you can read upward into the newer tweets. Your reading position is marked with X's own bookmarks — no extra accounts, no extension storage.

## Installation

- Download the repo
- Copy the settings file: `cp config.example.js config.js` (the extension won't load without it)
- Go to [chrome://extensions](chrome://extensions)
- Press Load unpacked
- Choose the repo folder

All settings (filters, model, rubrics, API key) live in `config.js`, which is gitignored. The example ships the author's own filters and rubrics; trim them to taste. Edit it and reload the extension to apply changes — there's no options page.

## Usage

- Go to your X [home](https://x.com/home) page.
- Press **Ctrl+Shift+Y** (or **Cmd+Shift+Y** on Mac, or click the **Skrl** button next to the compose button).
- The feed scrolls down and stops at your most recent bookmarked tweet.
- Read upward. When you stop reading, **bookmark** the last tweet you read (the native bookmark icon in the tweet's action bar) — that's where scrolling will stop next time.

Tip: to keep your bookmarks tidy, you can remove the previous position bookmark after setting a new one. Note that if you bookmark tweets you haven't read yet, scrolling will stop at the newest bookmark rather than your actual reading position.

## iPhone / Safari (userscript)

The native X app can't be scripted, so on iOS you read the feed at [x.com](https://x.com) in Safari with a userscript. [`userscript/skrl.user.js`](userscript/skrl.user.js) has full parity with the desktop extension — scroll-to-bookmark **and** the noise filters — tuned to be memory-safe on mobile (slower stepping, and it pauses/unloads video so Safari doesn't kill the tab).

It uses the same `config.js` as the desktop extension: `userscript/sync-ios.sh` bakes your settings into the script and copies it to your iCloud Userscripts folder, which syncs to the iPhone (this is how settings "sync" across your Apple devices).

- Install the free [Userscripts](https://apps.apple.com/app/userscripts/id1463298887) app from the App Store, then enable it in Settings → Safari → Extensions, and point it at your iCloud Userscripts folder.
- On your Mac, run `./userscript/sync-ios.sh` (needs `config.js`). Re-run it whenever you edit `config.js`.
- Open [x.com](https://x.com) in Safari and tap the **Skrl** button to scroll to your newest bookmark.

## Filtering noise

Filters only apply to the home feed (x.com/home), never to notifications, threads, profiles, search or bookmarks. Tweets can be hidden by several filter passes, all configured in `config.js` (see
`config.example.js` for the format). Filtered tweets collapse to a one-line `filtered: …` stub in
the feed; click the stub to reveal the tweet. Your bookmarked position tweet is never hidden.
After editing `config.js`, reload the extension (desktop) or re-run `sync-ios.sh` (iPhone).

**`hide`** — structural filters by kind of post, rather than topic: `"reposts"`, `"replies"` (replies
that show up in the feed), and `"duplicates"` (a link card you already saw earlier in the session;
the first copy stays). E.g. `hide: ["reposts", "replies", "duplicates"]`. Runs before every other
pass, and `keep` doesn't exempt from it.

**`links_only`** — hides every tweet not containing a link (external URL or link card). Runs
before the other passes.

**`filters`** — a `{ label: regexp-source }` object, matched case-insensitively against tweet text
(e.g. `{ "crypto": "crypto ?bro" }`). The label is what shows on the `filtered: …` stub. Instant and free.

**`keep`** — a universal allow-list of regexp sources, matched against each tweet's text **and** its
link hrefs. A match exempts the tweet from the content filters (`links_only`, `filters`, the LLM), though not from `hide`. E.g. `["php", "github"]` keeps any
PHP-related tweet or GitHub-linked tweet visible even when another filter (like a CJK-language
pattern) would otherwise hide it.

**`model` + `rubrics` + `key` (optional LLM filter)** — tweets that pass the regexps are classified
by an LLM via [OpenRouter](https://openrouter.ai) against rubrics you write in plain language, as a
`{ label: what-to-filter }` object (e.g. `{ "politics": "elections, politicians, geopolitics" }`). To
enable, set all three: your OpenRouter API `key`, a `model`, and at least one
rubric. Each tweet is classified once and the verdict cached, so cost stays negligible.

The recommended model is TypeSafe's Jev (`~typesafe/jev-latest`). It isn't a chat LLM: it answers
which rubric matches with a probability, in roughly 300 ms per tweet and at a fraction of a cent per
thousand tweets. A tweet is hidden only when that probability reaches `threshold` (default `0.7`),
and the stub shows it (`filtered: politics 86%`). Raise `threshold` if good tweets get hidden.
Any other OpenRouter model id (e.g. `x-ai/grok-4.3`) is called through chat completions instead. Note:
tweet text is sent to OpenRouter and the model's provider, and the `key` lives in `config.js`
(gitignored) — on iPhone it travels through your iCloud.

## License

[MIT](LICENSE)
