# Upwords

A two-player stacking word game for Arcade, with a computer opponent, local
pass-and-play, and private Internet or Nearby rooms. Use the existing Arcade
theme, home navigation, saved-game interface and turn alerts.

## Playing

Drag a tile from your rack to an empty board square or a different existing
letter. You can also tap a tile and then a square. Drag an unplayed gold tile
to reposition it or return it to the rack. Drag between rack slots to change
their display order; this never changes the physical rack or consumes a turn.
All tiles placed in one turn belong in one row or column. Tap an unplayed tile
again to take it back, or use Undo/Clear. The preview checks every changed word
and shows the points before Play commits the turn. Shuffle changes only the
display order of the rack. The board and move controls fit the viewport. Scores and actions are compact;
persistent rules and empty preview text do not take up board space. Rules
remain under Help, and Zoom is a small header button. Check a word and Recent turns open as overlays. Zoom optionally enlarges the board within a scrollable area.

The board has 10 rows and 10 columns. Each player holds seven tiles from the
100-tile bag. Qu is one tile. The opening uses at least two tiles and covers one
of the four center squares. Later plays connect to the existing board. Stacks
can reach five tiles; identical letters cannot cover each other. A move must
leave at least one original visible tile in every old word it changes.

Each flat word scores two points per tile, plus two for a Qu tile. A word with
any stacked tile instead scores the total height of all its stacks. Each
new or changed word scores independently. Using seven rack tiles adds twenty
points. A single S cannot merely make an existing word plural, unless it also
creates a perpendicular word. ESDB inflection metadata distinguishes this
from nonplural extensions such as HI becoming HIS.

Swap 1 exchanges one tile and ends the turn; the replacement is drawn before
the old tile returns to the bag. Pass keeps the rack. Two consecutive passes
end the game. Emptying a rack when the bag is empty also ends the game. Final
scores deduct five points per unused tile, once.

Rules reference: [Hasbro's 100-tile Upwords instructions](https://instructions.hasbro.com/api/download/14577_en-us_upwords-game.pdf).
Tile distribution reference: [the licensed Upwords app FAQ](https://www.upwords-app.com/faq.html).

## Arcade English word list

The game bundles 127,360 words from the English Speller Database (ESDB,
formerly SCOWL), size 80, American spelling, normal variants. It uses listed
inflections rather than guessing plurals, tenses or suffixes. Ten reviewed standalone two-letter words, including UN, supplement the ESDB base; the complete 107-word short-word audit and reference are recorded in the metadata. The build filters
abbreviations, fragments, capitalized entries, punctuation and spaces. It also
excludes Moby-only and acronym source rows that admitted unsuitable entries
despite part-of-speech filtering. Accents use the source's own normalization.

Words contain 2-11 letters and must fit ten squares with Qu as a single tile.
This is Arcade's fixed English list, not an official Upwords or Scrabble
tournament lexicon. A valid everyday word can still be missing, and a broad
dictionary contains some unfamiliar words. The in-game checker gives the same
answer as the move validator. No API, external lookup, account or key is used.

`dictionary-source.json` records the exact source revision, generation options,
word and plural-metadata hashes, count and policy. `LICENSE.dictionary.txt`
preserves redistribution notices. `tools/build-upwords-dictionary.py` regenerates
these files from the pinned ESDB checkout and supports `--check`. The dictionary
ID covers both the words and the plural metadata. Both authorities and every
client require that ID; there are no unagreed additions during a match.

Source: [ESDB at the pinned revision](https://github.com/en-wl/wordlist/tree/1e5b7d3a72f47a71da5d28686c1dd4b397178485).

## State, privacy and persistence

`engine.js` owns deterministic placement, scoring, end conditions, validation
and computer moves. `cpu-worker.js` performs the computer search away from the
UI thread. CPU difficulty changes the bounded search, using the same legal-move
validator as players. It considers horizontal/vertical plays and stacking.

Local saves include the full board stacks, bag, racks, scores, next turn,
computer difficulty, rack display order and unsubmitted placements. The resolved
turn saves before the next rack appears. Reloading a hotseat save first shows
the device handoff screen, hiding both the rack and the unsubmitted draft.
Opening a room suppresses local autosave and keeps the local draft separately;
leaving restores it. Home retains the room seat for explicit resume.

`multiplayer/models/upwords-authority.js` is shared by the existing Durable
Object service and the Nearby host. Clients submit intent only. The authority
deals tiles, validates the turn and dictionary version, applies rules, calculates
scores and requires both players for a rematch. Clients cannot supply state,
scores, seeds or dictionary approvals.

Only the requesting player's rack is exposed. Public state has the opponent's
tile count and bag count, without opponent letters, bag order, seed, random
state, or exchanged tiles. Public move history contains only played tiles and
words. Nearby checkpoints retain authority state for the trusted host and are
validated before restoration. Nearby stays on its original transport and never
silently falls back to the Internet service. Room chat is bounded to keep
checkpoints below the existing Nearby size limit.

## Verification

- `npm run test:upwords`: deterministic engine, dictionary and client lifecycle checks.
- `npm test --prefix cloudflare/chess-worker`: authority, HTTP/WebSocket and Nearby regression checks.
- `npm run test:upwords:browser`: actual UI moves, saved drafts, reloads, CPU turns,
  private rooms, reconnects, layouts, keyboard, zoom and Nearby RTC.

Release results and environment limitations belong in
`docs/arcade-stress-test-2.8.0.md` and the canonical ProjectStatus entry.

## Drag behavior

`tile-drag.js` handles pointer gestures for mouse, touch and pen. A floating
letter and target highlight follow the gesture. Only rack tiles and unplayed
gold tiles can move; committed tiles remain fixed. The game applies a drop
atomically and checks existing draft occupancy, stack height and identical
letters before changing anything. Invalid or outside drops preserve the draft.
No scores, bag draws or authoritative moves are generated until Play.

Cancellation, lost capture, Escape, viewport changes, hidden pages, dialogs,
privacy handoffs and authoritative turn changes clean up a held gesture.
A gesture is tied to its actor, game position, rack and draft. The compatibility
click after dragging cannot accidentally take back a placed tile. Taps and
keyboard input remain available. Save format and multiplayer intent are unchanged.
