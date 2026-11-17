// Types and constants shared by the server and both clients (host screen + phones).

export type Phase =
  | 'lobby'
  | 'names' // everyone secretly writes one name
  | 'memorize' // the big screen shows every name, 4 seconds each (pass 1, then pass 2)
  | 'ready' // break between the two passes: everybody taps Ready on their phone
  | 'play' // teams take turns guessing who wrote which name
  | 'gameOver';

export const MIN_PLAYERS = 3;
export const MAX_PLAYER_NAME_LENGTH = 14;

export const INTRO_MS = 3000; // "get ready" before each pass
export const MEMORIZE_MS = 4000; // how long each name is shown
export const EVENT_HOLD_MS = 10000; // how long a guess result stays on the big screen
export const GIVEUP_HOLD_MS = 3000;
export const REVEAL_HOLD_MS = 6000;

export interface PlayerInfo {
  id: string;
  name: string;
  /** The colour of this player's pencil. */
  color: string;
  connected: boolean;
  /** Finished whatever the current phase is waiting on (wrote a name / tapped Ready). */
  done: boolean;
  /** Still in the game (players who never wrote a name are dropped). */
  participating: boolean;
  /** The team this player belongs to, identified by its leader (the only player whose name is still in the pool). */
  teamLeaderId: string | null;
}

export interface TeamInfo {
  leaderId: string;
  /** Eliminated players who joined this team (not including the leader). */
  memberIds: string[];
  gaveUp: boolean;
}

export interface GuessEvent {
  id: number;
  kind: 'correct' | 'wrong' | 'giveup' | 'reveal';
  /** The leader of the team that made the guess / gave up. */
  guesserId: string;
  targetId: string | null;
  /** What the team typed. */
  typed: string | null;
  /** On a correct guess: the real name that was guessed. */
  actualName: string | null;
  /** Correct guess that leaves only one name in the pool. */
  final: boolean;
  holdMs: number;
}

export interface PlayState {
  teams: TeamInfo[];
  turnLeaderId: string | null;
  /** While set, the result is on screen and nobody can guess. */
  event: GuessEvent | null;
  /** How many letters of every unguessed name are revealed. */
  revealLevel: number;
  /** Masked names still in the pool, e.g. "C _ _ _ _ _" (spaces kept), in a fixed random order. Empty until a reveal. */
  masks: string[];
}

export interface MemorizeState {
  pass: 1 | 2;
  /** -1 while the "get ready" intro is showing. */
  index: number;
  total: number;
  /** The name on screen (host only). */
  name: string | null;
  ms: number;
}

/** A hint from a teammate to the team leader. Never checked against anything. */
export interface Suggestion {
  id: number;
  fromId: string;
  targetId: string | null;
  text: string;
}
export const MAX_SUGGESTION_LENGTH = 40;

export interface YouInfo {
  id: string;
  /** Your own secret name, once you've submitted it. */
  secretName: string | null;
  ready: boolean;
  teamLeaderId: string | null;
  /** You are the leader of the team whose turn it is and nothing is on hold: only you can guess or give up. */
  canGuess: boolean;
  /** You are on the team whose turn it is, but not its leader: you can send suggestions. */
  canSuggest: boolean;
  /** Suggestions from teammates for this turn (leader only). */
  suggestions: Suggestion[];
}

export interface ClientState {
  code: string;
  phase: Phase;
  players: PlayerInfo[];
  memorize: MemorizeState | null;
  play: PlayState | null;
  winner: { id: string; secretName: string; teamIds: string[] } | null;
  /** Everyone's secret name, once the game is over. */
  recap: { id: string; secretName: string }[] | null;
  you: YouInfo | null;
}

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface ClientToServerEvents {
  'host:create': (cb: Ack<{ code: string; hostToken: string }>) => void;
  'host:resume': (p: { code: string; hostToken: string }, cb: Ack) => void;
  'host:start': () => void;
  'host:skip': () => void;
  'host:backToLobby': () => void;
  'host:kick': (p: { playerId: string }) => void;
  'player:join': (p: { code: string; name: string; token?: string }, cb: Ack<{ token: string; playerId: string }>) => void;
  'player:submitName': (p: { name: string }, cb?: Ack) => void;
  'player:ready': (cb?: Ack) => void;
  'player:guess': (p: { targetId: string; name: string }, cb?: Ack<{ result: 'correct' | 'wrong' }>) => void;
  'player:giveUp': (cb?: Ack) => void;
  'player:suggest': (p: { text: string; targetId?: string | null }, cb?: Ack) => void;
}

export interface ServerToClientEvents {
  state: (s: ClientState) => void;
  closed: (reason: string) => void;
}
