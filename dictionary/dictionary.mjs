import { createReferenceLibrary, isProtectiveQuery } from '../reference/library.mjs';
import { appendResults, button, clearButton, collection, currentHash, currentQuery, el, navigation, quickQuiz, section, setQuery } from './ui.mjs';
import { definitionEntry, missingWord, selectedPhrase, wordResults } from './definition.mjs';

const library = createReferenceLibrary();
const form = document.querySelector('#reference-search');
const input = document.querySelector('#reference-query');
const completions = document.querySelector('#word-completions');
const routes = navigation({ initial: fromHash(), render, hashFor, fromHash });
const openWord = word => {
  hideCompletions();
  return routes.open({ type: 'word', word });
};
let completionTimer;
let completionId = 0;

function fromHash() {
  const params = currentHash();
  const word = params.get('word');
  const letter = params.get('letter');
  if (word && word.length <= 100) return { type: 'word', word };
  if (/^[A-Z]$/.test(letter || '')) return { type: 'browse', letter };
  if (params.has('saved')) return { type: 'saved' };
  return { type: 'browse', letter: '' };
}

function hashFor(route) {
  if (route.type === 'word' && route.word === route.headword) return `#word=${encodeURIComponent(route.word)}`;
  if (route.type === 'browse' && route.letter) return `#letter=${route.letter}`;
  if (route.type === 'saved') return '#saved';
  return '';
}

function hideCompletions() {
  clearTimeout(completionTimer);
  completionId++;
  completions.hidden = true;
  completions.replaceChildren();
}

function showCompletions() {
  hideCompletions();
  const word = currentQuery();
  if (!word || isProtectiveQuery(word)) return;
  const id = completionId;
  completionTimer = setTimeout(async () => {
    try {
      const matches = await library.searchWords(word, { limit: 6 });
      if (id !== completionId || !matches.length) return;
      completions.append(wordResults(matches, item => openHeadword(item.headword)));
      completions.hidden = false;
    } catch { /* A submitted lookup displays its own load error. */ }
  }, 120);
}

function openHeadword(word) {
  hideCompletions();
  return routes.open({ type: 'word', word, headword: word });
}

input.addEventListener('input', showCompletions);
input.addEventListener('keydown', event => {
  if (event.key === 'Escape') hideCompletions();
  if (event.key === 'ArrowDown' && !completions.hidden) {
    event.preventDefault();
    completions.querySelector('button')?.focus();
  }
});
completions.addEventListener('keydown', event => {
  const buttons = [...completions.querySelectorAll('button')];
  const index = buttons.indexOf(event.target);
  if (event.key === 'Escape') {
    hideCompletions();
    input.focus();
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const next = buttons[index + (event.key === 'ArrowDown' ? 1 : -1)];
    (next || input).focus();
  }
});
form.addEventListener('focusout', event => {
  if (!form.contains(event.relatedTarget)) hideCompletions();
});
form.addEventListener('submit', event => {
  event.preventDefault();
  const word = currentQuery();
  if (word) openWord(word);
  else routes.open({ type: 'browse', letter: '' });
});
for (const id of ['#reference-start', '#reference-browse']) {
  document.querySelector(id).addEventListener('click', () => routes.open({ type: 'browse', letter: '' }));
}
document.querySelector('#reference-saved').addEventListener('click', () => routes.open({ type: 'saved' }));

async function browse(letter, snapshot) {
  const letters = el('ul', 'reference-letters');
  for (const item of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const target = button(item, () => routes.open({ type: 'browse', letter: item }));
    target.setAttribute('aria-pressed', String(item === letter));
    letters.append(el('li', '', target));
  }
  const panel = section('Browse A–Z', letters, el('h3', 'dictionary-words-title', letter ? `Words starting with ${letter}` : 'All words'));
  await appendResults(panel, options => library.listWords(letter, options),
    items => wordResults(items, item => openHeadword(item.headword)), () => el('p', 'reference-note', `There are no words under ${letter || 'this list'} yet.`), snapshot);
  return panel;
}

function savedWords() {
  const saved = collection.list('words');
  if (!saved.length) return section('My words', el('p', 'reference-note', 'Open a definition and choose Save word to keep it here.'));
  return section('My words', wordResults(saved.map(item => ({ headword: item.id })), item => openHeadword(item.headword)),
    el('div', 'reference-actions', button('Review my words', () => routes.open({ type: 'review', index: 0 }))),
    clearButton('Clear saved words', 'Clear your saved words on this device?', () => {
      collection.clear('words');
      routes.refresh();
    }));
}

async function review(index) {
  const saved = collection.list('words');
  if (!saved.length) return savedWords();
  const position = index % saved.length;
  const [entry, ...others] = await Promise.all([saved[position], ...saved.filter((_, offset) => position !== offset).slice(0, 3)]
    .map(item => library.findWord(item.id)));
  const definition = entry?.senses[0]?.definition;
  if (!definition) return section('Word unavailable', button('Return to my words', () => routes.open({ type: 'saved' })));
  const values = [...new Set(others.map(item => item?.senses[0]?.definition).filter(value => value && value !== definition))];
  const next = button('Next word', () => routes.open({ type: 'review', index: index + 1 }));
  const positionText = el('p', 'reference-note', `Word ${position + 1} of ${saved.length}`);
  if (!values.length) {
    return section('Review my words', positionText, el('p', '', `What does “${entry.headword}” mean?`),
      el('details', '', el('summary', '', 'Show definition'), el('p', '', definition)), el('div', 'reference-actions', next));
  }
  const answer = Math.floor(Math.random() * (values.length + 1));
  values.splice(answer, 0, definition);
  return section('Review my words', positionText, quickQuiz({ question: `What does “${entry.headword}” mean?`, options: values, answer }), next);
}

async function render(route, snapshot) {
  hideCompletions();
  setQuery(route.type === 'word' ? route.word : '');
  switch (route.type) {
    case 'saved': return savedWords();
    case 'review': return review(route.index);
    case 'word': {
      if (isProtectiveQuery(route.word)) return section('Talk to a trusted grown-up', el('p', '', 'That’s a question to talk about with a parent or trusted grown-up.'));
      const entry = await library.findWord(route.word);
      if (!entry) return section('No definition found', ...missingWord(await library.searchWords(route.word, { limit: 8 }), openHeadword));
      const result = definitionEntry(entry, openHeadword);
      const define = button('Define selected word', () => {
        const phrase = selectedPhrase(result);
        if (phrase) openWord(phrase);
        else input.focus();
      });
      define.addEventListener('pointerdown', event => {
        if (selectedPhrase(result)) event.preventDefault();
      });
      result.querySelector('.reference-actions').append(define);
      return result;
    }
    default: return browse(route.letter, snapshot);
  }
}

routes.start().finally(() => {
  for (const field of form.querySelectorAll('input, button[type="submit"]')) field.disabled = false;
});
