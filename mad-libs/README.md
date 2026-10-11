# Mad Libs

All 68 themes use exactly twelve ordinary word prompts: nouns, verbs,
adjectives, adverbs, names, places, and familiar categories such as food.
The story supplies its own characters and plot. Each story has 126-150 words
with one-word answers, twelve short sentences, and 18-24 blanks. Every answer
appears, and no sentence is just a long fixed passage.

Ideas offer examples for each word category. Fill Empty keeps words already
entered. The title is optional. Answers are escaped before display, and long
words wrap on narrow screens.

Story ordering and the original twelve answer positions are unchanged.
Version 3 saves tag their story format. Completed version 1 and 2 saves retain
their original template, answers, and optional title. Unfinished old entries
and Change Words move the first twelve answers into the longer current story,
with all original answers retained as a backup in the save. Shared-room control
includes the format, answers, and title.

Run `node tools/test-mad-libs.mjs` for story coverage and prose checks,
`node tools/test-mad-libs-browser.mjs` for all-story rendering, mobile layout,
Ideas, editing, escaping and actual reloads, and
`node tools/test-shared-lobby.mjs --case=mad-libs` for two-browser shared play.

## Capitalization and read aloud

Ordinary answers render in lowercase within sentences; sentence starts and
quoted remarks are capitalized. Names and places retain entered spelling.
Character descriptions such as "your uncle" follow ordinary sentence case.
The pronoun I stays capitalized. Raw answers remain unchanged in inputs and
saves, including old saves, and HTML escaping applies after formatting.

Read It Aloud uses `../arcade-speech.js`: the existing Android wrapper's native
speech bridge is preferred, with browser speech synthesis otherwise. Browser
speech is chunked with actual completion events. Stop, changing screens,
shell Home/pause and hiding the document cancel speech and stale callbacks.
The existing APK can read a normal story in one request but cannot report
completion; Stop remains available until stopped or navigation. Its native
limit is 2,000 characters. Longer stories show a clear shorten/open-browser
message instead of being cut off. Missing native voices show a bounded error.
No new APK is required for normal story narration.

Run `npm run test:mad-libs` and `npm run test:narration` for these regressions.
