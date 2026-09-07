/**
 * Match Durable Object — one live 1v1 game.
 *
 * Lockstep relay, not a server-authoritative sim: each client runs its own
 * full FPSim locally, exactly as it already does against the AI. This DO
 * only sequences commands between the two sockets (so both apply the same
 * commands in the same order) and runs a *shadow* copy of the sim purely to
 * reject illegal commands and to catch divergence via periodic hash checks —
 * it is never the source of truth for what either client renders. sim.js was
 * built for exactly this (see its header comment on lockstep replay and the
 * hash() "desync tripwire").
 *
 * Plain (non-hibernating) WebSockets on purpose: a match is short-lived and
 * its shadow sim must survive in memory for the whole match, so the small
 * idle-billing cost of a live socket is the right trade against the risk of
 * losing in-memory match state to a hibernation eviction mid-game.
 *
 * The shadow sim has no timer of its own (see catchUp()) — it only advances
 * when a command arrives, fast-forwarding on wall-clock time. A long stretch
 * with no commands at all (rare in this game, but possible) means no interim
 * hash check happens either; both real clients keep playing correctly off
 * their own local sims regardless, so this only narrows the window in which
 * the DO's desync/anti-cheat backstop is actively checking. Acceptable for a
 * casual v1 feature — see the plan's Open Risks on anti-cheat.
 */
import '../public/map.js';
import '../public/sim.js';

const HASH_EVERY_TICKS = 100;
const CONNECT_TIMEOUT_MS = 20_000;
const FORFEIT_GRACE_MS = 15_000;

const commands = () => ({
  build: self.FPSim.build,
  industry: self.FPSim.industry,
  march: self.FPSim.march,
  reinforce: self.FPSim.reinforce,
});

export class Match {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.seats = new Map();          // seat (0|1) -> { ws, userId, username }
    this.sim = null;
    this.M = null;
    this.started = false;
    this.ended = false;
    this.lastHashTick = 0;
    this.pendingHashes = new Map();  // tick -> Map(seat -> hash)
    this.alarmKind = null;           // 'connect-timeout' | 'forfeit'
    this.forfeitSeat = null;
    this.matchStartMs = null;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const userId = request.headers.get('x-sl-user-id');
    const username = request.headers.get('x-sl-username') || 'Player';
    if (!userId) return new Response('unauthorized', { status: 401 });

    // No reconnect in v1 — a user id that's already seated (even if its
    // socket already closed) cannot take the other seat or rejoin.
    for (const s of this.seats.values()) {
      if (s.userId === userId) return new Response('already connected', { status: 409 });
    }
    if (this.seats.size >= 2) return new Response('match full', { status: 409 });

    const seat = this.seats.size;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.seats.set(seat, { ws: server, userId, username });
    server.addEventListener('message', ev => this.onMessage(seat, ev.data));
    server.addEventListener('close', () => this.onClose(seat));
    server.addEventListener('error', () => this.onClose(seat));

    if (this.seats.size === 1) {
      this.alarmKind = 'connect-timeout';
      await this.state.storage.setAlarm(Date.now() + CONNECT_TIMEOUT_MS);
    } else {
      await this.beginMatch();
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async beginMatch() {
    this.started = true;
    this.alarmKind = null;
    await this.state.storage.deleteAlarm();
    this.M = self.FPMap.build('duel');
    this.sim = self.FPSim.create(this.M);
    this.matchStartMs = Date.now();
    for (const [seat] of this.seats) {
      const opp = this.seats.get(1 - seat);
      this.send(seat, { type: 'start', seat, board: 'duel', opponent: { username: opp.username } });
    }
  }

  /** The shadow sim has no timer of its own — it only advances when a command
   *  needs validating or a hash check is due — so before doing either, fast
   *  forward it to wherever wall-clock time says both real clients already
   *  are. step() is pure and tick-driven, so "catch up 200 ticks at once" is
   *  exactly as correct as taking them one at a time. */
  catchUp() {
    if (!this.sim || this.matchStartMs == null) return;
    const dt = 1000 / self.FPSim.RULES.tickHz;
    const owed = Math.floor((Date.now() - this.matchStartMs) / dt) - this.sim.tick;
    for (let i = 0; i < owed && this.sim.over === null; i++) self.FPSim.step(this.sim, this.M);
  }

  send(seat, msg) {
    const s = this.seats.get(seat);
    if (!s) return;
    try { s.ws.send(JSON.stringify(msg)); } catch (_) { /* socket already gone */ }
  }

  broadcast(msg) { for (const seat of this.seats.keys()) this.send(seat, msg); }

  onMessage(seat, raw) {
    if (this.ended || !this.started) return;
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    if (msg.type === 'cmd') this.handleCmd(seat, msg);
    else if (msg.type === 'hashResp') this.handleHashResp(seat, msg);
  }

  /** Validate against the shadow sim; only a legal command is broadcast, and
   *  it's broadcast to both sockets (including the sender) so both clients
   *  apply it at the same point rather than the sender applying it early. */
  handleCmd(seat, msg) {
    this.catchUp();
    const { kind, args, seq } = msg;
    const fn = commands()[kind];
    if (!fn || !Array.isArray(args)) {
      this.send(seat, { type: 'applied', seq, ok: false, error: 'bad command' });
      return;
    }
    const err = fn(this.sim, this.M, seat, ...args);
    if (err) {
      this.send(seat, { type: 'applied', seq, ok: false, error: err });
      return;
    }
    this.broadcast({ type: 'applied', seq, seat, kind, args, ok: true, tick: this.sim.tick });
    this.maybeCheckHash();
    this.maybeEnd();
  }

  maybeCheckHash() {
    if (!this.sim || this.sim.tick - this.lastHashTick < HASH_EVERY_TICKS) return;
    this.lastHashTick = this.sim.tick;
    const tick = this.sim.tick;
    this.pendingHashes.set(tick, new Map());
    this.broadcast({ type: 'hashReq', tick });
  }

  handleHashResp(seat, msg) {
    const bucket = this.pendingHashes.get(msg.tick);
    if (!bucket) return;
    bucket.set(seat, msg.hash);
    if (bucket.size < 2) return;
    this.pendingHashes.delete(msg.tick);
    const [h0, h1] = [...bucket.values()];
    if (h0 !== h1) {
      this.broadcast({ type: 'desync', tick: msg.tick });
      this.endMatch();
    }
  }

  maybeEnd() {
    if (this.sim.over !== null) {
      this.broadcast({ type: 'over', winnerSeat: this.sim.over });
      this.endMatch();
    }
  }

  endMatch() {
    if (this.ended) return;
    this.ended = true;
    this.state.storage.deleteAlarm().catch(() => {});
    for (const s of this.seats.values()) { try { s.ws.close(1000, 'match-ended'); } catch (_) {} }
  }

  onClose(seat) {
    if (this.ended) return;
    if (!this.seats.has(seat)) return;

    if (!this.started) {
      // Left the lobby before the second player arrived — nothing to forfeit.
      this.seats.delete(seat);
      return;
    }

    const otherSeat = 1 - seat;
    this.send(otherSeat, { type: 'opponentGone', graceSeconds: Math.round(FORFEIT_GRACE_MS / 1000) });
    this.forfeitSeat = seat;
    this.alarmKind = 'forfeit';
    this.state.storage.setAlarm(Date.now() + FORFEIT_GRACE_MS).catch(() => {});
  }

  async alarm() {
    if (this.ended) return;
    if (this.alarmKind === 'connect-timeout') {
      if (this.seats.size < 2) {
        this.send(0, { type: 'error', message: 'opponent-no-show' });
        this.endMatch();
      }
      return;
    }
    if (this.alarmKind === 'forfeit' && this.forfeitSeat != null) {
      const winnerSeat = 1 - this.forfeitSeat;
      this.send(winnerSeat, { type: 'forfeit', winnerSeat, reason: 'disconnect' });
      this.endMatch();
    }
  }
}
