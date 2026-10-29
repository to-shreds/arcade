import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { WORDS, isWord, DICTIONARY_ID, DICTIONARY_INFO, PLURAL_S_WORDS, isSimpleSPlural } from './dictionary.js';

const SOURCE_COMMIT = '1e5b7d3a72f47a71da5d28686c1dd4b397178485';
const WORD_HASH = 'e4bdef7d98f32f5f75989a1f7022df2add8d937d1c8c8c01b781420806642b53';
const PLURAL_HASH = '9fe0dbe28383c3b3b7b9f7aed6dc23be1d7b897251d4aab7801319e8b0e35b0f';
const hashList = words => createHash('sha256').update(words.join('\n') + '\n').digest('hex');

test('published dictionary and plural data match the pinned multiplayer identity', () => {
  assert.equal(WORDS.length, 127360);
  assert.equal(PLURAL_S_WORDS.length, 31034);
  assert.equal(hashList(WORDS), WORD_HASH);
  assert.equal(hashList(PLURAL_S_WORDS), PLURAL_HASH);
  assert.equal(DICTIONARY_INFO.wordSha256, WORD_HASH);
  assert.equal(DICTIONARY_INFO.simpleSPluralSha256, PLURAL_HASH);
  assert.equal(DICTIONARY_INFO.wordCount, WORDS.length);
  assert.equal(DICTIONARY_INFO.simpleSPluralCount, PLURAL_S_WORDS.length);
  assert.equal(DICTIONARY_ID, 'esdb80-us-1e5b7d3-e4bdef7d98f3-s9fe0dbe2');
  assert.equal(DICTIONARY_INFO.id, DICTIONARY_ID);
});

test('word data is sorted, unique, ASCII and bounded to the actual board', () => {
  assert.ok(Object.isFrozen(WORDS));
  assert.ok(Object.isFrozen(PLURAL_S_WORDS));
  assert.equal(new Set(WORDS).size, WORDS.length);
  assert.equal(new Set(PLURAL_S_WORDS).size, PLURAL_S_WORDS.length);
  const counts = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [String(index + 2), 0]));
  for (const [index, word] of WORDS.entries()) {
    assert.match(word, /^[A-Z]{2,11}$/);
    assert.ok(word.replaceAll('QU', 'Q').length <= 10, `${word} fits ten squares`);
    if (index) assert.ok(WORDS[index - 1] < word, 'Words are in strict alphabetic order');
    counts[word.length]++;
  }
  assert.deepEqual(counts, DICTIONARY_INFO.countsByLetterLength);
  for (const [index, word] of PLURAL_S_WORDS.entries()) {
    if (index) assert.ok(PLURAL_S_WORDS[index - 1] < word, 'Plural words are in strict alphabetic order');
    assert.ok(word.endsWith('S') && isWord(word) && isWord(word.slice(0, -1)), `${word} has an accepted singular and plural`);
  }
});

test('ordinary words, listed inflections and common-word senses remain available', () => {
  for (const word of ['CAT', 'CATS', 'PLAY', 'PLAYED', 'PLAYING', 'QUIZ', 'QUIZZES', 'COLOR', 'MOOD', 'WOOD', 'WOOL', 'LEAP', 'LEAN', 'SNACK', 'PLUS', 'ON', 'NET', 'CAFE', 'MAY', 'MARCH']) {
    assert.equal(isWord(word), true, word);
    assert.equal(isWord(word.toLowerCase()), true, `${word} is case insensitive at lookup`);
  }
  assert.equal(isWord('cAt'), true);
  // Inflections must be present in the pinned list, never guessed from a root.
  for (const word of ['CATSS', 'PLAYEDS', 'PLAYEDING', 'CHILDS', 'DOGED', 'RUNNED']) assert.equal(isWord(word), false, word);
});

test('capitalized-only names, abbreviations, punctuation and malformed inputs stay excluded', () => {
  for (const word of ['LONDON', 'JANUARY', 'NASA', 'FBI', 'iPhone', 'ASAP', 'ETC', 'CM', 'CD', 'DM', 'MG', 'KM', 'ML', 'COLOUR', "CAN'T", 'ICE-CREAM', 'NEW YORK', 'CAT1', ' CAT', 'CAT ', 'CÁT', 'XYZNOTWORD', 'A', 'I', '']) {
    assert.equal(isWord(word), false, JSON.stringify(word));
  }
  for (const value of [null, undefined, 12, {}, ['CAT'], true]) assert.equal(isWord(value), false);
});

test('eleven-letter QU words fit ten squares without allowing overlong ordinary words', () => {
  for (const word of ['SQUEAKINESS', 'EQUIVALENCE', 'QUADRUPLETS', 'LIQUIDATORS']) {
    assert.equal(word.length, 11);
    assert.equal(word.replaceAll('QU', 'Q').length, 10);
    assert.equal(isWord(word), true);
  }
  assert.equal(isWord('OUTSTANDING'), false, 'Eleven ordinary letters require eleven board squares');
  assert.equal(isWord('QU'), false, 'The special tile alone is not a listed word');
});

test('the single-S rule uses actual plural metadata, preserving HI to HIS', () => {
  for (const [base, extended] of [['CAT', 'CATS'], ['DOG', 'DOGS'], ['NET', 'NETS'], ['CAFE', 'CAFES']]) {
    assert.equal(isSimpleSPlural(base, extended), true, `${base} to ${extended}`);
    assert.equal(isSimpleSPlural(base.toLowerCase(), extended.toLowerCase()), true);
  }
  for (const [base, extended] of [['HI', 'HIS'], ['HI', 'THIS'], ['BASIS', 'BASES'], ['CAT', 'CAT'], ['ABC', 'ABCS']]) assert.equal(isSimpleSPlural(base, extended), false, `${base} to ${extended}`);
  assert.equal(isWord('HI'), true);
  assert.equal(isWord('HIS'), true);
  assert.equal(isSimpleSPlural(null, 'CATS'), false);
  assert.equal(isSimpleSPlural('CAT', undefined), false);
});

test('generated metadata and accompanying license retain exact source attribution', async () => {
  const metadata = JSON.parse(await readFile(new URL('./dictionary-source.json', import.meta.url), 'utf8'));
  const license = await readFile(new URL('./LICENSE.dictionary.txt', import.meta.url), 'utf8');
  const module = await readFile(new URL('./dictionary.js', import.meta.url), 'utf8');
  const builder = await readFile(new URL('../tools/build-upwords-dictionary.py', import.meta.url), 'utf8');
  assert.deepEqual(metadata, DICTIONARY_INFO);
  assert.equal(metadata.sourceCommit, SOURCE_COMMIT);
  assert.equal(metadata.sourceUrl, 'https://github.com/en-wl/wordlist');
  assert.equal(metadata.sourceLicenseUrl, `https://github.com/en-wl/wordlist/blob/${SOURCE_COMMIT}/Copyright`);
  assert.equal(metadata.size, 80);
  assert.equal(metadata.spelling, 'American English');
  assert.equal(metadata.variantLevel, 1);
  assert.ok(metadata.buildArguments.includes('--wo-tags=[moby],[lcacr],[ucacr],[upper]'), 'Noisy abbreviation-source exclusions are reproducible');
  assert.match(metadata.pluralQuery, /lemma\.word_id = s\.lemma_id/);
  assert.match(license, /Copyright 2000-2026 by Kevin Atkinson/);
  assert.match(license, /Permission to use, copy, modify, distribute, and sell/);
  assert.match(license, /Alan Beale/);
  assert.ok(module.includes(license.trim()), 'The playable module carries the full applicable notice');
  assert.ok(builder.includes(SOURCE_COMMIT) && builder.includes('--check'), 'The pinned data has a reproducible build/check command');
});

test('all reviewed two-letter game words are playable', () => {
 for (const word of DICTIONARY_INFO.shortWordAudit) assert.ok(isWord(word), word);
});
