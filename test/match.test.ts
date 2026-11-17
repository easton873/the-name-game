import assert from 'node:assert/strict';
import { validateName } from '../shared/names.js';
import { matchName } from '../server/match.js';

// --- validation
assert.equal(validateName('P!nk').ok, true);
assert.equal(validateName('  Captain   Jack ').ok && (validateName('  Captain   Jack ') as { name: string }).name, 'Captain Jack');
assert.equal(validateName('Beyoncé').ok, true);
assert.equal(validateName('R2D2').ok, true);
assert.equal(validateName('Cash$ & @Money!').ok, true);
for (const bad of ['Bob 😀', 'a-b', "O'Brien", 'x#y', '<b>', 'a_b']) assert.equal(validateName(bad).ok, false, bad);
assert.equal(validateName('!!!').ok, false);
assert.equal(validateName('x'.repeat(25)).ok, false);
const e = validateName('hi 😀');
assert.ok(!e.ok && e.error.includes('😀') && e.error.includes('$ ! & @'));

// --- matching: whole names only
const pool = ['Captain Jack', 'Beyoncé', 'P!nk', 'Gandalf', 'Bob'];
assert.deepEqual(matchName('captain jack', pool), { kind: 'match', name: 'captain jack' });
assert.deepEqual(matchName('Beyonce', pool), { kind: 'match', name: 'beyonce' }); // accents ignored
assert.deepEqual(matchName('p!nk', pool), { kind: 'match', name: 'p!nk' });
assert.equal(matchName('Captain', pool).kind, 'none'); // every part must be remembered
assert.equal(matchName('Jack', pool).kind, 'none');
assert.equal(matchName('Pink', pool).kind, 'match'); // 4+ letters: one typo forgiven
assert.equal(matchName('Bib', pool).kind, 'none');
assert.deepEqual(matchName('Gandalff', pool), { kind: 'match', name: 'gandalf' }); // one typo forgiven
assert.equal(matchName('Dumbledore', pool).kind, 'none');
// names that were removed from the pool no longer match
assert.equal(matchName('Bob', pool.filter((n) => n !== 'Bob')).kind, 'none');
// equally close to two different names
assert.equal(matchName('Johnx', ['Johna', 'Johnb']).kind, 'ambiguous');
// exact beats close
assert.deepEqual(matchName('Johna', ['Johna', 'Johnb']), { kind: 'match', name: 'johna' });
// duplicates are one name
assert.deepEqual(matchName('Bob', ['Bob', 'bob']), { kind: 'match', name: 'bob' });
console.log('match tests passed');
