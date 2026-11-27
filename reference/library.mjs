import {createSearch, isProtectiveQuery, normalize, spelling} from './search.mjs';

const packBase = new URL('./packs/catalog.json', import.meta.url);
const safeId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const bounded = (value, fallback, maximum) => Number.isInteger(value) ? Math.min(maximum, Math.max(0, value)) : fallback;
export {isProtectiveQuery};

export function createReferenceLibrary({fetcher = globalThis.fetch.bind(globalThis)} = {}) {
  const pending = new Map();

  function load(path) {
    if (pending.has(path)) return pending.get(path);
    const promise = (async () => {
      const response = await fetcher(new URL(path, packBase));
      if (!response.ok) throw new Error('The local reference files could not be opened.');
      const data = await response.json();
      if (data.schema !== 1) throw new Error('This reference collection uses an unsupported version.');
      return data;
    })().catch(error => {
      pending.delete(path);
      throw error;
    });
    pending.set(path, promise);
    return promise;
  }

  let articleIndex;
  let wordIndex;
  const getArticles = async () => {
    if (articleIndex) return articleIndex;
    const data = await load('articles.json');
    articleIndex = {cards: data.cards, byId: new Map(data.cards.map(card => [card.id, card])),
      search: createSearch(data.index)};
    return articleIndex;
  };
  const getWords = async () => {
    if (wordIndex) return wordIndex;
    const data = await load('words.json');
    wordIndex = {cards: data.cards, exact: data.exact, search: createSearch(data.index)};
    return wordIndex;
  };

  const getCatalog = () => load('catalog.json');
  const searchArticles = async (query, {limit} = {}) => {
    if (!String(query ?? '').trim() || isProtectiveQuery(query)) return [];
    const {cards, search} = await getArticles();
    return search(query, bounded(limit, 12, 100)).map(offset => cards[offset]);
  };
  const listArticles = async ({category, limit, offset} = {}) => {
    const {cards} = await getArticles();
    const start = bounded(offset, 0, cards.length);
    const list = category ? cards.filter(card => card.category === category) : cards;
    return list.slice(start, start + bounded(limit, 24, 250));
  };
  const getArticle = async id => {
    if (typeof id !== 'string' || !safeId.test(id)) return null;
    const card = (await getArticles()).byId.get(id);
    if (!card) return null;
    const {entries} = await load(`articles/${card.shard}.json`);
    return entries.find(entry => entry.id === id) ?? null;
  };
  const randomArticle = async () => {
    const {cards} = await getArticles();
    return cards[Math.floor(Math.random() * cards.length)] ?? null;
  };
  const findWord = async query => {
    const word = spelling(String(query ?? '').slice(0, 240)).replace(/^[^\p{L}\p{N}-]+|[^\p{L}\p{N}'-]+$/gu, '');
    if (!word) return null;
    const {cards, exact} = await getWords();
    const normalized = normalize(word);
    const key = Object.hasOwn(exact, word) ? word : normalized;
    const position = Object.hasOwn(exact, key) ? exact[key] : undefined;
    if (position === undefined) return null;
    const card = cards[position];
    const {entries} = await load(`words/${card.shard}.json`);
    return entries.find(entry => entry.headword === card.headword) ?? null;
  };
  const searchWords = async (query, {limit} = {}) => {
    const word = spelling(String(query ?? '').slice(0, 240));
    if (!word || isProtectiveQuery(word)) return [];
    const {cards, exact, search} = await getWords();
    const maximum = bounded(limit, 12, 100);
    const normalized = normalize(word);
    const positions = search(word, maximum);
    const direct = Object.hasOwn(exact, word) ? exact[word] : Object.hasOwn(exact, normalized) ? exact[normalized] : undefined;
    return (direct === undefined ? positions : [direct, ...positions.filter(position => position !== direct)])
      .slice(0, maximum).map(position => cards[position]);
  };
  const listWords = async (letter, {limit, offset} = {}) => {
    const {cards} = await getWords();
    const prefix = normalize(letter);
    const start = bounded(offset, 0, cards.length);
    return (prefix ? cards.filter(card => normalize(card.headword).startsWith(prefix)) : cards)
      .slice(start, start + bounded(limit, 48, 250));
  };

  return {getCatalog, searchArticles, listArticles, getArticle, randomArticle, findWord, searchWords, listWords};
}
