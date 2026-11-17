import './theme.css';
import './play.css';
import { MAX_PLAYER_NAME_LENGTH, type ClientState, type GuessEvent } from '../../shared/types';
import { MAX_NAME_LENGTH, validateName } from '../../shared/names';
import { $, esc, maskHTML, pencilHTML, socket } from './common';

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
let guessTarget: string | null = null;
let guessText = '';
let giveUpArmed = false;

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

const byId = (s: ClientState, id: string | null | undefined) => s.players.find((p) => p.id === id);
const nameOf = (s: ClientState, id: string | null | undefined) => byId(s, id)?.name ?? '?';
const masksHTML = (masks: string[]) => (masks.length ? `<div class="masks-phone"><div class="sect">Letters so far</div>${masks.map(maskHTML).join('')}</div>` : '');

/** Live check of a typed name: shows the problem and disables the button when a symbol isn't allowed. */
function wireNameInput(input: HTMLInputElement, button: HTMLButtonElement, msg: HTMLElement, onChange: (v: string) => void) {
  const upd = () => {
    onChange(input.value);
    const v = validateName(input.value);
    button.disabled = !v.ok;
    msg.textContent = !v.ok && !v.empty ? v.error : '';
    msg.className = 'error';
  };
  input.addEventListener('input', upd);
  upd();
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
  const mine = byId(s, s.you?.id);
  return {
    header: header('Room ' + s.code, "You're in!"),
    main: centerView('Pencils sharpened!', 'Waiting for the host to start the game…', chipsHTML(s), mine?.color),
  };
}

function namesView(s: ClientState): View {
  const you = s.you!;
  const mine = byId(s, you.id);
  if (you.secretName) {
    const waiting = s.players.filter((p) => p.connected && !p.done).length;
    return {
      header: header('Secret name', 'Name written ✓'),
      main: centerView('Nice and sneaky!', waiting ? `Waiting for ${waiting} more…` : '', `<div class="mine sheet"><div class="wline">${esc(you.secretName)}</div></div>${chipsHTML(s)}`, mine?.color),
    };
  }
  return {
    header: header('Secret name', 'Write a name', 'Anyone you like: a person, a pet, a pirate…'),
    main: `<div class="write-sheet sheet"><div class="wline"><input id="nm" autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false" value="${esc(draftName)}" /></div><div class="counter" id="ctr"></div></div>
      <div class="note">Letters, numbers and the symbols <b>$ ! &amp; @</b>.<br>Remember it — and everyone else's!</div>
      <div class="error" id="err"></div>`,
    footer: `<button class="pbtn green full" id="send" disabled>Write it down</button>`,
    after: () => {
      const input = $<HTMLInputElement>('#nm')!;
      const send = $<HTMLButtonElement>('#send')!;
      const err = $('#err')!;
      wireNameInput(input, send, err, (v) => {
        draftName = v;
        const n = Array.from(v).length;
        const ctr = $('#ctr')!;
        ctr.textContent = `${n}/${MAX_NAME_LENGTH}`;
        ctr.className = 'counter ' + (n > MAX_NAME_LENGTH ? 'full' : MAX_NAME_LENGTH - n <= 5 ? 'near' : '');
      });
      const submit = () => {
        if (send.disabled) return;
        send.disabled = true;
        socket.emit('player:submitName', { name: input.value }, (res) => {
          if (!res.ok) {
            err.textContent = res.error;
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
  const mine = byId(s, s.you?.id);
  const m = s.memorize;
  return {
    header: header(`Look number ${m?.pass ?? 1} of 2`, 'Watch the big screen'),
    main: centerView('Eyes up!', 'Remember every name you see. They only show for a few seconds.', '', mine?.color),
  };
}

function readyView(s: ClientState): View {
  const you = s.you!;
  const mine = byId(s, you.id);
  if (!mine?.participating) {
    return { header: header('Break', 'Hang tight'), main: centerView('Hang tight!', 'The game is about to continue.', '', mine?.color) };
  }
  if (you.ready) {
    const waiting = s.players.filter((p) => p.connected && p.participating && !p.done).length;
    return { header: header('Break', 'Ready ✓'), main: centerView('Ready!', waiting ? `Waiting for ${waiting} more…` : 'Here we go…', chipsHTML(s), mine?.color) };
  }
  return {
    header: header('Break', 'One more look?'),
    main: centerView('That was the first look!', 'Tap Ready when you want to see all the names a second time.', '', mine?.color),
    footer: `<button class="pbtn green full" id="rdy">Ready!</button>`,
    after: () => $('#rdy')!.addEventListener('click', () => socket.emit('player:ready')),
  };
}

function eventText(s: ClientState, e: GuessEvent): { title: string; text: string } {
  const g = nameOf(s, e.guesserId);
  const t = nameOf(s, e.targetId);
  if (e.kind === 'correct') return { title: 'Correct!', text: e.final ? `${g}'s team guessed that ${t} wrote "${e.actualName}". Only one name is left!` : `${g}'s team guessed that ${t} wrote "${e.actualName}". ${t} joins their team.` };
  if (e.kind === 'wrong') return { title: 'Wrong!', text: `${g}'s team guessed that ${t} wrote "${e.typed}". It's ${nameOf(s, s.play!.turnLeaderId)}'s turn now.` };
  if (e.kind === 'giveup') return { title: `${g} gave up`, text: `Next up: ${nameOf(s, s.play!.turnLeaderId)}.` };
  return { title: 'Everybody gave up!', text: 'One more letter of every name is coming up.' };
}

function playView(s: ClientState): View {
  const you = s.you!;
  const pl = s.play!;
  const mine = byId(s, you.id);
  const me = you.teamLeaderId;
  const myTeam = pl.teams.find((t) => t.leaderId === me);
  const eliminated = !!me && me !== you.id;
  const kicker = eliminated ? `On ${nameOf(s, me)}'s team` : myTeam?.memberIds.length ? 'Your team' : 'Still in';

  if (pl.event) {
    const { title, text } = eventText(s, pl.event);
    return { header: header(kicker, title), main: centerView(title, text, masksHTML(pl.masks), mine?.color) };
  }

  if (!you.canGuess) {
    const t = nameOf(s, pl.turnLeaderId);
    const why = eliminated ? `You're on ${nameOf(s, me)}'s team now — help them remember!` : 'Listen up, and remember the names.';
    return { header: header(kicker, `${t}'s turn`), main: centerView(`${t}'s turn`, why, masksHTML(pl.masks), mine?.color) };
  }

  // our turn: pick a player, type the name from memory
  const targets = pl.teams.filter((t) => t.leaderId !== me);
  if (!targets.some((t) => t.leaderId === guessTarget)) guessTarget = null;
  return {
    header: header(myTeam?.memberIds.length ? 'Your team’s turn' : 'Your turn', 'Who wrote which name?', 'Pick a player, then type the name they wrote.'),
    main: `${masksHTML(pl.masks)}
      <div class="sect">1. Which player?</div>
      <div class="targets">${targets.map((t) => `<button class="target ${t.leaderId === guessTarget ? 'on' : ''}" data-t="${t.leaderId}">${pencilHTML(byId(s, t.leaderId)?.color ?? '#888')}<span>${esc(nameOf(s, t.leaderId))}</span></button>`).join('')}</div>
      <div class="sect">2. What name did they write?</div>
      <div class="write-sheet sheet small"><div class="wline"><input id="gn" autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false" value="${esc(guessText)}" /></div></div>
      <div class="error" id="err"></div>`,
    footer: `<div class="two"><button class="pbtn ghost" id="giveup">Give up</button><button class="pbtn green" id="guess" disabled>Guess!</button></div>`,
    after: () => {
      const input = $<HTMLInputElement>('#gn')!;
      const btn = $<HTMLButtonElement>('#guess')!;
      const err = $('#err')!;
      const refresh = () => {
        const v = validateName(input.value);
        btn.disabled = !v.ok || !guessTarget;
      };
      wireNameInput(input, btn, err, (v) => (guessText = v));
      refresh();
      input.addEventListener('input', refresh);
      app.querySelectorAll<HTMLElement>('[data-t]').forEach((b) =>
        b.addEventListener('click', () => {
          guessTarget = b.dataset.t!;
          app.querySelectorAll('.target').forEach((x) => x.classList.toggle('on', x === b));
          refresh();
        }),
      );
      const submit = () => {
        if (btn.disabled || !guessTarget) return;
        btn.disabled = true;
        socket.emit('player:guess', { targetId: guessTarget, name: input.value }, (res) => {
          if (res.ok) {
            guessText = '';
            guessTarget = null;
          } else {
            // a free retry: nothing counted
            err.textContent = res.error;
            refresh();
          }
        });
      };
      btn.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
      const gu = $<HTMLButtonElement>('#giveup')!;
      gu.addEventListener('click', () => {
        if (!giveUpArmed) {
          giveUpArmed = true;
          gu.textContent = 'Sure? Tap again';
          setTimeout(() => {
            giveUpArmed = false;
            if (gu.isConnected) gu.textContent = 'Give up';
          }, 3000);
          return;
        }
        giveUpArmed = false;
        socket.emit('player:giveUp', (res) => {
          if (!res.ok) err.textContent = res.error;
        });
      });
    },
  };
}

function overView(s: ClientState): View {
  const w = s.winner;
  const mine = byId(s, s.you?.id);
  const won = w && s.you?.teamLeaderId === w.id;
  return {
    header: header('Game over', w ? `${nameOf(s, w.id)} wins!` : 'Game over'),
    main: centerView(won ? 'You won!' : `${w ? nameOf(s, w.id) : '?'} wins!`, w ? `Their secret name was “${w.secretName}”. Look at the big screen!` : '', '', mine?.color),
  };
}

// ------------------------------------------------------------------ render

function signature(): string {
  const s = state;
  const lists = s && ['lobby', 'names', 'ready'].includes(s.phase) ? s.players.map((p) => p.id + p.connected + p.done).join(',') : '';
  return [
    me ? 'in' : 'out',
    s?.phase,
    s?.you?.secretName,
    s?.you?.ready,
    s?.you?.canGuess,
    s?.you?.teamLeaderId,
    s?.memorize?.pass,
    s?.play?.event?.id,
    s?.play?.turnLeaderId,
    s?.play?.revealLevel,
    s?.play?.teams.length,
    lists,
    joinError,
    closedMsg,
  ].join('|');
}

function render(force = false) {
  let v: View;
  if (!me || !state?.you) v = joinView();
  else
    switch (state.phase) {
      case 'lobby':
        v = lobbyView(state);
        break;
      case 'names':
        v = namesView(state);
        break;
      case 'memorize':
        v = memorizeView(state);
        break;
      case 'ready':
        v = readyView(state);
        break;
      case 'play':
        v = playView(state);
        break;
      default:
        v = overView(state);
    }
  const key = signature();
  if (!force && key === viewKey) return;
  viewKey = key;
  const focused = document.activeElement instanceof HTMLInputElement ? document.activeElement.id : '';
  app.innerHTML = (v.header ? `<header>${v.header}</header>` : '') + `<main>${v.main}</main>` + (v.footer ? `<footer>${v.footer}</footer>` : '<footer></footer>');
  v.after?.();
  if (focused) {
    const el = $<HTMLInputElement>('#' + focused);
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }
}
