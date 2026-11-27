import { createReferenceLibrary, isProtectiveQuery } from '../reference/library.mjs';
import { appendResults, button, clearButton, collection, currentHash, currentQuery, el, listing, listen, navigation, quickQuiz, saveButton, section, setQuery } from '../dictionary/ui.mjs';
import { definitionPanel, markedParagraph, selectedPhrase } from '../dictionary/definition.mjs';

const library = createReferenceLibrary();
const definitions = definitionPanel(document.querySelector('#reference-definition'), library);
const form = document.querySelector('#reference-search');
const surprise = document.querySelector('#reference-surprise');
const safeId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const routes = navigation({ initial: fromHash(), render, hashFor, fromHash });
const openArticle = id => routes.open({ type: 'article', id });
const openCategory = id => routes.open({ type: 'category', id });
const selectionControls = new WeakMap();

function fromHash() {
  const params = currentHash();
  if (safeId.test(params.get('article') || '')) return { type: 'article', id: params.get('article') };
  if (safeId.test(params.get('topic') || '')) return { type: 'category', id: params.get('topic') };
  if (params.has('saved')) return { type: 'saved' };
  return { type: 'home' };
}

function hashFor(route) {
  if (route.type === 'article') return `#article=${route.id}`;
  if (route.type === 'category') return `#topic=${route.id}`;
  if (route.type === 'saved') return '#saved';
  return '';
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const query = currentQuery();
  routes.open(query ? { type: 'search', query } : { type: 'home' });
});
form.querySelector('input').addEventListener('search', () => {
  if (!currentQuery()) routes.open({ type: 'home' });
});
document.querySelector('#reference-start').addEventListener('click', () => routes.open({ type: 'home' }));
document.querySelector('#reference-browse').addEventListener('click', () => routes.open({ type: 'home' }));
document.querySelector('#reference-saved').addEventListener('click', () => routes.open({ type: 'saved' }));
document.querySelector('#reference-lookup').addEventListener('click', event => definitions.open('', event.currentTarget));
surprise.addEventListener('click', async () => {
  surprise.disabled = true;
  try {
    const article = await library.randomArticle();
    if (article) await openArticle(article.id);
    else await routes.open({ type: 'unavailable' });
  } catch {
    await routes.open({ type: 'unavailable' });
  } finally {
    surprise.disabled = false;
  }
});
document.addEventListener('selectionchange', () => selectionControls.get(document.querySelector('.reference-article'))?.());

function articleResults(items, categories) {
  return listing(items, item => openArticle(item.id), {
    title: item => item.title,
    detail: item => [categories.get(item.category), item.summary].filter(Boolean).join(' · '),
  });
}

function topicPanel(categories) {
  const list = el('ul', 'reference-grid');
  for (const { id, label } of categories) list.append(el('li', '', button(label, () => openCategory(id))));
  return section('Browse topics', list);
}

async function dailyFact(count) {
  if (!count) return '';
  const today = new Date();
  const day = Math.floor(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86_400_000);
  const [card] = await library.listArticles({ limit: 1, offset: day % count });
  if (!card) return '';
  const article = await library.getArticle(card.id);
  if (!article) return '';
  const fact = article.fact || article.facts?.[0] || article.answer.match(/^.*?[.!?](?=\s|$)/)?.[0] || article.answer;
  const feature = section('Fact of the day', el('p', '', fact), button(`Explore ${article.title}`, () => openArticle(article.id)));
  feature.classList.add('reference-fact');
  return feature;
}

function savedPanel(title, key, empty) {
  const saved = collection.list(key);
  if (!saved.length) return section(title, el('p', 'reference-note', empty));
  return section(title, listing(saved, item => openArticle(item.id), { title: item => item.label }),
    clearButton(`Clear ${title.toLowerCase()}`, `Clear your ${title.toLowerCase()} on this device?`, () => {
      collection.clear(key);
      routes.refresh();
    }));
}

function selectedControl(copy) {
  const openSelected = trigger => {
    const phrase = selectedPhrase(copy);
    if (phrase) definitions.open(phrase, trigger);
    else definitions.open('', trigger);
  };
  const define = button('Define selected word', event => openSelected(event.currentTarget));
  const nearby = button('Define highlighted word', () => openSelected(define), 'reference-selection reference-primary');
  nearby.tabIndex = -1;
  nearby.hidden = true;
  for (const control of [define, nearby]) control.addEventListener('pointerdown', event => {
    if (selectedPhrase(copy)) event.preventDefault();
  });
  const update = () => {
    const chosen = selectedPhrase(copy);
    nearby.hidden = !chosen;
    // Keep the persistent keyboard target available as the selection changes.
    define.title = chosen ? `Look up ${chosen}` : 'Select text in the article or open a dictionary search';
  };
  return { define, nearby, update };
}

function articleDiagram(id) {
  if (id === 'solar-system') {
    const order = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
    const planets = el('ol', 'planet-order', ...order.map(name => {
      const planet = el('span', `planet-mark planet-${name.toLowerCase()}`);
      planet.setAttribute('aria-hidden', 'true');
      return el('li', '', planet, name);
    }));
    return el('figure', 'reference-diagram', planets,
      el('figcaption', '', 'Planet order, starting nearest the Sun. Sizes and spacing aren’t to scale.'));
  }
  if (id === 'equivalent-fractions') {
    const strips = el('div', 'fraction-strips');
    for (const [parts, shaded] of [[2, 1], [4, 2]]) {
      const strip = el('span', 'fraction-strip');
      strip.setAttribute('aria-hidden', 'true');
      for (let index = 0; index < parts; index++) strip.append(el('span', index < shaded ? 'fraction-shaded' : ''));
      strips.append(el('div', 'fraction-row', el('strong', '', `${shaded}/${parts}`), strip));
    }
    return el('figure', 'reference-diagram', strips, el('figcaption', '', 'Both strips show the same amount shaded: one half.'));
  }
  return null;
}

function renderArticle(article, categories) {
  const { id, title, category, answer, sections = [], facts = [], terms = [], questions = [], quiz } = article;
  const header = el('header', '', el('p', 'reference-label', categories.get(category) || 'Encyclopedia'), el('h1', '', title));
  const spoken = listen(`${title}. ${answer}`);
  const copy = el('div', 'article-copy');
  const marked = new Set();
  const teach = text => markedParagraph(text, terms, marked, (word, trigger) => definitions.open(word, trigger));
  for (const paragraph of answer.split(/\n\s*\n/)) copy.append(teach(paragraph));
  const diagram = articleDiagram(id);
  if (diagram) copy.append(diagram);
  if (facts.length) {
    const factsList = el('ul');
    for (const fact of facts) factsList.append(el('li', '', teach(fact)));
    copy.append(el('h2', '', 'Key facts'), factsList);
  }
  if (sections.length) {
    const details = el('details', '', el('summary', '', 'Find out more'));
    for (const item of sections) details.append(el('h3', '', item.heading), ...item.text.split(/\n\s*\n/).map(text => teach(text)));
    copy.append(details);
  }
  const unmarked = terms.filter(term => !marked.has(term.toLowerCase()));
  if (unmarked.length) {
    const links = el('div', 'reference-actions');
    for (const word of unmarked) links.append(button(word, event => definitions.open(word, event.currentTarget)));
    copy.append(el('h2', '', 'Words to know'), links);
  }
  const { define, nearby, update } = selectedControl(copy);
  const bookmark = saveButton('favorites', id, title, ['Bookmark', 'Remove bookmark']);
  header.append(el('div', 'article-tools', spoken.speak, spoken.stop, bookmark, define), spoken.feedback);
  const page = el('article', 'reference-article reference-panel', header, copy, nearby);
  selectionControls.set(page, update);
  if (questions.length) {
    const links = listing(questions, item => openArticle(item.target), { title: item => item.text });
    page.append(el('section', 'article-copy', el('h2', '', 'What else do you wonder?'), links));
  }
  if (quiz) {
    const quizPanel = el('details', 'article-copy', el('summary', '', 'Try a question'), quickQuiz(quiz));
    page.append(quizPanel);
  }
  return page;
}

async function render(route, snapshot) {
  if (route.type === 'search') setQuery(route.query);
  else if (route.type !== 'article') setQuery('');
  const catalog = await library.getCatalog();
  const categories = new Map(catalog.categories.map(({ id, label }) => [id, label]));
  const fragment = document.createDocumentFragment();

  switch (route.type) {
    case 'search': {
      if (isProtectiveQuery(route.query)) return section('Talk to a trusted grown-up', el('p', '', 'That’s a question to talk about with a parent or trusted grown-up.'));
      const hits = await library.searchArticles(route.query);
      if (hits.length) return section('Search results', articleResults(hits, categories));
      fragment.append(section('No answer found', el('p', '', 'The encyclopedia doesn’t have an answer for that yet. Try a shorter search or choose a topic.')), topicPanel(catalog.categories));
      break;
    }
    case 'article': {
      const article = await library.getArticle(route.id);
      if (!article) return section('Article unavailable', el('p', '', 'This article is not in this copy of the encyclopedia.'), button('Browse topics', () => routes.open({ type: 'home' })));
      collection.record('recent', article.id, article.title);
      return renderArticle(article, categories);
    }
    case 'category': {
      const label = categories.get(route.id);
      if (!label) return topicPanel(catalog.categories);
      const panel = section(label);
      await appendResults(panel, options => library.listArticles({ ...options, category: route.id }),
        items => articleResults(items, categories), () => el('p', 'reference-note', 'There are no articles in this topic yet.'), snapshot);
      return panel;
    }
    case 'saved':
      fragment.append(savedPanel('Bookmarks', 'favorites', 'Bookmark an article to find it here.'),
        savedPanel('Recently viewed', 'recent', 'Articles you read will appear here.'));
      break;
    case 'unavailable':
      fragment.append(section('Surprise article unavailable', button('Browse topics', () => routes.open({ type: 'home' }))));
      break;
    default:
      fragment.append(await dailyFact(catalog.counts.articles).catch(() => ''), topicPanel(catalog.categories));
  }
  return fragment;
}

routes.start().finally(() => {
  for (const field of form.querySelectorAll('input, button[type="submit"]')) field.disabled = false;
});
