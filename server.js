const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const REMEMBER_SECONDS = 12;
const TOTAL_COLORS = 5;

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

function makeRoomCode(length = 5) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function createRoomCode() {
  let code = makeRoomCode();
  while (rooms.has(code)) code = makeRoomCode();
  return code;
}

function sanitizeName(name) {
  if (typeof name !== "string") return "Player";
  const value = name.trim().slice(0, 16);
  return value || "Player";
}

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function randomColorHSB() {
  return {
    h: Math.floor(Math.random() * 360),
    s: Math.floor(35 + Math.random() * 60),
    b: Math.floor(35 + Math.random() * 60)
  };
}

function hsbToRgb(h, s, v) {
  s /= 100;
  v /= 100;

  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r1 = 0, g1 = 0, b1 = 0;

  if (h >= 0 && h < 60) [r1, g1, b1] = [c, x, 0];
  else if (h < 120) [r1, g1, b1] = [x, c, 0];
  else if (h < 180) [r1, g1, b1] = [0, c, x];
  else if (h < 240) [r1, g1, b1] = [0, x, c];
  else if (h < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255)
  };
}

function rgbDistance(c1, c2) {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function scoreGuess(original, guess) {
  const rgb1 = hsbToRgb(original.h, original.s, original.b);
  const rgb2 = hsbToRgb(guess.h, guess.s, guess.b);
  const maxDistance = Math.sqrt(255 * 255 * 3);
  const distance = rgbDistance(rgb1, rgb2);
  const closeness = 1 - distance / maxDistance;
  return Math.max(0, Math.round(closeness * 10 * 100) / 100);
}

function createPlayer(id, name) {
  return {
    id,
    name,
    connected: true,
    guesses: Array.from({ length: TOTAL_COLORS }, () => ({ h: 180, s: 50, b: 50 })),
    submitted: false,
    scores: Array.from({ length: TOTAL_COLORS }, () => 0),
    totalScore: 0,
    currentIndex: 0
  };
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    connected: player.connected,
    submitted: player.submitted,
    totalScore: player.totalScore,
    scores: player.scores,
    currentIndex: player.currentIndex
  };
}

function getRoomState(roomCode, forPlayerId = null) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  const players = Array.from(room.players.values())
    .map(publicPlayer)
    .sort((a, b) => b.totalScore - a.totalScore || Number(a.submitted) - Number(b.submitted));

  const state = {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    rememberEndsAt: room.rememberEndsAt,
    colorCount: TOTAL_COLORS,
    players
  };

  if (room.phase === "remember") {
    state.colors = room.colors;
  }

  if (room.phase === "results" && forPlayerId) {
    const me = room.players.get(forPlayerId);
    if (me) {
      state.myResults = room.colors.map((original, index) => ({
        original,
        guess: me.guesses[index],
        score: me.scores[index]
      }));
    }
    state.allResults = Array.from(room.players.values())
      .map((player) => ({
        id: player.id,
        name: player.name,
        totalScore: player.totalScore,
        scores: player.scores,
        submitted: player.submitted
      }))
      .sort((a, b) => b.totalScore - a.totalScore);
  }

  return state;
}

function emitRoomState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  for (const player of room.players.values()) {
    io.to(player.id).emit("room_state", getRoomState(roomCode, player.id));
  }
}

function startGame(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  room.phase = "remember";
  room.colors = Array.from({ length: TOTAL_COLORS }, randomColorHSB);
  room.rememberEndsAt = Date.now() + REMEMBER_SECONDS * 1000;

  for (const player of room.players.values()) {
    player.guesses = Array.from({ length: TOTAL_COLORS }, () => ({ h: 180, s: 50, b: 50 }));
    player.submitted = false;
    player.scores = Array.from({ length: TOTAL_COLORS }, () => 0);
    player.totalScore = 0;
    player.currentIndex = 0;
  }

  emitRoomState(roomCode);

  clearTimeout(room.rememberTimer);
  room.rememberTimer = setTimeout(() => {
    const latestRoom = rooms.get(roomCode);
    if (!latestRoom) return;
    latestRoom.phase = "guess";
    latestRoom.rememberEndsAt = null;
    emitRoomState(roomCode);
  }, REMEMBER_SECONDS * 1000);
}

function finalizeIfAllSubmitted(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  if (room.phase !== "guess") return;

  const connectedPlayers = Array.from(room.players.values()).filter((p) => p.connected);
  if (connectedPlayers.length === 0) return;

  const allSubmitted = connectedPlayers.every((p) => p.submitted);
  if (!allSubmitted) return;

  room.phase = "results";

  for (const player of room.players.values()) {
    player.scores = room.colors.map((original, index) => scoreGuess(original, player.guesses[index]));
    player.totalScore = Math.round(player.scores.reduce((a, b) => a + b, 0) * 100) / 100;
  }

  emitRoomState(roomCode);
}

function cleanupRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const hasConnected = Array.from(room.players.values()).some((p) => p.connected);
  if (!hasConnected) {
    clearTimeout(room.rememberTimer);
    rooms.delete(roomCode);
  }
}

io.on("connection", (socket) => {
  socket.on("create_room", ({ name }, callback) => {
    const roomCode = createRoomCode();
    const room = {
      code: roomCode,
      hostId: socket.id,
      phase: "lobby",
      rememberEndsAt: null,
      rememberTimer: null,
      colors: [],
      players: new Map()
    };

    room.players.set(socket.id, createPlayer(socket.id, sanitizeName(name)));
    rooms.set(roomCode, room);

    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    callback?.({ ok: true, selfId: socket.id, room: getRoomState(roomCode, socket.id) });
    emitRoomState(roomCode);
  });

  socket.on("join_room", ({ name, roomCode }, callback) => {
    const code = String(roomCode || "").trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      callback?.({ ok: false, error: "Room not found." });
      return;
    }

    room.players.set(socket.id, createPlayer(socket.id, sanitizeName(name)));
    socket.join(code);
    socket.data.roomCode = code;

    callback?.({ ok: true, selfId: socket.id, room: getRoomState(code, socket.id) });
    emitRoomState(code);
  });

  socket.on("start_game", (_, callback) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      callback?.({ ok: false, error: "Room not found." });
      return;
    }

    if (room.hostId !== socket.id) {
      callback?.({ ok: false, error: "Only host can start." });
      return;
    }

    if (room.phase === "remember" || room.phase === "guess") {
      callback?.({ ok: false, error: "Game already in progress." });
      return;
    }

    startGame(roomCode);
    callback?.({ ok: true });
  });

  socket.on("update_guess", ({ index, guess }, callback) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    if (!room || room.phase !== "guess") {
      callback?.({ ok: false });
      return;
    }

    const player = room.players.get(socket.id);
    if (!player || player.submitted) {
      callback?.({ ok: false });
      return;
    }

    const safeIndex = clamp(Number(index), 0, TOTAL_COLORS - 1);
    const safeGuess = {
      h: clamp(Math.floor(Number(guess?.h) || 0), 0, 359),
      s: clamp(Math.floor(Number(guess?.s) || 0), 0, 100),
      b: clamp(Math.floor(Number(guess?.b) || 0), 0, 100)
    };

    player.guesses[safeIndex] = safeGuess;
    player.currentIndex = safeIndex;
    emitRoomState(roomCode);
    callback?.({ ok: true });
  });

  socket.on("submit_answers", (_, callback) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    if (!room || room.phase !== "guess") {
      callback?.({ ok: false, error: "Not in guessing phase." });
      return;
    }

    const player = room.players.get(socket.id);
    if (!player) {
      callback?.({ ok: false, error: "Player not found." });
      return;
    }

    player.submitted = true;
    emitRoomState(roomCode);
    finalizeIfAllSubmitted(roomCode);
    callback?.({ ok: true });
  });

  socket.on("back_to_lobby", (_, callback) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      callback?.({ ok: false, error: "Room not found." });
      return;
    }

    if (room.hostId !== socket.id) {
      callback?.({ ok: false, error: "Only host can reset." });
      return;
    }

    clearTimeout(room.rememberTimer);
    room.phase = "lobby";
    room.rememberEndsAt = null;
    room.colors = [];

    for (const player of room.players.values()) {
      player.guesses = Array.from({ length: TOTAL_COLORS }, () => ({ h: 180, s: 50, b: 50 }));
      player.submitted = false;
      player.scores = Array.from({ length: TOTAL_COLORS }, () => 0);
      player.totalScore = 0;
      player.currentIndex = 0;
    }

    emitRoomState(roomCode);
    callback?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (player) {
      player.connected = false;
    }

    if (room.hostId === socket.id) {
      const nextHost = Array.from(room.players.values()).find((p) => p.connected && p.id !== socket.id);
      room.hostId = nextHost ? nextHost.id : null;
    }

    emitRoomState(roomCode);
    cleanupRoom(roomCode);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});