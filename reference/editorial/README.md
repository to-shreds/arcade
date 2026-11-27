# Arcade reference collection

The article files, word files and source registers are the editable records. The articles and definitions are original text written in ChatGPT Work. Source registers identify the specific facts consulted. No third-party corpus, prose, illustrations, credentials or runtime generation are included.

The first collection is the pilot for readers ages 8–9. Types of article, definition, question, quiz and source are verifiable separately. The generated [coverage report](coverage.json) gives counts by subject, editorial status, teachable-term gaps, flagged topics and ambiguous inflections. Only approved entries and the linked definitions they need can enter the bundled collection.

## Adding and reviewing a batch

1. Choose related topics in the taxonomy. Give each article a stable ID, priority, aliases, original short answer, sources, revision and review state. Add relevant facts, optional reading sections or a quiz, and 3–8 questions that each point to another real answer. Add advanced terms to the lexicon and list them in the article's terms. Preserve existing IDs and increase a record's revision when changing substantive content.
2. Read the exact source pages for load-bearing claims. Record publisher, URL, date, factual scope and reuse basis. Keep source text, images and outbound links out of child runtime packs. For reused assets record the actual license, credit and modifications. The starter charts are original and use shapes, CSS and text.
3. Have a different reviewer read the records for accuracy, clarity for ages 8–9, factual restraint, safety and useful question links. Review flagged records in context. Use `draft` until this is done, and `needs-revision` for material defects. Record review scope and revisions in the handoff.
4. Run `node tools/build-reference.mjs`, then `node tools/build-reference.mjs --check`. Inspect coverage after each batch. The `--preview` option makes a temporary review build containing drafts and must be followed by a final non-preview build before staging any packs. The builder checks approved closure across links and terms and removes stale shards. Names and regular inflections need not be marked as terms.
5. Test ordinary questions, related questions, uncertain spellings, definitions and offline launch. Regenerate the Arcade offline manifest after any approved pack changes. Review the ZIP inventory and hashes before delivery.

## Source and lexical licensing

The pilot uses the named reference sources for factual verification, with original definitions, articles and examples. Princeton WordNet 3.0 is a candidate for a later inventory. Its license requires preserving its notice and disclaimer and restricts use of Princeton's name for promotion. Wordfreq is another candidate for prioritization, with Apache 2.0 code and CC BY-SA 4.0 data and notices. Neither dataset was copied into this collection. Before using an inventory, document the exact version and license, separate its data from independently written definitions, and review selection and senses for the intended age range.

- [Princeton WordNet license](https://wordnet.princeton.edu/license-and-commercial-use)
- [Wordfreq notices](https://github.com/rspeer/wordfreq/blob/master/NOTICE.md)

## Next content batch

Use the coverage report to start with empty categories. These topics are proposed inventory, excluded from shipped counts. Use the existing articles as related links only where they genuinely answer a question.

| Area | First topics to add | Existing articles to connect |
| --- | --- | --- |
| Space exploration | Apollo 11, International Space Station, robotic Mars missions, orbits and satellites, reusable rockets, space telescopes | Moon phases, Mars, gravity, our solar system |
| Fungi and microbes | yeast, mushrooms, decomposers, bacteria, pond microbes, how yeast raises bread | Ecosystems, seeds, atoms, digestion |
| Health, nutrition and genetics | cells, DNA, inherited traits, germs and handwashing, immune system, sleep, bones and joints, five senses, food groups | Brain, blood flow, kidneys, lungs, digestion |
| Vehicles and infrastructure | steam locomotives, brakes, elevators, gears, flight, ship buoyancy, bridges, tunnels, canals, water supply | States of matter, density, energy, levers, pulleys |
| Logic and computing | AND/OR/NOT gates, repeating patterns, loops, pixels, Internet packets, accessibility, AI pattern recognition | Binary, algorithms, electrical circuits, online safety |
| Math | multiplication arrays, division/remainders, decimals, place value, angles, symmetry, estimating length | Fractions, equivalent fractions, area |
| Ecosystems and conservation | food webs, forest layers, freshwater wetlands, pollinator gardens, endangered species, restoration, invasive species | Pollination, coral reefs, ecosystems, evolution |
| Animals and fossils | octopuses, bees, penguins, owls, frogs, elephants, blue whales, sharks, trilobites, mammoths | Bats, ocean currents, sound, fossils |
| Countries and maps | China, Indonesia, South Africa, Nigeria, Germany, United Kingdom, Canada regions, Chile, New Zealand, Pacific islands, Antarctica, map scale | Existing country articles, continents, equator, map projections |
| History, literature and arts | Ancient China, Indus Valley, Mali Empire, printing press, oral stories, fables, comics, buildings and arches, film animation, Harriet Tubman | Ancient history, woodcut printing, Library of Congress |
| Sports and everyday science | Baseball, tennis, hockey, swimming, how zippers work, mirrors, soap, refrigeration, food fermentation, why steam rises | Gravity, friction when added, states of matter, light |

After that first batch, enumerate priority country and state profiles, the body systems and key species, then fill gaps by search and educator review. Track progress against 1,000 articles and 5,000 words, then 5,000 and 15,000, and the 10,000-plus article, 25,000-plus word and roughly 50,000-question planning targets. A large index alone does not establish coverage.
