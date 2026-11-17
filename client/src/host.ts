import QRCode from 'qrcode';
import './theme.css';
import './host.css';
import { MIN_PLAYERS, type ClientState } from '../../shared/types';
import { $, esc, GAME_NAME, pencilHTML, socket } from './common';

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

function memorizeView(): string {
  return `<section><div class="names-sheet sheet"><div class="wline headline">All names are in!</div><div class="sub">Next up: the memorizing round (coming soon).</div></div></section>`;
}

// ------------------------------------------------------------------ render

function stripLive(s: ClientState) {
  syncChildren(
    strip,
    s.players,
    (p) => p.id,
    (p) => {
      const el = document.createElement('div');
      el.className = 'pchip';
      el.innerHTML = `${pencilHTML(p.color)}<span class="nm">${esc(p.name)}</span><span class="tick">✓</span>`;
      return el;
    },
    (el, p) => {
      el.classList.toggle('off', !p.connected);
      el.classList.toggle('done', p.done);
    },
  );
}

function render() {
  const s = state;
  if (!s) return;
  $('#hudCode')!.innerHTML = s.phase === 'lobby' ? '' : `Room <b>${esc(s.code)}</b>`;
  strip.hidden = s.phase === 'lobby';

  const key = `${s.phase}|${qrDataUrl ? 'qr' : ''}`;
  if (key !== viewKey) {
    viewKey = key;
    stage.innerHTML = s.phase === 'lobby' ? lobbyView(s) : s.phase === 'names' ? namesView() : memorizeView();
    if (s.phase === 'lobby') {
      $('#start')!.addEventListener('click', () => socket.emit('host:start'));
      $('#roster')!.addEventListener('click', (e) => {
        const id = (e.target as HTMLElement).dataset.kick;
        if (id) socket.emit('host:kick', { playerId: id });
      });
    }
  }
  if (s.phase === 'lobby') lobbyLive(s);
  if (s.phase === 'names') {
    const live = s.players.filter((p) => p.connected);
    const d = stage.querySelector('[data-done]');
    if (d) d.textContent = `${live.filter((p) => p.done).length}/${live.length}`;
  }
  if (s.phase !== 'lobby') stripLive(s);
}

// Space bar / debugging helper: nothing yet.
