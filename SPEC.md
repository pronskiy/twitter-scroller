# Twitter Scroller — Technical Spec

**Author:** Roman Pronskiy · **Created:** 2026-10-08

> 📄 **This is a living document.** Status markers, decisions, and guardrail outcomes are meant to be updated as the work happens. See [How to Update This Document](#how-to-update-this-document) before editing.

### Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-10-08 | Initial spec created: epics A–C recorded as shipped, Jev backend (D) as current MVP, E–H post-MVP | Roman Pronskiy |
| 2026-10-08 | Added D2.5/D3.3: retry Jev calls after it was found overloaded (~37% failures) | Roman Pronskiy |
| 2026-10-08 | Added Epic I (structural filters: reposts, replies, duplicates) as the current focus | Roman Pronskiy |

### Status legend

🔲 Not started · 🔄 In progress · ✅ Done · ⏸️ Blocked · ❌ Cut

### Current focus

**Now on:** Epic I → Phase I1 exit guardrails — live x.com check of the repost/reply/duplicate stubs (needs a human: reload the extension). Epic D stays parked on the live Jev checks.

---

## 1. Executive summary

Twitter Scroller brings Tweetbot-style reading back to X: one shortcut scrolls the home feed down to the newest bookmarked tweet (your reading position), so you read upward into what's new. Along the way it collapses noise — tweets without links, regexp matches, and tweets an AI classifier puts under plain-language rubrics — into one-line stubs. It's a personal tool for one reader, shipped as a desktop Chrome extension and an iOS Safari userscript that share a single `config.js`. The current work moves the AI pass from a chat LLM (Grok) to TypeSafe's Jev, a decision model that returns typed, calibrated answers instead of text.

---

## 2. Technical decisions

| Area | Decision | Rationale |
|------|----------|-----------|
| Language | Vanilla JS, no dependencies, no bundler | Tiny codebase; load-unpacked and a userscript need no build |
| Runtimes | Chrome MV3 extension (desktop) + Userscripts-app userscript (iOS Safari) | The native X app can't be scripted; Safari + userscript is the only iOS route |
| Settings | One gitignored `config.js` (`globalThis.SKRL_CONFIG`), no options page, no `chrome.storage` | Single source of truth for both runtimes; `sync-ios.sh` bakes it into the userscript |
| Reading position | X's own bookmarks; stop at the first `removeBookmark` button scrolling down | Persists server-side across devices with no extra account or storage |
| Scrolling | Poll loop that checks for the bookmark before every ~0.85-viewport step | Never jumps past the bookmark; memory-safe on iOS |
| Filter pipeline | structural `hide` → `keep` → `links_only` → regexp `filters` → AI classifier | Cheap passes first so the paid pass sees only survivors; `hide` judges the kind of post, so `keep` (a topic allow-list) doesn't exempt from it |
| AI provider | OpenRouter, two backends chosen by model id: chat completions (any LLM) and the Decisions API (Jev) | Keep Grok/LLMs available as a fallback while Jev is in alpha |
| Default model | `google/gemini-3.5-flash-lite` (chat); Jev stays one `model` change away | Same verdicts as Grok 4.3 on the 20-tweet sample, ~1.6 s vs 6–22 s per batch, ~1/3 the cost |
| Jev request shape | One request per tweet; `state` = tweet text; one `choice` question over rubrics + reserved `_none` | The documented way to use the API; avoids cross-talk between tweets in a batch |
| Hiding rule (Jev) | Hide when the top choice is a rubric label and its probability ≥ `threshold` (default 0.7); stub shows the percentage | Turns calibrated output into a tunable precision knob |
| Verdict cache | `localStorage` `ts_llm_verdicts` (≤1000), invalidated by a signature of format version + model + rubrics + threshold | Each tweet is classified once; config changes take effect on reload |
| Failure mode | Fail open everywhere: errors leave tweets visible and uncached so they retry | A broken classifier must never hide the feed |

---

## 3. Architecture overview

```
 Desktop (Chrome MV3)
 ┌───────────────────────────┐  {type:'classify', tweets:[{id,text}]}  ┌──────────────────────────┐
 │ content script            │ ──────────────────────────────────────▶ │ background.js            │
 │ config.js + script.js     │ ◀────────────────────────────────────── │ classify() → dispatch    │
 │ scroll loop, filters,     │      {verdicts:{id:{label,p}|null}}     │  ├ classifyChat()  ──────┼──▶ POST /api/v1/chat/completions
 │ stubs, verdict cache      │                                         │  └ classifyJev()   ──────┼──▶ POST /api/alpha/decisions (×N)
 └───────────────────────────┘                                         └──────────────────────────┘          (openrouter.ai)

 iOS Safari (Userscripts app)
 ┌──────────────────────────────────────────────────────────┐
 │ skrl.user.js  (config.js spliced in by sync-ios.sh)      │
 │ scroll loop + video unload, filters, stubs, cache        │
 │ classify() → classifyChat() / classifyJev()  ────────────┼──▶ GM.xmlHttpRequest → openrouter.ai (same two endpoints)
 └──────────────────────────────────────────────────────────┘

 config.js ──(manifest content_scripts + importScripts)──▶ desktop
           └─(userscript/sync-ios.sh → iCloud Userscripts)─▶ iPhone
```

A 1.5 s poller marks new `article`s and runs the filter passes. Tweets that survive the regexps queue up by permalink, and each tick flushes up to 20 of them to `classify()`. The verdicts come back keyed by permalink. They're cached and the matching articles collapse into stubs.

---

## 4. Epics

### Epic A — Scroll to reading position  ·  Shipped

**Goal:** One action scrolls the home feed to the newest bookmarked tweet and stops there reliably.
**Success metrics:** Stops on the bookmark every time it's within `MAX_SCROLL_ITERATIONS`; never flies past it.

#### Phase A1 — Core scroller

| Step | Description | Status | Notes |
|------|-------------|--------|-------|
| A1.1 | Skrl button next to the compose button; toggle scrolling | ✅ | 2023-06 |
| A1.2 | Keyboard shortcut via `chrome.commands` + in-page Ctrl+Shift+Y/Н | ✅ | e00bc14 |
| A1.3 | Stop at newest `removeBookmark` (was: last liked) | ✅ | 1c26d35 |
| A1.4 | Memory-safe poll loop: check bookmark first, step ~0.85 viewport every Nth poll | ✅ | 16b3a84, 0ec6933 |
| A1.5 | SPA re-init on return to `/home` | ✅ | 4e5b984 |

---

### Epic B — Noise filter  ·  Shipped

**Goal:** Collapse noisy tweets into clickable `filtered: <label>` stubs without ever hiding the reading-position tweet.
**Success metrics:** Bookmark tweet never hidden; any stub restores on click; AI errors never hide tweets.

#### Phase B1 — Filter passes

| Step | Description | Status | Notes |
|------|-------------|--------|-------|
| B1.1 | Regexp `filters` as `{label: regexp}` | ✅ | dda31df, ba8dff0 |
| B1.2 | LLM rubrics via OpenRouter chat completions, batched ≤20, cached | ✅ | 9a0a151 |
| B1.3 | `links_only` pass | ✅ | d0d0902 |
| B1.4 | Universal `keep` allow-list (text + hrefs) | ✅ | |

---

### Epic C — iOS userscript  ·  Shipped

**Goal:** Same behavior on iPhone Safari, from the same `config.js`.
**Success metrics:** Feature parity with desktop; Safari doesn't kill the tab while scrolling.

#### Phase C1 — Port and sync

| Step | Description | Status | Notes |
|------|-------------|--------|-------|
| C1.1 | `skrl.user.js` with scroll + video unloading | ✅ | 5463eb0 |
| C1.2 | `config.js` as single source; `sync-ios.sh` splices it at `/* __CONFIG__ */` | ✅ | a72faae |
| C1.3 | Port filters + direct OpenRouter calls via `GM.xmlHttpRequest` | ✅ | a72faae |

---

### Epic D — Jev decisions backend  ·  MVP (current)

**Goal:** The AI pass can run on Jev through OpenRouter's Decisions API in both runtimes. It hides tweets by calibrated probability. Chat-completions models keep working when selected.
**Success metrics:** Jev is selected with `model: "~typesafe/jev-latest"`. Live-feed stubs show `filtered: <label> NN%`. There are no `classify failed` warnings in normal use. Switching `model` back to `x-ai/grok-4.3` restores the old behavior. Per-tweet latency p50 < 500 ms.

#### Phase D1 — Spike

| Step | Description | Status | Notes |
|------|-------------|--------|-------|
| D1.1 | curl/Node call to `/api/alpha/decisions` with real rubrics | ✅ | Shape matches docs |
| D1.2 | Non-English (Russian) and borderline tweets | ✅ | Russian correct; borderline gives soft probabilities |

**Steps (detail):**

- **D1.1 — Decisions API call.** Deliverable: a recorded request and response for one tweet.
  ```json
  // request
  { "model": "~typesafe/jev-latest", "state": "<tweet text>",
    "questions": { "noise": { "type": "choice",
      "instructions": "Which filter rule does this X/Twitter post clearly match? When unsure, pick _none.",
      "criteria": { "politics": "...", "sports": "...", "_none": "No rule clearly matches." } } } }
  // response
  { "model": "typesafe/jev-1.13-20260917",
    "answers": { "noise": { "type": "choice", "choice": "politics",
      "probabilities": { "_none": 0, "politics": 1, "sports": 0 }, "confidence": 1 } },
    "usage": { "input_tokens": 391, "output_tokens": 43, "cost": 0.000016422 },
    "id": "gen-dec-…", "provider": "TypeSafe" }
  ```
- **D1.2 — Language and edge cases.** Deliverable: verdicts for Russian and ambiguous tweets, recorded below.

**Exit guardrails — Phase D1 → D2**

| Guardrail | Criteria (pass/fail) | Status | Actual outcome |
|-----------|----------------------|--------|----------------|
| Response shape | `answers.noise.{choice, probabilities, confidence}` present | ✅ | Exactly as documented; `jev-latest` resolves to `typesafe/jev-1.13-20260917`; pinned `typesafe/jev-1.13` also works |
| Latency | p50 < 500 ms per tweet | ✅ | 9 calls: 247–476 ms, p50 ≈ 310 ms |
| Accuracy smoke test | Clear cases labeled correctly, incl. Russian | ✅ | 5/5 clear cases correct (2 Russian). Borderline "FAA grounds Starship after senators…" → politics 0.58 / _none 0.42, so the 0.7 threshold keeps it visible |
| Cost | Negligible | ✅ | ≈ $0.000017 per tweet (~400 input tokens; output free) |

#### Phase D2 — Desktop

| Step | Description | Status | Notes |
|------|-------------|--------|-------|
| D2.1 | `isDecisionsModel()` + `classify()` dispatch in `background.js` | ✅ | `jev-router` correctly routed to chat |
| D2.2 | `classifyJev()` — per-tweet parallel requests, threshold | ✅ | 4 tweets in ~0.6 s vs ~6 s on Grok |
| D2.3 | `{label, p}` verdicts, partial-failure handling, stub percentage in `script.js` | ✅ | |
| D2.4 | `threshold` config key + cache signature v2 | ✅ | |
| D2.5 | `jevPost()` retries 429/5xx/network errors (1 s, 3 s backoff) | ✅ | 20/20 classified with 4 retries during an overload |

**Steps (detail):**

- **D2.1 — Dispatch.** Deliverable: `classify(tweets)` keeps its message contract and routes by model id. Today's body becomes `classifyChat()`, which now returns `{label, p: null}` values.
  ```js
  // Jev decision models (not typesafe/jev-router, which is a chat router).
  function isDecisionsModel(model) {
      return /^~?typesafe\/jev-(latest|\d)/.test(model || '');
  }
  ```
- **D2.2 — `classifyJev()`.** Deliverable: one POST per tweet to `https://openrouter.ai/api/alpha/decisions`, run with `Promise.allSettled`. A tweet's verdict is `{label: choice, p}` when `choice` is a rubric label and `probabilities[choice] >= threshold`, and `null` otherwise. Tweets whose requests failed are left out of `verdicts`. If every request fails, it returns `{error}`.
- **D2.3 — Content script.** Deliverable: `flushPendingBatch` caches only ids present in `response.verdicts` and unqueues the rest so they retry. `collapseArticle(article, label, p)` renders `filtered: politics 86% — show` when `p` is a number. The cache-hit path reads `.label` and `.p`.
- **D2.4 — Config.** Deliverable: `threshold` (default 0.7, Jev only). The verdict-cache signature becomes `'v2\n' + model + '\n' + JSON(rubrics) + '\n' + threshold`, which also drops the old string-valued cache entries.

**Exit guardrails — Phase D2 → D3**

| Guardrail | Criteria (pass/fail) | Status | Actual outcome |
|-----------|----------------------|--------|----------------|
| Syntax | `node --check` passes on `background.js`, `script.js` | ✅ | Both pass |
| Live feed (Jev) | Stubs with percentages appear on x.com/home; no `[Skrl] classify failed` in the service-worker console | 🔲 | |
| Chat fallback | `model: "x-ai/grok-4.3"` still collapses tweets (stubs without percentage) | 🔄 | Node harness: Grok returns `{label, p: null}` for politics/sports, null for the rest. Live feed check pending |
| Fail open | Bad key → no tweets hidden by the AI pass, warning logged | ✅ | Bad key → `{error: "OpenRouter HTTP 401"}` + `[Skrl] classify failed` warning; the content script unqueues without caching |

#### Phase D3 — iOS userscript

| Step | Description | Status | Notes |
|------|-------------|--------|-------|
| D3.1 | Port D2.1–D2.4 into `userscript/skrl.user.js` (via `gmPost()`) | ✅ | Verified via Node harness with a GM stub |
| D3.2 | `sync-ios.sh` and test on iPhone | 🔲 | |
| D3.3 | Port the retry (`jevPost()`, `gmPost()` errors carry `status`) | ✅ | 18/20 classified with 10 retries; 2 failed open |

**Steps (detail):**

- **D3.1 — Port.** Deliverable: the same dispatch, `classifyJev()`, verdict shape, and stub in the userscript. It uses ES5-style `var`/`function` to match the file. The existing `@connect openrouter.ai` already covers the new path.
- **D3.2 — Device test.** Deliverable: a synced script that runs on the phone.

**Exit guardrails — Phase D3 → D4**

| Guardrail | Criteria (pass/fail) | Status | Actual outcome |
|-----------|----------------------|--------|----------------|
| Syntax | `node --check userscript/skrl.user.js` passes | ✅ | Source and `sync-ios.sh` build output (to a scratch dir) both pass |
| Device | Jev stubs with percentages on iPhone Safari; tab stays alive through a full scroll | 🔲 | |

#### Phase D4 — Docs

| Step | Description | Status | Notes |
|------|-------------|--------|-------|
| D4.1 | `config.example.js`: both model families + `threshold` | ✅ | |
| D4.2 | `README.md` LLM section mentions Jev + threshold | ✅ | |
| D4.3 | `CLAUDE.md` LLM bullets updated | ✅ | |

**Exit guardrails — Epic D done**

| Guardrail | Criteria (pass/fail) | Status | Actual outcome |
|-----------|----------------------|--------|----------------|
| Docs match code | Every config key in `config.example.js` is read by both runtimes | ✅ | `threshold` is read by `background.js`, `script.js` (cache sig), and the userscript |
| Default switched | Local `config.js` runs `~typesafe/jev-latest` day-to-day | ⏸️ | Switched to Jev, then back to `x-ai/grok-4.3` the same day (decision 16) |

---

### Epic I — Structural filters  ·  MVP (current)

**Goal:** Hide noise by *kind* of post, with no AI cost: reposts, replies that show up in the feed, and the same link shared again.
**Success metrics:** With `hide: ["reposts", "replies", "duplicates"]`, live-feed stubs read `filtered: repost` / `reply` / `duplicate`. The bookmarked tweet and the first copy of a link stay visible. The probe feed had 20 reposts in 87 tweets (23%).

#### Phase I1 — Probe and build

| Step | Description | Status | Notes |
|------|-------------|--------|-------|
| I1.1 | DOM probe of the live feed for markers | ✅ | 87 tweets, see below |
| I1.2 | `reposts`: `socialContext` text ending in "reposted" | ✅ | |
| I1.3 | `replies`: "Replying to" line outside the tweet text | ✅ | |
| I1.4 | `duplicates`: link-card text already seen this session on another permalink | ✅ | First copy survives re-renders |
| I1.5 | Same pass in the userscript | ✅ | |
| I1.6 | `hide` documented in `config.example.js`, README, CLAUDE.md | ✅ | |
| I1.7 | `ads`: promoted posts | ❌ | Probe found none (`placementTracking` = video players only) |
| I1.8 | `suggestions`: "Who to follow" and topic modules | ❌ | Probe found no rows that weren't tweets |

**Steps (detail):**

- **I1.1 — Probe.** Deliverable: marker counts from the user's real feed (a console snippet that collected while scrolling for 90 s).
  ```json
  { "cells": 87, "articles": 87, "other": [], "ads": [], "placement": { "video": 5, "noVideo": 0 },
    "social": { "reposted": 20 }, "replies": 2, "cards": 8, "duplicatedCards": 1, "quotes": 14 }
  ```
- **I1.2–I1.5 — `structuralMatch(article)`.** Deliverable: returns `'repost' | 'reply' | 'duplicate' | null`. It runs in the poller right after the `removeBookmark` exemption and before `isKept()`, and collapses to a stub.
  ```js
  const hideKinds = new Set(CONFIG.hide || []);
  const seenCards = {};   // card text -> permalink of the first tweet showing it
  ```

**Exit guardrails — Phase I1 done**

| Guardrail | Criteria (pass/fail) | Status | Actual outcome |
|-----------|----------------------|--------|----------------|
| Syntax | `node --check` on both runtimes | ✅ | Pass |
| Runtime load + logic | Both runtimes loaded in jsdom against fake X markup: repost, reply, text starting "Replying to", duplicate card + re-render, bookmarked repost, "Pinned" context | ✅ | All as expected. Caught a missing-semicolon bug in `script.js` (`{}` followed by an IIFE) that `node --check` missed. Fixed |
| Live feed | Repost/reply/duplicate stubs appear on x.com/home; bookmark tweet visible | 🔲 | |

---

### Epic E — Shared core module  ·  Post-MVP

**Goal:** Stop maintaining the filter and classifier logic twice (`script.js`/`background.js` and `skrl.user.js`).
**Success metrics:** The filter pipeline and both classifier backends live in one source file. A change there reaches both runtimes with no hand-porting.

#### Phase E1 — Extract and build

| Step | Description | Status | Notes |
|------|-------------|--------|-------|
| E1.1 | Move pure logic (filters, keep, verdict mapping, request builders) into `core.js` | 🔲 | |
| E1.2 | Load it as a content script/`importScripts` on desktop; splice it in via `sync-ios.sh` like `config.js` | 🔲 | |
| E1.3 | Delete the duplicates | 🔲 | |

Risks: the transport differs between runtimes (`fetch` vs `GM.xmlHttpRequest`), so inject it rather than share it. Code style also differs (`const`/arrow functions vs ES5).

---

### Epic F — Automated tests  ·  Post-MVP

**Goal:** Catch regressions in the pure logic without opening x.com.
**Success metrics:** `node --test` covers filter compile/match, `keep`, Jev response → verdict mapping, and the chat JSON parse. It runs in under 1 s and needs no dependencies.

#### Phase F1 — Harness

| Step | Description | Status | Notes |
|------|-------------|--------|-------|
| F1.1 | `node:test` suite importing `core.js` (after Epic E) | 🔲 | |
| F1.2 | Fixtures from the recorded D1 responses | 🔲 | |

---

### Epic G — Selector health check  ·  Post-MVP

**Goal:** When X changes its DOM, say so visibly instead of silently doing nothing.
**Success metrics:** If the compose anchor, `tweetText`, or the bookmark buttons aren't found on `/home` within N seconds, the Skrl button shows a warning state and a console line naming the missing selector.

#### Phase G1 — Detect and surface

| Step | Description | Status | Notes |
|------|-------------|--------|-------|
| G1.1 | Probe each selector on `/home` after load | 🔲 | |
| G1.2 | Warning badge on Skrl + console diagnostics | 🔲 | |

Risk: an empty or slow-loading feed could look like broken selectors, so it needs a grace period.

---

### Epic H — Filter stats / debug view  ·  Post-MVP

**Goal:** See what the filters are doing so rubrics and the threshold can be tuned.
**Success metrics:** Per-session counts for each pass and label. One place lists the hidden tweets with their label and probability, so false positives can be spotted.

#### Phase H1 — Counters and list

| Step | Description | Status | Notes |
|------|-------------|--------|-------|
| H1.1 | Count collapses by pass/label | 🔲 | |
| H1.2 | Debug panel (or long-press on Skrl) listing hidden tweets | 🔲 | |

---

## 5. Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| X changes DOM selectors | High | High | Selectors centralized in CLAUDE.md; Epic G makes breakage visible |
| Decisions API is `/api/alpha` and may change shape or path | Med | High | Fail open; chat backend still selectable by `model`; D1 fixtures document the shape seen |
| `~typesafe/jev-latest` drifts to a new release under a warm cache | Med | Low | Cache capped at 1000; pin `typesafe/jev-1.13` if verdicts get worse |
| Jev is weaker on non-English tweets | Med | Med | D1 Russian check passed; regexp `ru politics` filter stays as a first pass |
| Rate limits when a long feed loads (≤20 req per 1.5 s tick) | Low | Low | ~800 req/min worst case, under the ~1200/min limit; failures retry later |
| Jev capacity: 10 of 27 calls failed with 503/504/529 (`system_overloaded`) on 2026-10-08 | High | Med | Two retries with backoff per tweet; still-failing tweets stay visible (fail open). Switch `model` to a chat LLM if it persists |
| API key in `config.js` travels via iCloud on iOS | Low | Med | Documented in README; key is gitignored |

---

## 6. Decision log

| # | Date | Decision | Context | Decided by |
|---|------|----------|---------|------------|
| 1 | 2026-06-12 | Stop at the newest bookmarked tweet instead of the last liked one | Bookmarks are a deliberate, private marker; likes are noisy | Roman Pronskiy |
| 2 | 2026-06-12 | Add an LLM noise filter via OpenRouter chat completions | Regexps can't express topics like "geopolitics not related to tech" | Roman Pronskiy |
| 3 | 2026-06-13 | Ship an iOS userscript instead of an app | The native X app can't be scripted; Safari + the Userscripts app can | Roman Pronskiy |
| 4 | 2026-06-14 | `config.js` is the single settings source; drop the options page and `chrome.storage` | One file for both runtimes; settings sync to iOS via iCloud | Roman Pronskiy |
| 5 | 2026-06-14 | Filters and rubrics are `{label: …}` objects | The stub shows which rule hid the tweet | Roman Pronskiy |
| 6 | 2026-10-08 | Write SPEC.md for the whole project; A–C recorded as shipped, Jev as current epic | Spec-driven workflow going forward | Roman Pronskiy |
| 7 | 2026-10-08 | Keep both AI backends, selected by model id | Jev is in alpha; chat LLMs stay as a fallback | Roman Pronskiy |
| 8 | 2026-10-08 | Default model `~typesafe/jev-latest` (alias, not pinned) | Get Jev improvements automatically | Roman Pronskiy |
| 9 | 2026-10-08 | One Decisions request per tweet, not one per batch | Documented usage; no cross-talk between tweets; cost negligible | Roman Pronskiy |
| 10 | 2026-10-08 | Hide only when the top choice's probability ≥ `threshold` (0.7); show the percentage on the stub | Use Jev's calibrated output as a precision knob | Roman Pronskiy |
| 11 | 2026-10-08 | Repo stays private; no `SPEC.private.md` | Nothing to keep out of a public repo | Roman Pronskiy |
| 12 | 2026-10-08 | Post-MVP order: shared core → tests → selector health check → stats | Tests need the shared core to import from | Roman Pronskiy |
| 13 | 2026-10-08 | Bump `manifest.json` version and userscript `@version` with every commit (0.2 / 1.2.0 for the Jev backend) | Makes each change visible as a new version in Chrome and the Userscripts app | Roman Pronskiy |
| 14 | 2026-10-08 | Feed focus is AI and tech in general, not PHP: `php` dropped from `keep`; `off-topic` (not AI/tech) and `engagement-bait` rubrics enabled | User's interests shifted; on a 20-tweet sample this hides 10 and keeps every AI/tech tweet | Roman Pronskiy |
| 15 | 2026-10-08 | Retry Jev calls on 429/5xx/network errors (1 s, then 3 s) before failing open | Without retries, failed tweets stayed unclassified until X re-rendered them | Roman Pronskiy |
| 16 | 2026-10-08 | Switch the default model back to `x-ai/grok-4.3`; keep the Jev backend in the code | Jev was overloaded at the time (risk register). On the 20-tweet sample, Grok hid 11 and kept every AI/tech tweet | Roman Pronskiy |
| 17 | 2026-10-08 | Switch the default model to `google/gemini-3.5-flash-lite` | Benchmark of 8 cheap models on the 20-tweet sample: verdicts identical to Grok 4.3 in 2 runs, 1.5–1.6 s per batch, ~$0.05 per 1,000 tweets. Newer Gemini 3.8 Flash was slower (12–23 s) and pricier; `openai/gpt-6-luna` was cheapest (~$0.015/1k) but not faster | Roman Pronskiy |
| 18 | 2026-10-08 | Add structural `hide` filters (reposts, replies, duplicate link cards); they run before `keep` | User picked "reposts, replies, dupes" and "ads & X modules" as remaining noise. Markers confirmed by a live DOM probe (87 tweets: 20 reposts, 2 replies, 1 duplicated card) | Roman Pronskiy |
| 19 | 2026-10-08 | Don't build `ads` / `suggestions` filters | The probe found no ads and no suggestion modules in the user's feed, so there was no marker to build on | Roman Pronskiy |

---

## 7. Open questions

- [ ] Is the `/api/alpha/decisions` endpoint stable enough to depend on, or will it move to `/api/v1/…`?
- [ ] Should hiding use `probabilities[choice]` or `confidence`? (`confidence` was lower than the probability on the borderline case: 0.36 vs 0.58.)
- [ ] Is 0.7 the right default threshold after a week of real use?
- [ ] Does `~typesafe/jev-latest` change verdicts noticeably between releases?
- [ ] Are quote tweets (14 of 87 in the probe) worth a structural filter, or does the AI pass handle them?

---

## How to Update This Document

This spec is the source of truth for the build. Keep it current as work happens:

- **Status markers.** Update a step's status in its tracker table as you go: 🔲 → 🔄 → ✅. Use ⏸️ for blocked (note why in Notes) and ❌ for cut (leave the row; the strikethrough of history is useful).
- **Current focus.** Keep the pointer at the top aimed at the next actionable 🔲 step. Update it the moment you finish a step or cross a phase boundary — a stale pointer is worse than none, since it sends the next reader to the wrong place.
- **Guardrails.** When you hit a phase boundary, fill the **Actual outcome** column with what really happened and set the guardrail status. Don't advance to the next phase until its entry guardrails pass — or log a decision explaining why you're proceeding anyway.
- **Decisions.** Any non-trivial choice made during the build gets a new row in the Decision Log (§6). It's append-only — reversals are new rows, not edits. If the choice changes the architecture, also update the Technical Decisions snapshot (§2).
- **Spec changes.** Structural changes (new epic, re-scoped phase) get a Changelog row at the top. Keep the executive summary honest if the project's shape shifts.
- **Open questions.** When one resolves, strike it from §7 and log the decision in §6.
