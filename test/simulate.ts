// Plays a full game with bots over real sockets against a real server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { io, type Socket } from 'socket.io-client';
import type { ClientState, ClientToServerEvents, ServerToClientEvents } from '../shared/types.js';

type S = Socket<ServerToClientEvents, ClientToServerEvents>;
const PORT = 3217;
const server = spawn('npx', ['tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT), TIMING_SCALE: '0.02' }, stdio: 'ignore', detached: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const connect = (): S => io(`http://localhost:${PORT}`, { transports: ['websocket'] });
const emit = <T = any>(s: S, ev: string, ...args: any[]): Promise<T> => new Promise((res) => (s as any).emit(ev, ...args, res));

const SECRETS: Record<string, string> = { Ann: 'Captain Jack', Bo: 'P!nk', Cy: 'Gandalf the Grey', Di: 'Beyoncé' };

async function main() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/health`)).ok) break;
    } catch {
      await sleep(200);
    }
  }
  const host = connect();
  const created = await emit(host, 'host:create');
  let hostState!: ClientState;
  host.on('state', (s) => (hostState = s));
  const secretsSeenByPhones: string[] = [];
  let phase = '';
  const bots: Record<string, { s: S; id: string; st?: ClientState }> = {};
  for (const name of Object.keys(SECRETS)) {
    const s = connect();
    const r = await emit(s, 'player:join', { code: created.code, name });
    assert.ok(r.ok);
    bots[name] = { s, id: r.playerId };
    s.on('state', (st) => {
      bots[name].st = st;
      if (st.phase !== 'gameOver') secretsSeenByPhones.push(JSON.stringify(st));
    });
  }
  await sleep(100);
  host.emit('host:start');
  await sleep(100);
  assert.equal(hostState.phase, 'names');

  // invalid characters are rejected by the server too
  let r = await emit(bots.Ann.s, 'player:submitName', { name: 'Ann 😀' });
  assert.ok(!r.ok && /symbol/.test(r.error), 'emoji rejected');
  for (const [n, secret] of Object.entries(SECRETS)) assert.ok((await emit(bots[n].s, 'player:submitName', { name: secret })).ok);
  await sleep(100);
  assert.equal(hostState.phase, 'memorize');

  // memorize pass 1: host sees names, phones never do
  const shown: string[] = [];
  while (hostState.phase === 'memorize' && hostState.memorize!.pass === 1) {
    if (hostState.memorize!.index >= 0) shown.push(hostState.memorize!.name!);
    await sleep(20);
  }
  assert.equal(new Set(shown).size, 4, 'all four names shown in pass 1');
  assert.equal(hostState.phase, 'ready');
  for (const b of Object.values(bots)) b.s.emit('player:ready'); // no ack, like the real phones
  await sleep(100);
  assert.equal(hostState.memorize?.pass, 2);
  while (hostState.phase === 'memorize') await sleep(20);
  assert.equal(hostState.phase, 'play');
  for (const [who, secret] of Object.entries(SECRETS)) {
    for (const b of Object.values(bots)) if (b.id !== bots[who].id) assert.ok(!JSON.stringify(b.st).includes(secret), `${secret} leaked to a phone`);
  }

  // ---- play
  const byId = (id: string) => Object.entries(bots).find(([, b]) => b.id === id)!;
  const secretOf = (id: string) => SECRETS[byId(id)[0]];
  const waitIdle = async () => {
    for (let i = 0; i < 400; i++) {
      if (hostState.phase === 'gameOver' || (hostState.play && !hostState.play.event)) return;
      await sleep(10);
    }
    throw new Error('stuck waiting for the event to clear');
  };
  const turn = () => byId(hostState.play!.turnLeaderId!);

  // 1) everybody gives up -> letters get revealed, no names yet
  await waitIdle();
  for (let i = 0; i < 4; i++) {
    await waitIdle();
    assert.ok((await emit(turn()[1].s, 'player:giveUp')).ok);
  }
  await waitIdle();
  assert.equal(hostState.play!.revealLevel, 1);
  assert.equal(hostState.play!.masks.length, 4);
  assert.ok(hostState.play!.masks.every((m) => /^\S[_ ]*$/.test(m.replace(/ /g, '')) || m.length > 0));
  assert.ok(hostState.play!.masks.some((m) => m.startsWith('C') && m.includes(' ')), 'multi-part name keeps its space');

  // 1b) a give-up followed by a wrong guess: the wrong guess clears the give-up streak
  {
    const [, first] = turn();
    assert.ok((await emit(first.s, 'player:giveUp')).ok);
    await sleep(30);
    assert.ok(hostState.play!.teams.some((t) => t.gaveUp), 'give-up recorded');
    await waitIdle();
  }

  // 2) free retries: emoji, unknown name, wrong target team
  let [name, me] = turn();
  const others = Object.entries(bots).filter(([n]) => n !== name);
  const [targetName, target] = others[0];
  r = await emit(me.s, 'player:guess', { targetId: target.id, name: 'Nope 😀' });
  assert.ok(!r.ok && /symbol/.test(r.error));
  r = await emit(me.s, 'player:guess', { targetId: target.id, name: 'Totally Unknown' });
  assert.ok(!r.ok && /isn't one of the names/.test(r.error));
  r = await emit(me.s, 'player:guess', { targetId: me.id, name: SECRETS[name] });
  assert.ok(!r.ok, 'cannot target yourself');
  assert.equal(hostState.play!.turnLeaderId, me.id, 'free retries keep the turn');
  const notTurn = others[1][1];
  r = await emit(notTurn.s, 'player:guess', { targetId: me.id, name: 'whatever' });
  assert.ok(!r.ok && /turn/.test(r.error));

  // 3) a wrong guess (a real name, wrong player) passes the turn to the guessed player
  const wrongName = SECRETS[others[1][0]];
  r = await emit(me.s, 'player:guess', { targetId: target.id, name: wrongName });
  assert.ok(r.ok && r.result === 'wrong');
  await sleep(30);
  assert.equal(hostState.play!.event!.kind, 'wrong');
  assert.ok(hostState.play!.teams.every((t) => !t.gaveUp), 'a wrong guess clears all give-ups');
  assert.equal(hostState.play!.turnLeaderId, target.id);
  r = await emit(target.s, 'player:giveUp');
  assert.ok(!r.ok, 'no actions while a result is on screen');
  await waitIdle();

  // 4) correct guesses (with sloppy casing / accents) until one team is left
  let merges = 0;
  let checkedTeam = false;
  while (hostState.phase === 'play') {
    await waitIdle();
    if (hostState.phase !== 'play') break;
    [name, me] = turn();
    const t = hostState.play!.teams.find((x) => x.leaderId !== me.id)!;
    const sloppy = secretOf(t.leaderId).toUpperCase().replace('É', 'E');
    if (merges > 0 && !checkedTeam) {
      checkedTeam = true;
      // teammates can only suggest: unchecked, shown to the leader only, and they can't guess or give up
      const mate = Object.values(bots).find((b) => b.id !== me.id && b.st?.you?.teamLeaderId === me.id)!;
      assert.ok(mate, 'has a teammate');
      assert.ok(!mate.st!.you!.canGuess && mate.st!.you!.canSuggest);
      r = await emit(mate.s, 'player:suggest', { text: 'Totally Fake 😀 Name', targetId: t.leaderId });
      assert.ok(r.ok, 'suggestions are not validated');
      await sleep(30);
      assert.equal(me.st!.you!.suggestions.length, 1);
      assert.equal(me.st!.you!.suggestions[0].text, 'Totally Fake 😀 Name');
      assert.equal(me.st!.you!.suggestions[0].fromId, mate.id);
      assert.equal(mate.st!.you!.suggestions.length, 0, 'only the leader sees suggestions');
      assert.ok(!JSON.stringify(hostState).includes('Totally Fake'), 'the big screen never sees suggestions');
      assert.ok(!(await emit(mate.s, 'player:guess', { targetId: t.leaderId, name: sloppy })).ok, 'teammates cannot guess');
      assert.ok(!(await emit(mate.s, 'player:giveUp')).ok, 'teammates cannot give up');
      assert.ok(!(await emit(me.s, 'player:suggest', { text: 'x' })).ok, 'the leader does not suggest');
      assert.ok(!(await emit(mate.s, 'player:suggest', { text: '   ' })).ok, 'empty suggestions rejected');
      // a name that was already guessed is STILL a valid guess: it counts as a (wrong) guess and ends the turn
      const gone = Object.values(SECRETS).find((x) => !hostState.play!.teams.some((tm) => secretOf(tm.leaderId) === x))!;
      r = await emit(me.s, 'player:guess', { targetId: t.leaderId, name: gone });
      assert.ok(r.ok && r.result === 'wrong', 'a guessed name stays in the pool of valid guesses');
      await sleep(30);
      assert.equal(me.st!.you!.suggestions.length, 0, 'suggestions are cleared with the turn');
      assert.equal(hostState.play!.turnLeaderId, t.leaderId);
      await waitIdle();
      continue;
    }
    r = await emit(me.s, 'player:guess', { targetId: t.leaderId, name: sloppy });
    assert.ok(r.ok && r.result === 'correct', JSON.stringify(r));
    merges++;
    await sleep(30);
    assert.equal(hostState.play!.turnLeaderId, me.id, 'a correct guess keeps the turn');
    assert.ok(!hostState.play!.masks.some((m) => m.length === 0));
  }
  assert.equal(merges, 3);
  assert.equal(hostState.phase, 'gameOver');
  assert.equal(hostState.winner!.secretName, secretOf(hostState.winner!.id));
  assert.equal(hostState.winner!.teamIds.length, 4, 'everybody ended on the winner\'s team');
  assert.equal(hostState.recap!.length, 4);
  console.log(`simulation passed - winner: ${byId(hostState.winner!.id)[0]} ("${hostState.winner!.secretName}")`);
}

async function social() {
  const host = connect();
  const created = await emit(host, 'host:create');
  let hs!: ClientState;
  host.on('state', (st) => (hs = st));
  const bots: S[] = [];
  for (const n of ['A1', 'B2', 'C3']) {
    const sck = connect();
    assert.ok((await emit(sck, 'player:join', { code: created.code, name: n })).ok);
    bots.push(sck);
  }
  await sleep(100);
  host.emit('host:settings', { social: true });
  await sleep(100);
  assert.equal(hs.social, true);
  host.emit('host:start');
  await sleep(100);
  for (const [i, b] of bots.entries()) await emit(b, 'player:submitName', { name: 'Name ' + i });
  let passes = 0;
  let lastPass = 0;
  while (hs.phase !== 'socialOver') {
    if (hs.phase === 'memorize' && hs.memorize!.pass !== lastPass) {
      lastPass = hs.memorize!.pass;
      passes++;
    }
    if (hs.phase === 'ready') for (const b of bots) b.emit('player:ready');
    await sleep(20);
  }
  assert.equal(passes, 2, 'names shown twice, then the game ends');
  await sleep(300);
  assert.equal(hs.phase, 'socialOver', 'no guessing phase in social mode');
  assert.equal(hs.play, null);
  host.emit('host:backToLobby');
  await sleep(100);
  assert.equal(hs.phase, 'lobby');
  assert.equal(hs.social, true, 'the setting is remembered');
  console.log('social mode simulation passed');
}

main()
  .then(social)
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      process.kill(-server.pid!); // the whole process group, so no server is left behind
    } catch {
      /* already gone */
    }
    setTimeout(() => process.exit(), 100);
  });
