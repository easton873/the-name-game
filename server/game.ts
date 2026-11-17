import type { Server } from 'socket.io';
import { MAX_NAME_LENGTH, normalizeName, validateName } from '../shared/names.js';
import {
  EVENT_HOLD_MS,
  GIVEUP_HOLD_MS,
  MAX_SUGGESTION_LENGTH,
  INTRO_MS,
  MAX_PLAYER_NAME_LENGTH,
  MEMORIZE_MS,
  MIN_PLAYERS,
  REVEAL_HOLD_MS,
  type ClientState,
  type ClientToServerEvents,
  type GuessEvent,
  type MemorizeState,
  type Phase,
  type PlayState,
  type Suggestion,
  type PlayerInfo,
  type ServerToClientEvents,
} from '../shared/types.js';
import { matchName } from './match.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

// TIMING_SCALE lets the test simulation run fast.
const SCALE = Number(process.env.TIMING_SCALE ?? 1);

export const ROOM_IDLE_MS = 15 * 60 * 1000;

// Pencil colours.
const COLORS = ['#f7c21b', '#e5484d', '#3b82f6', '#3fb36b', '#f08c2e', '#8e5bd6', '#ec6fa5', '#1fb5ad', '#9a6b3f', '#4a4d5a', '#94c83d', '#4fc3f7'];

interface Player {
  id: string;
  token: string;
  name: string;
  color: string;
  socketId: string | null;
  /** The secret name this player wrote for the game. */
  secretName: string | null;
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const err = (error: string): { ok: false; error: string } => ({ ok: false, error });

const rand = (n: number) => Math.floor(Math.random() * n);
function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const pick = <T>(arr: readonly T[]): T => arr[rand(arr.length)];

/** "Captain Jack" at level 2 -> "Ca_____ ____". Spaces are kept; only the first `level` characters show. */
function maskName(name: string, level: number): string {
  let shown = 0;
  return Array.from(name)
    .map((c) => (c === ' ' ? ' ' : shown++ < level ? c : '_'))
    .join('');
}

export class Room {
  readonly code: string;
  readonly hostToken: string;
  hostSocketId: string | null = null;
  players = new Map<string, Player>();
  phase: Phase = 'lobby';
  social = false;

  // ---- game state (reset by resetGame)
  private participants: string[] = [];
  private order: string[] = [];
  private pass: 1 | 2 = 1;
  private index = -1;
  private ready = new Set<string>();
  /** playerId -> leader of their team. A leader maps to themselves. */
  private leaderOf = new Map<string, string>();
  /** Leaders whose secret name has not been guessed yet. */
  private pool: string[] = [];
  private turnLeader: string | null = null;
  private gaveUp = new Set<string>();
  private revealLevel = 0;
  private maskOrder: string[] = [];
  private event: GuessEvent | null = null;
  private eventSeq = 0;
  private winnerId: string | null = null;
  private firstPlayerId: string | null = null;
  private suggestions: Suggestion[] = [];
  private suggestionSeq = 0;

  private timer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  onDestroy: (() => void) | null = null;

  constructor(
    private io: IO,
    code: string,
    hostToken: string,
  ) {
    this.code = code;
    this.hostToken = hostToken;
  }

  // ------------------------------------------------------------------ lifecycle

  attachHost(socketId: string) {
    this.hostSocketId = socketId;
    this.cancelIdle();
    this.broadcast();
  }

  detachHost(socketId: string) {
    if (this.hostSocketId !== socketId) return;
    this.hostSocketId = null;
    this.startIdle();
    this.broadcast();
  }

  private startIdle() {
    this.cancelIdle();
    this.idleTimer = setTimeout(() => this.destroy('The host left and the room timed out.'), ROOM_IDLE_MS);
  }
  private cancelIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  destroy(reason: string) {
    this.cancelIdle();
    this.clearTimer();
    this.io.to(this.roomName).emit('closed', reason);
    this.onDestroy?.();
  }

  get roomName() {
    return `room:${this.code}`;
  }

  // ------------------------------------------------------------------ timing

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  private after(ms: number, fn: () => void) {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      fn();
      this.broadcast();
    }, ms * SCALE);
  }

  // ------------------------------------------------------------------ players

  join(name: string, token: string | undefined, socketId: string): { ok: true; player: Player } | { ok: false; error: string } {
    if (token) {
      const existing = [...this.players.values()].find((p) => p.token === token);
      if (existing) {
        existing.socketId = socketId;
        if (!this.maybeAdvance()) this.broadcast();
        return { ok: true, player: existing };
      }
    }
    if (this.phase !== 'lobby') return { ok: false, error: 'That game has already started.' };
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_PLAYER_NAME_LENGTH);
    if (!clean) return { ok: false, error: 'Please enter a name.' };
    if ([...this.players.values()].some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
      return { ok: false, error: 'That name is already taken.' };
    }
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = COLORS.find((c) => !used.has(c)) ?? COLORS[this.players.size % COLORS.length];
    const player: Player = {
      id: Math.random().toString(36).slice(2, 10),
      token: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
      name: clean,
      color,
      socketId,
      secretName: null,
    };
    this.players.set(player.id, player);
    this.broadcast();
    return { ok: true, player };
  }

  disconnectPlayer(socketId: string) {
    const p = [...this.players.values()].find((x) => x.socketId === socketId);
    if (!p) return;
    p.socketId = null;
    if (!this.maybeAdvance()) this.broadcast();
  }

  kick(playerId: string) {
    if (this.phase !== 'lobby') return;
    const p = this.players.get(playerId);
    if (!p) return;
    if (p.socketId) this.io.to(p.socketId).emit('closed', 'You were removed from the game by the host.');
    this.players.delete(playerId);
    this.broadcast();
  }

  private secret(id: string): string {
    return this.players.get(id)?.secretName ?? '';
  }

  private isIn(id: string) {
    return this.participants.includes(id);
  }

  // ------------------------------------------------------------------ flow

  private resetGame() {
    this.clearTimer();
    this.participants = [];
    this.order = [];
    this.pass = 1;
    this.index = -1;
    this.ready.clear();
    this.leaderOf.clear();
    this.pool = [];
    this.turnLeader = null;
    this.gaveUp.clear();
    this.revealLevel = 0;
    this.maskOrder = [];
    this.event = null;
    this.winnerId = null;
    this.suggestions = [];
    this.firstPlayerId = null;
    for (const p of this.players.values()) p.secretName = null;
  }

  updateSettings(patch: { social?: boolean }) {
    if (this.phase !== 'lobby') return;
    if (typeof patch.social === 'boolean') this.social = patch.social;
    this.broadcast();
  }

  start() {
    if (this.phase !== 'lobby') return;
    if ([...this.players.values()].filter((p) => p.socketId).length < MIN_PLAYERS) return;
    this.resetGame();
    this.phase = 'names';
    this.broadcast();
  }

  backToLobby() {
    this.resetGame();
    this.phase = 'lobby';
    this.broadcast();
  }

  submitName(playerId: string, raw: unknown): Result {
    if (this.phase !== 'names') return err('Names are closed.');
    const p = this.players.get(playerId);
    if (!p) return err('You are not in this game.');
    if (p.secretName) return err('You already wrote your name.');
    const v = validateName(raw);
    if (!v.ok) return err(v.error);
    if (v.name.length > MAX_NAME_LENGTH) return err(`Keep it to ${MAX_NAME_LENGTH} characters.`);
    p.secretName = v.name;
    if (!this.maybeAdvance()) this.broadcast();
    return { ok: true };
  }

  /** Everybody wrote a name: whoever didn't is dropped, and the memorizing begins. */
  private startMemorize() {
    for (const p of [...this.players.values()]) if (!p.secretName) this.players.delete(p.id);
    this.participants = [...this.players.keys()];
    if (this.participants.length < 2) {
      this.backToLobby();
      return;
    }
    this.pass = 1;
    this.beginPass();
  }

  private beginPass() {
    this.order = shuffle(this.participants);
    this.index = -1;
    this.phase = 'memorize';
    this.after(INTRO_MS, () => this.nextName());
  }

  private nextName() {
    this.index++;
    if (this.index >= this.order.length) {
      this.endPass();
      return;
    }
    this.after(MEMORIZE_MS, () => this.nextName());
  }

  private endPass() {
    if (this.pass === 1) {
      this.phase = 'ready';
      this.ready.clear();
      this.maybeAdvance();
    } else if (this.social) {
      // Social mode: that's all the game does. The players guess among themselves.
      this.phase = 'socialOver';
      this.firstPlayerId = pick(this.participants); // someone has to start the real game
      this.clearTimer();
    } else {
      this.startPlay();
    }
  }

  submitReady(playerId: string): Result {
    if (this.phase !== 'ready') return err('Not now.');
    if (!this.isIn(playerId)) return err('You are not in this game.');
    this.ready.add(playerId);
    if (!this.maybeAdvance()) this.broadcast();
    return { ok: true };
  }

  /** Moves on if everybody connected has finished what the phase waits on. True if it advanced (and broadcast). */
  private maybeAdvance(): boolean {
    if (this.phase === 'names') {
      const live = [...this.players.values()].filter((p) => p.socketId);
      if (live.length > 0 && live.every((p) => p.secretName)) {
        this.startMemorize();
        this.broadcast();
        return true;
      }
    } else if (this.phase === 'ready') {
      const live = this.participants.filter((id) => this.players.get(id)?.socketId);
      if (live.length > 0 && live.every((id) => this.ready.has(id))) {
        this.pass = 2;
        this.beginPass();
        this.broadcast();
        return true;
      }
    }
    return false;
  }

  /** Host pressed skip: start the second pass without the stragglers, or end a stuck turn. */
  skip() {
    if (this.phase === 'ready') {
      this.pass = 2;
      this.beginPass();
      this.broadcast();
    } else if (this.phase === 'play' && !this.event && this.turnLeader) {
      this.doGiveUp(this.turnLeader);
      this.broadcast();
    }
  }

  // ------------------------------------------------------------------ guessing

  private startPlay() {
    for (const id of this.participants) this.leaderOf.set(id, id);
    this.pool = [...this.participants];
    this.maskOrder = shuffle(this.participants);
    this.revealLevel = 0;
    this.gaveUp.clear();
    this.event = null;
    this.turnLeader = pick(this.pool);
    this.phase = 'play';
  }

  private members(leader: string): string[] {
    return this.participants.filter((id) => this.leaderOf.get(id) === leader);
  }

  private holdEvent(e: Omit<GuessEvent, 'id'>, then?: () => void) {
    this.event = { ...e, id: ++this.eventSeq };
    this.suggestions = []; // suggestions belong to one turn
    this.after(e.holdMs, () => {
      this.event = null;
      then?.();
    });
  }

  submitGuess(playerId: string, targetId: string, raw: unknown): Result<{ result: 'correct' | 'wrong' }> {
    if (this.phase !== 'play') return err('The game is not at the guessing part.');
    if (this.event) return err('Wait for the announcement to finish.');
    const guesser = playerId;
    if (guesser !== this.turnLeader) return err(this.leaderOf.get(playerId) === this.turnLeader ? 'Only your team leader can guess. Send a suggestion instead!' : "It's not your team's turn.");
    if (!this.pool.includes(targetId) || targetId === guesser) return err('Pick a player from another team.');
    const v = validateName(raw);
    if (!v.ok) return err(v.error);

    // Every name that was ever submitted stays a valid guess, even after it has been guessed.
    // Anything else is a free retry.
    const m = matchName(v.name, this.participants.map((id) => this.secret(id)));
    if (m.kind === 'none') return err("That isn't one of the names in the game.");
    if (m.kind === 'ambiguous') return err('That could be more than one name. Check your spelling.');
    const want = normalizeName(this.secret(targetId));

    const base = { guesserId: guesser, targetId, typed: v.name, holdMs: EVENT_HOLD_MS };
    if (m.name === want) {
      // Right: the guessed player's name leaves the pool and their whole team joins the guesser's.
      for (const id of this.participants) if (this.leaderOf.get(id) === targetId) this.leaderOf.set(id, guesser);
      this.pool = this.pool.filter((id) => id !== targetId);
      this.gaveUp.clear();
      const final = this.pool.length === 1;
      this.holdEvent({ ...base, kind: 'correct', actualName: this.secret(targetId), final }, () => {
        if (final) {
          this.winnerId = this.pool[0];
          this.phase = 'gameOver';
        }
      });
      this.broadcast();
      return { ok: true, result: 'correct' };
    }
    // Wrong: the player who was guessed gets the next turn, and the give-up streak is broken.
    this.turnLeader = targetId;
    this.gaveUp.clear();
    this.holdEvent({ ...base, kind: 'wrong', actualName: null, final: false });
    this.broadcast();
    return { ok: true, result: 'wrong' };
  }

  /** A teammate's idea for the leader. Deliberately unchecked: it can be a fake name. */
  suggest(playerId: string, rawText: unknown, targetId: string | null | undefined): Result {
    if (this.phase !== 'play') return err('The game is not at the guessing part.');
    if (this.event) return err('Wait for the announcement to finish.');
    if (!this.turnLeader || this.leaderOf.get(playerId) !== this.turnLeader) return err("It's not your team's turn.");
    if (playerId === this.turnLeader) return err('You are the leader - just guess!');
    const text = String(rawText ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SUGGESTION_LENGTH);
    if (!text) return err('Write a suggestion first!');
    const target = targetId && this.pool.includes(targetId) && targetId !== this.turnLeader ? targetId : null;
    this.suggestions = [...this.suggestions, { id: ++this.suggestionSeq, fromId: playerId, targetId: target, text }].slice(-20);
    this.broadcast();
    return { ok: true };
  }

  giveUp(playerId: string): Result {
    if (this.phase !== 'play') return err('The game is not at the guessing part.');
    if (this.event) return err('Wait for the announcement to finish.');
    if (playerId !== this.turnLeader) return err(this.leaderOf.get(playerId) === this.turnLeader ? 'Only your team leader can give up.' : "It's not your team's turn.");
    this.doGiveUp(playerId);
    this.broadcast();
    return { ok: true };
  }

  private doGiveUp(leader: string) {
    this.gaveUp.add(leader);
    const waiting = this.pool.filter((id) => !this.gaveUp.has(id));
    const base = { guesserId: leader, targetId: null, typed: null, actualName: null, final: false };
    if (waiting.length === 0) {
      // Everybody still in gave up: reveal one more letter of every name and start over.
      this.revealLevel++;
      this.gaveUp.clear();
      this.turnLeader = pick(this.pool);
      this.holdEvent({ ...base, kind: 'reveal', holdMs: REVEAL_HOLD_MS });
    } else {
      this.turnLeader = pick(waiting);
      this.holdEvent({ ...base, kind: 'giveup', holdMs: GIVEUP_HOLD_MS });
    }
  }

  // ------------------------------------------------------------------ state views

  private playState(): PlayState | null {
    if (this.phase !== 'play' && this.phase !== 'gameOver') return null;
    return {
      teams: this.pool.map((leaderId) => ({
        leaderId,
        memberIds: this.members(leaderId).filter((id) => id !== leaderId),
        gaveUp: this.gaveUp.has(leaderId),
      })),
      turnLeaderId: this.turnLeader,
      event: this.event,
      revealLevel: this.revealLevel,
      masks: this.revealLevel > 0 ? this.maskOrder.filter((id) => this.pool.includes(id)).map((id) => maskName(this.secret(id), this.revealLevel)) : [],
    };
  }

  private baseState(): ClientState {
    const inPlay = this.phase === 'play' || this.phase === 'gameOver';
    const players: PlayerInfo[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      connected: !!p.socketId,
      done: this.phase === 'ready' ? this.ready.has(p.id) : !!p.secretName,
      participating: this.isIn(p.id),
      teamLeaderId: inPlay ? (this.leaderOf.get(p.id) ?? null) : null,
    }));
    const memorize: MemorizeState | null =
      this.phase === 'memorize' ? { pass: this.pass, index: this.index, total: this.order.length, name: null, ms: this.index < 0 ? INTRO_MS : MEMORIZE_MS } : null;
    const over = this.phase === 'gameOver' && this.winnerId;
    return {
      code: this.code,
      phase: this.phase,
      social: this.social,
      players,
      memorize,
      play: this.playState(),
      winner: over ? { id: this.winnerId!, secretName: this.secret(this.winnerId!), teamIds: this.members(this.winnerId!) } : null,
      firstPlayerId: this.phase === 'socialOver' ? this.firstPlayerId : null,
      recap: over ? this.participants.map((id) => ({ id, secretName: this.secret(id) })) : null,
      you: null,
    };
  }

  broadcast() {
    const base = this.baseState();
    if (this.hostSocketId) {
      // Only the big screen ever sees the name that is currently being shown.
      const name = base.memorize && this.index >= 0 ? this.secret(this.order[this.index]) : null;
      // Social mode: the big screen can reveal who wrote what if the table needs to settle an argument.
      const recap = this.phase === 'socialOver' ? this.participants.map((id) => ({ id, secretName: this.secret(id) })) : base.recap;
      this.io.to(this.hostSocketId).emit('state', { ...base, recap, memorize: base.memorize ? { ...base.memorize, name } : null });
    }
    for (const p of this.players.values()) {
      if (!p.socketId) continue;
      const teamLeaderId = this.leaderOf.get(p.id) ?? null;
      this.io.to(p.socketId).emit('state', {
        ...base,
        you: {
          id: p.id,
          secretName: p.secretName,
          ready: this.ready.has(p.id),
          teamLeaderId: this.phase === 'play' || this.phase === 'gameOver' ? teamLeaderId : null,
          canGuess: this.phase === 'play' && !this.event && p.id === this.turnLeader,
          canSuggest: this.phase === 'play' && !this.event && !!teamLeaderId && teamLeaderId === this.turnLeader && p.id !== this.turnLeader,
          suggestions: this.phase === 'play' && p.id === this.turnLeader ? this.suggestions : [],
        },
      });
    }
  }
}
