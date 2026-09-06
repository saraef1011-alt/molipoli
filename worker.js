import { DurableObject } from "cloudflare:workers";

const COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#06b6d4", "#ec4899", "#84cc16"];
const BASE = [
  ["شروع",0],["خیابان آبی",60],["شانس",0],["خیابان سبز",80],["مالیات",100],["ایستگاه",120],
  ["خیابان قرمز",140],["شانس",0],["خیابان نارنجی",160],["پارک",0],["خیابان زرد",180],["آب",150],
  ["خیابان صورتی",200],["شانس",0],["خیابان بنفش",220],["ایستگاه",120],["خیابان سبز تیره",240],["شانس",0],
  ["خیابان طلایی",260],["استراحت",0],["خیابان آبی تیره",280],["شانس",0],["خیابان قرمز تیره",300],["مالیات",100],
  ["خیابان ویژه",320],["ایستگاه",120],["خیابان فیروزه‌ای",340],["شانس",0],["خیابان نقره‌ای",360],["بازداشت",0],
  ["خیابان آخر",400],["شانس",0],["خیابان سلطنتی",420],["آب",150],["خیابان الماس",450],["ایستگاه",120],
  ["شانس",0],["خیابان امپراتوری",480],["مالیات",100],["پایان مسیر",0]
];

function makeGame() {
  return {
    started: false,
    turn: 0,
    players: {},
    board: BASE.map(([name, price]) => ({ name, price, owner: null }))
  };
}

function cleanPlayer(p) {
  return {
    id:p.id, name:p.name, money:p.money, pos:p.pos, properties:p.properties,
    ready:p.ready, inGame:p.inGame, color:p.color
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/new-room") {
      return Response.json({ room: randomRoom() });
    }
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket upgrade required", { status: 426 });
      }
      const room = (url.searchParams.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
      if (!room) return new Response("Room code required", { status: 400 });
      const id = env.ROOM.idFromName(room);
      return env.ROOM.get(id).fetch(request);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("🐭 مولی پولی Worker روشن است");
  }
};

function randomRoom() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      if (!(await this.ctx.storage.get("game"))) await this.ctx.storage.put("game", makeGame());
    });
  }

  async fetch(request) {
    const game = await this.ctx.storage.get("game") || makeGame();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID() });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const game = await this.ctx.storage.get("game") || makeGame();
    const attachment = ws.deserializeAttachment() || {};

    if (msg.type === "join") {
      if (game.started || Object.keys(game.players).length >= 8) {
        ws.send(JSON.stringify({ type:"errorMsg", message:"اتاق پر است یا بازی شروع شده." }));
        return;
      }
      const id = attachment.id || crypto.randomUUID();
      const players = Object.values(game.players);
      const p = {
        id, name:String(msg.name || "بازیکن").slice(0,18), money:1500, pos:0,
        properties:[], ready:false, inGame:false, color:COLORS[players.length]
      };
      game.players[id] = p;
      ws.serializeAttachment({ id });
      await this.ctx.storage.put("game", game);
      ws.send(JSON.stringify({ type:"joined", id }));
      await this.broadcast(game);
      return;
    }

    const id = attachment.id;
    if (!id || !game.players[id]) return;

    if (msg.type === "ready") {
      game.players[id].ready = !game.players[id].ready;
      const players = Object.values(game.players);
      if (players.length >= 2 && players.every(p => p.ready)) startGame(game);
    } else if (msg.type === "startNow") {
      if (Object.keys(game.players).length >= 2) startGame(game);
    } else if (msg.type === "roll") {
      if (!game.started) return;
      const players = Object.values(game.players);
      const p = players[game.turn % players.length];
      if (!p || p.id !== id) return;
      const n = 1 + Math.floor(Math.random() * 6);
      move(game, p, n);
      game.turn = (game.turn + 1) % players.length;
      await this.ctx.storage.put("game", game);
      await this.broadcast(game, { type:"dice", n });
      return;
    } else if (msg.type === "chat") {
      const text = String(msg.text || "").trim().slice(0, 200);
      if (text) await this.broadcast(game, { type:"chat", name:game.players[id].name, text });
      return;
    }

    await this.ctx.storage.put("game", game);
    await this.broadcast(game);
  }

  async webSocketClose(ws) {
    const attachment = ws.deserializeAttachment() || {};
    if (!attachment.id) return;
    const game = await this.ctx.storage.get("game") || makeGame();
    if (game.players[attachment.id]) {
      delete game.players[attachment.id];
      if (!Object.keys(game.players).length) {
        await this.ctx.storage.put("game", makeGame());
      } else {
        game.turn = game.turn % Object.keys(game.players).length;
        await this.ctx.storage.put("game", game);
        await this.broadcast(game);
      }
    }
  }

  async broadcast(game, extra = null) {
    if (extra) {
      for (const ws of this.ctx.getWebSockets()) {
        try { ws.send(JSON.stringify(extra)); } catch {}
      }
    }
    const state = {
      type:"state", started:game.started, turn:game.turn,
      players:Object.values(game.players).map(cleanPlayer), board:game.board
    };
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(JSON.stringify(state)); } catch {}
    }
  }
}

function startGame(game) {
  game.started = true;
  game.turn = 0;
  for (const p of Object.values(game.players)) {
    p.money = 1500; p.pos = 0; p.properties = []; p.inGame = true; p.ready = true;
  }
  for (const c of game.board) c.owner = null;
}

function move(game, p, n) {
  const old = p.pos;
  p.pos = (p.pos + n) % game.board.length;
  if (p.pos < old) p.money += 200;
  const c = game.board[p.pos];
  if (c.price && c.owner && c.owner !== p.id) {
    const owner = game.players[c.owner];
    if (owner) {
      const fee = Math.min(p.money, Math.max(20, Math.floor(c.price * .15)));
      p.money -= fee; owner.money += fee;
    }
  } else if (c.price && !c.owner && p.money >= c.price) {
    p.money -= c.price;
    c.owner = p.id;
    p.properties.push(p.pos);
  }
}
