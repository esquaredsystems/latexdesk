// Spell checking worker. Loading a Hunspell dictionary takes a noticeable moment, so it
// happens here, off the extension host thread. Messages: load, check, suggest.
import { parentPort } from 'worker_threads';
import * as fs from 'fs';
import nspell from 'nspell';
import { ACADEMIC_WORDS, proseWords } from '../core/prose';

type Speller = ReturnType<typeof nspell>;
const spellers = new Map<string, { speller: Speller; added: Set<string> }>();

/** One speller per dictionary; words from the user and project dictionaries are added once. */
function speller(aff: string, dic: string, words: string[]): Speller {
  let entry = spellers.get(aff);
  if (!entry) {
    entry = { speller: nspell({ aff: fs.readFileSync(aff), dic: fs.readFileSync(dic) }), added: new Set() };
    spellers.set(aff, entry);
  }
  for (const w of words) {
    if (!entry.added.has(w)) {
      entry.speller.add(w);
      entry.added.add(w);
    }
  }
  return entry.speller;
}

parentPort!.on('message', (msg) => {
  try {
    const s = speller(msg.aff, msg.dic, msg.words);
    if (msg.type === 'check') {
      const known = new Set<string>([...msg.words, ...ACADEMIC_WORDS]);
      const wrong = proseWords(msg.text, msg.skipCommands, msg.from ?? 0).filter((w) => !known.has(w.word) && !known.has(w.word.toLowerCase()) && !s.correct(w.word));
      parentPort!.postMessage({ id: msg.id, wrong });
    } else if (msg.type === 'suggest') {
      parentPort!.postMessage({ id: msg.id, suggestions: s.suggest(msg.word).slice(0, 6) });
    }
  } catch (err) {
    parentPort!.postMessage({ id: msg.id, error: String(err) });
  }
});
