# Arcade mouse and touch audit

## What was exercised

The audit started from Arcade 2.13.6, main at `f37d6c1f84391df920fddd14030f1f9daf31546a`. The existing repeat/rotate/save suite passed all 52 enabled activities in Chromium 158.0.8127.0 on Linux. It sent 178 counted mouse actions across 43 entries, plus some uncounted start/mode clicks. It verified 36 save reloads. The action counts in the table reflect executed probes, including some that only checked a control or rejected input. They do not establish comprehensive game or gesture coverage.

The initial pointer tests ran at 768×1024 with a Chromium touch-capable context using Playwright mouse clicks and drags. The suite subsequently changed viewports to 320×568, 844×390 and 768×1024, inspected geometry and assets, and checked available saves. Those viewport changes did not repeat each gameplay interaction. The focused tests below use actual mouse events at 1280×800. Minesweeper uses touch events at 390×844. Monster Forge and Comic Library exercised actual UI across four sizes. WebView2 and physical hardware are still untested.

Baseline reproduction and focused verification:

- Minesweeper before the fix treated a right-click on a hidden cell as a normal reveal. Open Easy and right-click the first cell before the first reveal. The UI should flag the cell while leaving the minefield unplaced. The new test failed this assertion on the baseline and passed after the fix. Right-click toggles a flag, a short left-click reveals, a left-button hold or touch hold still flags, and a drag canceled by distance or lost pointer capture does not reveal. A middle-click does nothing.
- Mini Golf: drag the aim joystick, set power using the range slider, then shoot. The stroke count increases.
- Simon: watch the first sequence and click the matching pad. The game advances to level two.
- Sorry: use the board’s Draw button and confirm the deck loses one card.
- Music Maker: press and release one pad with the mouse and confirm both visual states. A single mouse still cannot play simultaneous notes from both sets of pads. Use touchscreen for simultaneous notes. Audio output, a keyboard chord alternative and microphone behavior remain untested here.
- Train Trouble: send the first engine, verify the simulation runs and click Brake. The engine records the brake command.
- Retro Vault: launch Snake with a mouse, use the on-screen Down control to change direction and open and resume its menu. The other 25 games still need representative mouse gameplay tests.
- Monopoly: click to start and roll, then confirm animated movement changes the game phase and player positions.
- Arcade Chat: the local Worker fixture passed file upload, preview and removal, image viewer and focus restore, paste/drop, reconnect and layout checks. It used no production account or room.
- Upwords: the local Worker fixture passed the same drag, cancel, draft rearrangement, stacking and reload scenarios with real mouse and touch input. Internet fixture play also passed. The real Nearby case was blocked by loopback-only networking.
- Mouse Lab: ten complete desktop mouse exercises, touch and keyboard alternatives, correct and wrong drops, trace recovery, wheel containment, reset and reload. Touch tests used 320×568, including a drag, trace and swipe, and layout also passed at 568×320. Browser request monitoring found zero external requests in the direct activity. A separate fresh install verified all 508 manifest entries, disabled browser networking, opened Mouse Lab through the catalog, completed a lesson, returned Home and reopened the activity with its progress intact.

## Per-activity coverage

| Activity ID | Mouse action checked | Status and follow-up |
| --- | --- | --- |
| `adventure` | 4 story choices with pagination | Reading path sampled. Verify wheel, selection and narrow touch controls. |
| `balloons` | 4 pointer sweeps on game canvas | Smoke only. Assert a balloon pops and retest touch. |
| `blackjack` | 5 bet/deal inputs | Mouse bet/deal sampled. Existing local UI check covered desktop two-player advance and 320×568 Deal. Test additional gameplay actions. |
| `bowling` | 1 roll | Mouse roll and 320×568 layout checked. Verify aiming/drag and touch. |
| `bounce-boxes` | 4 pointer sweeps on canvas | Smoke only. Test exact aim/release, secondary input and touch. |
| `bug-squish` | 4 pointer sweeps on canvas | Smoke only. Test a successful hit, mode-specific inputs and two players. |
| `build-my-joke` | 12 random, reveal, favorite and close actions | Partial. Test narrow touch and favorite reopening. |
| `chat-room` | Composer, upload, drag and drop, and viewer in the local Worker suite | Focused desktop/mobile layouts and attachment flow passed. Excluded from the default Windows child policy. |
| `checkers` | 4 board clicks | Smoke plus short-landscape board geometry. Prove legal move/jump and touch. |
| `chess` | 6 square clicks | Smoke plus short-landscape geometry. Prove move, drag/tap alternatives and promotion. |
| `codebreaking` | 4 symbol-palette clicks | Partial. Verify complete puzzle and touch. |
| `comic-reader` | Mouse file choice, CBZ/PDF paging, bookmarks and local/offline library flows | Focused Chromium suite passed at 1280×800, 844×390, 390×844 and 320×568. Verify wheel and pinch alternatives on a physical device. |
| `contraption-maker` | 4 Drop actions | Partial. Verify component placing, moving and deleting with mouse and touch. |
| `dots` | 4 canvas board clicks | Smoke only. Assert line drawing and box award; test precision on touch. |
| `firefighter-frenzy` | 4 pointer sweeps on canvas | Smoke only. Test spray, aim, hold and two-player alternatives. |
| `guess-who` | 3 controls, including invalid short join-code validation | Local forms only. Verify live selection, elimination and question flow with a test room. |
| `hangman` | 4 on-screen letter presses | Partial. Test physical keys and wheel behavior on long panels. |
| `insultinator` | 4 Generate actions | Partial. Test custom input, save and touch controls. |
| `jigsaw` | 4 pointer sweeps on puzzle canvas | Smoke only. Assert one drag starts from its tray piece and snaps correctly on mouse and touch. |
| `mad-libs` | Random story, fill answers, make story | Partial. Test selection, scroll and touch text entry. |
| `make-10` | 4 hint inputs | Partial and responsive geometry checked. Test card placement and touch. |
| `math` | 4 number inputs | Partial and short-landscape geometry checked. Test complete question and touch. |
| `maze` | 4 pointer sweeps on canvas | Smoke plus responsive geometry. Assert maze navigation by mouse, touch and keyboard. |
| `memory` | 4 card clicks | Partial. Verify pair resolution and keyboard focus. |
| `minesweeper` | 4 grid clicks in baseline plus a dedicated mouse and touch suite | Focused pass after fixing right-click and drag cancellation. Check Windows event routing and board controls during real desktop testing. |
| `mini-golf` | Joystick drag, slider and shot | Focused pass at 1280×800. Test canvas shot, slider and on-device touch in short landscape. |
| `monopoly` | Mouse opening roll changed the board and player state | Focused pass at 1280×800. Remaining modes and trade/management controls need input coverage. |
| `monster-dentist` | 4 pointer sweeps on canvas | Smoke only. Test tool pickup, use and any two-player alternatives. |
| `monster-forge` | Mouse drawing and dragging, device-emulated touch drawing, transforms, storage and export | Full focused suite passed at 1280×800, 832×384, 390×844 and 320×568. Verify physical-device gestures and Windows file policy. |
| `music-maker` | Mouse press and release on one pad | Focused visual pass. Simultaneous desktop notes, audio and microphone unverified. |
| `orb-slicer` | 4 pointer sweeps on canvas | Smoke only. Assert a successful slice and verify continuous swipes. |
| `paint-lab` | 4 pointer sweeps on canvas | Smoke only. Verify stroke, tools, undo and correct touch cancellation. |
| `patterns` | 4 pattern choices | Partial. Test completed pattern and touch. |
| `regex-lab` | 6 select, check and advance actions | Partial. Verify all puzzle families and mobile controls. |
| `retro-vault` | Snake direction control, menu and resume | Focused pass in one cabinet. Test the remaining 25 cabinets and their mouse alternatives. |
| `robot-workshop` | 3 input-port, output-port and run actions | Partial gameplay fixture check. Test real gate drag, scrolling and touch alternatives. |
| `shuffleboard` | 4 pointer sweeps on canvas | Smoke only. Assert launch/score and test touch precision. |
| `silly-face-lab` | 4 surprise-face actions | Partial. Test size, drag/drawing and touch. |
| `simon` | Correct mouse pad press advances the pattern | Focused pass at 1280×800. Test touch progression too. |
| `solitaire` | 4 Klondike draw actions | Partial. Verify moving, stacking and other rule sets on mouse and touch. |
| `sorry` | Board click draws a card | Focused pass at 1280×800. Test pawns, choices, keyboard and touch. |
| `spelling` | 4 on-screen letter presses | Partial. Test physical key input and touch. |
| `tanks` | Hotseat setup and fire | Partial. Test aiming, power adjustment, overlays, all gestures and touch. |
| `tic-tac-toe` | 4 grid clicks | Partial and short-landscape geometry checked. Test complete match, alternative input and touch. |
| `time` | 4 keypad presses | Partial and 320×568 keypad geometry checked. Verify other game modes and touch. |
| `trail` | 4 pointer sweeps on canvas | Smoke only. Assert the stroke, continuity and touch behavior. |
| `train-trouble` | 6 campaign actions plus focused Send and Brake assertions | Focused pass at 1280×800. Check trolley choices, routing and touch. The historical PWA crash-video failure is a separate baseline issue. |
| `trivia` | 4 answer picks | Partial. Test young-kid mode and accessible selection. |
| `tv` | 4 Movie/Show tab switches | Tabs only. Actual playback requires authorized online access. Excluded from the default Windows child policy. |
| `two-truths` | 4 claim picks | Partial. Test feedback, next question and touch. |
| `typing` | 4 on-screen letter presses | Existing local UI suite also passed physical typing, cursor editing, emoji deletion and reload. Test Windows native keyboard and touch on hardware. |
| `upwords` | Real mouse and touch drag, cancellation, repositioning and stacking | Focused input and reload passed. Real Nearby was blocked by loopback-only networking. |
| `mouse-lab` | All ten exercises with real mouse events | Focused pass with touch and keyboard checks. Test Windows wrapper and hardware. |
| `encyclopedia`, `dictionary` | New reference activities, outside the 52-entry baseline | See the reference browser test for controls exercised. Add Windows child-mode checks once running on hardware. |

## Rerun

Set `ARCADE_CHROMIUM` if using a Chromium executable outside Playwright’s installation.

```sh
ARCADE_STRESS_MODE=repeat-rotate-save ARCADE_STRESS_OUT=../test-results/mouse-preliminary/ node tools/test-project-stress-browser.mjs
node tools/test-mouse-lab-browser.mjs
node tools/test-mouse-lab-offline.mjs
node tools/test-mouse-compat-browser.mjs
node tools/test-local-ui-browser.mjs
node tools/test-monster-forge-browser.mjs
node tools/test-comic-library-browser.mjs
node tools/test-chat-browser.mjs
node tools/test-upwords-browser.mjs
```

Continue from the incomplete gameplay paths in the table. Start Windows verification with the child-mode allowlist and native Exit, then repeat actual mouse and keyboard operations across every allowed activity. For touchscreen parity, verify physical touch on drag, canvas and gesture-heavy titles first.
