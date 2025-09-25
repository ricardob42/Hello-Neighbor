(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const statusList = document.getElementById("status");

  const TILE_SIZE = 40;
  const ROWS = 15;
  const COLS = 20;
  const MAP_LAYOUT = [
    "####################",
    "#...........#......#",
    "#.######....#..##..#",
    "#.#....#....#..##..#",
    "#.#....#....#......#",
    "#.#....#.####.####.#",
    "#.#....#......#....#",
    "#.#######.##..#....#",
    "#.......#..#..#....#",
    "#.###...#..#..#.####",
    "#...#...#..#..#....#",
    "###.#...#..#..#....#",
    "#...#..............#",
    "#...######.#######.#",
    "####################"
  ];

  const WALLS = new Set();
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (MAP_LAYOUT[row][col] === "#") {
        WALLS.add(`${col},${row}`);
      }
    }
  }

  const isBlocked = (x, y) => {
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
      return true;
    }
    const col = Math.floor(x / TILE_SIZE);
    const row = Math.floor(y / TILE_SIZE);
    return WALLS.has(`${col},${row}`);
  };

  const collidesWithWall = (x, y, radius) => {
    return (
      isBlocked(x - radius, y - radius) ||
      isBlocked(x + radius, y - radius) ||
      isBlocked(x - radius, y + radius) ||
      isBlocked(x + radius, y + radius)
    );
  };

  function tileCenter(col, row, label) {
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) {
      throw new Error(`${label} fuera del mapa (${col}, ${row})`);
    }

    const key = `${col},${row}`;
    if (WALLS.has(key)) {
      throw new Error(`${label} colocado sobre un muro (${col}, ${row})`);
    }

    return { x: (col + 0.5) * TILE_SIZE, y: (row + 0.5) * TILE_SIZE };
  }

  const playerStart = tileCenter(1, 1, "Inicio del jugador");
  const neighborStart = tileCenter(12, 7, "Inicio del vecino");

  const door = {
    ...tileCenter(18, 1, "Puerta"),
    radius: TILE_SIZE * 0.45,
    open: false
  };

  const keyItem = {
    ...tileCenter(3, 12, "Llave"),
    radius: TILE_SIZE * 0.3,
    collected: false
  };

  const PATROL_TILES = [
    [12, 12],
    [17, 12],
    [12, 12],
    [12, 7]
  ];

  const patrolPath = PATROL_TILES.map(([col, row], index) =>
    tileCenter(col, row, `Punto de patrulla ${index + 1}`)
  );

  const player = {
    x: playerStart.x,
    y: playerStart.y,
    radius: 14,
    speed: 120,
    sprintSpeed: 190,
    stamina: 4,
    maxStamina: 4,
    staminaRecovery: 1.5,
    sprintDrain: 2.5,
    facing: 0
  };

  const neighbor = {
    x: neighborStart.x,
    y: neighborStart.y,
    radius: 16,
    speed: 90,
    chaseSpeed: 115,
    facing: Math.PI,
    detectionRange: 220,
    fov: Math.PI * 0.6,
    state: "patrol",
    pathIndex: 0,
    suspicion: 0,
    suspicionMax: 4,
    suspicionDecay: 0.8,
    memoryTimer: 0,
    maxMemory: 3,
    patrolPath
  };

  const gameState = {
    running: true,
    outcome: "",
    messageTimer: 0
  };

  const keysPressed = new Set();
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) {
      event.preventDefault();
    }
    keysPressed.add(key);

    if (key === "r") {
      resetGame();
    }
  });

  document.addEventListener("keyup", (event) => {
    keysPressed.delete(event.key.toLowerCase());
  });

  function resetGame() {
    player.x = playerStart.x;
    player.y = playerStart.y;
    player.stamina = player.maxStamina;
    player.facing = 0;

    neighbor.x = neighborStart.x;
    neighbor.y = neighborStart.y;
    neighbor.state = "patrol";
    neighbor.suspicion = 0;
    neighbor.pathIndex = 0;
    neighbor.memoryTimer = 0;

    keyItem.collected = false;
    door.open = false;

    gameState.running = true;
    gameState.outcome = "";
    gameState.messageTimer = 0;
  }

  function lerp(start, end, t) {
    return start + (end - start) * t;
  }

  function length(x, y) {
    return Math.hypot(x, y);
  }

  function normalize(x, y) {
    const len = length(x, y);
    if (len === 0) return { x: 0, y: 0 };
    return { x: x / len, y: y / len };
  }

  function attemptMove(entity, vx, vy, dt) {
    if (vx !== 0) {
      const newX = entity.x + vx * dt;
      if (!collidesWithWall(newX, entity.y, entity.radius)) {
        entity.x = newX;
      }
    }
    if (vy !== 0) {
      const newY = entity.y + vy * dt;
      if (!collidesWithWall(entity.x, newY, entity.radius)) {
        entity.y = newY;
      }
    }
  }

  function projectLOS(origin, target) {
    const steps = 24;
    const stepX = (target.x - origin.x) / steps;
    const stepY = (target.y - origin.y) / steps;
    for (let i = 1; i <= steps; i += 1) {
      const x = origin.x + stepX * i;
      const y = origin.y + stepY * i;
      if (isBlocked(x, y)) {
        return false;
      }
    }
    return true;
  }

  function hasLineOfSight(from, to) {
    return projectLOS(from, to);
  }

  function updatePlayer(dt) {
    let moveX = 0;
    let moveY = 0;

    if (keysPressed.has("arrowup") || keysPressed.has("w")) moveY -= 1;
    if (keysPressed.has("arrowdown") || keysPressed.has("s")) moveY += 1;
    if (keysPressed.has("arrowleft") || keysPressed.has("a")) moveX -= 1;
    if (keysPressed.has("arrowright") || keysPressed.has("d")) moveX += 1;

    const sprinting = keysPressed.has(" ") && player.stamina > 0.1;
    const speed = sprinting ? player.sprintSpeed : player.speed;

    if (sprinting && (moveX !== 0 || moveY !== 0)) {
      player.stamina = Math.max(0, player.stamina - player.sprintDrain * dt);
    } else {
      player.stamina = Math.min(player.maxStamina, player.stamina + player.staminaRecovery * dt);
    }

    if (moveX !== 0 || moveY !== 0) {
      const dir = normalize(moveX, moveY);
      attemptMove(player, dir.x * speed, dir.y * speed, dt);
      player.facing = Math.atan2(dir.y, dir.x);
    }

    if (!keyItem.collected) {
      const distance = Math.hypot(player.x - keyItem.x, player.y - keyItem.y);
      if (distance < player.radius + keyItem.radius) {
        keyItem.collected = true;
      }
    }

    if (keyItem.collected && !door.open) {
      const distance = Math.hypot(player.x - door.x, player.y - door.y);
      if (distance < player.radius + door.radius) {
        door.open = true;
        gameState.running = false;
        gameState.outcome = "¡Escapaste!";
        gameState.messageTimer = 6;
      }
    }
  }

  function advancePatrol(dt) {
    const point = neighbor.patrolPath[neighbor.pathIndex];
    const dx = point.x - neighbor.x;
    const dy = point.y - neighbor.y;
    const dist = length(dx, dy);
    if (dist < 10) {
      neighbor.pathIndex = (neighbor.pathIndex + 1) % neighbor.patrolPath.length;
      return { x: 0, y: 0 };
    }
    const dir = normalize(dx, dy);
    neighbor.facing = Math.atan2(dir.y, dir.x);
    return { x: dir.x * neighbor.speed, y: dir.y * neighbor.speed };
  }

  function chasePlayer(dt) {
    const dx = player.x - neighbor.x;
    const dy = player.y - neighbor.y;
    const dist = length(dx, dy);
    if (dist > 4) {
      const dir = normalize(dx, dy);
      neighbor.facing = Math.atan2(dir.y, dir.x);
      return { x: dir.x * neighbor.chaseSpeed, y: dir.y * neighbor.chaseSpeed };
    }
    return { x: 0, y: 0 };
  }

  function updateNeighbor(dt) {
    const toPlayerX = player.x - neighbor.x;
    const toPlayerY = player.y - neighbor.y;
    const distance = length(toPlayerX, toPlayerY);

    let seesPlayer = false;
    if (distance < neighbor.detectionRange && hasLineOfSight(neighbor, player)) {
      const direction = Math.atan2(toPlayerY, toPlayerX);
      let diff = Math.abs(direction - neighbor.facing);
      diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (Math.abs(diff) < neighbor.fov / 2) {
        neighbor.suspicion = Math.min(neighbor.suspicionMax, neighbor.suspicion + dt * (neighbor.state === "chase" ? 1.5 : 1));
        seesPlayer = true;
      }
    }

    if (!seesPlayer) {
      neighbor.suspicion = Math.max(0, neighbor.suspicion - neighbor.suspicionDecay * dt);
    }

    if (seesPlayer) {
      neighbor.state = "chase";
      neighbor.memoryTimer = neighbor.maxMemory;
    } else if (neighbor.state === "chase") {
      neighbor.memoryTimer = Math.max(0, neighbor.memoryTimer - dt);
      if (neighbor.memoryTimer === 0 && neighbor.suspicion < 0.2) {
        neighbor.state = "patrol";
      }
    }

    let velocity = { x: 0, y: 0 };
    if (neighbor.state === "chase") {
      velocity = chasePlayer(dt);
    } else {
      velocity = advancePatrol(dt);
    }

    attemptMove(neighbor, velocity.x, velocity.y, dt);

    if (distance < player.radius + neighbor.radius) {
      gameState.running = false;
      gameState.outcome = "Te atraparon";
      gameState.messageTimer = 6;
    }
  }

  function drawGrid() {
    ctx.fillStyle = "#1e1e26";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;
        if (WALLS.has(`${col},${row}`)) {
          ctx.fillStyle = "#2f303a";
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = "#41424c";
          ctx.strokeRect(x + 0.5, y + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
        } else {
          ctx.fillStyle = (row + col) % 2 === 0 ? "#23232d" : "#1f1f28";
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        }
      }
    }
  }

  function drawKey() {
    if (keyItem.collected) return;
    ctx.save();
    ctx.translate(keyItem.x, keyItem.y);
    ctx.fillStyle = "#ffd447";
    ctx.beginPath();
    ctx.arc(0, 0, keyItem.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#8c6b1d";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, keyItem.radius - 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawDoor() {
    ctx.save();
    ctx.translate(door.x, door.y);
    ctx.fillStyle = door.open ? "#47d17d" : "#d14747";
    const size = door.radius * 2;
    ctx.fillRect(-door.radius, -door.radius, size, size);
    ctx.strokeStyle = "#00000055";
    ctx.lineWidth = 3;
    ctx.strokeRect(-door.radius, -door.radius, size, size);
    ctx.restore();
  }

  function drawPlayer() {
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.facing);
    ctx.fillStyle = "#4fa3f9";
    ctx.beginPath();
    ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d7ecff";
    ctx.beginPath();
    ctx.arc(player.radius * 0.6, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawNeighbor() {
    ctx.save();
    ctx.translate(neighbor.x, neighbor.y);
    ctx.rotate(neighbor.facing);
    ctx.fillStyle = "#f9744f";
    ctx.beginPath();
    ctx.arc(0, 0, neighbor.radius, 0, Math.PI * 2);
    ctx.fill();

    const suspicionRatio = neighbor.suspicion / neighbor.suspicionMax;
    ctx.lineWidth = 4;
    ctx.strokeStyle = `rgba(255, 120, 80, ${0.2 + suspicionRatio * 0.6})`;
    ctx.beginPath();
    ctx.arc(0, 0, neighbor.radius + 6, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "rgba(249, 79, 79, 0.25)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, neighbor.detectionRange, -neighbor.fov / 2, neighbor.fov / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawMessages(dt) {
    if (gameState.messageTimer > 0) {
      ctx.save();
      ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
      ctx.fillRect(0, canvas.height - 90, canvas.width, 90);
      ctx.fillStyle = "#fff";
      ctx.font = "24px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(gameState.outcome, canvas.width / 2, canvas.height - 50);
      ctx.restore();
      gameState.messageTimer = Math.max(0, gameState.messageTimer - dt);
    }
  }

  function updateStatus() {
    const suspicionPercent = Math.round((neighbor.suspicion / neighbor.suspicionMax) * 100);
    const staminaPercent = Math.round((player.stamina / player.maxStamina) * 100);
    statusList.innerHTML = `
      <li>${keyItem.collected ? "Llave asegurada" : "Llave pendiente"}</li>
      <li>Visión: ${neighbor.state === "chase" ? "En persecución" : `${suspicionPercent}% sospecha`}</li>
      <li>Energía: ${staminaPercent}%</li>
      <li>${door.open ? "Puerta abierta" : "Puerta cerrada"}</li>
    `;
  }

  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;

    if (gameState.running) {
      updatePlayer(dt);
      updateNeighbor(dt);
    }

    drawGrid();
    drawDoor();
    drawKey();
    drawNeighbor();
    drawPlayer();
    drawMessages(dt);
    updateStatus();

    requestAnimationFrame(loop);
  }

  resetGame();
  requestAnimationFrame(loop);
})();
