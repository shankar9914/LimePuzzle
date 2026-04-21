(function () {
  "use strict";

  const ROWS = 8;
  const COLS = 8;
  const FRUIT_TYPES = 5;
  const BASE_TIME = 120;
  const LEVEL_SCORE_THRESHOLD = 250;

  const FRUITS = ["🍋", "🍈", "🍊", "🍏", "🍐"];
  const COLORS = ["#f9e45b", "#8bc34a", "#ffb347", "#a2d149", "#e8f48c"];

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas ? canvas.getContext("2d") : null;
  const timeSpan = document.getElementById("time");
  const scoreSpan = document.getElementById("score");
  const levelSpan = document.getElementById("level");
  const comboDisplay = document.getElementById("comboDisplay");
  const gameoverMsg = document.getElementById("gameoverMsg");
  const restartButton = document.getElementById("restartButton");
  const hintButton = document.getElementById("hintButton");

  let board = [];
  let selected = null;
  let score = 0;
  let level = 1;
  let timeLeft = BASE_TIME;
  let combo = 0;
  let gameActive = true;
  let busy = false;
  let tileSize = 60;
  let timerInterval = null;

  let audioCtx = null;

  function initAudio() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) {
      audioCtx = null;
    }
  }

  function playSound(freq, duration, type) {
    if (!audioCtx || audioCtx.state !== "running") return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type || "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        audioCtx.currentTime + duration,
      );
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
      // Ignore audio failures; gameplay should continue.
    }
  }

  function randomFruit() {
    return Math.floor(Math.random() * FRUIT_TYPES);
  }

  function createTile(r, c, val) {
    return {
      r: r,
      c: c,
      val: val,
      x: c * tileSize,
      y: r * tileSize,
      targetX: c * tileSize,
      targetY: r * tileSize,
    };
  }

  function syncTargets() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const tile = board[r][c];
        tile.r = r;
        tile.c = c;
        tile.targetX = c * tileSize;
        tile.targetY = r * tileSize;
      }
    }
  }

  function inBounds(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
  }

  function hasLocalMatch(boardRef, r, c) {
    const val = boardRef[r][c].val;
    if (val < 0) return false;

    let count = 1;
    for (let cc = c - 1; cc >= 0 && boardRef[r][cc].val === val; cc--) count++;
    for (let cc = c + 1; cc < COLS && boardRef[r][cc].val === val; cc++)
      count++;
    if (count >= 3) return true;

    count = 1;
    for (let rr = r - 1; rr >= 0 && boardRef[rr][c].val === val; rr--) count++;
    for (let rr = r + 1; rr < ROWS && boardRef[rr][c].val === val; rr++)
      count++;
    return count >= 3;
  }

  function findMatches(boardRef) {
    const keySet = new Set();

    for (let r = 0; r < ROWS; r++) {
      let c = 0;
      while (c < COLS) {
        const start = c;
        const val = boardRef[r][c].val;
        while (c + 1 < COLS && boardRef[r][c + 1].val === val) c++;
        const len = c - start + 1;
        if (val >= 0 && len >= 3) {
          for (let k = start; k <= c; k++) keySet.add(r + "," + k);
        }
        c++;
      }
    }

    for (let c = 0; c < COLS; c++) {
      let r = 0;
      while (r < ROWS) {
        const start = r;
        const val = boardRef[r][c].val;
        while (r + 1 < ROWS && boardRef[r + 1][c].val === val) r++;
        const len = r - start + 1;
        if (val >= 0 && len >= 3) {
          for (let k = start; k <= r; k++) keySet.add(k + "," + c);
        }
        r++;
      }
    }

    const list = [];
    keySet.forEach((key) => {
      const parts = key.split(",");
      list.push({ r: parseInt(parts[0], 10), c: parseInt(parts[1], 10) });
    });
    return list;
  }

  function swapTiles(boardRef, r1, c1, r2, c2) {
    const temp = boardRef[r1][c1].val;
    boardRef[r1][c1].val = boardRef[r2][c2].val;
    boardRef[r2][c2].val = temp;
  }

  function hasPossibleMoves(boardRef) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const dirs = [
          [0, 1],
          [1, 0],
        ];
        for (let i = 0; i < dirs.length; i++) {
          const nr = r + dirs[i][0];
          const nc = c + dirs[i][1];
          if (!inBounds(nr, nc)) continue;
          swapTiles(boardRef, r, c, nr, nc);
          const ok =
            hasLocalMatch(boardRef, r, c) || hasLocalMatch(boardRef, nr, nc);
          swapTiles(boardRef, r, c, nr, nc);
          if (ok) return true;
        }
      }
    }
    return false;
  }

  function buildBoardNoStartingMatches() {
    const b = Array.from({ length: ROWS }, (_, r) =>
      Array.from({ length: COLS }, (_, c) => createTile(r, c, 0)),
    );

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const candidates = [];
        for (let v = 0; v < FRUIT_TYPES; v++) {
          const leftBad =
            c >= 2 && b[r][c - 1].val === v && b[r][c - 2].val === v;
          const upBad =
            r >= 2 && b[r - 1][c].val === v && b[r - 2][c].val === v;
          if (!leftBad && !upBad) candidates.push(v);
        }
        const pool = candidates.length > 0 ? candidates : [randomFruit()];
        b[r][c].val = pool[Math.floor(Math.random() * pool.length)];
      }
    }
    return b;
  }

  function reshuffleUntilPlayable() {
    let attempts = 0;
    do {
      board = buildBoardNoStartingMatches();
      attempts++;
    } while (!hasPossibleMoves(board) && attempts < 50);
  }

  function collapseAndRefill() {
    for (let c = 0; c < COLS; c++) {
      const values = [];
      for (let r = ROWS - 1; r >= 0; r--) {
        if (board[r][c].val >= 0) values.push(board[r][c].val);
      }
      while (values.length < ROWS) values.push(randomFruit());
      for (let r = ROWS - 1, idx = 0; r >= 0; r--, idx++) {
        board[r][c].val = values[idx];
      }
    }
  }

  function resolveCascades() {
    let any = false;
    let chain = 0;
    const MAX_CHAIN = 30;

    while (chain < MAX_CHAIN) {
      const matches = findMatches(board);
      if (matches.length === 0) break;
      any = true;
      chain++;
      combo = chain;
      comboDisplay.innerText = String(combo);

      score += Math.floor(matches.length * 10 * (1 + chain * 0.25));

      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        board[m.r][m.c].val = -1;
      }

      collapseAndRefill();
      syncTargets();
      playSound(460 + chain * 40, 0.08, "triangle");
    }

    if (!any) {
      combo = 0;
      comboDisplay.innerText = "0";
    }

    const newLevel = 1 + Math.floor(score / LEVEL_SCORE_THRESHOLD);
    if (newLevel > level) {
      level = newLevel;
      timeLeft = Math.min(99, timeLeft + 10);
      playSound(760, 0.12, "square");
    }

    if (!hasPossibleMoves(board)) {
      reshuffleUntilPlayable();
      syncTargets();
      gameoverMsg.innerText = "No moves. Reshuffled!";
    }

    updateUI();
    return any;
  }

  function updateUI() {
    scoreSpan.innerText = String(score);
    levelSpan.innerText = String(level);
    timeSpan.innerText = String(timeLeft);
  }

  function gameOver() {
    gameActive = false;
    if (timerInterval) clearInterval(timerInterval);
    gameoverMsg.innerText = "Game Over. Score " + score;
    playSound(200, 0.22, "sawtooth");
  }

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(function () {
      if (!gameActive) return;
      timeLeft--;
      if (timeLeft <= 0) {
        timeLeft = 0;
        updateUI();
        gameOver();
        return;
      }
      updateUI();
    }, 1000);
  }

  function restartGame() {
    score = 0;
    level = 1;
    timeLeft = BASE_TIME;
    combo = 0;
    selected = null;
    gameActive = true;
    busy = false;
    gameoverMsg.innerText = "";
    comboDisplay.innerText = "0";

    reshuffleUntilPlayable();
    syncTargets();
    updateUI();
    startTimer();
    playSound(520, 0.08, "sine");
  }

  function findHintMove() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const dirs = [
          [0, 1],
          [1, 0],
        ];
        for (let i = 0; i < dirs.length; i++) {
          const nr = r + dirs[i][0];
          const nc = c + dirs[i][1];
          if (!inBounds(nr, nc)) continue;
          swapTiles(board, r, c, nr, nc);
          const ok = hasLocalMatch(board, r, c) || hasLocalMatch(board, nr, nc);
          swapTiles(board, r, c, nr, nc);
          if (ok) return { r: r, c: c };
        }
      }
    }
    return null;
  }

  function drawRoundedRectPath(ctxRef, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    if (typeof ctxRef.roundRect === "function") {
      ctxRef.roundRect(x, y, w, h, r);
      return;
    }
    ctxRef.moveTo(x + r, y);
    ctxRef.lineTo(x + w - r, y);
    ctxRef.quadraticCurveTo(x + w, y, x + w, y + r);
    ctxRef.lineTo(x + w, y + h - r);
    ctxRef.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctxRef.lineTo(x + r, y + h);
    ctxRef.quadraticCurveTo(x, y + h, x, y + h - r);
    ctxRef.lineTo(x, y + r);
    ctxRef.quadraticCurveTo(x, y, x + r, y);
  }

  function drawBoard() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const tile = board[r][c];
        tile.x += (tile.targetX - tile.x) * 0.28;
        tile.y += (tile.targetY - tile.y) * 0.28;

        const x = tile.x;
        const y = tile.y;
        const val = tile.val >= 0 ? tile.val : 0;

        ctx.fillStyle = COLORS[val];
        ctx.shadowColor = "#0f2a0a";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        drawRoundedRectPath(ctx, x + 2, y + 2, tileSize - 4, tileSize - 4, 10);
        ctx.fill();
        ctx.shadowBlur = 0;

        if (selected && selected.r === r && selected.c === c) {
          ctx.strokeStyle = "#FFE484";
          ctx.lineWidth = 4;
          ctx.beginPath();
          drawRoundedRectPath(ctx, x + 3, y + 3, tileSize - 6, tileSize - 6, 8);
          ctx.stroke();
        }

        ctx.font =
          "500 " +
          Math.floor(tileSize * 0.55) +
          "px 'Segoe UI Emoji', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#1f2f0c";
        ctx.fillText(FRUITS[val], x + tileSize / 2 + 1, y + tileSize / 2 + 1);
        ctx.fillStyle = "#faf7e1";
        ctx.fillText(FRUITS[val], x + tileSize / 2, y + tileSize / 2);
      }
    }
  }

  function animationLoop() {
    drawBoard();
    requestAnimationFrame(animationLoop);
  }

  function toCellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const c = Math.floor(x / tileSize);
    const r = Math.floor(y / tileSize);
    if (!inBounds(r, c)) return null;
    return { r: r, c: c };
  }

  function tryMove(r1, c1, r2, c2) {
    if (busy || !gameActive) return;
    busy = true;

    swapTiles(board, r1, c1, r2, c2);
    const isValid =
      hasLocalMatch(board, r1, c1) || hasLocalMatch(board, r2, c2);
    if (!isValid) {
      swapTiles(board, r1, c1, r2, c2);
      busy = false;
      playSound(280, 0.08, "sawtooth");
      return;
    }

    combo = 0;
    comboDisplay.innerText = "0";
    playSound(560, 0.06, "triangle");
    resolveCascades();
    busy = false;
  }

  function handlePointerDown(e) {
    if (!gameActive) return;
    e.preventDefault();
    initAudio();

    const cell = toCellFromEvent(e);
    if (!cell) return;

    if (!selected) {
      selected = cell;
      return;
    }

    const dr = Math.abs(selected.r - cell.r);
    const dc = Math.abs(selected.c - cell.c);
    if (dr + dc !== 1) {
      selected = cell;
      return;
    }

    tryMove(selected.r, selected.c, cell.r, cell.c);
    selected = null;
  }

  function resizeCanvas() {
    const container = canvas.parentElement;
    const containerWidth = container ? container.clientWidth : 520;
    const size = Math.max(280, Math.min(520, containerWidth - 30));
    canvas.style.width = size + "px";
    canvas.style.height = size + "px";
    canvas.width = size;
    canvas.height = size;
    tileSize = size / COLS;
    if (board.length === ROWS) syncTargets();
  }

  function showFatal(message) {
    if (gameoverMsg) {
      gameoverMsg.innerText = "Runtime error: " + message;
      gameoverMsg.style.color = "#ff9e9e";
    }
  }

  function initGame() {
    if (
      !canvas ||
      !ctx ||
      !timeSpan ||
      !scoreSpan ||
      !levelSpan ||
      !comboDisplay ||
      !gameoverMsg
    ) {
      return;
    }

    window.addEventListener("error", function (event) {
      showFatal(event.message || "Unknown error");
    });

    resizeCanvas();
    restartGame();
    animationLoop();

    canvas.addEventListener("pointerdown", handlePointerDown, {
      passive: false,
    });
    window.addEventListener("resize", resizeCanvas);

    if (restartButton) {
      restartButton.addEventListener("click", function () {
        restartGame();
      });
    }

    if (hintButton) {
      hintButton.addEventListener("click", function () {
        if (!gameActive) return;
        const hint = findHintMove();
        if (hint) {
          selected = hint;
          playSound(720, 0.06, "sine");
        } else {
          reshuffleUntilPlayable();
          syncTargets();
          gameoverMsg.innerText = "No moves. Reshuffled!";
        }
      });
    }
  }

  initGame();
})();
