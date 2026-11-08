# Arcade 2.10.2: Time Master clock correction

## Change and authoritative source

The user reported that the analog clock's number ring and hands were drawn
very small in the upper-left of a large white circular frame on a high-density
Android phone. The prior `time/index.html` used CSS pixels while a separate
canvas backing bitmap was device-pixel-scaled; a context reset could discard
the expected transform and shrink all drawing into one corner. An inline
size calculation also competed with the mobile CSS face rules.

The 2.10.2 fix makes CSS the single authority for the screen diameter and uses
the actual `canvas.width` and `canvas.height` for all drawing coordinates,
after explicitly setting the context transform to identity on every paint.
Clock tick marks, numeral sizes, hands, and pivot scale together. The phone
dial becomes larger without increasing the keypad footprint. Original
three modes, touch interactions, restore/rotation, save schema, and multiplayer
adapters are unchanged.

Runtime patch `d5bb228475c24a8315fbacdb939e9841c02258c9`.
Merged runtime source on main `3fec6d366dfd4deb95fd06ed50c8cd9e0e94fe20`.
The later handoff/report commits have no runtime changes.

## Verification and limits

- GitHub Actions package job [42514388444](https://github.com/to-shreds/arcade/actions/runs/42514388444)
  **passed** all 90 dedicated actual-browser clock rendering/pointer/rotation
  scenarios, including six sizes (1440x900, 390x844, 393x873, 320x568,
  844x390 and 568x320), DPR 1/2/3, all three modes, content/bitmap
  geometry, center and edge pixels, a deliberate reset of canvas context,
  mouse/touch setting, rotation and hidden save restoration.
- The same package job **passed** save contract, native keyboard,
  Android wrapper source, offline runtime manifest, and ZIP verification.
- PR [Test Arcade Web 42513863079](https://github.com/to-shreds/arcade/actions/runs/42513863079)
  **passed** the combined clock/menu/young kid Trivia browser step, native
  model tests, packaged runtime validation, typing/Face Lab and Nearby.
  However, the overall job **failed** at a TV source-quality change test:
  seeking after a quality switch landed at 1.4 seconds instead of the
  expected previously played position. No TV source file was changed by
  this patch. This is an outstanding separate test issue, not evidence
  that the clock failed, and the full CI must not be called green.
- Independent all-activity stress preflight
  [42513863364](https://github.com/to-shreds/arcade/actions/runs/42513863364)
  passed its model/package, Bug Squish, stories/TV, and Tanks/Upwords jobs.
  The menus-and-tools job failed one Face Lab 320x568 size-button
  assertion (1.5 instead of 1.75). Face Lab was not changed by this clock
  release. Other jobs were still running at this report, so this suite
  is not represented as fully successful.
- Main [Pages deployment 42514434917](https://github.com/to-shreds/arcade/actions/runs/42514434917)
  **succeeded**. Device-specific Android rendering has **not** been tested
  on the reporting handset. Other extensive project stress jobs may
  continue independently; only their completed results count.

## Published download and offline identity

Release [Arcade 2.10.2](https://github.com/to-shreds/arcade/releases/tag/arcade-v2.10.2)
contains the full Arcade web ZIP and provenance.

- ZIP: https://github.com/to-shreds/arcade/releases/download/arcade-v2.10.2/arcade-2.10.2-web.zip
- Package job: 42514388444 (success).
- ZIP size: 15,476,545 bytes.
- ZIP SHA-256: `428969ddfbd22427348cfd2c84011d2fd594bbea0c03626d25955a877b169eef`.
- Offline snapshot: `2.10.2+20261108.1`, 415 runtime files and
  22,971,520 runtime bytes.
- Main live app: https://to-shreds.github.io/arcade/
- Direct Time Master: https://to-shreds.github.io/arcade/time/

The existing Android wrapper loads the web release and does not require a
new APK to obtain these source changes. Refresh Arcade and update its offline
copy for the revised manifest; avoid deleting saved progress.

## Next verification

Use the reporting Android handset to verify the analog ring fills and is
centered in its white frame, with the correct time and responsive keypad.
Investigate the independent TV seek test only in its own scope.
