/**
 * Matchmaker Durable Object — a single well-known FIFO queue.
 *
 * Hibernatable WebSockets on purpose: this instance sits idle between joins
 * far more than the Match DO does, and losing the in-memory queue to a
 * hibernation eviction is harmless — a client just reconnects/re-queues.
 * `state.getWebSockets()` + `deserializeAttachment()` rebuild `waiting` on
 * wake so a queued socket surviving hibernation isn't silently dropped.
 */
export class Matchmaker {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.waiting = [];
    for (const ws of this.state.getWebSockets()) {
      const att = ws.deserializeAttachment();
      if (att) this.waiting.push({ ws, userId: att.userId, username: att.username });
    }
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const userId = request.headers.get('x-sl-user-id');
    const username = request.headers.get('x-sl-username') || 'Player';
    if (!userId) return new Response('unauthorized', { status: 401 });

    // A second queue attempt from the same user supersedes the first.
    this.waiting = this.waiting.filter(w => {
      if (w.userId !== userId) return true;
      try { w.ws.close(1000, 'superseded'); } catch (_) {}
      return false;
    });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ userId, username });
    this.waiting.push({ ws: server, userId, username });
    this.send(server, { type: 'queued', position: this.waiting.length });

    this.tryPair();

    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch (_) { /* socket already gone */ }
  }

  tryPair() {
    while (this.waiting.length >= 2) {
      const a = this.waiting.shift();
      const b = this.waiting.shift();
      const matchId = crypto.randomUUID();
      this.send(a.ws, { type: 'matched', matchId, opponent: { username: b.username } });
      this.send(b.ws, { type: 'matched', matchId, opponent: { username: a.username } });
      try { a.ws.close(1000, 'matched'); } catch (_) {}
      try { b.ws.close(1000, 'matched'); } catch (_) {}
    }
  }

  webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    if (msg.type === 'cancel') {
      this.waiting = this.waiting.filter(w => w.ws !== ws);
      try { ws.close(1000, 'cancelled'); } catch (_) {}
    }
  }

  webSocketClose(ws) { this.waiting = this.waiting.filter(w => w.ws !== ws); }
  webSocketError(ws) { this.waiting = this.waiting.filter(w => w.ws !== ws); }
}
