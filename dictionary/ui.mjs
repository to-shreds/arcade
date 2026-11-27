const view = document.querySelector('#reference-view');
const queryInput = document.querySelector('#reference-query');
const previous = document.querySelector('#reference-back');
const next = document.querySelector('#reference-forward');
const storagePrefix = 'arcade.reference.v1.';
const memory = new Map();

export function el(tag, className, ...children) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  item.append(...children);
  return item;
}

export function button(label, activate, style = '') {
  const item = el('button', `reference-control ${style}`.trim(), label);
  item.type = 'button';
  item.addEventListener('click', activate);
  return item;
}

export function section(title, ...children) {
  return el('section', 'reference-panel', el('h2', '', title), ...children);
}

export function listing(entries, open, { title, detail, className = 'reference-list' }) {
  const list = el('ul', className);
  for (const entry of entries) {
    const card = button(title(entry), () => open(entry), 'reference-card');
    card.replaceChildren(el('strong', '', title(entry)));
    const preview = detail?.(entry);
    if (preview) card.append(el('span', '', preview));
    list.append(el('li', '', card));
  }
  return list;
}

export function appendResults(container, getPage, render, showEmpty, snapshot) {
  const batchSize = 30;
  let offset = 0;
  let running = false;
  const status = el('p', 'reference-status');
  status.setAttribute('role', 'status');
  const more = button('Show more', load);
  const footer = el('div', 'reference-actions', more, status);
  container.append(footer);

  async function load({ type } = {}) {
    if (running) return;
    running = true;
    more.disabled = true;
    status.textContent = '';
    try {
      const page = [];
      const requested = type === 'click' ? batchSize : Math.max(batchSize, snapshot.loadedCount ?? 0);
      let hasMore = true;
      while (hasMore && page.length < requested) {
        const size = Math.min(requested - page.length, 249);
        const items = await getPage({ limit: size + 1, offset: offset + page.length });
        page.push(...items.slice(0, size));
        hasMore = items.length > size;
      }
      if (page.length) {
        const results = render(page);
        const list = container.querySelector(':scope > .reference-list');
        const first = results.querySelector('button');
        if (list) list.append(...results.children);
        else footer.before(results);
        offset += page.length;
        snapshot.loadedCount = offset;
        if (type === 'click') first?.focus();
      } else if (!offset) footer.before(showEmpty());
      more.hidden = !hasMore;
    } catch {
      status.textContent = 'This list could not load. Try again.';
    } finally {
      more.disabled = false;
      running = false;
    }
  }
  return load();
}

function readList(key) {
  try {
    const data = JSON.parse(localStorage.getItem(storagePrefix + key));
    if (!memory.has(key) && Array.isArray(data)) memory.set(key, data);
  } catch { /* Keep the current in-memory list if storage is unavailable. */ }
  return (memory.get(key) || []).filter(item => item && typeof item.id === 'string' && typeof item.label === 'string').slice(0, 200);
}

function writeList(key, data) {
  const bounded = data.slice(0, 200);
  memory.set(key, bounded);
  try { localStorage.setItem(storagePrefix + key, JSON.stringify(bounded)); }
  catch { /* Still works until the activity closes. */ }
}

window.addEventListener('storage', event => {
  if (event.key?.startsWith(storagePrefix)) memory.delete(event.key.slice(storagePrefix.length));
  else if (event.key === null) memory.clear();
});

export const collection = {
  list: readList,
  has: (key, id) => readList(key).some(item => item.id === id),
  record(key, id, label) {
    writeList(key, [{ id, label }, ...readList(key).filter(item => item.id !== id)]);
  },
  toggle(key, id, label) {
    const items = readList(key);
    const kept = items.filter(item => item.id !== id);
    if (kept.length !== items.length) {
      writeList(key, kept);
      return false;
    }
    writeList(key, [{ id, label }, ...kept]);
    return true;
  },
  clear(key) { writeList(key, []); },
};

export function saveButton(key, id, label, words) {
  const control = button('', () => update(collection.toggle(key, id, label)));
  function update(saved) {
    control.textContent = saved ? words[1] : words[0];
    control.setAttribute('aria-pressed', String(saved));
  }
  update(collection.has(key, id));
  return control;
}

export function clearButton(label, message, clear) {
  const status = el('p', 'reference-status');
  status.setAttribute('role', 'status');
  const confirm = button('Yes, clear', clear);
  const cancel = button('Keep it', () => {
    options.hidden = true;
    status.textContent = '';
    offer.hidden = false;
    offer.focus();
  });
  const options = el('div', 'reference-actions', confirm, cancel);
  const offer = button(label, () => {
    status.textContent = message;
    options.hidden = false;
    offer.hidden = true;
    cancel.focus();
  });
  options.hidden = true;
  return el('div', 'reference-actions', offer, status, options);
}

export function setSiblingNavigation() {
  const sibling = document.querySelector('[data-reference-sibling]');
  sibling?.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.button !== 0) return;
    try {
      if (window.parent !== window && window.parent.ArcadeShell?.openGame(sibling.dataset.referenceSibling)) {
        event.preventDefault();
      }
    } catch { /* Direct activity links work when the Arcade shell is absent. */ }
  });
}

export function navigation({ initial, render, hashFor, fromHash }) {
  const direct = window.parent === window;
  const session = crypto.getRandomValues(new Uint32Array(2)).join('-');
  let entries = [{ route: initial, top: 0 }];
  let position = 0;
  let renderId = 0;
  const current = () => entries[position].route;
  const updateButtons = () => {
    previous.disabled = position === 0;
    next.disabled = position === entries.length - 1;
  };
  const loading = () => {
    const note = el('p', 'reference-note', 'Loading…');
    note.setAttribute('role', 'status');
    return note;
  };

  async function show({ focus = true, wait = false } = {}) {
    const id = ++renderId;
    const entry = entries[position];
    const route = entry.route;
    if (!wait) {
      view.setAttribute('aria-busy', 'true');
      view.replaceChildren(loading());
    }
    updateButtons();
    try {
      const rendered = await render(route, entry.presentation ??= {});
      if (id !== renderId) return;
      view.replaceChildren(rendered);
      for (const [index, details] of [...view.querySelectorAll('details')].entries()) {
        if (entry.disclosures?.includes(index)) details.open = true;
      }
    } catch {
      if (id !== renderId) return;
      view.replaceChildren(section('Couldn’t load this page', el('p', '', 'Try opening it again.'), button('Try again', () => show())));
    }
    view.setAttribute('aria-busy', 'false');
    if (focus) {
      const heading = view.querySelector('h1, h2');
      if (heading) heading.tabIndex = -1;
      heading?.focus({ preventScroll: true });
    }
    window.scrollTo(0, entry.top);
  }

  function savePosition() {
    entries[position].top = window.scrollY;
    entries[position].disclosures = [...view.querySelectorAll('details')].flatMap((details, index) => details.open ? [index] : []);
    window.ArcadeSpeech?.cancel();
  }

  function forwardTo(route) {
    if (JSON.stringify(route) === JSON.stringify(current())) return show({ wait: true });
    savePosition();
    entries.splice(position + 1, Infinity, { route, top: 0 });
    position++;
    if (direct) history.pushState({ session, position }, '', hashFor(route) || location.pathname + location.search);
    return show();
  }

  function step(offset) {
    const target = position + offset;
    if (!entries[target]) return;
    if (direct) history.go(offset);
    else {
      savePosition();
      position = target;
      show();
    }
  }

  if (direct) {
    history.scrollRestoration = 'manual';
    history.replaceState({ session, position }, '');
    window.addEventListener('popstate', event => {
      savePosition();
      if (event.state?.session === session && entries[event.state.position]) position = event.state.position;
      else {
        entries = [{ route: fromHash(), top: 0 }];
        position = 0;
        history.replaceState({ session, position }, '');
      }
      show();
    });
  }
  previous.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  setSiblingNavigation();
  return { open: forwardTo, refresh: () => show({ wait: true }), start: () => show({ focus: false }) };
}

export function currentHash() {
  return new URLSearchParams(location.hash.slice(1));
}

export function currentQuery() {
  return queryInput.value.trim();
}

export function setQuery(value) {
  if (queryInput.value !== value) queryInput.value = value;
}

export function listen(text, { label = 'Read aloud', status } = {}) {
  const feedback = status || el('p', 'reference-status');
  feedback.setAttribute('role', 'status');
  const speak = button(label, () => {
    if (!window.ArcadeSpeech) {
      finish('unavailable');
      return;
    }
    feedback.textContent = '';
    const speaking = window.ArcadeSpeech.speak(text, {
      localOnly: true,
      onend: () => finish(),
      onerror: finish,
      oncancel: () => finish(),
    });
    speak.disabled = speaking;
    stop.disabled = !speaking;
  });
  const stop = button('Stop', () => window.ArcadeSpeech?.cancel());
  stop.disabled = true;
  function finish(error) {
    speak.disabled = false;
    stop.disabled = true;
    feedback.textContent = error ? 'A voice isn’t available on this device.' : '';
  }
  return { speak, stop, feedback };
}

export function quickQuiz({ question, options, answer, explanation }, id = 'reference-quiz') {
  const form = el('form', 'reference-quiz');
  const choices = el('fieldset', '', el('legend', '', question));
  const status = el('p', 'reference-status');
  status.setAttribute('role', 'status');
  const check = el('button', 'reference-control', 'Check answer');
  check.type = 'submit';
  for (const [index, option] of options.entries()) {
    const input = el('input');
    input.type = 'radio';
    input.name = id;
    input.value = String(index);
    choices.append(el('label', '', input, option));
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const selected = new FormData(form).get(id);
    status.textContent = selected === null ? 'Choose an answer first.' : [
      Number(selected) === answer ? 'That’s right.' : `The answer is ${options[answer]}.`,
      explanation,
    ].filter(Boolean).join(' ');
  });
  form.append(choices, check, status);
  return form;
}
