# The Name Game

A Jackbox-style party game, in the style of [matchy-finderoo](https://github.com/easton873/matchy-finderoo): one laptop/TV shows the main screen, everyone else plays on their phone.

Themed like early-writing practice sheets: ruled paper (blue top line, dotted middle line, red baseline) and pencils everywhere.

## The game (design)

1. **Names** – every player secretly writes one name.
2. **Memorize** – the big screen shows every name, 4 seconds each, in random order. Twice, with a break in between where everyone taps *Ready* on their phone.
3. **Guessing** – a random player goes first and guesses *which player wrote which name*. Right: that player is eliminated and joins the guesser's team, and the guesser goes again. Wrong: it's the guessed player's turn.
4. The UI never lists the names – players have to type from memory. Typed names are fuzzy-matched against the submitted names so typos are forgiven, and a name that matches nothing is rejected.
5. **Give up** – if every remaining player gives up, the first letter of every unclaimed name is revealed, then the next, and so on. A correct guess resets everyone's give-up status.
6. Last team standing wins.

### Status

- [x] Pencil-and-paper theme (landing, host lobby, phone join)
- [x] Lobby + room codes + QR join
- [x] Name entry phase
- [ ] Memorize phase (two passes, ready-up)
- [ ] Guessing, elimination, teams
- [ ] Fuzzy name matching
- [ ] Give up / letter reveals

## Run it locally

```bash
npm install
npm run build
npm start          # http://localhost:3000
```

Open `http://localhost:3000/host.html` on the laptop/TV; phones scan the QR code. For development with hot reload: `npm run dev` (server on :3000, Vite on :5173 – open `http://localhost:5173/host.html`).

## Layout

```
shared/   types + socket event contracts shared by server and clients
server/   Express + socket.io: room / game state machine (game.ts)
client/   Vite multi-page app: index.html (landing), host.html (big screen), play.html (phones)
          theme.css = the pencil-and-paper design system (.sheet, .wline, .pbtn, pencils)
```
