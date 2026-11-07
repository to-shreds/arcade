# Arcade 2.8.7 TV verification

The published update defaults to a remembered 480p preference, adds quality
settings and actual resolution display, reports startup/buffering stages, reuses
bounded account-specific metadata/source checks, and prefetches selected sources
without preparing torrents. Failed explicit preparation refreshes ready copies
and tries verified cached alternatives of the same title/episode.

GitHub preflight [42422326599](https://github.com/to-shreds/arcade/actions/runs/42422326599)
passed the final recovered sources: 33 TV core checks, 12 focused browser
scenarios, eight existing TV integration scenarios, 112 transport/shell tests,
47-activity native keyboard/Home audits and complete offline validation.
The focused browser checks cover default/persisted quality, fresh playback
links, strict seek preservation and native fullscreen, each progress stage,
in-flight prefetch adoption, both identity error classes after explicit Prepare,
no duplicate uncached preparation, retry after transient failure, cancellation,
account switching and four responsive layouts.

Before the workspace outage, all 33 core and eight existing integration checks
passed locally. The synthetic video fixture needed 206 byte-range responses for
actual seeking; the strict position assertion was retained. After the executor
disconnected, sources were recovered deterministically from the exact baseline
48e52e48 and recorded successful patches. No independent filesystem byte
comparison is claimed. The login reset and full backend error-code fixture were
added before the successful combined GitHub preflight.

Runtime commit 681e3db55187e2e98619cef59ec357e397a8d664 was published by successful
Pages run [42422477990](https://github.com/to-shreds/arcade/actions/runs/42422477990).
The preflight's live job independently fetched snapshot 2.8.7+20261107.1 and
verified size/SHA-256 of tv/index.html, tv/app.mjs, tv/core.mjs, tv/style.css
and sw.js against the tested manifest. Snapshot: 387 files, 20,164,370 bytes.
The runner-built 413-entry ZIP passes CRC and every runtime hash; exact
checksum and download are recorded in the release provenance and ProjectStatus.

Backend 1.2.11 passed 704 registered Node tests: 698 passed, zero failures or
cancellations and six optional live/account skips. All 79 focused identity,
discovery and recovery checks passed. Main commit 0713abb6 and identical-tree
deployment mirror 611cf0a5 are deployed on Render; the GitHub runner fetched
/healthz and verified live version 1.2.11. Missing detail hashes require
independent proof and actual conflicts remain blocked.

The user's personal TorBox key/response and physical Android playback were not
available. Source preference cannot guarantee a 480p copy for every title;
fallback quality is shown. The supplementary historical 2.8.6 broad run
42418533256 failed an unchanged Tank Tactics Load Saved click timeout, while
its actual Nearby job passed. The separate 2.8.7 broad run and latest publication
state are recorded in ProjectStatus; neither is represented as passed prematurely.
