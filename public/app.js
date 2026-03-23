const socket = io();

const homeCard = document.getElementById("homeCard");
const roomCard = document.getElementById("roomCard");
const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const saveRoundsBtn = document.getElementById("saveRoundsBtn");
const roundsInput = document.getElementById("roundsInput");

const roomCode = document.getElementById("roomCode");
const phaseText = document.getElementById("phaseText");
const roundText = document.getElementById("roundText");
const statusBox = document.getElementById("status");
const scoreboard = document.getElementById("scoreboard");
const myTotal = document.getElementById("myTotal");

const lobbyScreen = document.getElementById("lobbyScreen");
const rememberScreen = document.getElementById("rememberScreen");
const guessScreen = document.getElementById("guessScreen");
const resultsScreen = document.getElementById("resultsScreen");
const finalScreen = document.getElementById("finalScreen");

const rememberRoundLabel = document.getElementById("rememberRoundLabel");
const rememberColor = document.getElementById("rememberColor");
const rememberTimer = document.getElementById("rememberTimer");

const guessRoundLabel = document.getElementById("guessRoundLabel");
const hueBar = document.getElementById("hueBar");
const hueHandle = document.getElementById("hueHandle");
const sbArea = document.getElementById("sbArea");
const sbHandle = document.getElementById("sbHandle");
const previewPanel = document.getElementById("previewPanel");
const pickerValues = document.getElementById("pickerValues");
const guessMessage = document.getElementById("guessMessage");
const submitBtn = document.getElementById("submitBtn");

const resultsTarget = document.getElementById("resultsTarget");
const resultsTimer = document.getElementById("resultsTimer");
const resultsList = document.getElementById("resultsList");
const finalTarget = document.getElementById("finalTarget");
const finalResultsList = document.getElementById("finalResultsList");

let state = {
  selfId: null,
  room: null,
  timers: [],
  guess: { h: 280, s: 35, b: 55 }
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

function clearAllTimers() {
  state.timers.forEach((id) => clearInterval(id));
  state.timers = [];
}

function hsbCss(h, s, b) {
  return `hsl(${h} ${s}% ${b}%)`;
}

function syncPickerVisuals() {
  const { h, s, b } = state.guess;

  previewPanel.style.background = hsbCss(h, s, b);
  sbArea.style.background = `
    linear-gradient(to bottom, rgba(255,255,255,0.55), rgba(255,255,255,0)),
    linear-gradient(to top, rgba(0,0,0,1), rgba(0,0,0,0)),
    hsl(${h} 100% 50%)
  `;

  const hueY = (h / 359) * hueBar.clientHeight;
  hueHandle.style.left = `${hueBar.clientWidth / 2}px`;
  hueHandle.style.top = `${hueY}px`;

  const sbX = (s / 100) * sbArea.clientWidth;
  const sbY = ((100 - b) / 100) * sbArea.clientHeight;
  sbHandle.style.left = `${sbX}px`;
  sbHandle.style.top = `${sbY}px`;

  pickerValues.textContent = `H${h} S${s} B${b}`;
}

function emitGuess() {
  socket.emit("update_guess", { guess: state.guess }, () => {});
}

function setGuess(nextGuess) {
  state.guess = {
    h: Math.max(0, Math.min(359, Math.round(nextGuess.h))),
    s: Math.max(0, Math.min(100, Math.round(nextGuess.s))),
    b: Math.max(0, Math.min(100, Math.round(nextGuess.b)))
  };
  syncPickerVisuals();
  emitGuess();
}

function attachHueEvents() {
  function updateFromEvent(event) {
    const rect = hueBar.getBoundingClientRect();
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const h = (y / rect.height) * 359;
    setGuess({ ...state.guess, h });
  }

  hueBar.addEventListener("mousedown", (event) => {
    updateFromEvent(event);

    function onMove(e) {
      updateFromEvent(e);
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}

function attachSbEvents() {
  function updateFromEvent(event) {
    const rect = sbArea.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));

    const s = (x / rect.width) * 100;
    const b = 100 - (y / rect.height) * 100;

    setGuess({ ...state.guess, s, b });
  }

  sbArea.addEventListener("mousedown", (event) => {
    updateFromEvent(event);

    function onMove(e) {
      updateFromEvent(e);
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}

function updateScreens() {
  const phase = state.room?.phase || "lobby";

  lobbyScreen.classList.toggle("hidden", phase !== "lobby");
  rememberScreen.classList.toggle("hidden", phase !== "remember");
  guessScreen.classList.toggle("hidden", phase !== "guess");
  resultsScreen.classList.toggle("hidden", phase !== "round_results");
  finalScreen.classList.toggle("hidden", phase !== "final_results");
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
      <div>${player.submitted ? "Submitted" : "Waiting"}</div>
    </div>
  `).join("");

  scoreboard.innerHTML = header + rows;

  const me = state.room.players.find((p) => p.id === state.selfId);
  myTotal.textContent = me ? Number(me.totalScore || 0).toFixed(2) : "0.00";
}

function renderResults(listEl, rows) {
  const targetColor = state.room?.targetColor;

  if (!rows || !targetColor) {
    listEl.innerHTML = "<div class='muted'>No results.</div>";
    return;
  }

  listEl.innerHTML = `
    <div class="resultRow header">
      <div>#</div>
      <div>Name</div>
      <div>Guess</div>
      <div>Original</div>
      <div>Round</div>
      <div>Total</div>
    </div>
    ${rows.map((row, index) => `
      <div class="resultRow">
        <div>${index + 1}</div>
        <div>${row.name}</div>
        <div class="swatch" style="background:${row.guess ? hsbCss(row.guess.h, row.guess.s, row.guess.b) : "#444"}"></div>
        <div class="swatch" style="background:${hsbCss(targetColor.h, targetColor.s, targetColor.b)}"></div>
        <div>${row.roundScore != null ? Number(row.roundScore).toFixed(2) : "-"}</div>
        <div>${Number(row.totalScore || 0).toFixed(2)}</div>
      </div>
    `).join("")}
  `;
}

function startCountdown(el, endAt) {
  function tick() {
    const ms = Math.max(0, endAt - Date.now());
    el.textContent = `${(ms / 1000).toFixed(1)}s`;
    if (ms <= 0) clearInterval(id);
  }

  tick();
  const id = setInterval(tick, 100);
  state.timers.push(id);
}

function updateRoomInfo() {
  if (!state.room) return;

  roomCode.textContent = state.room.code;
  phaseText.textContent = state.room.phase.replaceAll("_", " ");
  roundText.textContent = `${state.room.currentRound} / ${state.room.totalRounds}`;
  roundsInput.value = state.room.totalRounds;

  const isHost = state.room.hostId === state.selfId;
  saveRoundsBtn.disabled = !isHost || state.room.phase !== "lobby";
  startBtn.disabled = !isHost || (state.room.phase !== "lobby" && state.room.phase !== "final_results");
  resetBtn.disabled = !isHost;

  updateScreens();
  renderScoreboard();

  if (state.room.phase === "remember" && state.room.targetColor) {
    rememberRoundLabel.textContent = `${state.room.currentRound}/${state.room.totalRounds}`;
    rememberColor.style.background = hsbCss(
      state.room.targetColor.h,
      state.room.targetColor.s,
      state.room.targetColor.b
    );
  }

  if (state.room.phase === "guess") {
    guessRoundLabel.textContent = `${state.room.currentRound}/${state.room.totalRounds}`;
    guessMessage.textContent = "Adjust the color and submit.";
  }

  if ((state.room.phase === "round_results" || state.room.phase === "final_results") && state.room.targetColor) {
    const color = hsbCss(state.room.targetColor.h, state.room.targetColor.s, state.room.targetColor.b);
    resultsTarget.style.background = color;
    finalTarget.style.background = color;
  }

  if (state.room.phase === "round_results") {
    renderResults(resultsList, state.room.roundResults);
  }

  if (state.room.phase === "final_results") {
    renderResults(finalResultsList, state.room.roundResults);
  }
}

createBtn.addEventListener("click", () => {
  socket.emit("create_room", { name: getName() }, (res) => {
    if (!res.ok) {
      setStatus(res.error || "Could not create room.");
      return;
    }
    state.selfId = res.selfId;
    state.room = res.room;
    state.guess = res.room.currentGuess || { h: 280, s: 35, b: 55 };
    showRoom(true);
    updateRoomInfo();
    syncPickerVisuals();
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
    state.guess = res.room.currentGuess || { h: 280, s: 35, b: 55 };
    showRoom(true);
    updateRoomInfo();
    syncPickerVisuals();
    setStatus(`Joined room ${res.room.code}.`);
  });
});

saveRoundsBtn.addEventListener("click", () => {
  socket.emit("set_rounds", { totalRounds: roundsInput.value }, (res) => {
    if (!res?.ok) setStatus(res?.error || "Could not save rounds.");
    else setStatus("Rounds updated.");
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
    else setStatus("Back in lobby.");
  });
});

submitBtn.addEventListener("click", () => {
  socket.emit("submit_guess", {}, (res) => {
    if (!res?.ok) setStatus(res?.error || "Could not submit guess.");
    else {
      guessMessage.textContent = "Submitted. Waiting for others.";
      setStatus("Submitted. Waiting for others.");
    }
  });
});

socket.on("room_state", (room) => {
  state.room = room;
  state.guess = room.currentGuess || state.guess;

  clearAllTimers();
  updateRoomInfo();
  syncPickerVisuals();

  if (room.phase === "remember" && room.rememberEndsAt) {
    startCountdown(rememberTimer, room.rememberEndsAt);
    setStatus("Memorize the color.");
  } else if (room.phase === "guess") {
    setStatus("Match the color and submit.");
  } else if (room.phase === "round_results" && room.roundResultsEndsAt) {
    startCountdown(resultsTimer, room.roundResultsEndsAt);
    setStatus("Round results.");
  } else if (room.phase === "final_results") {
    setStatus("Game finished.");
  } else if (room.phase === "lobby") {
    setStatus("Waiting in lobby.");
  }
});

attachHueEvents();
attachSbEvents();
window.addEventListener("resize", syncPickerVisuals);
syncPickerVisuals();
renderScoreboard();