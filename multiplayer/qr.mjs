import { NearbyProtocolError, SIGNAL_LIMITS } from './protocol.mjs';

const QR_ENCODER_URL = new URL('./vendor/qrcode-generator-2.0.4.min.js', import.meta.url);
const QR_DECODER_URL = new URL('./vendor/jsqr-1.4.0.min.js', import.meta.url);
const VALID_ERROR_CORRECTION = new Set(['L', 'M', 'Q', 'H']);
let vendorPromise;

function fail(code, message, details) {
  throw new NearbyProtocolError(code, message, details);
}

function loadClassicScript(url, globalName, documentImpl) {
  const current = globalThis[globalName];
  if (typeof current === 'function') return Promise.resolve(current);
  if (!documentImpl || typeof documentImpl.createElement !== 'function') {
    return Promise.reject(new NearbyProtocolError('qr_library_unavailable', 'Bundled QR tools cannot load in this environment.'));
  }
  return new Promise((resolve, reject) => {
    let existing = documentImpl.querySelector && documentImpl.querySelector(`script[data-arcade-qr-vendor="${globalName}"]`);
    // A script that has already emitted load/error will not emit it again when
    // a retry merely attaches fresh listeners. Discard settled elements so a
    // failed first load cannot leave every later pairing attempt hanging.
    if (existing && existing.dataset?.arcadeQrState && existing.dataset.arcadeQrState !== 'loading') {
      existing.remove?.();
      existing = null;
    }
    const script = existing || documentImpl.createElement('script');
    const loaded = () => {
      const library = globalThis[globalName];
      if (typeof library === 'function') {
        if (script.dataset) script.dataset.arcadeQrState = 'loaded';
        resolve(library);
      } else {
        if (script.dataset) script.dataset.arcadeQrState = 'error';
        script.remove?.();
        reject(new NearbyProtocolError('qr_library_unavailable', `Bundled ${globalName} did not initialize.`));
      }
    };
    const failed = () => {
      if (script.dataset) script.dataset.arcadeQrState = 'error';
      script.remove?.();
      reject(new NearbyProtocolError('qr_library_unavailable', `Bundled ${globalName} could not load.`));
    };
    script.addEventListener('load', loaded, { once: true });
    script.addEventListener('error', failed, { once: true });
    if (!existing) {
      script.src = String(url);
      script.async = true;
      script.dataset.arcadeQrVendor = globalName;
      script.dataset.arcadeQrState = 'loading';
      (documentImpl.head || documentImpl.documentElement).appendChild(script);
    } else if (typeof globalThis[globalName] === 'function') {
      loaded();
    }
  });
}

/** Load the locally bundled encoder and fallback decoder. No network URL is used. */
export async function loadBundledQrLibraries({ documentImpl = globalThis.document } = {}) {
  if (typeof globalThis.qrcode === 'function' && typeof globalThis.jsQR === 'function') {
    return Object.freeze({ qrcode: globalThis.qrcode, jsQR: globalThis.jsQR });
  }
  if (!vendorPromise) {
    vendorPromise = Promise.all([
      loadClassicScript(QR_ENCODER_URL, 'qrcode', documentImpl),
      loadClassicScript(QR_DECODER_URL, 'jsQR', documentImpl),
    ]).then(([qrcode, jsQR]) => Object.freeze({ qrcode, jsQR })).catch(error => {
      vendorPromise = null;
      throw error;
    });
  }
  return vendorPromise;
}

function assertCanvas(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') fail('invalid_canvas', 'A canvas is required to display the QR code.');
  const context = canvas.getContext('2d');
  if (!context) fail('canvas_unavailable', 'This browser cannot draw the QR code.');
  return context;
}

export async function renderQrToCanvas(text, canvas, {
  size = 320,
  margin = 4,
  errorCorrection = 'M',
  foreground = '#101321',
  background = '#ffffff',
  qrcode: qrcodeOverride,
} = {}) {
  if (typeof text !== 'string' || !text.length || text.length > SIGNAL_LIMITS.maxFrameChars) {
    fail('invalid_qr_text', 'QR text is empty or too large.');
  }
  if (!Number.isSafeInteger(size) || size < 128 || size > 2048) fail('invalid_qr_size', 'QR display size is out of range.');
  if (!Number.isSafeInteger(margin) || margin < 0 || margin > 16) fail('invalid_qr_margin', 'QR margin is out of range.');
  if (!VALID_ERROR_CORRECTION.has(errorCorrection)) fail('invalid_qr_correction', 'QR error-correction level is invalid.');
  const context = assertCanvas(canvas);
  const qrcodeImpl = qrcodeOverride || (await loadBundledQrLibraries()).qrcode;
  let code;
  try {
    code = qrcodeImpl(0, errorCorrection);
    code.addData(text, 'Byte');
    code.make();
  } catch (error) {
    fail('qr_encode_failed', 'Pairing data does not fit in this QR frame.', { cause: String(error && error.message || error) });
  }
  const modules = code.getModuleCount();
  const totalModules = modules + margin * 2;
  const moduleSize = Math.max(1, Math.floor(size / totalModules));
  const drawnSize = moduleSize * totalModules;
  const offset = Math.floor((size - drawnSize) / 2);
  canvas.width = size;
  canvas.height = size;
  context.imageSmoothingEnabled = false;
  context.fillStyle = background;
  context.fillRect(0, 0, size, size);
  context.fillStyle = foreground;
  for (let row = 0; row < modules; row += 1) {
    for (let column = 0; column < modules; column += 1) {
      if (!code.isDark(row, column)) continue;
      context.fillRect(
        offset + (column + margin) * moduleSize,
        offset + (row + margin) * moduleSize,
        moduleSize,
        moduleSize,
      );
    }
  }
  canvas.dataset && (canvas.dataset.qrModules = String(modules));
  return canvas;
}

export async function decodeQrImageData(imageData, {
  jsQR: jsQROverride,
  inversionAttempts = 'attemptBoth',
} = {}) {
  if (!imageData || !imageData.data || !Number.isSafeInteger(imageData.width) || !Number.isSafeInteger(imageData.height)) {
    fail('invalid_image_data', 'QR image pixels are invalid.');
  }
  if (imageData.width < 16 || imageData.height < 16 || imageData.width * imageData.height > 25_000_000) {
    fail('invalid_image_size', 'QR image dimensions are out of range.');
  }
  const jsQRImpl = jsQROverride || (await loadBundledQrLibraries()).jsQR;
  const result = jsQRImpl(imageData.data, imageData.width, imageData.height, { inversionAttempts });
  return result && typeof result.data === 'string' ? result.data : null;
}

async function toDrawableSource(source) {
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    if (typeof createImageBitmap !== 'function') fail('image_decode_unavailable', 'This browser cannot open the selected QR image.');
    const bitmap = await createImageBitmap(source);
    return { source: bitmap, close: () => bitmap.close && bitmap.close() };
  }
  return { source, close: () => {} };
}

function sourceDimensions(source) {
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    fail('image_not_ready', 'The QR image is not ready yet.');
  }
  return { width: Math.floor(width), height: Math.floor(height) };
}

function makeScratchCanvas(width, height, documentImpl = globalThis.document) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (!documentImpl || typeof documentImpl.createElement !== 'function') fail('canvas_unavailable', 'This browser cannot inspect QR image pixels.');
  const canvas = documentImpl.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function imageDataFromSource(source, documentImpl) {
  if (source && source.data instanceof Uint8ClampedArray && Number.isSafeInteger(source.width) && Number.isSafeInteger(source.height)) return source;
  if (source && typeof source.getContext === 'function') {
    const { width, height } = sourceDimensions(source);
    return source.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height);
  }
  const { width, height } = sourceDimensions(source);
  const maxSide = 1280;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const targetWidth = Math.max(1, Math.floor(width * scale));
  const targetHeight = Math.max(1, Math.floor(height * scale));
  const canvas = makeScratchCanvas(targetWidth, targetHeight, documentImpl);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) fail('canvas_unavailable', 'This browser cannot inspect QR image pixels.');
  context.drawImage(source, 0, 0, targetWidth, targetHeight);
  return context.getImageData(0, 0, targetWidth, targetHeight);
}

async function nativeQrDecode(source, BarcodeDetectorImpl = globalThis.BarcodeDetector) {
  if (typeof BarcodeDetectorImpl !== 'function') return null;
  try {
    if (typeof BarcodeDetectorImpl.getSupportedFormats === 'function') {
      const formats = await BarcodeDetectorImpl.getSupportedFormats();
      if (!formats.includes('qr_code')) return null;
    }
    const detector = new BarcodeDetectorImpl({ formats: ['qr_code'] });
    const results = await detector.detect(source);
    return results && results[0] && typeof results[0].rawValue === 'string' ? results[0].rawValue : null;
  } catch {
    return null;
  }
}

export async function decodeQrSource(source, {
  preferNative = true,
  documentImpl = globalThis.document,
  BarcodeDetector: BarcodeDetectorImpl = globalThis.BarcodeDetector,
  jsQR,
} = {}) {
  if (!source) fail('invalid_qr_source', 'A camera frame or image is required.');
  const drawable = await toDrawableSource(source);
  try {
    if (preferNative) {
      const nativeResult = await nativeQrDecode(drawable.source, BarcodeDetectorImpl);
      if (nativeResult) return nativeResult;
    }
    const imageData = await imageDataFromSource(drawable.source, documentImpl);
    return decodeQrImageData(imageData, { jsQR });
  } finally {
    drawable.close();
  }
}

export async function startQrCameraScanner({
  video,
  onResult,
  onError = () => {},
  constraints = { video: { facingMode: { ideal: 'environment' } }, audio: false },
  fps = 10,
  signal,
  mediaDevices = globalThis.navigator && globalThis.navigator.mediaDevices,
  decodeOptions,
} = {}) {
  if (!video || typeof video.play !== 'function') fail('invalid_video', 'A video preview is required to scan QR codes.');
  if (typeof onResult !== 'function') fail('invalid_qr_callback', 'A QR result callback is required.');
  if (!Number.isFinite(fps) || fps < 1 || fps > 30) fail('invalid_scan_rate', 'QR scan rate is out of range.');
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') fail('camera_unavailable', 'Camera scanning is unavailable in this browser.');
  const stream = await mediaDevices.getUserMedia(constraints);
  let stopped = false;
  let timer = null;
  let busy = false;
  let lastValue = null;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    for (const track of stream.getTracks()) track.stop();
    if (video.srcObject === stream) video.srcObject = null;
    if (signal) signal.removeEventListener('abort', stop);
  };
  if (signal) {
    if (signal.aborted) {
      stop();
      throw new DOMException('QR scan was cancelled.', 'AbortError');
    }
    signal.addEventListener('abort', stop, { once: true });
  }
  try {
    video.srcObject = stream;
    video.setAttribute && video.setAttribute('playsinline', '');
    await video.play();
  } catch (error) {
    // Camera permission may succeed even when Safari/WebView subsequently
    // rejects video playback.  The caller has no scanner handle yet, so this
    // function must release every acquired track before propagating failure.
    stop();
    throw error;
  }
  const delay = Math.round(1000 / fps);
  const scan = async () => {
    if (stopped) return;
    if (!busy && video.readyState >= 2) {
      busy = true;
      try {
        const value = await decodeQrSource(video, decodeOptions);
        // Decoding (especially BarcodeDetector on mobile) can finish after the
        // pairing dialog was closed.  An aborted scanner must never deliver a
        // stale QR result that can recreate a session the user just cancelled.
        if (stopped || (signal && signal.aborted)) return;
        if (value && value !== lastValue) {
          lastValue = value;
          await onResult(value);
        } else if (!value) {
          lastValue = null;
        }
      } catch (error) {
        onError(error);
      } finally {
        busy = false;
      }
    }
    if (!stopped) timer = setTimeout(scan, delay);
  };
  timer = setTimeout(scan, 0);
  return Object.freeze({ stop, stream });
}

export async function startAnimatedQrDisplay({
  frames,
  canvas,
  frameMs = 650,
  signal,
  render = renderQrToCanvas,
  ...renderOptions
} = {}) {
  if (!Array.isArray(frames) || !frames.length || frames.some(frame => typeof frame !== 'string')) {
    fail('invalid_qr_frames', 'Animated QR display requires one or more frames.');
  }
  if (!Number.isSafeInteger(frameMs) || frameMs < 350 || frameMs > 5000) fail('invalid_frame_duration', 'Animated QR timing is out of range.');
  let stopped = false;
  let index = 0;
  let timer = null;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', stop);
  };
  if (signal) {
    if (signal.aborted) {
      stop();
      throw new DOMException('QR display was cancelled.', 'AbortError');
    }
    signal.addEventListener('abort', stop, { once: true });
  }
  const draw = async () => {
    if (stopped) return;
    await render(frames[index], canvas, renderOptions);
    if (stopped) return;
    index = (index + 1) % frames.length;
    if (frames.length > 1) timer = setTimeout(() => draw().catch(stop), frameMs);
  };
  try { await draw(); }
  catch (error) { stop(); throw error; }
  return Object.freeze({
    stop,
  });
}
