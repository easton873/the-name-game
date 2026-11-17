// Types and constants shared by the server and both clients (host screen + phones).

export type Phase =
  | 'lobby'
  | 'names' // everyone secretly writes one name
  | 'memorize'; // (next) the big screen shows every name, twice

export const MIN_PLAYERS = 3;
export const MAX_NAME_LENGTH = 24;
export const MAX_PLAYER_NAME_LENGTH = 14;

export interface PlayerInfo {
  id: string;
  name: string;
  /** The colour of this player's pencil. */
  color: string;
  connected: boolean;
  /** Has submitted a secret name. (Never the name itself - it stays secret!) */
  done: boolean;
}

export interface YouInfo {
  id: string;
  /** Your own secret name, once you've submitted it. */
  secretName: string | null;
}

export interface ClientState {
  code: string;
  phase: Phase;
  players: PlayerInfo[];
  you: YouInfo | null;
}

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface ClientToServerEvents {
  'host:create': (cb: Ack<{ code: string; hostToken: string }>) => void;
  'host:resume': (p: { code: string; hostToken: string }, cb: Ack) => void;
  'host:start': () => void;
  'host:backToLobby': () => void;
  'host:kick': (p: { playerId: string }) => void;
  'player:join': (p: { code: string; name: string; token?: string }, cb: Ack<{ token: string; playerId: string }>) => void;
  'player:submitName': (p: { name: string }, cb?: Ack) => void;
}

export interface ServerToClientEvents {
  state: (s: ClientState) => void;
  closed: (reason: string) => void;
}
