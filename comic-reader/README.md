# Comic Library

Comic Library reads CBZ and PDF files from the user's device and the public
`to-shreds/Misc/cbz` folder. A file's size does not disqualify it from reading.

## Large-book support

- CBZs are indexed using a ZIP64-capable random-access ZIP reader (zip.js),
  which extracts the requested page instead of loading or inflating the whole
  archive. ZIP64 archives and large page counts are supported.
- PDFs use PDF.js with a Blob-backed byte-range transport, so a local PDF is
  not eagerly copied into a single full-size JavaScript ArrayBuffer.
- Downloads use a streamed Blob, and the UI displays download progress.
  Local and remote files still require adequate device storage and memory for
  individual pages. A 256 MiB **per-image** guard protects the reader from
  maliciously expanded ZIP pages; it is not a CBZ total-file-size limit.
- The image URL cache remains bounded, with a maximum of 12 rendered pages.
  Browser storage quotas may constrain optional offline copies.

## GitHub hosting

- Ordinary `.cbz` and `.pdf` files uploaded to `Misc/cbz` show up automatically.
  GitHub limits browser uploads to 25 MiB per file and standard Git pushes to
  100 MiB per file.
- To host a larger book **within that same folder**, split its original
  bytes into consecutive files called `Comic.cbz.001`, `Comic.cbz.002`, ...
  (or `Comic.pdf.001` etc.). The reader groups all contiguous parts into a
  single bookshelf item, downloads them in order and joins their Blobs without
  recompressing the file. Each part must meet GitHub's upload limit.
- The included `split-book.py` prepares 24 MiB parts without modifying the
  original book. Example:

  `python split-book.py "Comic.cbz" --output "parts"`

  Upload every generated part in `parts` to the public `Misc/cbz` folder.
  Do **not** use 7-Zip's multi-volume archive mode. These must be consecutive
  raw byte fragments of the original CBZ/PDF, not independently zipped parts.
- GitHub Releases can hold assets under 2 GiB, but these assets are not
  automatically part of this folder's bookshelf. They can be downloaded to
  the device and opened locally. Do not use Git LFS pointer files as CBZs.

## Reading

The file picker shows all files on Android to avoid excluding `.cbz` due to
an unrecognized MIME type. After selection only `.cbz` and `.pdf` filenames
are accepted. Nothing from a local file is uploaded to a server.

Pages support swipe/tap, pinch/zoom, vertical scrolling, landscape spreads,
bookmarks, resume, and optional offline storage in IndexedDB. The Arcade's
shared Home control is preserved. PDF.js and zip.js are bundled for offline
use; the previous JSZip file is no longer used by this reader.

## Dependencies and safety

- Mozilla PDF.js v3.2.146, Apache-2.0.
- Gildas Lormeau zip.js v2.25.0, BSD-3-Clause.
- ZIP entries are validated to include only supported image paths, and page
  decompression checks the ZIP signature. Only trusted repository URLs are
  loaded from GitHub. File downloads are not subject to an arbitrary 150 MB cap.

CI checks test the ZIP reader on a sparse archive exceeding 160 MiB,
real PDF.js parsing, ordinary and split GitHub libraries, browser layouts,
bookmarks, and the Arcade's shell navigation.