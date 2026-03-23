const socket = io();

const homeCard = document.getElementById("homeCard");
const roomCard = document.getElementById("roomCard");
const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");

const roomCode = document.getElementById("roomCode");
const phaseText = document.getElementById("phaseText");
const timerText = document.getElementById("timerText");
const statusBox = document.getElementById("status");
const scoreboard = document.getElementById("scoreboard");
const myTotal = document.getElementById("myTotal");

const lobbyScreen = document.getElementById("lobbyScreen");
const rememberScreen = document.getElementById("rememberScreen");
const guessScreen = document.getElementById("guessScreen");
const resultsScreen = document.getElementById("resultsScreen");

const rememberGrid = document.getElementById("rememberGrid");
const colorTabs = document.getElementById("colorTabs");
const previewBox = document.getElementById("previewBox");
const hsbValues = document.getElementById("hsbValues");

const hSlider = document.getElementById("hSlider");
const sSlider = document.getElementById("sSlider");
const bSlider = document.getElementById("bSlider");
const hVal = document.getElementById("hVal");
const sVal = document.getElementById("sVal");
const bVal = document.getElementById("bVal");

const submitBtn = document.getElementById("submitBtn");
const myResults = document.getElementById("myResults");

let state = {
  selfId: null,
  room: null,
  currentIndex: 0,
  timerInterval: null,
  localGuesses: Array.from({ length: 5 }, () => ({ h: 180, s: 50, b: 50 }))
};

function setStatus(text) {
  statusBox.textContent = text;
}

function getName() {
  return (nameInput.value || "").trim().slice(0, 16) || "Player";
}

function showRoom(show) {
  homeCard.classList.toggle("hidden", show);
  roomCard.classList.toggle("hidden", !show);
}

function hsbCss(h, s, b) {
  return `hsl(${h} ${s}% ${Math.max(5, Math.min(95, b))}%)`;
}

function updateScreens() {
  const phase = state.room?.phase || "lobby";

  lobbyScreen.classList.toggle("hidden", phase !== "lobby");
  rememberScreen.classList.toggle("hidden", phase !== "remember");
  guessScreen.classList.toggle("hidden", phase !== "guess");
  resultsScreen.classList.toggle("hidden", phase !== "results");
}

function renderRememberColors() {
  if (!state.room?.colors) {
    rememberGrid.innerHTML = "";
    return;
  }

  rememberGrid.innerHTML = state.room.colors
    .map((color) => `<div class="colorCard" style="background:${hsbCss(color.h, color.s, color.b)}"></div>`)
    .join("");
}

function renderTabs() {
  colorTabs.innerHTML = "";

  for (let i = 0; i < 5; i += 1) {
    const btn = document.createElement("button");
    btn.className = `tabBtn ${state.currentIndex === i ? "active" : ""}`;
    btn.textContent = `Color ${i + 1}`;
    btn.addEventListener("click", () => {
      state.currentIndex = i;
      syncSlidersFromLocal();
      renderTabs();
    });
    colorTabs.appendChild(btn);
  }
}

function syncSlidersFromLocal() {
  const guess = state.localGuesses[state.currentIndex];
  hSlider.value = guess.h;
  sSlider.value = guess.s;
  bSlider.value = guess.b;

  hVal.textContent = guess.h;
  sVal.textContent = guess.s;
  bVal.textContent = guess.b;

  hsbValues.textContent = `H${guess.h} S${guess.s} B${guess.b}`;
  previewBox.style.background = hsbCss(guess.h, guess.s, guess.b);
}

function sendGuess() {
  const guess = state.localGuesses[state.currentIndex];
  socket.emit("update_guess", { index: state.currentIndex, guess }, () => {});
}

function handleSliderChange() {
  const guess = {
    h: Number(hSlider.value),
    s: Number(sSlider.value),
    b: Number(bSlider.value)
  };

  state.localGuesses[state.currentIndex] = guess;
  syncSlidersFromLocal();
  sendGuess();
}

function renderScoreboard() {
  if (!state.room) {
    scoreboard.innerHTML = "<div class='muted'>No room joined.</div>";
    return;
  }

  const header = `
    <div class="playerRow header">
      <div>#</div>
      <div>Name</div>
      <div>Total</div>
      <div>Status</div>
    </div>
  `;

  const rows = state.room.players.map((player, index) => `
    <div class="playerRow ${player.id === state.selfId ? "me" : ""}">
      <div>${index + 1}</div>
      <div>${player.name}${player.connected ? "" : " (left)"}</div>
      <div>${Number(player.totalScore || 0).toFixed(2)}</div>
      <div>${player.submitted ? "Submitted" : "Playing"}</div>
    </div>
  `).join("");

  scoreboard.innerHTML = header + rows;

  const me = state.room.players.find((p) => p.id === state.selfId);
  myTotal.textContent = me ? Number(me.totalScore || 0).toFixed(2) : "0.00";
}

function renderResults() {
  const results = state.room?.myResults || [];
  if (!results.length) {
    myResults.innerHTML = "<div class='muted'>No results yet.</div>";
    return;
  }

  myResults.innerHTML = results.map((item, index) => `
    <div class="resultItem">
      <div>
        <div class="muted">Original</div>
        <div class="swatch" style="background:${hsbCss(item.original.h, item.original.s, item.original.b)}"></div>
      </div>
      <div>
        <div class="muted">Your guess</div>
        <div class="swatch" style="background:${hsbCss(item.guess.h, item.guess.s, item.guess.b)}"></div>
      </div>
      <div>
        <div><strong>Color ${index + 1}</strong></div>
        <div>Score: <strong>${Number(item.score).toFixed(2)}</strong> / 10</div>
        <div class="muted">Original H${item.original.h} S${item.original.s} B${item.original.b}</div>
        <div class="muted">Guess H${item.guess.h} S${item.guess.s} B${item.guess.b}</div>
      </div>
    </div>
  `).join("");
}

function updateRoomInfo() {
  if (!state.room) return;

  roomCode.textContent = state.room.code;
  phaseText.textContent = state.room.phase[0].toUpperCase() + state.room.phase.slice(1);

  const isHost = state.room.hostId === state.selfId;
  startBtn.disabled = !isHost || state.room.phase === "remember" || state.room.phase === "guess";
  resetBtn.disabled = !isHost;

  updateScreens();
  renderRememberColors();
  renderScoreboard();
  renderResults();
}

function startRememberTimer(endsAt) {
  clearInterval(state.timerInterval);

  function tick() {
    const ms = Math.max(0, endsAt - Date.now());
    timerText.textContent = `${(ms / 1000).toFixed(1)}s`;
    if (ms <= 0) clearInterval(state.timerInterval);
  }

  tick();
  state.timerInterval = setInterval(tick, 100);
}

function clearTimer() {
  clearInterval(state.timerInterval);
  timerText.textContent = "--.-s";
}

createBtn.addEventListener("click", () => {
  socket.emit("create_room", { name: getName() }, (res) => {
    if (!res.ok) {
      setStatus(res.error || "Could not create room.");
      return;
    }
    state.selfId = res.selfId;
    state.room = res.room;
    state.localGuesses = Array.from({ length: 5 }, () => ({ h: 180, s: 50, b: 50 }));
    showRoom(true);
    updateRoomInfo();
    renderTabs();
    syncSlidersFromLocal();
    setStatus(`Room ${res.room.code} created.`);
  });
});

joinBtn.addEventListener("click", () => {
  socket.emit("join_room", { name: getName(), roomCode: roomInput.value.trim().toUpperCase() }, (res) => {
    if (!res.ok) {
      setStatus(res.error || "Could not join room.");
      return;
    }
    state.selfId = res.selfId;
    state.room = res.room;
    state.localGuesses = Array.from({ length: 5 }, () => ({ h: 180, s: 50, b: 50 }));
    showRoom(true);
    updateRoomInfo();
    renderTabs();
    syncSlidersFromLocal();
    setStatus(`Joined room ${res.room.code}.`);
  });
});

startBtn.addEventListener("click", () => {
  socket.emit("start_game", {}, (res) => {
    if (!res?.ok) setStatus(res?.error || "Could not start game.");
  });
});

resetBtn.addEventListener("click", () => {
  socket.emit("back_to_lobby", {}, (res) => {
    if (!res?.ok) setStatus(res?.error || "Could not reset room.");
  });
});

submitBtn.addEventListener("click", () => {
  socket.emit("submit_answers", {}, (res) => {
    if (!res?.ok) setStatus(res?.error || "Could not submit answers.");
    else setStatus("Submitted. Waiting for others.");
  });
});

[hSlider, sSlider, bSlider].forEach((el) => {
  el.addEventListener("input", handleSliderChange);
});

socket.on("room_state", (room) => {
  state.room = room;
  updateRoomInfo();

  if (room.phase === "remember" && room.rememberEndsAt) {
    startRememberTimer(room.rememberEndsAt);
    setStatus("Memorize the colors.");
  } else {
    clearTimer();
  }

  if (room.phase === "guess") {
    setStatus("Recreate the colors from memory.");
  }

  if (room.phase === "results") {
    setStatus("Results are ready.");
  }
});

renderTabs();
syncSlidersFromLocal();
renderScoreboard();