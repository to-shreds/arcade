import { isProtectiveQuery } from '../reference/library.mjs';
import { button, el, listing, listen, saveButton } from './ui.mjs';

export function wordResults(entries, open) {
  return listing(entries, open, { title: item => item.headword, detail: item => item.definition });
}

function relatedWords(label, words, open) {
  if (!words?.length) return '';
  return el('p', 'definition-related', el('strong', '', label), ...words.map(word => {
    const term = button(word, () => open(word));
    term.className = 'reference-term';
    return term;
  }));
}

export function definitionEntry(entry, open, { showHeading = true } = {}) {
  const { headword, pronunciation, forms, etymology, senses } = entry;
  const frame = el('section', showHeading ? 'reference-panel definition-entry' : 'definition-entry');
  if (showHeading) frame.append(el('h1', '', headword));
  if (pronunciation) frame.append(el('p', 'definition-phonetic', pronunciation));
  const { speak, stop, feedback } = listen(headword, { label: 'Hear word' });
  frame.append(el('div', 'reference-actions', speak, stop, saveButton('words', headword, headword, ['Save word', 'Remove saved word'])), feedback);
  const list = el('ol', 'definition-senses');
  for (const sense of senses) {
    list.append(el('li', '', el('p', 'reference-label', sense.partOfSpeech), el('p', '', sense.definition),
      el('p', 'definition-example', sense.example), relatedWords('Similar words', sense.synonyms, open),
      relatedWords('Opposites', sense.antonyms, open)));
  }
  frame.append(list);
  if (forms?.length) frame.append(el('p', 'reference-note', `Other forms: ${forms.join(', ')}`));
  if (etymology) frame.append(el('p', '', el('strong', '', 'Where it comes from '), etymology));
  return frame;
}

export function missingWord(suggestions, open) {
  return [el('p', '', 'This dictionary doesn’t have that word yet.'),
    ...(suggestions.length ? [el('h3', '', 'Did you mean…'), wordResults(suggestions, item => open(item.headword))] : [])];
}

export function selectedPhrase(container) {
  const selection = document.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return '';
  const ancestor = selection.getRangeAt(0).commonAncestorContainer;
  if (!container?.contains(ancestor)) return '';
  const text = selection.toString().trim().replace(/^\p{P}+|\p{P}+$/gu, '').trim();
  return text.length <= 100 && /^[\p{L}\p{N}][\p{L}\p{N}\p{M}’'\s-]*$/u.test(text) && text.split(/\s+/).length <= 6 ? text : '';
}

export function markedParagraph(text, terms, marked, open) {
  const paragraph = el('p');
  const permitted = terms.map(term => String(term).trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!permitted.length) {
    paragraph.textContent = text;
    return paragraph;
  }
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lookups = new Map(permitted.map(term => [term.toLowerCase(), term]));
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${permitted.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    const [word] = match;
    const key = word.toLowerCase();
    if (marked.has(key)) continue;
    paragraph.append(text.slice(start, match.index));
    const term = button(word, () => open(lookups.get(key), term));
    term.className = 'reference-term';
    term.setAttribute('aria-label', `Define ${word}`);
    paragraph.append(term);
    marked.add(key);
    start = match.index + word.length;
  }
  paragraph.append(text.slice(start));
  return paragraph;
}

export function definitionPanel(dialog, library) {
  const title = dialog.querySelector('#definition-title');
  const body = dialog.querySelector('#definition-body');
  const close = dialog.querySelector('#definition-close');
  let words = [];
  let revision = 0;
  let trigger;
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    revision++;
    window.ArcadeSpeech?.cancel();
    trigger?.focus({ preventScroll: true });
  });

  function follow(word) {
    const clean = String(word).trim().slice(0, 100);
    if (!clean) return;
    if (clean !== words.at(-1)) words.push(clean);
    render();
  }

  async function render(initial = false) {
    const id = ++revision;
    window.ArcadeSpeech?.cancel();
    const word = words.at(-1) || '';
    title.textContent = word || 'Look up a word';
    const form = el('form', 'definition-form');
    const input = el('input');
    input.type = 'search';
    input.id = 'definition-query';
    input.maxLength = 100;
    input.value = word;
    input.autocomplete = 'off';
    input.spellcheck = false;
    const label = el('label', '', 'Find a definition');
    label.htmlFor = input.id;
    const submit = el('button', 'reference-control reference-primary', 'Look up');
    submit.type = 'submit';
    form.append(label, el('div', 'reference-search-row', input, submit));
    form.addEventListener('submit', event => {
      event.preventDefault();
      follow(input.value);
    });
    const toolbar = el('div', 'reference-actions');
    if (words.length > 1) toolbar.append(button('← Previous word', () => { words.pop(); render(); }));
    body.replaceChildren(form, toolbar);
    if (initial || !word) input.focus({ preventScroll: true });
    else if (words.length > 1) toolbar.querySelector('button')?.focus({ preventScroll: true });
    if (!word) return;
    const result = el('div');
    body.append(result);
    if (isProtectiveQuery(word)) {
      title.textContent = 'Talk to a trusted grown-up';
      result.append(el('p', '', 'That’s a question to talk about with a parent or trusted grown-up.'));
      return;
    }
    result.setAttribute('aria-busy', 'true');
    try {
      const entry = await library.findWord(word);
      const suggestions = entry ? [] : await library.searchWords(word, { limit: 6 });
      if (id !== revision || !dialog.open) return;
      if (entry) {
        title.textContent = entry.headword;
        const content = definitionEntry(entry, follow, { showHeading: false });
        const selected = button('Define selected word', () => {
          const phrase = selectedPhrase(content);
          if (phrase) follow(phrase);
          else input.focus();
        });
        selected.addEventListener('pointerdown', event => {
          if (selectedPhrase(content)) event.preventDefault();
        });
        toolbar.append(selected);
        result.replaceChildren(content);
      } else result.replaceChildren(...missingWord(suggestions, follow));
    } catch {
      if (id === revision && dialog.open) result.textContent = 'The definition could not load. Try again.';
    } finally {
      result.setAttribute('aria-busy', 'false');
    }
  }

  return {
    open(word = '', openedFrom = document.activeElement) {
      if (dialog.open) return follow(word);
      trigger = openedFrom;
      words = word ? [word] : [];
      dialog.showModal();
      render(true);
    },
  };
}
