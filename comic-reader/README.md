# Comic Library

A compact, local-first CBZ and PDF reader in the Family Arcade.

- `index.html` is the entry page. `reader.js` supplies UI, IndexedDB offline storage and PDF/CBZ page rendering; `core.mjs` handles safe library listing, natural image ordering and spread page navigation.
- The bookshelf reads public files from `https://api.github.com/repos/to-shreds/Misc/contents/cbz?ref=main`. Add `.cbz` or `.pdf` files to that folder. No repository changes or Arcade redeploy are needed when uploading a book.
- On Android, the device file picker shows all file types to avoid incorrectly graying out `.cbz`; after selection the reader accepts only `.cbz` or `.pdf`, including filenames using uppercase extensions. Local files never upload to any server.
- GitHub comics are downloaded only when opened. Optional Keep Offline stores full files locally in IndexedDB. Page number, bookmarks and reading preferences are stored per device; no Internet/Nearby rooms are used.
- The reader's own code, PDF.js worker and JSZip are included in the Arcade web release for offline startup. GitHub books require Internet until the user saves a copy offline.
- PDF.js is used with JavaScript evaluation and embedded PDF scripting disabled. The bundled PDF.js distribution is v3.2.146 (Mozilla Apache-2.0). JSZip v3.10.2 is MIT/GPLv3 licensed; included here under its MIT option.
- PDF pages and CBZ images are decoded as needed, with a bounded URL cache. The reader rejects huge archives and unsafe non-image CBZ paths. It does not unzip images to the device or transform PDFs to CBZ.

## Reader controls

- Tap/swipe sides to turn pages, tap center to hide/show controls, and double tap or pinch to zoom. Left/right arrows and page keys work on keyboards.
- Options: fit page/width, single or continuous scroll, two pages in landscape, reading direction, bookmark, offline storage, Back to Arcade.
- Tap the page counter or drag the page slider to jump to a page. Progress and bookmarks remain on the same device.

## Notes

GitHub's public Contents API is subject to unauthenticated rate limits. A missing `Misc/cbz` folder is treated as an empty library. GitHub browser uploads have a 25 MiB per-file limit, and standard Git pushes have a 100 MiB single-file limit.

For the exact screen/test status, consult the current Arcade `HANDOFF.md` and Arcade `ProjectStatus` entry.