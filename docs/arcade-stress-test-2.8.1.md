# Arcade 2.8.1 verification

This update fixes Upwords' omitted standalone two-letter words and the play
screen's vertical overflow. The fixed list contains 127,360 entries, including
all 107 reviewed two-letter words. Ten entries were missing from the ESDB base:
AL, AR, AY, BO, DA, ES, HM, OK, PO and UN. The generator records the reference
and includes these entries in the word hash and multiplayer dictionary ID.
No words from the previous release are removed. Unknown dictionary versions
remain rejected; the exact previous list can upgrade without changing tiles,
scores, RNG, drafts or history. Updated authorities reject old-client moves.

## Local checks

- 35 Upwords checks passed, including UN as an opening and the reported TON
  below GUILT position, with the GO and UN cross words.
- All 208 Worker/model/client checks and 109 shared transport checks passed.
- The added old-room test passed: a stored old dictionary room resumes, old
  clients are rejected without mutation, and an accepted action persists the
  new dictionary identity in both room and game.
- Dictionary regeneration with --check passed against the pinned ESDB source.
- Every offline runtime file passed its size and SHA-256 checks.

## Browser verification

All ten scenarios passed in dedicated preflight 40970825545 on
8bcc5bcf0d0fd601ffbe70916b717a1ca5ff859a with no JavaScript errors.
Screenshots at all five sizes and the mobile multiplayer view were visually
reviewed. The final promotion changes only documentation and removes the
temporary preflight workflow; runtime files are identical. The suite exercises real
Chromium clicks, saved drafts/reloads, hidden racks, CPU response, scoring,
exchanges, game endings, Internet rooms, reconnect and offline Nearby RTC.
The viewport checks include desktop, tall portrait, short portrait, smallest
portrait and short landscape. The whole board and all move buttons must fit
inside the screen, and the play container must not require vertical scrolling.
Optional checker/history overlays can scroll their own long content; explicit
Zoom retains internal board scrolling. No physical phone hardware is claimed.
