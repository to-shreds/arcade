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
