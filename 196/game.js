(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const startButton = document.getElementById("start-button");
  const startLabel = document.getElementById("start-label");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayCopy = document.getElementById("overlay-copy");
  const overlayHint = document.getElementById("overlay-hint");
  const pauseBadge = document.getElementById("pause-badge");
  const scoreDisplay = document.getElementById("score");
  const bestDisplay = document.getElementById("best-score");
  const waveDisplay = document.getElementById("wave");
  const livesDisplay = document.getElementById("lives");
  const progress = document.getElementById("score-progress");
  const soundButton = document.getElementById("sound-button");

  const WIDTH = canvas.width;
  const HEIGHT = canvas.height;
  const keys = new Set();
  const stars = Array.from({ length: 115 }, () => ({
    x: Math.random() * WIDTH,
    y: Math.random() * HEIGHT,
    size: Math.random() * 1.7 + 0.3,
    speed: Math.random() * 25 + 12,
    phase: Math.random() * Math.PI * 2
  }));
  const player = { x: WIDTH / 2, y: HEIGHT - 76, radius: 15, speed: 310, invulnerable: 0, fireCooldown: 0, power: 0 };
  let enemies = [];
  let shots = [];
  let enemyShots = [];
  let particles = [];
  let pickups = [];
  let score = 0;
  let best = loadBest();
  let lives = 3;
  let wave = 1;
  let waveRemaining = 0;
  let spawnTimer = 0;
  let state = "ready";
  let elapsed = 0;
  let lastTime = 0;
  let soundEnabled = false;
  let audioContext;
  let pointerAim = null;

  function loadBest() {
    try {
      return Number(localStorage.getItem("starstrike-best")) || 0;
    } catch (error) {
      console.warn("Unable to read the saved high score.", error);
      return 0;
    }
  }

  function saveBest() {
    try {
      localStorage.setItem("starstrike-best", String(best));
    } catch (error) {
      console.warn("Unable to save the high score.", error);
    }
  }

  function formatScore(value) {
    return String(value).padStart(6, "0");
  }

  function updateHud() {
    scoreDisplay.textContent = formatScore(score);
    bestDisplay.textContent = formatScore(best);
    waveDisplay.textContent = String(wave).padStart(2, "0");
    progress.style.width = `${Math.min(100, (score % 1000) / 10)}%`;
    livesDisplay.setAttribute("aria-label", `${lives} ${lives === 1 ? "life" : "lives"}`);
    [...livesDisplay.children].forEach((heart, index) => heart.classList.toggle("lost", index >= lives));
  }

  function startGame() {
    score = 0;
    lives = 3;
    wave = 1;
    waveRemaining = 0;
    spawnTimer = 0;
    elapsed = 0;
    enemies = [];
    shots = [];
    enemyShots = [];
    particles = [];
    pickups = [];
    player.x = WIDTH / 2;
    player.y = HEIGHT - 76;
    player.invulnerable = 1.5;
    player.power = 0;
    state = "playing";
    pauseBadge.hidden = true;
    overlay.classList.add("is-hidden");
    overlay.inert = true;
    overlay.setAttribute("aria-hidden", "true");
    updateHud();
    beginWave();
    playTone(520, 0.09, "sine", 0.035);
  }

  function beginWave() {
    waveRemaining = 5 + wave * 2;
    spawnTimer = 0.6;
    updateHud();
  }

  function endGame() {
    state = "over";
    if (score > best) {
      best = score;
      saveBest();
    }
    updateHud();
    overlayTitle.innerHTML = "GAME <span>OVER</span>";
    overlayCopy.innerHTML = `You scored <strong>${formatScore(score)}</strong> points.<br>${score > 0 && score >= best ? "A new high score. Stellar work!" : "The galaxy will remember your sacrifice."}`;
    startLabel.textContent = "PLAY AGAIN";
    overlayHint.textContent = "PRESS ENTER TO TRY AGAIN";
    overlay.classList.remove("is-hidden");
    overlay.inert = false;
    overlay.setAttribute("aria-hidden", "false");
    playTone(150, 0.32, "sawtooth", 0.045);
  }

  function togglePause() {
    if (state === "playing") {
      state = "paused";
      pauseBadge.hidden = false;
    } else if (state === "paused") {
      state = "playing";
      pauseBadge.hidden = true;
    }
  }

  function playTone(frequency, duration, type, volume) {
    if (!soundEnabled) return;
    try {
      audioContext ??= new AudioContext();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
      gain.gain.setValueAtTime(volume, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration);
    } catch (error) {
      console.warn("Unable to play game audio.", error);
    }
  }

  function addBurst(x, y, color, count = 12) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 150 + 35;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: Math.random() * 0.35 + 0.25,
        maxLife: 0.6,
        size: Math.random() * 3 + 1,
        color
      });
    }
  }

  function spawnEnemy() {
    const heavy = wave >= 3 && Math.random() < 0.22;
    const radius = heavy ? 23 : 16;
    enemies.push({
      x: Math.random() * (WIDTH - radius * 4) + radius * 2,
      y: -radius,
      radius,
      hp: heavy ? 3 : 1,
      maxHp: heavy ? 3 : 1,
      speed: (heavy ? 65 : 95) + wave * 8 + Math.random() * 35,
      phase: Math.random() * Math.PI * 2,
      drift: heavy ? 0.55 : 1.25,
      shotTimer: 1.3 + Math.random() * 2,
      color: heavy ? "#ff548d" : Math.random() > 0.5 ? "#a879ff" : "#55dff0"
    });
  }

  function fire() {
    if (player.fireCooldown > 0) return;
    const target = pointerAim;
    let dx = 0;
    let dy = -1;
    if (target) {
      const aimX = target.x - player.x;
      const aimY = target.y - player.y;
      const length = Math.hypot(aimX, aimY);
      if (length > 14) {
        dx = aimX / length;
        dy = aimY / length;
      }
    }
    const spread = player.power > 0 ? 0.16 : 0;
    for (const angle of (spread ? [-spread, 0, spread] : [0])) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      shots.push({ x: player.x, y: player.y - 11, vx: dx * cos - dy * sin, vy: dx * sin + dy * cos, speed: 560, radius: 3.5 });
    }
    player.fireCooldown = player.power > 0 ? 0.19 : 0.29;
    playTone(650, 0.055, "square", 0.018);
  }

  function damagePlayer() {
    if (player.invulnerable > 0 || state !== "playing") return;
    lives -= 1;
    player.invulnerable = 1.65;
    addBurst(player.x, player.y, "#61e8f5", 22);
    updateHud();
    playTone(200, 0.2, "triangle", 0.04);
    if (lives <= 0) endGame();
  }

  function awardPoints(points) {
    score += points;
    updateHud();
  }

  function update(dt) {
    elapsed += dt;
    for (const star of stars) {
      star.y += star.speed * dt;
      if (star.y > HEIGHT) { star.y = 0; star.x = Math.random() * WIDTH; }
    }
    if (state !== "playing") return;

    player.invulnerable = Math.max(0, player.invulnerable - dt);
    player.fireCooldown = Math.max(0, player.fireCooldown - dt);
    player.power = Math.max(0, player.power - dt);
    let moveX = Number(keys.has("ArrowRight") || keys.has("d") || keys.has("D")) - Number(keys.has("ArrowLeft") || keys.has("a") || keys.has("A"));
    let moveY = Number(keys.has("ArrowDown") || keys.has("s") || keys.has("S")) - Number(keys.has("ArrowUp") || keys.has("w") || keys.has("W"));
    const magnitude = Math.hypot(moveX, moveY) || 1;
    player.x += (moveX / magnitude) * player.speed * dt;
    player.y += (moveY / magnitude) * player.speed * dt;
    player.x = Math.max(player.radius + 5, Math.min(WIDTH - player.radius - 5, player.x));
    player.y = Math.max(player.radius + 5, Math.min(HEIGHT - player.radius - 5, player.y));
    if (keys.has(" ") || keys.has("Enter") && state === "playing") fire();

    if (waveRemaining > 0) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnEnemy();
        waveRemaining -= 1;
        spawnTimer = Math.max(0.35, 0.95 - wave * 0.035) + Math.random() * 0.45;
      }
    }

    for (const shot of shots) { shot.x += shot.vx * shot.speed * dt; shot.y += shot.vy * shot.speed * dt; }
    shots = shots.filter(shot => shot.y > -20 && shot.y < HEIGHT + 20 && shot.x > -20 && shot.x < WIDTH + 20);
    for (const shot of enemyShots) { shot.x += shot.vx * shot.speed * dt; shot.y += shot.vy * shot.speed * dt; }
    enemyShots = enemyShots.filter(shot => shot.y < HEIGHT + 20 && shot.y > -20 && shot.x > -20 && shot.x < WIDTH + 20);

    for (const enemy of enemies) {
      enemy.phase += dt * enemy.drift;
      enemy.y += enemy.speed * dt;
      enemy.x += Math.sin(enemy.phase * 2) * 36 * dt;
      enemy.shotTimer -= dt;
      if (enemy.shotTimer <= 0 && enemy.y > 20 && enemy.y < HEIGHT * 0.66) {
        const aimX = player.x - enemy.x;
        const aimY = player.y - enemy.y;
        const length = Math.hypot(aimX, aimY) || 1;
        enemyShots.push({ x: enemy.x, y: enemy.y + enemy.radius, vx: aimX / length, vy: aimY / length, speed: 175 + wave * 6, radius: 4 });
        enemy.shotTimer = 2.2 + Math.random() * 1.3;
      }
      if (enemy.y > HEIGHT + enemy.radius) {
        enemy.escaped = true;
        damagePlayer();
      }
    }

    for (const shot of shots) {
      const target = enemies.find(enemy => !enemy.dead && Math.hypot(enemy.x - shot.x, enemy.y - shot.y) < enemy.radius + shot.radius);
      if (target) {
        target.hp -= 1;
        shot.dead = true;
        addBurst(shot.x, shot.y, target.color, 3);
        if (target.hp <= 0) {
          target.dead = true;
          awardPoints(target.maxHp === 1 ? 100 : 250);
          addBurst(target.x, target.y, target.color, target.maxHp === 1 ? 14 : 24);
          if (Math.random() < 0.12) pickups.push({ x: target.x, y: target.y, radius: 10, spin: 0 });
          playTone(280, 0.1, "triangle", 0.025);
        }
      }
    }
    shots = shots.filter(shot => !shot.dead);
    enemies = enemies.filter(enemy => !enemy.dead && !enemy.escaped);

    for (const shot of enemyShots) {
      if (!shot.dead && Math.hypot(player.x - shot.x, player.y - shot.y) < player.radius + shot.radius) {
        shot.dead = true;
        damagePlayer();
      }
    }
    enemyShots = enemyShots.filter(shot => !shot.dead);
    for (const enemy of enemies) {
      if (Math.hypot(player.x - enemy.x, player.y - enemy.y) < player.radius + enemy.radius) {
        enemy.dead = true;
        damagePlayer();
        addBurst(enemy.x, enemy.y, enemy.color, 12);
      }
    }
    enemies = enemies.filter(enemy => !enemy.dead);

    for (const pickup of pickups) {
      pickup.y += 90 * dt;
      pickup.spin += dt * 3;
      if (Math.hypot(player.x - pickup.x, player.y - pickup.y) < player.radius + pickup.radius) {
        pickup.collected = true;
        player.power = 8;
        awardPoints(50);
        playTone(880, 0.16, "sine", 0.035);
      }
    }
    pickups = pickups.filter(pickup => !pickup.collected && pickup.y < HEIGHT + 20);
    for (const particle of particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 0.98;
      particle.vy *= 0.98;
      particle.life -= dt;
    }
    particles = particles.filter(particle => particle.life > 0);

    if (waveRemaining === 0 && enemies.length === 0) {
      wave += 1;
      beginWave();
    }
  }

  function drawShip(x, y, scale, color, isPlayer = false) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    if (isPlayer) {
      ctx.shadowColor = "#61e8f5";
      ctx.shadowBlur = 20;
    }
    ctx.fillStyle = isPlayer ? "#61e8f5" : color;
    ctx.beginPath();
    ctx.moveTo(0, -19);
    ctx.lineTo(14, 12);
    ctx.lineTo(5, 8);
    ctx.lineTo(0, 13);
    ctx.lineTo(-5, 8);
    ctx.lineTo(-14, 12);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = isPlayer ? "#e2fcff" : "#fff1fa";
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = isPlayer ? "#ffbb68" : "#ff82bc";
    ctx.beginPath();
    ctx.moveTo(-4, 12);
    ctx.lineTo(0, 12 + 6 + Math.random() * 5);
    ctx.lineTo(4, 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const bg = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    bg.addColorStop(0, "#090d20");
    bg.addColorStop(1, "#10152d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const nebula = ctx.createRadialGradient(WIDTH * 0.72, HEIGHT * 0.28, 10, WIDTH * 0.72, HEIGHT * 0.28, 330);
    nebula.addColorStop(0, "rgba(81, 49, 131, 0.11)");
    nebula.addColorStop(1, "rgba(81, 49, 131, 0)");
    ctx.fillStyle = nebula;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    for (const star of stars) {
      const alpha = 0.35 + (Math.sin(elapsed * 2 + star.phase) + 1) * 0.28;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#dce9ff";
      ctx.fillRect(star.x, star.y, star.size, star.size);
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = "rgba(109, 130, 197, 0.08)";
    ctx.lineWidth = 1;
    for (let x = 60; x < WIDTH; x += 80) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, HEIGHT); ctx.stroke();
    }

    for (const shot of shots) {
      ctx.save();
      ctx.strokeStyle = "#b7faff";
      ctx.shadowColor = "#61e8f5";
      ctx.shadowBlur = 12;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(shot.x - shot.vx * 10, shot.y - shot.vy * 10);
      ctx.lineTo(shot.x, shot.y);
      ctx.stroke();
      ctx.restore();
    }
    for (const shot of enemyShots) {
      ctx.fillStyle = "#ff719f";
      ctx.shadowColor = "#ff548d";
      ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(shot.x, shot.y, shot.radius, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
    for (const enemy of enemies) {
      drawShip(enemy.x, enemy.y, enemy.radius / 16, enemy.color);
      if (enemy.maxHp > 1) {
        ctx.fillStyle = "rgba(255,255,255,.18)";
        ctx.fillRect(enemy.x - 15, enemy.y - 30, 30, 3);
        ctx.fillStyle = enemy.color;
        ctx.fillRect(enemy.x - 15, enemy.y - 30, 30 * enemy.hp / enemy.maxHp, 3);
      }
    }
    for (const pickup of pickups) {
      ctx.save();
      ctx.translate(pickup.x, pickup.y);
      ctx.rotate(pickup.spin);
      ctx.shadowColor = "#a879ff";
      ctx.shadowBlur = 14;
      ctx.fillStyle = "#a879ff";
      ctx.fillRect(-7, -7, 14, 14);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("+", 0, 0);
      ctx.restore();
    }
    for (const particle of particles) {
      ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
      ctx.fillStyle = particle.color;
      ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
    }
    ctx.globalAlpha = 1;

    if (player.invulnerable <= 0 || Math.floor(elapsed * 12) % 2 === 0) {
      drawShip(player.x, player.y, 1, "#61e8f5", true);
    }
    if (player.power > 0) {
      ctx.strokeStyle = `rgba(168, 121, 255, ${0.35 + Math.sin(elapsed * 8) * 0.15})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 25, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (state === "paused") {
      ctx.fillStyle = "rgba(5, 8, 20, .45)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
  }

  function frame(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000 || 0, 0.04);
    lastTime = timestamp;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function setKey(event, isDown) {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) event.preventDefault();
    if (isDown) keys.add(key);
    else keys.delete(key);
    if (!isDown) return;
    if (event.key === "Enter" && state !== "playing" && state !== "paused") startGame();
    if ((event.key === "p" || event.key === "P") && (state === "playing" || state === "paused")) togglePause();
  }

  function setPointer(event) {
    const bounds = canvas.getBoundingClientRect();
    pointerAim = {
      x: (event.clientX - bounds.left) / bounds.width * WIDTH,
      y: (event.clientY - bounds.top) / bounds.height * HEIGHT
    };
  }

  window.addEventListener("keydown", event => setKey(event, true));
  window.addEventListener("keyup", event => setKey(event, false));
  window.addEventListener("blur", () => keys.clear());
  canvas.addEventListener("pointermove", event => {
    setPointer(event);
    if (event.pointerType === "mouse" && event.buttons === 1) keys.add(" ");
  });
  canvas.addEventListener("pointerdown", event => {
    setPointer(event);
    if (event.pointerType !== "mouse") keys.add(" ");
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointerup", () => keys.delete(" "));
  canvas.addEventListener("pointercancel", () => keys.delete(" "));
  startButton.addEventListener("click", startGame);
  soundButton.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    soundButton.textContent = soundEnabled ? "♫" : "♪";
    soundButton.setAttribute("aria-label", soundEnabled ? "Mute sound" : "Enable sound");
    soundButton.style.color = soundEnabled ? "#61e8f5" : "";
    if (soundEnabled) playTone(520, 0.1, "sine", 0.035);
  });
  for (const button of document.querySelectorAll(".d-pad .touch-button")) {
    const key = button.dataset.key;
    button.addEventListener("pointerdown", event => {
      event.preventDefault();
      keys.add(key);
      button.classList.add("is-active");
      button.setPointerCapture(event.pointerId);
    });
    const release = () => { keys.delete(key); button.classList.remove("is-active"); };
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
  }
  const fireButton = document.getElementById("fire-button");
  fireButton.addEventListener("pointerdown", event => {
    event.preventDefault();
    keys.add(" ");
    fireButton.classList.add("is-active");
    fireButton.setPointerCapture(event.pointerId);
  });
  const releaseFire = () => { keys.delete(" "); fireButton.classList.remove("is-active"); };
  fireButton.addEventListener("pointerup", releaseFire);
  fireButton.addEventListener("pointercancel", releaseFire);
  fireButton.addEventListener("lostpointercapture", releaseFire);

  updateHud();
  requestAnimationFrame(frame);
})();
