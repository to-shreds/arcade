// Pointer events cover mouse, touch and pen without relying on HTML drag/drop.
// This owns only the gesture. The game decides which tiles and drops are legal.
export function installTileDrag({ surface, sourceFor, contextIsCurrent, targetFor, canDrop, drop }) {
  const doc = surface.ownerDocument, win = doc.defaultView;
  let gesture = null, swallowClick = false, abortedPointer = null;

  function suppressClick() {
    swallowClick = true;
    win.setTimeout(() => { swallowClick = false; }, 0);
  }

  function clearTarget() {
    gesture?.over?.classList.remove('drag-over', 'drop-blocked');
    if (gesture) gesture.over = null;
  }
  function cancel() {
    if (!gesture) return;
    const old = gesture;
    gesture = null;
    abortedPointer = old.id;
    old.over?.classList.remove('drag-over', 'drop-blocked');
    old.source.element.classList.remove('drag-source');
    old.ghost?.remove();
    surface.classList.remove('dragging-tile');
    if (surface.hasPointerCapture?.(old.id)) surface.releasePointerCapture(old.id);
  }
  function validate() {
    if (gesture && !contextIsCurrent(gesture.source)) cancel();
  }
  function locate(event) {
    // The ghost is pointer-transparent. Hit-test the real pointer, not its offset.
    const element = doc.elementFromPoint(event.clientX, event.clientY);
    return element && surface.contains(element) ? targetFor(element) : null;
  }
  function move(event) {
    if (!gesture || gesture.id !== event.pointerId) return;
    validate();
    if (!gesture) return;
    if (!gesture.active) {
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 7) return;
      gesture.active = true;
      const ghost = doc.createElement('div');
      ghost.className = 'tile-drag-ghost';
      ghost.textContent = gesture.source.label;
      ghost.setAttribute('aria-hidden', 'true');
      doc.body.append(ghost);
      gesture.ghost = ghost;
      gesture.source.element.classList.add('drag-source');
      surface.classList.add('dragging-tile');
      surface.setPointerCapture?.(event.pointerId);
    }
    event.preventDefault();
    const offset = event.pointerType === 'touch' ? 62 : 28;
    gesture.ghost.style.transform = `translate(${event.clientX - 24}px,${event.clientY - offset}px)`;
    clearTarget();
    const target = locate(event);
    if (target) {
      gesture.over = target.element;
      target.element.classList.add(canDrop(gesture.source, target) ? 'drag-over' : 'drop-blocked');
    }
  }
  function end(event) {
    if (gesture?.id === event.pointerId) validate();
    if (abortedPointer === event.pointerId) {
      abortedPointer = null; event.preventDefault(); suppressClick(); return;
    }
    if (!gesture || gesture.id !== event.pointerId) return;
    const { active, source } = gesture, target = active ? locate(event) : null;
    cancel();
    abortedPointer = null;
    if (!active) return; // A tap still uses the existing click/keyboard controls.
    event.preventDefault();
    // Only swallow the compatibility click in this pointerup task, never a later tap.
    suppressClick();
    if (target && contextIsCurrent(source)) drop(source, target);
  }
  surface.addEventListener('pointerdown', event => {
    if (gesture) { if (gesture.id !== event.pointerId) cancel(); return; }
    if (event.isPrimary === false || event.button !== 0) return;
    abortedPointer = null;
    const source = sourceFor(event.target);
    if (source) gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, source, active: false, over: null, ghost: null };
  });
  doc.addEventListener('pointermove', move, { passive: false });
  doc.addEventListener('pointerup', end, { passive: false });
  doc.addEventListener('pointercancel', event => { if (gesture?.id === event.pointerId) cancel(); });
  surface.addEventListener('lostpointercapture', event => { if (event.target === surface && gesture?.id === event.pointerId) cancel(); });
  doc.addEventListener('click', event => {
    if (swallowClick && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  doc.addEventListener('keydown', event => { if (gesture && event.key === 'Escape') { cancel(); event.preventDefault(); } });
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) cancel(); });
  win.addEventListener('blur', cancel);
  win.addEventListener('resize', cancel);
  win.visualViewport?.addEventListener('resize', cancel);
  return { cancel, validate };
}
