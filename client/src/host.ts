import QRCode from 'qrcode';
import './theme.css';
import './host.css';
import { MIN_PLAYERS, type ClientState, type GuessEvent } from '../../shared/types';
import { $, esc, GAME_NAME, maskHTML, pencilHTML, socket } from './common';

const STORE = 'thenamegame.host';
const stage = $('#stage')!;
const strip = $('#strip')!;

let state: ClientState | null = null;
let viewKey = '';
let roomCode = '';
let joinBase = location.origin;
let qrDataUrl = '';

// ------------------------------------------------------------------ connection

function load(): { code: string; hostToken: string } | null {
  try {
    return JSON.parse(localStorage.getItem(STORE) || 'null');
  } catch {
    return null;
  }
}

function createRoom() {
  socket.emit('host:create', (res) => {
    if (!res.ok) return;
    roomCode = res.code;
    try {
      localStorage.setItem(STORE, JSON.stringify({ code: res.code, hostToken: res.hostToken }));
    } catch {
      /* ignore */
    }
    prepareJoinInfo();
  });
}

socket.on('connect', () => {
  $('#conn')!.hidden = true;
  const saved = load();
  if (saved) {
    socket.emit('host:resume', saved, (res) => {
      if (res.ok) {
        roomCode = saved.code;
        prepareJoinInfo();
      } else createRoom();
    });
  } else createRoom();
});
socket.on('disconnect', () => ($('#conn')!.hidden = false));
socket.on('state', (s) => {
  state = s;
  render();
});
socket.on('closed', () => {
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* ignore */
  }
  location.reload();
});

async function prepareJoinInfo() {
  const { hostname, port, protocol, origin } = location;
  joinBase = origin;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    // phones can't reach "localhost" - advertise this computer's LAN address instead
    try {
      const { ips } = (await (await fetch('/api/info')).json()) as { ips: string[] };
      if (ips[0]) joinBase = `${protocol}//${ips[0]}${port ? ':' + port : ''}`;
    } catch {
      /* fall back to origin */
    }
  }
  qrDataUrl = await QRCode.toDataURL(`${joinBase}/play.html?room=${roomCode}`, { margin: 1, width: 520, color: { dark: '#2f3140', light: '#ffffff' } });
  viewKey = '';
  render();
}

// ------------------------------------------------------------------ helpers

function syncChildren<T>(host: HTMLElement, items: T[], id: (t: T) => string, make: (t: T) => HTMLElement, update: (el: HTMLElement, t: T) => void) {
  const existing = new Map<string, HTMLElement>();
  host.querySelectorAll<HTMLElement>(':scope > [data-id]').forEach((e) => existing.set(e.dataset.id!, e));
  const keep = new Set<string>();
  items.forEach((t, i) => {
    const k = id(t);
    keep.add(k);
    let el = existing.get(k);
    if (!el) {
      el = make(t);
      el.dataset.id = k;
    }
    update(el, t);
    const at = host.children[i] as HTMLElement | undefined;
    if (at !== el) host.insertBefore(el, at ?? null);
  });
  existing.forEach((el, k) => !keep.has(k) && el.remove());
}

// ------------------------------------------------------------------ views

const byId = (s: ClientState, id: string | null | undefined) => s.players.find((p) => p.id === id);
const nameOf = (s: ClientState, id: string | null | undefined) => esc(byId(s, id)?.name ?? '?');
const colorOf = (s: ClientState, id: string | null | undefined) => byId(s, id)?.color ?? '#888';
const holdBar = (ms: number) => `<div class="holdbar"><i style="animation-duration:${ms}ms"></i></div>`;
const masksHTML = (masks: string[]) => (masks.length ? `<div class="masks-wrap"><div class="eyebrow">Letters so far</div><div class="masks">${masks.map(maskHTML).join('')}</div></div>` : '');

function lobbyView(s: ClientState): string {
  return `<section class="lobby">
    <div class="lobby-left">
      <div class="logo sheet"><div class="wline small">The</div><div class="wline big">${esc(GAME_NAME.replace(/^The /, ''))}</div></div>
      <div class="join-card sheet">
        ${qrDataUrl ? `<img class="qr" src="${qrDataUrl}" alt="QR code to join" />` : '<div class="qr"></div>'}
        <div class="t">Scan the code or go to<br /><b>${esc(joinBase.replace(/^https?:\/\//, ''))}</b><br />and enter room code<div class="roomcode">${esc(s.code)}</div></div>
      </div>
    </div>
    <div class="lobby-right">
      <div class="roster sheet"><h3>Who's playing?</h3><div class="roster-grid" id="roster"></div></div>
      <button class="pbtn green startbtn" id="start" disabled>Start game</button>
    </div>
  </section>`;
}

function lobbyLive(s: ClientState) {
  const b = $('#roster')!;
  if (!s.players.length) {
    if (!b.querySelector('.empty')) b.innerHTML = '<div class="empty" style="grid-column:1/-1">Waiting for players to join…</div>';
  } else {
    b.querySelector('.empty')?.remove();
    syncChildren(
      b,
      s.players,
      (p) => p.id,
      (p) => {
        const el = document.createElement('div');
        el.className = 'rline wline';
        el.innerHTML = `${pencilHTML(p.color)}<span class="nm">${esc(p.name)}</span><button class="x" data-kick="${p.id}" title="Remove">✕</button>`;
        return el;
      },
      (el, p) => el.classList.toggle('off', !p.connected),
    );
  }
  const live = s.players.filter((p) => p.connected).length;
  const start = $<HTMLButtonElement>('#start')!;
  start.disabled = live < MIN_PLAYERS;
  start.textContent = live < MIN_PLAYERS ? `Need at least ${MIN_PLAYERS} players` : `Start game (${live} players)`;
}

function namesView(): string {
  return `<section>
    <div class="names-sheet sheet">
      ${pencilHTML('#f7c21b').replace('class="pencil"', 'class="pencil hero"')}
      <div class="wline headline">Write a secret name!</div>
      <div class="sub">Look at your phone and write <b>one name</b> — a person, a pet, a pirate, anything.<br>Then <b>remember everyone's</b>: you'll only see them for a few seconds.</div>
      <div class="status"><span data-done>0/0</span> names written</div>
    </div>
  </section>`;
}

function memorizeView(s: ClientState): string {
  const m = s.memorize!;
  if (m.index < 0) {
    return `<section>
      <div class="eyebrow">Look number ${m.pass} of 2</div>
      <div class="names-sheet sheet">
        <div class="wline headline">Get ready…</div>
        <div class="sub">Every name will be shown for <b>${m.ms / 1000 + 1} seconds</b>.<br>${m.pass === 1 ? "You'll get to see them all twice." : 'This is your last look!'}</div>
      </div>
    </section>`;
  }
  const name = m.name ?? '';
  const fs = Math.min(9.5, 142 / Math.max(1, Array.from(name).length));
  return `<section>
    <div class="eyebrow">Look number ${m.pass} of 2 · name ${m.index + 1} of ${m.total}</div>
    <div class="name-sheet sheet"><div class="wline giant" style="font-size:${fs.toFixed(2)}rem">${esc(name)}</div></div>
    ${holdBar(m.ms)}
  </section>`;
}

function readyView(): string {
  return `<section>
    <div class="names-sheet sheet">
      <div class="wline headline">One more look?</div>
      <div class="sub">That was the first time through. Tap <b>Ready</b> on your phone when you want to see all the names again.</div>
      <div class="status"><span data-done>0/0</span> ready</div>
    </div>
  </section>`;
}

/** A player's name at the given size, used for team layouts. */
const teamMember = (s: ClientState, id: string) => `<div class="member" style="--i:${id.length}">${pencilHTML(colorOf(s, id))}<span>${nameOf(s, id)}</span></div>`;

function turnView(s: ClientState): string {
  const pl = s.play!;
  const team = pl.teams.find((t) => t.leaderId === pl.turnLeaderId);
  const members = team?.memberIds ?? [];
  const left = members.filter((_, i) => i % 2 === 0);
  const right = members.filter((_, i) => i % 2 === 1);
  return `<section class="turn">
    <div class="eyebrow">${members.length ? "It's this team's turn" : "It's your turn"}</div>
    <div class="team-row">
      <div class="side left">${left.map((id) => teamMember(s, id)).join('')}</div>
      <div class="leader sheet">${pencilHTML(colorOf(s, pl.turnLeaderId)).replace('class="pencil"', 'class="pencil big"')}<div class="wline headline">${nameOf(s, pl.turnLeaderId)}</div></div>
      <div class="side right">${right.map((id) => teamMember(s, id)).join('')}</div>
    </div>
    <div class="sub">Pick a player and type the name they wrote — <b>from memory</b>.<br>${pl.teams.length} names still in the pool.</div>
    ${masksHTML(pl.masks)}
  </section>`;
}

function eventView(s: ClientState, e: GuessEvent): string {
  const pl = s.play!;
  const team = pl.teams.find((t) => t.leaderId === e.guesserId);
  const who = nameOf(s, e.guesserId) + (team && team.memberIds.length ? ' &amp; team' : '');
  if (e.kind === 'giveup') {
    return `<section><div class="names-sheet sheet"><div class="wline headline">${who} gave up</div><div class="sub">Next up: <b>${nameOf(s, pl.turnLeaderId)}</b></div></div></section>`;
  }
  if (e.kind === 'reveal') {
    return `<section>
      <div class="names-sheet sheet"><div class="wline headline">Everybody gave up!</div><div class="sub">Here comes <b>one more letter</b> of every name…</div></div>
      ${masksHTML(pl.masks)}
      ${holdBar(e.holdMs)}
    </section>`;
  }
  const right = e.kind === 'correct';
  const shown = right ? (e.actualName ?? '') : (e.typed ?? '');
  const after = right
    ? `${nameOf(s, e.targetId)} is out and <b>joins ${nameOf(s, e.guesserId)}'s team</b>.${e.final ? ' <b>Only one name is left!</b>' : ` ${pl.teams.length} names still in the pool.`}`
    : `Not quite! It's now <b>${nameOf(s, pl.turnLeaderId)}</b>'s turn.`;
  return `<section class="event">
    <div class="eyebrow">${who} guess${team && team.memberIds.length ? '' : 'es'} that…</div>
    <div class="guess-sheet sheet">
      <div class="gwho">${pencilHTML(colorOf(s, e.targetId))}<b>${nameOf(s, e.targetId)}</b> wrote</div>
      <div class="wline quote">“${esc(shown)}”</div>
    </div>
    <div class="stamp ${right ? 'good' : 'bad'}">${right ? 'Correct!' : 'Wrong!'}</div>
    <div class="sub">${after}</div>
    ${holdBar(e.holdMs)}
  </section>`;
}

function overView(s: ClientState): string {
  const w = s.winner!;
  const letters = Array.from(w.secretName);
  const step = 0.3;
  const t0 = 3.4; // seconds before the secret name starts being written
  const fs = Math.min(6.4, 100 / Math.max(1, letters.length));
  const team = w.teamIds.filter((id) => id !== w.id);
  return `<section class="over">
    <div class="eyebrow">We have a winner!</div>
    <div class="winner-name sheet">${pencilHTML(colorOf(s, w.id)).replace('class="pencil"', 'class="pencil big"')}<div class="wline headline">${nameOf(s, w.id)} wins!</div></div>
    ${team.length ? `<div class="sub">with ${team.map((id) => nameOf(s, id)).join(', ')} on their team</div>` : ''}
    <div class="drum" style="animation-delay:${t0 - 1}s">Their secret name was…</div>
    <div class="reveal-sheet sheet">
      <div class="wline giant reveal" style="font-size:${fs.toFixed(2)}rem;--n:${letters.length};--step:${step}s;--t0:${t0}s">${letters.map((c, i) => `<span style="--i:${i}">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('')}<em class="writer">${pencilHTML('#f7c21b')}</em></div>
    </div>
    <div class="recap" style="animation-delay:${t0 + letters.length * step + 1}s">${(s.recap ?? []).map((r) => `<span class="rc">${nameOf(s, r.id)}: <b>${esc(r.secretName)}</b></span>`).join('')}</div>
    <button class="pbtn green again" id="again" style="animation-delay:${t0 + letters.length * step + 1.5}s">Play again</button>
  </section>`;
}

function confetti(count = 60) {
  const colors = ['#f7c21b', '#e5484d', '#3b82f6', '#3fb36b', '#8e5bd6', '#f08c2e', '#ec6fa5'];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'cf';
    el.innerHTML = pencilHTML(colors[i % colors.length], '--pw:1.4rem;--tilt:' + Math.round(Math.random() * 360) + 'deg');
    el.style.left = Math.random() * 100 + 'vw';
    el.style.setProperty('--dx', (Math.random() * 30 - 15).toFixed(1) + 'vw');
    el.style.setProperty('--rot', Math.round(Math.random() * 900 - 450) + 'deg');
    el.style.animationDuration = 2.6 + Math.random() * 2.4 + 's';
    el.style.animationDelay = Math.random() * 1 + 's';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 7000);
  }
}

// ------------------------------------------------------------------ render

function stripLive(s: ClientState) {
  const inPlay = s.phase === 'play' || s.phase === 'gameOver';
  const chips = inPlay
    ? (s.play?.teams ?? []).map((t) => ({ p: byId(s, t.leaderId)!, extra: t.memberIds.length, active: s.play!.turnLeaderId === t.leaderId && !s.play!.event, gaveUp: t.gaveUp }))
    : s.players.map((p) => ({ p, extra: 0, active: false, gaveUp: false }));
  syncChildren(
    strip,
    chips,
    (c) => c.p.id,
    (c) => {
      const el = document.createElement('div');
      el.className = 'pchip';
      el.innerHTML = `${pencilHTML(c.p.color)}<span class="nm">${esc(c.p.name)}</span><span class="plus"></span><span class="tick">✓</span>`;
      return el;
    },
    (el, c) => {
      el.classList.toggle('off', !c.p.connected);
      el.classList.toggle('done', !inPlay && c.p.done);
      el.classList.toggle('active', c.active);
      el.classList.toggle('gaveup', c.gaveUp);
      el.querySelector('.plus')!.textContent = c.extra ? `+${c.extra}` : c.gaveUp ? 'gave up' : '';
    },
  );
}

function render() {
  const s = state;
  if (!s) return;
  $('#hudCode')!.innerHTML = s.phase === 'lobby' ? '' : `Room <b>${esc(s.code)}</b>`;
  strip.hidden = s.phase === 'lobby' || s.phase === 'memorize' || s.phase === 'gameOver';
  $('#skip')!.hidden = !(s.phase === 'ready' || (s.phase === 'play' && !s.play?.event));

  const key = `${s.phase}|${qrDataUrl ? 'qr' : ''}|${s.memorize ? s.memorize.pass + ':' + s.memorize.index : ''}|${s.play ? JSON.stringify(s.play) : ''}`;
  if (key !== viewKey) {
    viewKey = key;
    document.querySelectorAll('.cf').forEach((e) => e.remove());
    switch (s.phase) {
      case 'lobby':
        stage.innerHTML = lobbyView(s);
        $('#start')!.addEventListener('click', () => socket.emit('host:start'));
        $('#roster')!.addEventListener('click', (e) => {
          const id = (e.target as HTMLElement).dataset.kick;
          if (id) socket.emit('host:kick', { playerId: id });
        });
        break;
      case 'names':
        stage.innerHTML = namesView();
        break;
      case 'memorize':
        stage.innerHTML = memorizeView(s);
        break;
      case 'ready':
        stage.innerHTML = readyView();
        break;
      case 'play':
        stage.innerHTML = s.play?.event ? eventView(s, s.play.event) : turnView(s);
        break;
      case 'gameOver':
        stage.innerHTML = overView(s);
        $('#again')?.addEventListener('click', () => socket.emit('host:backToLobby'));
        setTimeout(() => confetti(), 3400 + Array.from(s.winner?.secretName ?? '').length * 300);
        break;
    }
  }
  if (s.phase === 'lobby') lobbyLive(s);
  if (s.phase === 'names' || s.phase === 'ready') {
    const live = s.players.filter((p) => p.connected && p.participating !== (s.phase === 'names' ? undefined : false));
    const d = stage.querySelector('[data-done]');
    if (d) d.textContent = `${live.filter((p) => p.done).length}/${live.length}`;
  }
  if (!strip.hidden) stripLive(s);
}

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !(e.target as HTMLElement).matches('input, select, textarea')) {
    e.preventDefault();
    socket.emit('host:skip');
  }
});
$('#skip')!.addEventListener('click', () => socket.emit('host:skip'));
