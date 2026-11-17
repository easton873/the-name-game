# The Name Game

A Jackbox-style party game, in the style of [matchy-finderoo](https://github.com/easton873/matchy-finderoo): one laptop/TV shows the main screen, everyone else plays on their phone.

Themed like early-writing practice sheets: ruled paper (blue top line, dotted middle line, red baseline) and pencils everywhere.

## How it plays

1. **Names** – every player secretly writes one name. Letters, numbers, spaces and the symbols `$ ! & @` only (so `P!nk` works); anything else disables the button and says why.
2. **Memorize** – the big screen shows every name for 4 seconds each, in random order, then everyone taps **Ready** on their phone and it shows them all again in a new random order.
3. **Guessing** – a random player goes first: they pick a player and type, from memory, the name that player wrote. There are no timers on anyone's turn or on name entry.
   - **Right:** that player is out and joins the guesser's team, and the guesser keeps going.
   - **Wrong** (a real submitted name, but not theirs): the guessed player's team gets the turn, and any give-ups are cleared.
   - **Not a submitted name** (typo too far off, or not a name at all): free retry, nothing changes.
   - The UI never lists names. Matching ignores case, accents and extra spaces, and every part of a multi-part name must be typed. **Every name that was ever submitted stays a valid guess, even after it's been guessed** – so typing an old name costs you your turn. If a typed name is equally close to two names it's rejected as ambiguous. Small typos are forgiven – see `typoTolerance` in `server/match.ts` (set it to `() => 0` for exact spelling only).
   - **Teams:** an eliminated player shares the leader's name. Only the leader (the one who wrote the name still in play) can guess or give up. Teammates can **send suggestions** – a free-text idea, optionally for a particular player, that is not checked at all (fake names are fine). Suggestions show up only on the leader's phone for that turn.
4. **Give up** – the leader can give up; the turn goes to a random team that hasn't. If every team gives up in a row, with no guess in between, one more letter of each unguessed name is revealed (as `C _ _ _ _ _ _  J _ _ _`). Any right or wrong guess breaks the streak.
5. **Winner** – when only one name is left, that player wins and their secret name is revealed with a pencil writing it out.

The big screen shows whose turn it is (teammates smaller on either side), announces each guess and whether it was right for 10 seconds, and the host can press **Skip** (or space) to move on if a player's phone dropped.

**Social mode** (checkbox in the host lobby): everyone writes a name and the big screen shows all the names twice as usual, then the game just ends and the group plays the guessing part themselves, out loud.

### Status

- [x] Pencil-and-paper theme
- [x] Lobby, room codes, QR join
- [x] Name entry with symbol validation
- [x] Memorize (two passes, ready-up)
- [x] Guessing, elimination, teams
- [x] Name matching
- [x] Give up / letter reveals
- [x] Winner reveal

## Run it locally

```bash
npm install
npm run build
npm start          # http://localhost:3000
```

Open `http://localhost:3000/host.html` on the laptop/TV; phones scan the QR code. `npm test` runs the matching unit tests and a full bot game over real sockets. For development with hot reload: `npm run dev` (server on :3000, Vite on :5173 – open `http://localhost:5173/host.html`).

## Layout

```
shared/   types + socket event contracts shared by server and clients
server/   Express + socket.io: room / game state machine (game.ts)
client/   Vite multi-page app: index.html (landing), host.html (big screen), play.html (phones)
          theme.css = the pencil-and-paper design system (.sheet, .wline, .pbtn, pencils)
```
