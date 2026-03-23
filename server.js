const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const DEFAULT_TOTAL_ROUNDS = 5;
const MIN_ROUNDS = 1;
const MAX_ROUNDS = 20;
const REMEMBER_SECONDS = 4;
const ROUND_RESULTS_SECONDS = 4;

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

function makeRoomCode(length = 5) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function uniqueRoomCode() {
  let code = makeRoomCode();
  while (rooms.has(code)) code = makeRoomCode();
  return code;
}

function sanitizeName(name) {
  if (typeof name !== "string") return "Player";
  const trimmed = name.trim().slice(0, 16);
  return trimmed || "Player";
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function colorDistanceHSB(a, b) {
  const hueDiffRaw = Math.abs(a.h - b.h);
  const hueDiff = Math.min(hueDiffRaw, 360 - hueDiffRaw) / 180;
  const satDiff = Math.abs(a.s - b.s) / 100;
  const brightDiff = Math.abs(a.b - b.b) / 100;

  return Math.sqrt(
    hueDiff * hueDiff * 2.2 +
    satDiff * satDiff * 0.8 +
    brightDiff * brightDiff * 0.8
  );
}

function randomColorHSB(previousColors = []) {
  let best = null;
  let bestScore = -1;

  for (let i = 0; i < 30; i += 1) {
    const candidate = {
      h: Math.floor(Math.random() * 360),
      s: Math.floor(35 + Math.random() * 60),
      b: Math.floor(35 + Math.random() * 55)
    };

    if (!previousColors.length) {
      return candidate;
    }

    const minDistance = Math.min(
      ...previousColors.map((c) => colorDistanceHSB(candidate, c))
    );

    if (minDistance > bestScore) {
      best = candidate;
      bestScore = minDistance;
    }
  }

  return best || {
    h: Math.floor(Math.random() * 360),
    s: Math.floor(35 + Math.random() * 60),
    b: Math.floor(35 + Math.random() * 55)
  };
}

function hsbToRgb(h, s, v) {
  const sat = s / 100;
  const val = v / 100;

  const c = val * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = val - c;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

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

function rgbDistance(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
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
    submitted: false,
    currentGuess: { h: 280, s: 35, b: 55 },
    totalScore: 0,
    roundScores: [],
    roundGuesses: []
  };
}

function getSortedPlayers(room) {
  return Array.from(room.players.values())
    .map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      submitted: p.submitted,
      totalScore: p.totalScore,
      roundScores: p.roundScores
    }))
    .sort((a, b) => b.totalScore - a.totalScore);
}

function getRoundResults(room) {
  return Array.from(room.players.values())
    .map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      submitted: p.submitted,
      totalScore: p.totalScore,
      guess: p.roundGuesses[room.currentRound - 1] || null,
      roundScore: p.roundScores[room.currentRound - 1] ?? null
    }))
    .sort((a, b) => (b.roundScore ?? -1) - (a.roundScore ?? -1));
}

function roomStateFor(room, playerId) {
  const player = room.players.get(playerId);

  const state = {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    totalRounds: room.totalRounds,
    currentRound: room.currentRound,
    rememberEndsAt: room.rememberEndsAt,
    roundResultsEndsAt: room.roundResultsEndsAt,
    players: getSortedPlayers(room),
    currentGuess: player ? player.currentGuess : { h: 280, s: 35, b: 55 }
  };

  if (room.phase === "remember") {
    state.targetColor = room.currentColor;
  }

  if (room.phase === "round_results" || room.phase === "final_results") {
    state.targetColor = room.currentColor;
    state.roundResults = getRoundResults(room);
  }

  return state;
}

function emitRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  for (const player of room.players.values()) {
    io.to(player.id).emit("room_state", roomStateFor(room, player.id));
  }
}

function resetRoomToLobby(room) {
  room.phase = "lobby";
  room.currentRound = 0;
  room.currentColor = null;
  room.usedColors = [];
  room.rememberEndsAt = null;
  room.roundResultsEndsAt = null;

  clearTimeout(room.rememberTimer);
  clearTimeout(room.resultsTimer);
  room.rememberTimer = null;
  room.resultsTimer = null;

  for (const player of room.players.values()) {
    player.submitted = false;
    player.currentGuess = {
     h: Math.floor(Math.random() * 360),
     s: Math.floor(25 + Math.random() * 70),
     b: Math.floor(25 + Math.random() * 70)
    };
    player.totalScore = 0;
    player.roundScores = [];
    player.roundGuesses = [];
  }
}

function startRound(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  room.phase = "remember";
  room.currentRound += 1;
  room.currentColor = randomColorHSB(room.usedColors);
  room.usedColors.push(room.currentColor);
  room.rememberEndsAt = Date.now() + REMEMBER_SECONDS * 1000;
  room.roundResultsEndsAt = null;

  for (const player of room.players.values()) {
    player.submitted = false;
    player.currentGuess = { h: 280, s: 35, b: 55 };
  }

  emitRoom(roomCode);

  clearTimeout(room.rememberTimer);
  room.rememberTimer = setTimeout(() => {
    const current = rooms.get(roomCode);
    if (!current) return;
    if (current.phase !== "remember") return;

    current.phase = "guess";
    current.rememberEndsAt = null;
    emitRoom(roomCode);
  }, REMEMBER_SECONDS * 1000);
}

function maybeFinishRound(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.phase !== "guess") return;

  const connectedPlayers = Array.from(room.players.values()).filter((p) => p.connected);
  if (!connectedPlayers.length) return;

  const allSubmitted = connectedPlayers.every((p) => p.submitted);
  if (!allSubmitted) return;

  for (const player of room.players.values()) {
    const guess = player.currentGuess;
    const score = scoreGuess(room.currentColor, guess);

    player.roundGuesses[room.currentRound - 1] = { ...guess };
    player.roundScores[room.currentRound - 1] = score;
    player.totalScore = Math.round((player.totalScore + score) * 100) / 100;
  }

  room.phase = room.currentRound >= room.totalRounds ? "final_results" : "round_results";
  room.roundResultsEndsAt =
    room.phase === "round_results" ? Date.now() + ROUND_RESULTS_SECONDS * 1000 : null;

  emitRoom(roomCode);

  if (room.phase === "round_results") {
    clearTimeout(room.resultsTimer);
    room.resultsTimer = setTimeout(() => {
      const current = rooms.get(roomCode);
      if (!current) return;
      if (current.phase !== "round_results") return;
      startRound(roomCode);
    }, ROUND_RESULTS_SECONDS * 1000);
  }
}

function cleanupRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const hasConnected = Array.from(room.players.values()).some((p) => p.connected);
  if (!hasConnected) {
    clearTimeout(room.rememberTimer);
    clearTimeout(room.resultsTimer);
    rooms.delete(roomCode);
  }
}

io.on("connection", (socket) => {
  socket.on("create_room", ({ name }, callback) => {
    const code = uniqueRoomCode();

    const room = {
      code,
      hostId: socket.id,
      phase: "lobby",
      totalRounds: DEFAULT_TOTAL_ROUNDS,
      currentRound: 0,
      currentColor: null,
      usedColors: [],
      rememberEndsAt: null,
      roundResultsEndsAt: null,
      rememberTimer: null,
      resultsTimer: null,
      players: new Map()
    };

    room.players.set(socket.id, createPlayer(socket.id, sanitizeName(name)));
    rooms.set(code, room);

    socket.join(code);
    socket.data.roomCode = code;

    callback?.({ ok: true, selfId: socket.id, room: roomStateFor(room, socket.id) });
    emitRoom(code);
  });

  socket.on("join_room", ({ name, roomCode }, callback) => {
  const code = String(roomCode || "").trim().toUpperCase();
  const cleanName = String(name || "").trim().slice(0, 16);
  const room = rooms.get(code);

  if (!code) {
    callback?.({ ok: false, error: "Room code is required." });
    return;
  }

  if (!cleanName) {
    callback?.({ ok: false, error: "Name is required to join the room." });
    return;
  }

  if (!room) {
    callback?.({ ok: false, error: "Room not found." });
    return;
  }

  room.players.set(socket.id, createPlayer(socket.id, cleanName));
  socket.join(code);
  socket.data.roomCode = code;

  callback?.({ ok: true, selfId: socket.id, room: roomStateFor(room, socket.id) });
  emitRoom(code);
});
  socket.on("set_rounds", ({ totalRounds }, callback) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      callback?.({ ok: false, error: "Room not found." });
      return;
    }

    if (room.hostId !== socket.id) {
      callback?.({ ok: false, error: "Only host can change rounds." });
      return;
    }

    if (room.phase !== "lobby") {
      callback?.({ ok: false, error: "Rounds can only be changed in lobby." });
      return;
    }

    room.totalRounds = clamp(Math.floor(Number(totalRounds) || DEFAULT_TOTAL_ROUNDS), MIN_ROUNDS, MAX_ROUNDS);
    emitRoom(roomCode);
    callback?.({ ok: true });
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

    if (room.phase !== "lobby" && room.phase !== "final_results") {
      callback?.({ ok: false, error: "Game already running." });
      return;
    }

    if (room.phase === "final_results") {
      resetRoomToLobby(room);
    }

    startRound(roomCode);
    callback?.({ ok: true });
  });

  socket.on("update_guess", ({ guess }, callback) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room || room.phase !== "guess") {
      callback?.({ ok: false, error: "Not in guess phase." });
      return;
    }

    const player = room.players.get(socket.id);
    if (!player || player.submitted) {
      callback?.({ ok: false, error: "Cannot update guess." });
      return;
    }

    player.currentGuess = {
      h: clamp(Math.floor(Number(guess?.h) || 0), 0, 359),
      s: clamp(Math.floor(Number(guess?.s) || 0), 0, 100),
      b: clamp(Math.floor(Number(guess?.b) || 0), 0, 100)
    };

    emitRoom(roomCode);
    callback?.({ ok: true });
  });

  socket.on("submit_guess", (_, callback) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room || room.phase !== "guess") {
      callback?.({ ok: false, error: "Not in guess phase." });
      return;
    }

    const player = room.players.get(socket.id);
    if (!player) {
      callback?.({ ok: false, error: "Player not found." });
      return;
    }

    player.submitted = true;
    emitRoom(roomCode);
    maybeFinishRound(roomCode);
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

    resetRoomToLobby(room);
    emitRoom(roomCode);
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

    if (room.phase === "guess") {
      maybeFinishRound(roomCode);
    }

    emitRoom(roomCode);
    cleanupRoom(roomCode);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});