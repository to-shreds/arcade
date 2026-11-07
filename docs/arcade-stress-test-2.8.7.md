# Arcade 2.8.7 TV verification

Scope: 480p default with remembered quality choices, actual quality display,
clear stage/buffering messages, bounded account-specific caches/prefetch and
source recovery after failed explicit preparation.

Before the workspace outage, 33 TV core checks and all eight existing TV
integration scenarios passed. All 12 focused scenarios passed across the initial
run and the corrected seek/fullscreen case. The synthetic fixture needed 206
byte-range responses for actual seeking; the seek assertion was retained.
Screenshots of 320/844 layouts and progress were reviewed. A final combined
GitHub-hosted preflight re-verifies the recovered source before publication.

Sources were recovered deterministically from 48e52e48 and the recorded successful
patches after the executor disconnected. This is not claimed to be an independent
byte comparison with the unavailable filesystem. The runner performs syntax,
TV logic, focused browser, existing integration, transport and offline checks,
then generates the runtime manifest and verified release ZIP. The login reset and full backend error-code fixture were then added for the
combined preflight. Its provenance records the actual source commit, runtime size/hashes and package checksum.

Backend 1.2.11 passed 704 registered Node tests: 698 passed, zero failures/cancellations,
six optional live/account skips; all 79 focused identity/discovery/recovery checks
passed. It is committed as 0713abb6 and deployed via 611cf0a5. No personal TorBox
key/response or physical Android account playback was available. Wrong copies
remain rejected; missing hash data requires independent verification.

ProjectStatus records the final runner, deployment, live-file comparison,
download and any supplementary broad-CI result. A preferred 480p copy cannot be
guaranteed for every title because source availability varies; fallback quality
is shown rather than represented as 480p.
