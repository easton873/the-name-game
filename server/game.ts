import type { Server } from 'socket.io';
import {
  MAX_NAME_LENGTH,
  MAX_PLAYER_NAME_LENGTH,
  MIN_PLAYERS,
  type ClientState,
  type ClientToServerEvents,
  type Phase,
  type PlayerInfo,
  type ServerToClientEvents,
} from '../shared/types.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

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

export class Room {
  readonly code: string;
  readonly hostToken: string;
  hostSocketId: string | null = null;
  players = new Map<string, Player>();
  phase: Phase = 'lobby';

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
    this.io.to(this.roomName).emit('closed', reason);
    this.onDestroy?.();
  }

  get roomName() {
    return `room:${this.code}`;
  }

  // ------------------------------------------------------------------ players

  join(name: string, token: string | undefined, socketId: string): { ok: true; player: Player } | { ok: false; error: string } {
    if (token) {
      const existing = [...this.players.values()].find((p) => p.token === token);
      if (existing) {
        existing.socketId = socketId;
        this.broadcast();
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
    this.broadcast();
  }

  kick(playerId: string) {
    if (this.phase !== 'lobby') return;
    const p = this.players.get(playerId);
    if (!p) return;
    if (p.socketId) this.io.to(p.socketId).emit('closed', 'You were removed from the game by the host.');
    this.players.delete(playerId);
    this.broadcast();
  }

  // ------------------------------------------------------------------ flow

  start() {
    if (this.phase !== 'lobby') return;
    if ([...this.players.values()].filter((p) => p.socketId).length < MIN_PLAYERS) return;
    for (const p of this.players.values()) p.secretName = null;
    this.phase = 'names';
    this.broadcast();
  }

  backToLobby() {
    this.phase = 'lobby';
    for (const p of this.players.values()) p.secretName = null;
    this.broadcast();
  }

  submitName(playerId: string, raw: unknown): string | null {
    if (this.phase !== 'names') return 'Names are closed.';
    const p = this.players.get(playerId);
    if (!p) return 'You are not in this game.';
    if (p.secretName) return 'You already wrote your name.';
    const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!name) return 'Write a name first!';
    if (name.length > MAX_NAME_LENGTH) return `Keep it to ${MAX_NAME_LENGTH} characters.`;
    p.secretName = name;
    // Once every connected player has written a name, the memorizing part begins.
    const live = [...this.players.values()].filter((x) => x.socketId);
    if (live.length > 0 && live.every((x) => x.secretName)) this.phase = 'memorize';
    this.broadcast();
    return null;
  }

  // ------------------------------------------------------------------ state views

  private baseState(): ClientState {
    const players: PlayerInfo[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      connected: !!p.socketId,
      done: !!p.secretName,
    }));
    return { code: this.code, phase: this.phase, players, you: null };
  }

  broadcast() {
    const base = this.baseState();
    if (this.hostSocketId) this.io.to(this.hostSocketId).emit('state', base);
    for (const p of this.players.values()) {
      if (p.socketId) this.io.to(p.socketId).emit('state', { ...base, you: { id: p.id, secretName: p.secretName } });
    }
  }
}
