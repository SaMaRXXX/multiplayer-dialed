const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ROUND_DURATION_MS = 30000;

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

function createUniqueRoomCode() {
  let code = makeRoomCode();
  while (rooms.has(code)) {
    code = makeRoomCode();
  }
  return code;
}

function sanitizeName(name) {
  if (typeof name !== "string") return "Player";
  const trimmed = name.trim().slice(0, 16);
  return trimmed || "Player";
}

function getRoomPublicState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  const players = Array.from(room.players.values())
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      hits: p.hits,
      misses: p.misses,
      accuracy: p.hits + p.misses > 0 ? Math.round((p.hits / (p.hits + p.misses)) * 100) : 0,
      connected: p.connected
    }))
    .sort((a, b) => b.score - a.score || b.hits - a.hits || a.misses - b.misses);

  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    roundEndsAt: room.roundEndsAt,
    players
  };
}

function emitRoomState(roomCode) {
  io.to(roomCode).emit("room_state", getRoomPublicState(roomCode));
}

function resetPlayerStats(room) {
  for (const player of room.players.values()) {
    player.score = 0;
    player.hits = 0;
    player.misses = 0;
  }
}

function startRound(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  if (room.phase === "playing") return;

  resetPlayerStats(room);
  room.phase = "playing";
  room.roundEndsAt = Date.now() + ROUND_DURATION_MS;

  io.to(roomCode).emit("round_started", {
    roundEndsAt: room.roundEndsAt,
    durationMs: ROUND_DURATION_MS
  });

  emitRoomState(roomCode);

  clearTimeout(room.roundTimeout);
  room.roundTimeout = setTimeout(() => {
    endRound(roomCode);
  }, ROUND_DURATION_MS + 100);
}

function endRound(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  room.phase = "results";
  room.roundEndsAt = null;
  clearTimeout(room.roundTimeout);
  room.roundTimeout = null;

  io.to(roomCode).emit("round_ended", {
    results: getRoomPublicState(roomCode)
  });

  emitRoomState(roomCode);
}

function cleanupRoomIfEmpty(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const hasConnectedPlayers = Array.from(room.players.values()).some((p) => p.connected);
  if (!hasConnectedPlayers) {
    clearTimeout(room.roundTimeout);
    rooms.delete(roomCode);
  }
}

io.on("connection", (socket) => {
  socket.on("create_room", ({ name }, callback) => {
    try {
      const roomCode = createUniqueRoomCode();
      const playerName = sanitizeName(name);

      const room = {
        code: roomCode,
        hostId: socket.id,
        phase: "lobby",
        roundEndsAt: null,
        roundTimeout: null,
        players: new Map()
      };

      room.players.set(socket.id, {
        id: socket.id,
        name: playerName,
        score: 0,
        hits: 0,
        misses: 0,
        connected: true
      });

      rooms.set(roomCode, room);
      socket.join(roomCode);
      socket.data.roomCode = roomCode;

      callback({ ok: true, room: getRoomPublicState(roomCode), selfId: socket.id });
      emitRoomState(roomCode);
    } catch (err) {
      callback({ ok: false, error: "Failed to create room." });
    }
  });

  socket.on("join_room", ({ name, roomCode }, callback) => {
    try {
      const code = String(roomCode || "").trim().toUpperCase();
      const room = rooms.get(code);

      if (!room) {
        callback({ ok: false, error: "Room not found." });
        return;
      }

      const playerName = sanitizeName(name);
      room.players.set(socket.id, {
        id: socket.id,
        name: playerName,
        score: 0,
        hits: 0,
        misses: 0,
        connected: true
      });

      socket.join(code);
      socket.data.roomCode = code;

      callback({ ok: true, room: getRoomPublicState(code), selfId: socket.id });
      emitRoomState(code);
    } catch (err) {
      callback({ ok: false, error: "Failed to join room." });
    }
  });

  socket.on("start_round", (_, callback) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      callback?.({ ok: false, error: "Room not found." });
      return;
    }

    if (room.hostId !== socket.id) {
      callback?.({ ok: false, error: "Only the host can start the round." });
      return;
    }

    if (room.phase === "playing") {
      callback?.({ ok: false, error: "Round already in progress." });
      return;
    }

    startRound(roomCode);
    callback?.({ ok: true });
  });

  socket.on("submit_hit", ({ points }, callback) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room || room.phase !== "playing") {
      callback?.({ ok: false });
      return;
    }

    const player = room.players.get(socket.id);
    if (!player) {
      callback?.({ ok: false });
      return;
    }

    const safePoints = Number.isFinite(points) ? Math.max(1, Math.min(10, Math.floor(points))) : 1;
    player.score += safePoints;
    player.hits += 1;

    emitRoomState(roomCode);
    callback?.({ ok: true });
  });

  socket.on("submit_miss", (_, callback) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room || room.phase !== "playing") {
      callback?.({ ok: false });
      return;
    }

    const player = room.players.get(socket.id);
    if (!player) {
      callback?.({ ok: false });
      return;
    }

    player.misses += 1;
    emitRoomState(roomCode);
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
      callback?.({ ok: false, error: "Only the host can return to lobby." });
      return;
    }

    room.phase = "lobby";
    room.roundEndsAt = null;
    clearTimeout(room.roundTimeout);
    room.roundTimeout = null;

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
      const nextHost = Array.from(room.players.values()).find((p) => p.id !== socket.id && p.connected);
      room.hostId = nextHost ? nextHost.id : null;
    }

    emitRoomState(roomCode);
    cleanupRoomIfEmpty(roomCode);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});