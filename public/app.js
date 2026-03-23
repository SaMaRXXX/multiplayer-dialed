const socket = io();

const homeView = document.getElementById("homeView");
const roomView = document.getElementById("roomView");
const nameInput = document.getElementById("nameInput");
const roomCodeInput = document.getElementById("roomCodeInput");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const roomCodeLabel = document.getElementById("roomCodeLabel");
const phaseLabel = document.getElementById("phaseLabel");
const startRoundBtn = document.getElementById("startRoundBtn");
const backToLobbyBtn = document.getElementById("backToLobbyBtn");
const timerLabel = document.getElementById("timerLabel");
const statusBox = document.getElementById("statusBox");
const leaderboard = document.getElementById("leaderboard");
const gameArea = document.getElementById("gameArea");
const target = document.getElementById("target");
const centerMessage = document.getElementById("centerMessage");

const selfScore = document.getElementById("selfScore");
const selfHits = document.getElementById("selfHits");
const selfMisses = document.getElementById("selfMisses");

let state = {
  selfId: null,
  room: null,
  phase: "home",
  targetVisible: false,
  targetSpawnAt: null,
  timerInterval: null
};

function setStatus(message) {
  statusBox.textContent = message;
}

function getPlayerName() {
  return (nameInput.value || "").trim().slice(0, 16) || "Player";
}

function showRoomUI(show) {
  homeView.classList.toggle("hidden", show);
  roomView.classList.toggle("hidden", !show);
}

function updateSelfStats() {
  if (!state.room) {
    selfScore.textContent = "0";
    selfHits.textContent = "0";
    selfMisses.textContent = "0";
    return;
  }

  const me = state.room.players.find((p) => p.id === state.selfId);
  selfScore.textContent = me ? me.score : "0";
  selfHits.textContent = me ? me.hits : "0";
  selfMisses.textContent = me ? me.misses : "0";
}

function renderLeaderboard() {
  if (!state.room) {
    leaderboard.innerHTML = "<div class='muted'>No room joined yet.</div>";
    return;
  }

  const rows = [
    `<div class="player-row header">
      <div>#</div>
      <div>Name</div>
      <div>Score</div>
      <div>Hits</div>
      <div>Misses</div>
      <div>Accuracy</div>
    </div>`
  ];

  state.room.players.forEach((player, index) => {
    rows.push(`
      <div class="player-row ${player.id === state.selfId ? "me" : ""}">
        <div>${index + 1}</div>
        <div>${player.name}${player.connected ? "" : " (left)"}</div>
        <div>${player.score}</div>
        <div>${player.hits}</div>
        <div>${player.misses}</div>
        <div>${player.accuracy}%</div>
      </div>
    `);
  });

  leaderboard.innerHTML = rows.join("");
}

function updateRoomInfo() {
  if (!state.room) return;

  roomCodeLabel.textContent = state.room.code;
  phaseLabel.textContent = state.room.phase[0].toUpperCase() + state.room.phase.slice(1);

  const isHost = state.room.hostId === state.selfId;
  startRoundBtn.disabled = !isHost || state.room.phase === "playing";
  backToLobbyBtn.disabled = !isHost || state.room.phase === "lobby";

  updateSelfStats();
  renderLeaderboard();
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function spawnTarget() {
  const areaRect = gameArea.getBoundingClientRect();
  const size = 64;
  const maxX = Math.max(0, areaRect.width - size);
  const maxY = Math.max(0, areaRect.height - size);

  const x = randomInt(12, Math.max(12, maxX - 12));
  const y = randomInt(12, Math.max(12, maxY - 12));

  target.style.left = `${x}px`;
  target.style.top = `${y}px`;
  target.classList.remove("hidden");
  state.targetVisible = true;
  state.targetSpawnAt = performance.now();
}

function hideTarget() {
  target.classList.add("hidden");
  state.targetVisible = false;
  state.targetSpawnAt = null;
}

function startGameplay() {
  centerMessage.textContent = "";
  centerMessage.classList.add("hidden");
  spawnTarget();
}

function stopGameplay(message) {
  hideTarget();
  centerMessage.textContent = message;
  centerMessage.classList.remove("hidden");
}

function startTimer(roundEndsAt) {
  clearInterval(state.timerInterval);

  function tick() {
    const msLeft = Math.max(0, roundEndsAt - Date.now());
    timerLabel.textContent = `${(msLeft / 1000).toFixed(1)}s`;
    if (msLeft <= 0) {
      clearInterval(state.timerInterval);
    }
  }

  tick();
  state.timerInterval = setInterval(tick, 100);
}

function resetTimer() {
  clearInterval(state.timerInterval);
  timerLabel.textContent = "30.0s";
}

createRoomBtn.addEventListener("click", () => {
  socket.emit("create_room", { name: getPlayerName() }, (res) => {
    if (!res.ok) {
      setStatus(res.error || "Could not create room.");
      return;
    }

    state.selfId = res.selfId;
    state.room = res.room;
    showRoomUI(true);
    updateRoomInfo();
    stopGameplay("Waiting in lobby");
    setStatus(`Room ${res.room.code} created.`);
  });
});

joinRoomBtn.addEventListener("click", () => {
  const roomCode = roomCodeInput.value.trim().toUpperCase();
  socket.emit("join_room", { name: getPlayerName(), roomCode }, (res) => {
    if (!res.ok) {
      setStatus(res.error || "Could not join room.");
      return;
    }

    state.selfId = res.selfId;
    state.room = res.room;
    showRoomUI(true);
    updateRoomInfo();
    stopGameplay("Waiting for host to start");
    setStatus(`Joined room ${res.room.code}.`);
  });
});

startRoundBtn.addEventListener("click", () => {
  socket.emit("start_round", {}, (res) => {
    if (!res?.ok) {
      setStatus(res?.error || "Could not start round.");
    }
  });
});

backToLobbyBtn.addEventListener("click", () => {
  socket.emit("back_to_lobby", {}, (res) => {
    if (!res?.ok) {
      setStatus(res?.error || "Could not return to lobby.");
    }
  });
});

target.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!state.targetVisible || !state.targetSpawnAt) return;

  const reactionMs = performance.now() - state.targetSpawnAt;
  let points = 1;
  if (reactionMs < 250) points = 10;
  else if (reactionMs < 400) points = 8;
  else if (reactionMs < 550) points = 6;
  else if (reactionMs < 700) points = 4;
  else points = 2;

  socket.emit("submit_hit", { points }, () => {});
  hideTarget();
  setTimeout(spawnTarget, 120);
});

gameArea.addEventListener("click", (e) => {
  if (e.target === target) return;
  if (!state.room || state.room.phase !== "playing") return;

  socket.emit("submit_miss", {}, () => {});
});

socket.on("room_state", (room) => {
  state.room = room;
  updateRoomInfo();

  if (room.phase === "lobby") {
    resetTimer();
    stopGameplay("Waiting in lobby");
  } else if (room.phase === "results") {
    resetTimer();
    stopGameplay("Round over. Check the leaderboard.");
  }
});

socket.on("round_started", ({ roundEndsAt }) => {
  if (!state.room) return;
  state.room.phase = "playing";
  updateRoomInfo();
  startTimer(roundEndsAt);
  startGameplay();
  setStatus("Round started. Go.");
});

socket.on("round_ended", ({ results }) => {
  state.room = results;
  updateRoomInfo();
  resetTimer();
  stopGameplay("Results are in.");
  setStatus("Round ended.");
});

stopGameplay("Create or join a room to begin");
renderLeaderboard();