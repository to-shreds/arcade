/* Shared read-aloud support for browsers and the Arcade Android WebView. */
(function () {
  'use strict';
  var active = null;
  var sequence = 0;
  var owner = Math.random().toString(36).slice(2, 12);

  function nativeBridge() {
    try {
      var bridge = window.ArcadeNative;
      if (!bridge && window.parent !== window) bridge = window.parent.ArcadeNative;
      return bridge && typeof bridge.speak === 'function' && typeof bridge.stopSpeech === 'function' ? bridge : null;
    } catch (_) { return null; }
  }

  function browserEngine() {
    try {
      return window.speechSynthesis && typeof window.speechSynthesis.speak === 'function' &&
        typeof window.speechSynthesis.cancel === 'function' && typeof window.SpeechSynthesisUtterance === 'function'
        ? window.speechSynthesis : null;
    } catch (_) { return null; }
  }

  function mode() {
    var bridge = nativeBridge();
    if (bridge) return typeof bridge.speakWithId === 'function' ? 'native-events' : 'native';
    return browserEngine() ? 'browser' : 'unavailable';
  }

  function chunks(text, limit) {
    var remaining = String(text || '').replace(/\s+/g, ' ').trim();
    var result = [];
    while (remaining.length > limit) {
      var cut = remaining.lastIndexOf(' ', limit);
      if (cut < limit / 2) cut = limit;
      var prefix = remaining.slice(0, cut);
      var sentences = /[.!?]["'’”)]*\s/g;
      var boundary, match;
      while ((match = sentences.exec(prefix))) boundary = match.index + match[0].length;
      if (boundary > limit / 2) cut = boundary;
      result.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }
    if (remaining) result.push(remaining);
    return result;
  }

  function notify(request, event, value) {
    if (typeof request.options[event] === 'function') request.options[event](value);
  }

  function cancel() {
    var request = active;
    // Invalidate callbacks before cancellation; some engines call onend during cancel().
    active = null;
    if (request && request.readinessTimer) clearTimeout(request.readinessTimer);
    sequence++;
    var bridge = nativeBridge(), engine = browserEngine();
    try { if (bridge) bridge.stopSpeech(); } catch (_) {}
    try { if (engine) engine.cancel(); } catch (_) {}
    if (request) notify(request, 'oncancel');
  }

  function finish(request, error) {
    if (active !== request) return;
    active = null;
    if (request.readinessTimer) clearTimeout(request.readinessTimer);
    request.utterance = null;
    notify(request, error ? 'onerror' : 'onend', error);
  }

  function next(request) {
    if (active !== request) return;
    if (request.position >= request.parts.length) return finish(request);
    var text = request.parts[request.position];
    try {
      if (request.mode === 'native-events') {
        request.id = 'arcade-speech-' + owner + '-' + request.token + '-' + request.position + '-' + Date.now();
        request.bridge.speakWithId(text, request.rate, request.pitch, request.id);
      } else if (request.mode === 'native') {
        request.bridge.speak(text, request.rate, request.pitch);
        // Legacy bridges queue while Android loads its voice. Report a voice that never loads.
        if (typeof request.bridge.hasSpeech === 'function' && !request.bridge.hasSpeech()) {
          request.readinessTimer = setTimeout(function () {
            if (active !== request) return;
            try {
              if (!request.bridge.hasSpeech()) {
                request.bridge.stopSpeech();
                finish(request, 'voice-unavailable');
              }
            } catch (_) { finish(request, 'speech-failed'); }
          }, 5000);
        }
        // Existing APKs have no completion callback. Keep Stop available until cancellation.
      } else {
        var utterance = new window.SpeechSynthesisUtterance(text);
        utterance.rate = request.rate;
        utterance.pitch = request.pitch;
        utterance.volume = 1;
        utterance.lang = 'en-US';
        var voices = typeof request.engine.getVoices === 'function' ? request.engine.getVoices() : [];
        var voice = voices.find(function (entry) { return /^en[-_]US$/i.test(entry.lang); }) ||
          voices.find(function (entry) { return /^en(?:[-_]|$)/i.test(entry.lang); });
        if (voice) utterance.voice = voice;
        // Retain a strong reference while speaking. Chromium can lose event callbacks otherwise.
        request.utterance = utterance;
        utterance.onend = function () {
          if (active !== request || request.utterance !== utterance) return;
          request.utterance = null;
          request.position++;
          next(request);
        };
        utterance.onerror = function (event) {
          if (active === request && request.utterance === utterance) finish(request, event.error || 'speech-failed');
        };
        if (typeof request.engine.resume === 'function') request.engine.resume();
        request.engine.speak(utterance);
      }
    } catch (_) { finish(request, 'speech-failed'); }
  }

  function speak(text, options) {
    options = options || {};
    cancel();
    var selectedMode = mode();
    var clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return false;
    if (selectedMode === 'unavailable') {
      if (options.onerror) options.onerror('unavailable');
      return false;
    }
    if (selectedMode === 'native' && clean.length > 2000) {
      if (options.onerror) options.onerror('native-text-limit');
      return false;
    }
    var request = {
      options: options, mode: selectedMode, token: ++sequence, position: 0,
      bridge: nativeBridge(), engine: browserEngine(),
      rate: Number(options.rate) || 0.93, pitch: Number(options.pitch) || 1,
      parts: selectedMode === 'native' ? [clean] : chunks(clean, selectedMode === 'browser' ? 220 : 1600)
    };
    active = request;
    next(request);
    return active === request;
  }

  window.addEventListener('arcade-native-speech', function (event) {
    var request = active, detail = event.detail || {};
    if (!request || request.mode !== 'native-events' || detail.id !== request.id) return;
    if (detail.type === 'end') { request.position++; next(request); }
    else if (detail.type === 'error') finish(request, detail.error || 'speech-failed');
    else if (detail.type === 'cancel') { active = null; notify(request, 'oncancel'); }
  });
  window.addEventListener('pagehide', cancel);
  window.addEventListener('beforeunload', cancel);
  window.addEventListener('arcadepause', cancel);
  document.addEventListener('arcadepause', cancel);
  document.addEventListener('visibilitychange', function () { if (document.hidden) cancel(); });
  window.addEventListener('message', function (event) {
    if (event.source === window.parent && event.origin === window.location.origin && event.data &&
        event.data.scope === 'arcade-shell' && event.data.version === 1 && event.data.type === 'pause') cancel();
  });
  // Android emits arcadepause on the shell document, while narration lives in its iframe.
  try {
    if (window.parent !== window) {
      window.parent.addEventListener('arcadepause', cancel);
      window.addEventListener('pagehide', function () { window.parent.removeEventListener('arcadepause', cancel); });
    }
  } catch (_) {}
  window.ArcadeSpeech = { available: function () { return mode() !== 'unavailable'; }, mode: mode,
    hasCompletion: function () { return mode() === 'browser' || mode() === 'native-events'; },
    speak: speak, cancel: cancel, chunks: chunks };
})();
