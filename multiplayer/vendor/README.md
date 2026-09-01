# Bundled QR dependencies

Nearby Arcade pairing must work without Internet access, so its QR encoder and
fallback decoder are committed locally rather than fetched from a CDN.

- `qrcode-generator-2.0.4.min.js`: Kazuhiko Arase's `qrcode-generator` 2.0.4,
  MIT licensed. The npm distribution was locally minified with Terser 5.44.0.
- `jsqr-1.4.0.min.js`: `jsQR` 1.4.0, Apache-2.0 licensed. The npm distribution
  was locally minified with Terser 5.44.0.

The adjacent license files contain the complete license terms. The files are
classic-script/UMD builds so `qr.mjs` can lazy-load them only when pairing is
opened. `BarcodeDetector` is used as an optional fast path; `jsQR` remains the
portable offline fallback.
