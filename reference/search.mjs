const QUESTION_WORDS = new Set('a an are can could did do does for how i in is it of or the to was what when where which who why will with would you'.split(' '));

export function spelling(text) {
  return String(text ?? '').trim().normalize('NFC').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
}

export function normalize(text) {
  return spelling(text).normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function stem(token) {
  if (token.length > 5 && token.endsWith('ies')) return token.slice(0, -3) + 'y';
  if (token.length > 5 && token.endsWith('ing')) {
    const root = token.slice(0, -3);
    return root.length > 3 && root.at(-1) === root.at(-2) ? root.slice(0, -1) : root;
  }
  if (token.length > 4 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

export function keywords(text) {
  return [...new Set(normalize(text).split(' ').filter(token => token && !QUESTION_WORDS.has(token)).map(stem))];
}

function editsWithin(first, second, limit) {
  if (Math.abs(first.length - second.length) > limit) return false;
  let older = [];
  let previous = Array.from({length: second.length + 1}, (_, i) => i);
  for (let i = 1; i <= first.length; i++) {
    const row = [i];
    for (let j = 1; j <= second.length; j++) {
      row[j] = Math.min(row[j - 1] + 1, previous[j] + 1,
        previous[j - 1] + Number(first[i - 1] !== second[j - 1]));
      if (i > 1 && j > 1 && first[i - 1] === second[j - 2] && first[i - 2] === second[j - 1]) {
        row[j] = Math.min(row[j], older[j - 2] + 1);
      }
    }
    older = previous;
    previous = row;
  }
  return previous[second.length] <= limit;
}

export function buildPostings(records) {
  const postings = new Map();
  const phrases = new Map();
  records.forEach((record, offset) => {
    for (const [index, text] of [record.label, ...record.aliases].entries()) {
      const phrase = normalize(text);
      if (!phrase) continue;
      if (!phrases.has(phrase)) phrases.set(phrase, new Map());
      const exact = phrases.get(phrase);
      exact.set(offset, Math.max(exact.get(offset) ?? 0, index === 0 ? 25 : 20));
      for (const word of keywords(text)) {
        if (!postings.has(word)) postings.set(word, new Map());
        const entries = postings.get(word);
        entries.set(offset, Math.max(entries.get(offset) ?? 0, index === 0 ? 6 : 4));
      }
    }
  });
  const serialize = table => Object.fromEntries([...table].sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([key, values]) => [key, [...values].flat()]));
  return {postings: serialize(postings), phrases: serialize(phrases)};
}

export function createSearch(index) {
  let vocabulary;
  return function search(query, limit) {
    const phrase = normalize(String(query ?? '').slice(0, 240));
    const tokens = keywords(phrase);
    if (!phrase || tokens.length > 20) return [];
    const scores = new Map();
    const add = (matches, weight, seen = new Map()) => {
      if (!matches) return seen;
      for (let i = 0; i < matches.length; i += 2) {
        const id = matches[i];
        seen.set(id, Math.max(seen.get(id) ?? 0, matches[i + 1] * weight));
      }
      return seen;
    };
    const exact = add(Object.hasOwn(index.phrases, phrase) ? index.phrases[phrase] : null, 1);
    for (const token of tokens) {
      if (token.length > 32) continue;
      const candidates = add(Object.hasOwn(index.postings, token) ? index.postings[token] : null, 1);
      if (token.length >= 2) {
        vocabulary ??= Object.keys(index.postings);
        for (const other of vocabulary) {
          if (token === other) continue;
          if (other.startsWith(token)) add(index.postings[other], 0.72, candidates);
          else if (!Object.hasOwn(index.postings, token) && token.length >= 4 &&
              editsWithin(token, other, token.length >= 8 ? 2 : 1)) {
            add(index.postings[other], 0.57, candidates);
          }
        }
      }
      for (const [id, value] of candidates) {
        const score = scores.get(id) ?? {sum: 0, matches: 0, exact: false};
        score.sum += value;
        score.matches++;
        scores.set(id, score);
      }
    }
    for (const [id, value] of exact) {
      const score = scores.get(id) ?? {sum: 0, matches: 0};
      scores.set(id, {...score, sum: score.sum + value, exact: true});
    }
    return [...scores].filter(([, score]) => score.exact || score.matches === tokens.length)
      .sort(([a, x], [b, y]) => y.sum - x.sum || a - b)
      .slice(0, limit).map(([id]) => id);
  };
}

const PROTECTIVE_QUERY = /\b(?:how to|how do i|how can i|instructions to|teach me to)\b.{0,65}\b(?:hurt myself|kill myself|make a bomb|poison someone|hurt someone|kill someone)\b/;
export function isProtectiveQuery(query) {
  return PROTECTIVE_QUERY.test(normalize(String(query ?? '').slice(0, 240)));
}
