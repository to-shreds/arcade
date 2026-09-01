import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { decodeQrImageData, loadBundledQrLibraries, renderQrToCanvas, startAnimatedQrDisplay, startQrCameraScanner } from '../qr.mjs';

const require = createRequire(import.meta.url);
const qrcode = require('../vendor/qrcode-generator-2.0.4.min.js');
const jsQR = require('../vendor/jsqr-1.4.0.min.js');

function qrPixels(text, scale = 8, margin = 4) {
  const code = qrcode(0, 'M');
  code.addData(text, 'Byte');
  code.make();
  const modules = code.getModuleCount();
  const side = (modules + margin * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4);
  data.fill(255);
  for (let row = 0; row < modules; row += 1) {
    for (let column = 0; column < modules; column += 1) {
      if (!code.isDark(row, column)) continue;
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          const pixel = (((row + margin) * scale + y) * side + ((column + margin) * scale + x)) * 4;
          data[pixel] = 0;
          data[pixel + 1] = 0;
          data[pixel + 2] = 0;
        }
      }
    }
  }
  return { data, width: side, height: side };
}

test('vendored encoder output is decoded by the bundled fallback decoder', async () => {
  const text = 'ANQ1:12345678-2s:0/1:12345678:12345678:ARCADE_pairing-test-0123456789';
  const decoded = await decodeQrImageData(qrPixels(text), { jsQR, inversionAttempts: 'dontInvert' });
  assert.equal(decoded, text);
});

test('canvas renderer draws a quiet zone and square module grid', async () => {
  const calls = [];
  const context = {
    imageSmoothingEnabled: true,
    fillStyle: '',
    fillRect(...args) { calls.push({ color: this.fillStyle, args }); },
  };
  const canvas = { width: 0, height: 0, dataset: {}, getContext: () => context };
  await renderQrToCanvas('Nearby Arcade', canvas, { qrcode, size: 256, margin: 4 });
  assert.equal(canvas.width, 256);
  assert.equal(canvas.height, 256);
  assert.ok(Number(canvas.dataset.qrModules) >= 21);
  assert.deepEqual(calls[0], { color: '#ffffff', args: [0, 0, 256, 256] });
  assert.ok(calls.length > 100);
  assert.equal(context.imageSmoothingEnabled, false);
});

test('bundled QR vendor load failures remain retryable', async () => {
  const scripts = [];
  const documentImpl = {
    createElement() {
      const listeners = new Map();
      const script = {
        dataset: {},
        addEventListener(type, listener) { listeners.set(type, listener); },
        remove() {
          const index = scripts.indexOf(script);
          if (index >= 0) scripts.splice(index, 1);
        },
        dispatch(type) { listeners.get(type)?.(); },
      };
      return script;
    },
    querySelector(selector) {
      const match = selector.match(/data-arcade-qr-vendor="([^"]+)"/);
      return scripts.find(script => script.dataset.arcadeQrVendor === match?.[1]) || null;
    },
    head: {
      appendChild(script) {
        scripts.push(script);
        queueMicrotask(() => script.dispatch('error'));
      },
    },
  };

  await assert.rejects(loadBundledQrLibraries({ documentImpl }), /could not load|cannot load/i);
  assert.equal(scripts.length, 0, 'failed vendor elements are removed');
  const retry = loadBundledQrLibraries({ documentImpl });
  await assert.doesNotReject(Promise.race([
    assert.rejects(retry, /could not load|cannot load/i),
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('retry hung on a settled script')), 50)),
  ]));
  assert.equal(scripts.length, 0);
});

test('camera tracks stop when playback fails after permission succeeds', async () => {
  const stopped = [0, 0];
  const stream = {
    getTracks: () => stopped.map((_value, index) => ({ stop() { stopped[index]++; } })),
  };
  const playbackError = new Error('playback blocked');
  const video = {
    srcObject: null,
    setAttribute() {},
    play: async () => { throw playbackError; },
  };

  await assert.rejects(startQrCameraScanner({
    video,
    onResult() {},
    mediaDevices: { getUserMedia: async () => stream },
  }), error => error === playbackError);

  assert.deepEqual(stopped, [1, 1]);
  assert.equal(video.srcObject, null);
});

test('an in-flight camera decode cannot deliver a QR result after cancellation', async () => {
  let resolveDetect;
  let detectStarted;
  const started = new Promise(resolve => { detectStarted = resolve; });
  class DelayedBarcodeDetector {
    detect() {
      detectStarted();
      return new Promise(resolve => { resolveDetect = resolve; });
    }
  }
  const tracks = [{ stops: 0, stop() { this.stops += 1; } }];
  const stream = { getTracks: () => tracks };
  const video = {
    readyState: 2,
    videoWidth: 320,
    videoHeight: 240,
    srcObject: null,
    setAttribute() {},
    play: async () => {},
  };
  const controller = new AbortController();
  const results = [];
  const scanner = await startQrCameraScanner({
    video,
    signal: controller.signal,
    onResult: value => results.push(value),
    mediaDevices: { getUserMedia: async () => stream },
    decodeOptions: { BarcodeDetector: DelayedBarcodeDetector },
  });
  await started;
  controller.abort();
  resolveDetect([{ rawValue: 'AN1.j.stale-result' }]);
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.deepEqual(results, []);
  assert.equal(tracks[0].stops, 1);
  assert.equal(video.srcObject, null);
  scanner.stop();
  assert.equal(tracks[0].stops, 1, 'cleanup remains idempotent');
});

test('closing during the first animated QR render prevents stale rotation', async () => {
  let releaseRender;
  let renderStartedResolve;
  const renderStarted = new Promise(resolve => { renderStartedResolve = resolve; });
  const renderGate = new Promise(resolve => { releaseRender = resolve; });
  let renders = 0;
  const controller = new AbortController();
  const pending = startAnimatedQrDisplay({
    frames: ['first', 'second'],
    canvas: {},
    frameMs: 350,
    signal: controller.signal,
    render: async () => {
      renders += 1;
      renderStartedResolve();
      await renderGate;
    },
  });
  await renderStarted;
  controller.abort();
  releaseRender();
  const display = await pending;
  await new Promise(resolve => setTimeout(resolve, 380));

  assert.equal(renders, 1, 'an obsolete display never schedules its next frame');
  display.stop();
});
