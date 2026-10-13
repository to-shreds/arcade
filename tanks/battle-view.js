/** Local-only display preference. Never changes a game, room or saved shot. */
export function initBattleView(resize) {
  const button = document.getElementById('landscape');
  const notice = document.getElementById('viewNotice');
  let wide = false, operation = 0, enteredFullscreen = false, active = true, timer;
  try { wide = localStorage.getItem('arcade.tanks.wide.v1') === 'true'; } catch {}
  function draw() {
    document.body.classList.toggle('tanks-wide', wide);
    button.setAttribute('aria-pressed', String(wide));
    button.title = wide ? 'Exit landscape view' : 'Landscape view and fullscreen';
    button.setAttribute('aria-label', button.title);
    button.querySelector('span').textContent = wide ? 'Exit wide' : 'Landscape';
    requestAnimationFrame(resize);
  }
  function say(text) {
    clearTimeout(timer); notice.textContent = text; notice.hidden = !text;
    if (text) timer = setTimeout(() => { notice.hidden = true; }, 6500);
  }
  function remember() { try { localStorage.setItem('arcade.tanks.wide.v1', String(wide)); } catch {} }
  function unlock() { try { screen.orientation?.unlock?.(); } catch {} }
  async function leaveFullscreen() {
    unlock();
    if (enteredFullscreen && document.fullscreenElement === document.documentElement) {
      enteredFullscreen = false;
      try { await document.exitFullscreen(); } catch {}
    }
  }
  button.addEventListener('click', async () => {
    active = true; const token = ++operation; wide = !wide; remember(); draw(); say('');
    if (!wide) { await leaveFullscreen(); return; }
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        enteredFullscreen = document.fullscreenElement === document.documentElement;
      }
    } catch {} // Embedded browsers may reject fullscreen; the layout still works.
    if (token !== operation || !wide) { if (!wide || !active) await leaveFullscreen(); return; }
    let locked = false;
    try {
      if (screen.orientation?.lock) { await screen.orientation.lock('landscape'); locked = true; }
    } catch {}
    if (token !== operation || !wide) { if (!wide || !active) await leaveFullscreen(); return; }
    if (!locked && matchMedia('(orientation: portrait)').matches) {
      say('Wide view is on. Turn your phone sideways for landscape.');
    }
    draw();
  });
  document.addEventListener('fullscreenchange', () => {
    if (enteredFullscreen && !document.fullscreenElement) {
      enteredFullscreen = false; ++operation; wide = false; unlock(); remember(); draw();
    }
  });
  function suspend() { active = false; ++operation; leaveFullscreen(); }
  window.addEventListener('arcadepause', suspend);
  window.addEventListener('arcaderesume', () => { active = true; });
  window.addEventListener('pagehide', suspend);
  document.getElementById('home').addEventListener('click', suspend);
  document.getElementById('setupHome').addEventListener('click', suspend);
  window.visualViewport?.addEventListener('resize', resize);
  draw();
}
