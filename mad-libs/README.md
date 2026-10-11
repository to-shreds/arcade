# Mad Libs

All 68 themes now have shorter plots around familiar activities: lunch, trips,
parties, school, games, shopping, and getting home. Favorite characters and
fantasy themes remain, with practical goals and small problems to solve.

Each story has 18 answers, including the main character, helper, goal,
solution, reward, and last line. Every sentence contains a blank, and fixed
passages stay short. Ideas for the new story choices are specific to the theme;
Fill Empty keeps words the player has already entered. The title is optional.
This remains a fill-in-the-blanks game, without a whole-story editor.

Story ordering and the original twelve answer positions are unchanged.
Version 1 saves retain those answers; the six new fields start empty in a
word-entry save, or receive Ideas when an old completed story is restored.
Version 2 saves also retain the optional title. Local Arcade autosave and
shared-room control both include the updated answers and title. Answers are
escaped before display. Long words wrap on narrow screens.

Run `node tools/test-mad-libs.mjs` for story coverage and short-prose checks,
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
