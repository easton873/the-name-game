import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/types';

export const GAME_NAME = 'The Name Game';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({ transports: ['websocket', 'polling'] });

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

/**
 * A pencil, point down, in the given body colour. Size it with --pw and tilt it with --tilt on
 * the wrapping `.pencil` element.
 */
export function pencilHTML(color: string, style = ''): string {
  const o = 'stroke="#2f3140" stroke-width="1.6" stroke-linejoin="round"';
  return `<span class="pencil" style="${style}"><svg viewBox="0 0 28 140" aria-hidden="true">
    <rect x="4" y="1" width="20" height="14" rx="5" fill="#f4a3a8" ${o}/>
    <rect x="2" y="15" width="24" height="14" fill="#c9ced8" ${o}/>
    <path d="M2 20.5h24M2 24.5h24" stroke="#8d95a5" stroke-width="1.4"/>
    <rect x="2" y="29" width="24" height="75" fill="${color}" ${o}/>
    <rect x="3.5" y="30.5" width="6" height="72" fill="#fff" opacity=".28"/>
    <rect x="19" y="30.5" width="6.5" height="72" fill="#000" opacity=".14"/>
    <path d="M2 104h24L14 134Z" fill="#f2d4a7" ${o}/>
    <path d="M10 124.5h8L14 134Z" fill="#3a3d4a" ${o}/>
  </svg></span>`;
}

/** A partly revealed name: shown letters, dotted blanks for hidden ones, gaps for spaces. */
export function maskHTML(mask: string): string {
  return `<div class="mask">${Array.from(mask)
    .map((c) => (c === ' ' ? '<span class="gap"></span>' : c === '_' ? '<i class="blank"></i>' : `<b>${esc(c)}</b>`))
    .join('')}</div>`;
}

// ---- server clock (kept for later timed phases) -------------------------------------------

export const timerHTML = (cls = '') =>
  `<div class="timer ${cls}" data-timer><svg viewBox="0 0 36 36"><circle class="track" cx="18" cy="18" r="16"/><circle class="arc" cx="18" cy="18" r="16"/></svg><span data-timer-text>∞</span></div>`;
