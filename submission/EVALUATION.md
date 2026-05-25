# DelOS evaluation · website + Chrome extension · start to end

What the judge will actually see when they click each surface. Written
to call out the killer moments so the Loom script lands exactly on
those beats.

No em-dashes anywhere. Plain numbers and verbs.

## 1. Website · https://delrio.vercel.app

### Landing page
You arrive on a polished marquee with four live counters (agents,
requests, tokens, dollars) and three big calls to action. ENTER OS,
JUDGE DEMO, GitHub. Counters animate so the page feels alive even on
first paint.

### OS desktop · /os?guest=1
Boots in under two seconds on a fast connection. Pixel wallpaper,
yellow brand color. Top bar with the connection pill, JUDGE DEMO,
counter strip, settings cog. Dock at the bottom with twenty four
apps. ShortcutsSticky panel on the lower left listing every keyboard
shortcut so the user never feels lost.

### Killer apps to demo on the website (rank ordered)

1. **JUDGE DEMO pill** in the top bar. Auto runs the sixty second
   narrated walkthrough across Del Assistant, Notion, GitHub list,
   VibeCode build, and Memory recall. Card explains every step in
   plain English.

2. **VibeCode + DelCode (code app builder).** Type "Investor CRM with
   kanban and warm intro graph". Planner picks a domain cockpit. Files
   stream into the IDE on the right with green checks as each file
   lands. Export the whole project as a zip or a single HTML file.

3. **Memory Browser.** Twelve seed entries plus everything written by
   the demo. Source badges (voice-memory, codegen, arena, calendar,
   schedule, browser-search, user-fact, assistant). Click any row to
   copy. Delete with the X. Full text search at the top.

4. **Arena.** Same prompt fans out to five LLMs in parallel. Judge
   scores each, picks the winner, writes the verdict to memory with
   an arena source tag.

5. **Voice Agent (v10 hardened).** Big circular mic. Live audio level
   ring that expands with your voice so the user sees it is hot from
   two meters away. Continuous mode by default. maxAlternatives three
   for accent recovery. Auto restart loop up to thirty times across a
   session. Says "build me a stopwatch", a stopwatch lands. Says "run
   cohort on the best agent framework", arena fires.

6. **Schedule, Calendar, Notification Center.** Real time tickers
   firing scheduled actions, calendar events, reminder pops.

### Less obvious wins on the website
- Window resize handles live outside the content area so the
  scrollbar is reachable. SE corner has a chunky grip.
- Maximize self heals to the viewport even if bounds prop is stale.
- ErrorBoundary wraps every app so a single crash never breaks the OS.
- Yellow scrollbar that is actually visible against the dark surface.
- Cursor uses a custom pixel SVG so the whole desktop reads as one
  intentional product.

## 2. Chrome extension · /chrome-ext (v3.1.0)

### Install path
chrome://extensions, Developer Mode on, Load Unpacked, point at the
chrome-ext folder. The pixel D logo appears as the toolbar icon.
Click it. The side panel opens with the same logo in the header.

Three tabs only. Mission, Cohort, Memory.

### Killer features to demo on the extension (rank ordered)

1. **Perplexity style in page overlay during Mission run.** This is
   the headline. When the agent runs a multi step task on the current
   page, the extension injects an overlay layer into the page that:
   - shows a floating banner top right that says "DelOS · 1 of 6 ·
     navigate" then "2 of 6 click" then "done"
   - pulses a colored outline around the exact element being clicked
     or filled (blue for click, orange for fill, red for destructive,
     green for navigate)
   - persists across full page navigations because the script re mounts
     on tabs.onUpdated
   This is what Comet and Claude in Chrome do. We do the same.

2. **Mission tab takes any complex task and runs it endlessly.** Type
   "research the top three wireless earbuds under two hundred dollars
   for twenty twenty five and rank them". The agent plans, navigates,
   scrolls, extracts, summarizes. When the first plan finishes, chain
   re plan kicks in for up to three rounds until the goal is hit. Then
   the conversation row at the bottom is enabled. Type a follow up
   like "what about the noise cancellation on the second one". If the
   follow up implies a browser action ("open", "find", "click") the
   agent re engages the browser. If it is a pure text question, the
   answer comes back instantly using the prior context.

3. **Live screenshot embedding.** After every mutating step the
   extension calls chrome.tabs.captureVisibleTab and embeds the
   screenshot inline in the Mission log so the user has a visual
   trace of what the agent did. JPEG at sixty quality, max two hundred
   pixels tall.

4. **Memory tab cross device synced.** Same tenant id as the website.
   Search, save, delete, copy. Auto refresh every thirty seconds when
   the tab is visible. Every Mission run and every Cohort verdict
   auto saves with a typed source badge.

5. **Cohort racing in the extension.** Same five model cohort as the
   website. SSE streaming. Spawn lines for each model, finish lines
   with timings, disagreement percentage, judge verdict, merged answer.
   Verdict auto saves to memory.

6. **Connection robustness.** Health probe retries three times with
   light backoff before the pill flips to offline. Click the pill to
   force recheck. Title attribute shows last checked time. Single
   transient cold lambda no longer trips the red state.

### Less obvious wins on the extension
- chrome:// and edge:// URLs are now a muted skip with a friendly
  hint instead of a red Cannot access error.
- Voice tab removed entirely. Cleaner UI, no more accidental TTS in
  demos.
- D logo image referenced in manifest icons 16, 32, 48, 128, in the
  toolbar action, in the sidepanel header, and in the settings modal.
- Browse URL normalization. "github" becomes "https://github.com" on
  the server side so the navigate step never dies on a bare word.
- Fields truncated client side before serialize so a long selection
  on a long page never blows up the schema.

## 3. End to end story arc the judge sees

1. Open delrio.vercel.app/os, press JUDGE DEMO, sixty seconds of
   narrated agent action.
2. Open Memory app. See the demo's writes already saved with source
   badges.
3. Install Chrome extension. Open the side panel.
4. Type "summarize this page" in Mission. Watch the colored highlight
   pulse on the target element. Watch the floating banner narrate.
5. Watch the summary land. The Mission tab shows the screenshot.
6. Type a follow up. Get a contextual answer in the same panel.
7. Back to delrio.vercel.app/os, open Memory app. The mission run
   from the extension is right there at the top with a
   browser-search source badge.

That last beat is the closer. Memory updates live across both surfaces
under the same tenant id. No login. No card. No mocked anything.
