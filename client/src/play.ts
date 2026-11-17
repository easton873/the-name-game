import './theme.css';
import './play.css';
import { MAX_NAME_LENGTH, MAX_PLAYER_NAME_LENGTH, type ClientState } from '../../shared/types';
import { $, esc, pencilHTML, socket } from './common';

interface View {
  header?: string;
  main: string;
  footer?: string;
  after?: () => void;
}

const app = $('#app')!;
const STORE = 'thenamegame.player';

let state: ClientState | null = null;
let me: { code: string; token: string; name: string; id: string } | null = null;
let joinError = '';
let viewKey = '';
let closedMsg = '';
let draftName = '';

const params = new URLSearchParams(location.search);

function loadStored(): { code: string; token: string; name: string } | null {
  try {
    return JSON.parse(localStorage.getItem(STORE) || 'null');
  } catch {
    return null;
  }
}
const saveStored = (v: unknown) => {
  try {
    if (v) localStorage.setItem(STORE, JSON.stringify(v));
    else localStorage.removeItem(STORE);
  } catch {
    /* private mode: rejoin just won't survive a refresh */
  }
};

// ------------------------------------------------------------------ joining

function join(code: string, name: string, token?: string) {
  socket.emit('player:join', { code, name, token }, (res) => {
    if (res.ok) {
      me = { code: code.toUpperCase(), name, token: res.token, id: res.playerId };
      saveStored({ code: me.code, token: me.token, name });
      joinError = '';
      closedMsg = '';
    } else {
      joinError = res.error;
      if (token) saveStored(null);
      me = null;
    }
    viewKey = '';
    render();
  });
}

socket.on('connect', () => {
  document.querySelector('.conn')?.remove();
  const stored = loadStored();
  const want = (params.get('room') || '').toUpperCase();
  if (me) join(me.code, me.name, me.token); // reconnect after a drop
  else if (stored && (!want || want === stored.code)) join(stored.code, stored.name, stored.token);
  else render();
});
socket.on('disconnect', () => {
  if (!document.querySelector('.conn')) document.body.insertAdjacentHTML('beforeend', '<div class="conn">Reconnecting…</div>');
});
socket.on('closed', (reason) => {
  closedMsg = reason;
  me = null;
  state = null;
  saveStored(null);
  viewKey = '';
  render();
});
socket.on('state', (s) => {
  state = s;
  render();
});

// ------------------------------------------------------------------ helpers

function header(kicker: string, title: string, sub?: string): string {
  return `<div class="htxt"><div class="kicker">${esc(kicker)}</div><div class="title">${esc(title)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
}

const centerView = (title: string, text = '', extra = '', color = '#f7c21b'): string =>
  `<div class="center">${pencilHTML(color)}<h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}${extra}</div>`;

function chipsHTML(s: ClientState) {
  return `<div class="chips">${s.players.map((p) => `<span class="chip ${p.connected ? '' : 'off'} ${p.done ? 'done' : ''}">${pencilHTML(p.color)}${esc(p.name)}</span>`).join('')}</div>`;
}

// ------------------------------------------------------------------ views

function joinView(): View {
  const code = esc(params.get('room') || '');
  return {
    header: header('Welcome', 'Join the game'),
    main: `<form id="jf" style="display:flex;flex-direction:column;gap:16px;margin-top:8px">
      <div class="field"><label for="code">Room code</label><input id="code" maxlength="4" value="${code}" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" /></div>
      <div class="field"><label for="name">Your name</label><input id="name" maxlength="${MAX_PLAYER_NAME_LENGTH}" value="${esc(loadStored()?.name ?? '')}" autocomplete="off" /></div>
      <div class="error">${esc(closedMsg || joinError)}</div>
      <button class="pbtn green full" type="submit">Join</button>
    </form>`,
    after: () => {
      $<HTMLFormElement>('#jf')!.addEventListener('submit', (e) => {
        e.preventDefault();
        const c = $<HTMLInputElement>('#code')!.value.trim().toUpperCase();
        const n = $<HTMLInputElement>('#name')!.value.trim();
        if (c.length !== 4) joinError = 'Room codes are 4 letters.';
        else if (!n) joinError = 'Please enter a name.';
        else return join(c, n);
        $('.error')!.textContent = joinError;
      });
      (params.get('room') ? $('#name') : $('#code'))?.focus();
    },
  };
}

function lobbyView(s: ClientState): View {
  const mine = s.players.find((p) => p.id === s.you?.id);
  return {
    header: header('Room ' + s.code, "You're in!"),
    main: centerView('Pencils sharpened!', 'Waiting for the host to start the game…', chipsHTML(s), mine?.color),
  };
}

function namesView(s: ClientState): View {
  const you = s.you!;
  const mine = s.players.find((p) => p.id === you.id);
  if (you.secretName) {
    const waiting = s.players.filter((p) => p.connected && !p.done).length;
    return {
      header: header('Secret name', 'Name written ✓'),
      main: centerView('Nice and sneaky!', waiting ? `Waiting for ${waiting} more…` : '', `<div class="mine sheet"><div class="wline">${esc(you.secretName)}</div></div>${chipsHTML(s)}`, mine?.color),
    };
  }
  return {
    header: header('Secret name', 'Write a name', 'Anyone you like: a person, a pet, a pirate…'),
    main: `<div class="write-sheet sheet"><div class="wline"><input id="nm" maxlength="${MAX_NAME_LENGTH}" autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false" value="${esc(draftName)}" /></div><div class="counter" id="ctr"></div></div>
      <div class="note">Remember it — and everyone else's!<br>You won't see the names for long.</div>
      <div class="error" id="err"></div>`,
    footer: `<button class="pbtn green full" id="send" disabled>Write it down</button>`,
    after: () => {
      const input = $<HTMLInputElement>('#nm')!;
      const send = $<HTMLButtonElement>('#send')!;
      const upd = () => {
        draftName = input.value;
        send.disabled = !input.value.trim();
        const left = MAX_NAME_LENGTH - input.value.length;
        const ctr = $('#ctr')!;
        ctr.textContent = `${input.value.length}/${MAX_NAME_LENGTH}`;
        ctr.className = 'counter ' + (left <= 0 ? 'full' : left <= 5 ? 'near' : '');
      };
      input.addEventListener('input', upd);
      upd();
      const submit = () => {
        if (!input.value.trim()) return;
        send.disabled = true;
        socket.emit('player:submitName', { name: input.value }, (res) => {
          if (!res.ok) {
            $('#err')!.textContent = res.error;
            send.disabled = false;
          }
        });
      };
      send.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    },
  };
}

function memorizeView(s: ClientState): View {
  const mine = s.players.find((p) => p.id === s.you?.id);
  return { header: header('Get ready', 'Watch the big screen'), main: centerView('All names are in!', 'Look at the big screen and remember every name.', '', mine?.color) };
}

// ------------------------------------------------------------------ render

function render() {
  let v: View;
  if (!me || !state?.you) v = joinView();
  else if (state.phase === 'lobby') v = lobbyView(state);
  else if (state.phase === 'names') v = namesView(state);
  else v = memorizeView(state);

  const key = `${me ? 'in' : 'out'}|${state?.phase}|${state?.you?.secretName ? 'done' : ''}|${joinError}|${closedMsg}`;
  const dynamic = state?.phase === 'lobby' || (state?.phase === 'names' && state.you?.secretName);
  const html = (v.header ? `<header>${v.header}</header>` : '') + `<main>${v.main}</main>` + (v.footer ? `<footer>${v.footer}</footer>` : '<footer></footer>');
  if (key !== viewKey || dynamic) {
    // Keep the typed text and focus when only live data changed.
    viewKey = key;
    app.innerHTML = html;
    v.after?.();
  }
}
