/* ==========================================================================
   RIVER RAID — браузерний рімейк на Phaser 3
   Ретро pixel-art спрайти намальовані програмно (без зовнішніх картинок).
   Керування: ← → рух, ↑ прискорення, ↓ гальмо, SPACE постріл/старт,
   P або ESC — пауза.
   ========================================================================== */

'use strict';

// ---------------------------------------------------------------------------
// КОНСТАНТИ
// ---------------------------------------------------------------------------
// версія гри — показується на тайтл-екрані ("vX.Y by Alex Raven"). Онови
// цей рядок разом із записом у CHANGELOG.md при кожній помітній зміні.
const GAME_VERSION = '1.21';

const W = 480;
// ігрове поле займає всю висоту екрана: беремо реальну висоту вікна
// (з розумними межами, щоб на крихітних чи величезних екранах усе лишалось
// грабельним), а не фіксовані 640px як раніше
const H = Math.round(Phaser.Math.Clamp(
  (typeof window !== 'undefined' ? window.innerHeight : 640), 640, 1400));
const ROW_H = 8;                       // висота одного "рядка" рельєфу в px
const ROWS_COUNT = Math.ceil(H / ROW_H) + 6;

const PLAYER_Y = H - 130;              // фіксована екранна Y-позиція гравця
// половина ширини хітбокса літака — навмисно вужча за видиму картинку:
// колізія лише по фюзеляжу (вузькому "тілу" по центру), крила НЕ
// враховуються, тож проскочити впритул до берега/острова, коли крило
// візуально ледь зачіпає його, більше не має завершуватись крахом.
const PLAYER_HALF_W = 6;
const PLAYER_SPEED_X = 230;            // px/сек, бічний рух
const PLAYER_VISUAL_WIDTH = 45;        // повна видима ширина літака по кінчиках крил (== displayWidth, PLAYER_SCALE * 96)
// прохід повз острів має бути мін. вдвічі ширшим за ВИДИМУ картинку літака
// (не за вузький хітбокс вище) — так гравець і "на око" бачить достатньо
// місця, а не тільки технічно проскакує повз графіку
const MIN_ISLAND_CHANNEL = PLAYER_VISUAL_WIDTH * 2;

const MIN_SPEED = 16;                  // мін. швидкість скролу (px/сек) — майже зупинка для заправки
const CRUISE_SPEED = 130;              // швидкість старту/респавну
const BASE_MAX_SPEED = 230;            // макс. швидкість скролу на 1 рівні
const THROTTLE_ACCEL = 260;            // px/сек^2

// ---------------------------------------------------------------------------
// ГОТОВІ ІКОНКИ (танк / гелікоптер / повітряна куля / гравець / реактивний
// літак-ворог / корабель / заправка / вибух) — окремі PNG-файли в assets/,
// а НЕ вбудовані як base64. Кожен файл заздалегідь відмасштабований рівно
// до того розміру, який гра реально показує (найбільший з усіх контекстів
// використання цієї іконки) — тому в game.js більше НЕ тягнеться зайва вага
// суперсемплінгу "про запас": що бачиш у грі, те й важить на диску.
// УВАГА: через це гра вантажить зображення через `this.load.image(key,
// 'assets/....png')`, а Phaser вантажить зображення через XHR — браузери
// блокують XHR-запити до file://, тож гра БІЛЬШЕ НЕ відкривається подвійним
// кліком без сервера (`file://`). Для гри й тестів тепер обов'язково
// потрібен локальний http-сервер (див. README.md/CLAUDE.md).
// ---------------------------------------------------------------------------
const TANK_SCALE = 48 / 53;          // → ~48x24 (берегові танки)
const HELI_SCALE = 1;                // → 55x30 (нативний розмір)
const BALLOON_SCALE = 28 / 45;       // → ~28x40 (кулька в грі; на тайтлі — ×1.6)
const PLAYER_SCALE = 45 / 96;        // → ~45x45 (гравець у грі)
const PLAYER_TITLE_SCALE = 1;        // → 96x96 (гравець на тайтл-екрані, нативний розмір)
const JET_SCALE = 1;                 // → 44x31 (нативний розмір)
const SHIP_SCALE = 1;                // → 52x31 (нативний розмір)
const FUEL_SCALE = 1;                // → 26x36 (нативний розмір)
const HOMING_MISSILE_SCALE = 1;      // → 6x32 (нативний розмір; лише ракети самонаведення)

// Анімація вибуху ('explo', spawnExplosion()/updateExplosions()): "росте" до
// половини тривалості, потім "зменшується" назад, і весь час обертається за
// годинниковою стрілкою.
const EXPLO_START_SCALE = 0.15;    // з чого починається/чим закінчується (не з нуля)
const EXPLO_PEAK_SCALE = 1;        // пік росту — нативний розмір картинки (48x48)
const EXPLO_DURATION = 0.4;        // сек, повний цикл рост+зменшення
const EXPLO_ROTATION_SPEED = 900;  // град/сек → рівно один повний оберт за EXPLO_DURATION

// Дерева/кущі на березі ('tree1'/'tree2'/'bush1'/'bush2') — так само готові
// PNG-іконки з assets/, нативний розмір (масштаб 1). Для кожного дерева чи
// куща, що з'являється (TerrainGen.nextRow()), випадково обирається один із
// двох варіантів картинки в межах свого типу (tree1/tree2 для дерева,
// bush1/bush2 для куща) — суто візуальна різноманітність, на геймплей
// (очки/блокування танків) впливає лише сам тип tree/bush, як і раніше.
const DECO_TREE_KEYS = ['tree1', 'tree2'];
const DECO_BUSH_KEYS = ['bush1', 'bush2'];
const DECO_EDGE_MARGIN = 16; // мін. відстань дерева/куща від берега і від краю екрана (щоб не влазило у воду й не вилазило за кадр)

const SAND_MAX_WIDTH = 32; // жовтий пісок біля води — макс. ширина смуги (0..32px, "дихає" по берегу, ніде не паралельна воді)


const MISSILE_SPEED = 520;
// бонус 'M' (HOMING) — скільки самонавідних пострілів дає ОДНА підібрана
// куля; якщо підібрати ще одну, поки лічильник ще не вичерпаний, додається
// стільки ж ЗВЕРХУ наявної кількості (не перезаписує)
const HOMING_BONUS_AMOUNT = 50;
const FUEL_MAX = 100;
const FUEL_DRAIN_BASE = 2.0;           // одиниць/сек на мін. швидкості
const FUEL_DRAIN_MAX = 5.2;            // одиниць/сек на макс. швидкості
const FUEL_REFILL_RATE = 42;

const INVULN_TIME = 2.0;               // сек недоторканності після респавну
const EXTRA_LIFE_STEP = 10000;

const COL = {
  green: 0x2ecc40, greenDark: 0x1c8a2c, greenDarker: 0x0f5a19,
  cockpit: 0x8fe3ff, red: 0xe03c3c, redDark: 0x8f1f1f,
  gray: 0x9aa0a6, grayDark: 0x555b60, grayDarker: 0x33383c,
  yellowFuel: 0xf5c400, orange: 0xff8c1a, brown: 0x6b4a2b,
  white: 0xffffff, black: 0x000000, tan: 0xd9c08a,
  waterBlue: 0x1560c4,
  landGreen: 0x0e6b1a, landGreenEdge: 0x18a02a,
  sand: 0xe0b64a,
  bridgeGray: 0x9aa0a6, bridgeDark: 0x555b60,
  exploYellow: 0xffe066, exploOrange: 0xff8c42, exploRed: 0xe03c3c,
  hudGreen: 0x39ff6a,
  tankBody: 0x5a6b2f, tankDark: 0x38431c, tankBarrel: 0x24291a,
  prideRed: 0xe4032e, prideOrange: 0xff8c1a, prideYellow: 0xffed4a,
  prideGreen: 0x2ecc40, prideBlue: 0x1f6feb, pridePurple: 0x8a3fe0,
  basket: 0x7a5230
};

// ---------------------------------------------------------------------------
// ДОПОМІЖНЕ: синтезовані звуки (Web Audio, без зовнішніх файлів)
// ---------------------------------------------------------------------------
const SFX = {
  ctx: null,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur, type, gainVal, glideTo) {
    this.ensure();
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (glideTo) osc.frequency.linearRampToValueAtTime(glideTo, ctx.currentTime + dur);
    gain.gain.setValueAtTime(gainVal || 0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  },
  shoot() { this.tone(720, 0.09, 'square', 0.05, 300); },
  explode() {
    this.ensure();
    if (!this.ctx) return;
    const ctx = this.ctx;
    const bufSize = ctx.sampleRate * 0.3;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    src.connect(gain).connect(ctx.destination);
    src.start();
  },
  fuel() { this.tone(400, 0.15, 'sine', 0.06, 900); },
  crash() { this.tone(220, 0.6, 'sawtooth', 0.09, 40); },
  bridge() { this.tone(150, 0.5, 'square', 0.1, 700); },
  life() { this.tone(500, 0.12, 'sine', 0.08, 1200); },
  tankShot() { this.tone(170, 0.14, 'sawtooth', 0.07, 80); },
  heliShot() { this.tone(340, 0.1, 'square', 0.06, 120); },
  chop() { this.tone(300, 0.12, 'sawtooth', 0.07, 90); },
  extraLife() {
    this.tone(600, 0.1, 'sine', 0.08, 900);
    setTimeout(() => this.tone(900, 0.2, 'sine', 0.09, 1400), 90);
  }
};

// ---------------------------------------------------------------------------
// ГЕНЕРАЦІЯ PIXEL-ART ТЕКСТУР (процедурно, без картинок ззовні)
// ---------------------------------------------------------------------------
function P(g, px, x, y, w, h, color) {
  g.fillStyle(color, 1);
  g.fillRect(x * px, y * px, w * px, h * px);
}

function bakeTexture(scene, key, gridW, gridH, px, drawFn) {
  const g = scene.add.graphics();
  drawFn(g, px);
  g.generateTexture(key, gridW * px, gridH * px);
  g.destroy();
}

function generateAllTextures(scene) {
  const c = COL;
  const circ = (g, px, cx, cy, r, color) => { g.fillStyle(color, 1); g.fillCircle(cx * px, cy * px, r * px); };

  // 'player' і 'heli' тепер завантажуються як картинки — див.
  // BootScene.preload(). Процедурне малювання прибрано.

  // 'ship' тепер завантажується як картинка — див. BootScene.preload().
  // Процедурне малювання прибрано.

  // 'tank', 'balloon' і 'jet' тепер завантажуються як картинки — див.
  // BootScene.preload(). Процедурне малювання прибрано. 'tank'/'balloon'
  // за замовчуванням "дивляться" так само, як і старі процедурні спрайти
  // (дуло танка — вправо), тож уся логіка setFlipX() для них лишається без
  // змін. 'jet' — НАВПАКИ: нова картинка за замовчуванням "дивиться" вліво
  // (а стара процедурна текстура дивилась вправо), тож напрям setFlipX()
  // для нього довелось інвертувати (див. spawnEnemy()).

  // --- Снаряд танка, сітка 6x6, px=2 ---
  bakeTexture(scene, 'tankShell', 6, 6, 2, (g, px) => {
    circ(g, px, 3, 3, 2, c.orange);
    circ(g, px, 3, 3, 1, c.exploYellow);
  });

  // --- Снаряд гелікоптера, сітка 6x6, px=2 (інший колір — щоб відрізнявся
  // від танкового пострілу) ---
  bakeTexture(scene, 'heliShell', 6, 6, 2, (g, px) => {
    circ(g, px, 3, 3, 2, c.red);
    circ(g, px, 3, 3, 1, c.white);
  });

  // 'fuel' (паливна бочка) тепер теж завантажується як картинка — див.
  // BootScene.preload(). Процедурне малювання й окремий текстовий напис
  // "FUEL" над бочкою прибрані (іконка бочки й так впізнавана).

  // --- Ракета гравця, сітка 4x8, px=3 ---
  bakeTexture(scene, 'missile', 4, 8, 3, (g, px) => {
    P(g, px, 1, 0, 2, 6, c.white);
    P(g, px, 0, 6, 4, 2, c.orange);
  });

  // 'explo' (вибух) тепер завантажується як картинка — див.
  // BootScene.preload(). Три процедурні кадри explo1/2/3, які раніше
  // підмінялись через setTexture() для ефекту "росту", прибрані — тепер
  // ріст/зменшення й обертання роблять spawnExplosion()/updateExplosions()
  // самі, анімуючи scale/angle одного спрайту (дивись нижче).

  // --- Тайл ферми моста, сітка 16x16, px=2 (тайлиться по горизонталі) ---
  bakeTexture(scene, 'bridgeTile', 16, 16, 2, (g, px) => {
    P(g, px, 0, 0, 16, 3, c.bridgeGray);
    P(g, px, 0, 13, 16, 3, c.bridgeGray);
    for (let i = 0; i < 16; i += 4) {
      P(g, px, i, 3, 2, 2, c.bridgeDark);
      P(g, px, i + 2, 7, 2, 2, c.bridgeDark);
      P(g, px, i, 11, 2, 2, c.bridgeDark);
    }
  });

  // --- Опора мосту (вежа), сітка 8x16, px=2 ---
  bakeTexture(scene, 'bridgeTower', 8, 16, 2, (g, px) => {
    P(g, px, 0, 0, 8, 16, c.grayDarker);
    P(g, px, 2, 2, 4, 12, c.bridgeDark);
  });
}

// ---------------------------------------------------------------------------
// ГЕНЕРАТОР РЕЛЬЄФУ РІЧКИ
// ---------------------------------------------------------------------------
class TerrainGen {
  constructor() {
    this.centerX = W / 2;
    this.halfWidth = 150;
    this.minHalf = 78;
    this.maxHalf = 195;
    this.margin = 30;

    // плавність берегів: рухаємо ширину/центр через "швидкість" (інерцію),
    // а не незалежним випадковим кроком щорядка — так контур виходить
    // хвилястим, а не рваним/зигзагоподібним
    this.halfVel = 0;
    this.centerVel = 0;

    this.islandActive = false;
    this.islandPhase = null;
    this.islandHalf = 0;
    this.islandTargetHalf = 0;
    this.islandRowsLeft = 0;
    this.islandCooldown = 90;

    this.distSinceBridge = 0;
    this.bridgeDistance = 3600;
    this.bridgeRowsLeft = 0;
    this.currentBridge = null;

    // дерева/кущі на берегах — декоративні, не впливають на колізії
    this.decoLeftCooldown = Phaser.Math.Between(4, 12);
    this.decoRightCooldown = Phaser.Math.Between(4, 12);

    // жовтий пісок біля води — та сама "інерція", що й halfVel/centerVel
    // вище, але окремо для КОЖНОГО з двох типів країв (щоб піски зліва й
    // справа не йшли синхронно): sandA — краї, де суша ЗЛІВА від лінії
    // води (тобто ліворуч тягнеться в мінус: головний лівий берег
    // (row.left) і правий край острова (islandRight)); sandB — краї, де
    // суша СПРАВА від лінії води (тягнеться в плюс: головний правий берег
    // (row.right) і лівий край острова (islandLeft)). Діапазон [0,
    // SAND_MAX_WIDTH] навмисно включає сам 0 — тож пісок природно то
    // з'являється, то зникає, а не просто "дихає" вузькою смужкою.
    this.sandA = Phaser.Math.Between(0, SAND_MAX_WIDTH);
    this.sandAVel = 0;
    this.sandB = Phaser.Math.Between(0, SAND_MAX_WIDTH);
    this.sandBVel = 0;

    this.level = 1;
  }

  setLevel(level) {
    this.level = level;
    this.minHalf = Math.max(58, 78 - level * 3);
    this.bridgeDistance = Math.max(2600, 4200 - level * 130);
  }

  nextRow(scrollDeltaPx) {
    const frozen = this.bridgeRowsLeft > 0; // під час моста ширина не змінюється

    if (!frozen) {
      // невеликі випадкові поштовхи міняють не саму позицію, а швидкість —
      // положення тоді змінюється плавною кривою (як інерція), без різких
      // зигзагів від рядка до рядка
      // centerVel відповідає за те, наскільки річка звивається вліво-вправо;
      // раніше межі були занадто вузькими (±1.4), тож русло виглядало майже
      // прямим — тепер дозволяємо помітно більшу амплітуду й розгін
      this.halfVel = Phaser.Math.Clamp(this.halfVel + Phaser.Math.FloatBetween(-0.25, 0.25), -1.1, 1.1);
      this.centerVel = Phaser.Math.Clamp(this.centerVel + Phaser.Math.FloatBetween(-0.55, 0.55), -2.6, 2.6);

      let newHalf = this.halfWidth + this.halfVel;
      if (newHalf < this.minHalf || newHalf > this.maxHalf) this.halfVel *= -0.4; // м'яко "відбити" від межі
      this.halfWidth = Phaser.Math.Clamp(newHalf, this.minHalf, this.maxHalf);

      let newCenter = this.centerX + this.centerVel;
      const centerMin = this.halfWidth + this.margin, centerMax = W - this.halfWidth - this.margin;
      if (newCenter < centerMin || newCenter > centerMax) this.centerVel *= -0.4;
      this.centerX = Phaser.Math.Clamp(newCenter, centerMin, centerMax);
    }

    // --- острови ---
    let islandLeft = null, islandRight = null;
    if (!frozen) {
      if (!this.islandActive) {
        this.islandCooldown--;
        if (this.islandCooldown <= 0 && this.halfWidth > 118 && this.bridgeRowsLeft === 0) {
          this.islandActive = true;
          this.islandPhase = 'grow';
          this.islandHalf = 0;
          this.islandTargetHalf = Phaser.Math.Between(20, Math.max(20, Math.min(58, this.halfWidth - MIN_ISLAND_CHANNEL)));
          this.islandRowsLeft = Phaser.Math.Between(45, 85);
        }
      }
      if (this.islandActive) {
        // halfWidth і далі "дихає" (звужується/розширюється) поки острів
        // активний — тож на кожному рядку перераховуємо максимально
        // безпечну половину острова, щоб з обох боків завжди лишався
        // прохід шириною не менше MIN_ISLAND_CHANNEL. Без цього острів міг
        // "з'їсти" прохід, коли річка тим часом звужувалась, і річку
        // ставало фізично неможливо пролетіти.
        const maxSafeIslandHalf = Math.max(0, this.halfWidth - MIN_ISLAND_CHANNEL);
        if (this.islandTargetHalf > maxSafeIslandHalf) this.islandTargetHalf = maxSafeIslandHalf;

        if (this.islandPhase === 'grow') {
          this.islandHalf += 3;
          if (this.islandHalf >= this.islandTargetHalf) { this.islandHalf = this.islandTargetHalf; this.islandPhase = 'hold'; }
        } else if (this.islandPhase === 'hold') {
          this.islandRowsLeft--;
          if (this.islandRowsLeft <= 0) this.islandPhase = 'shrink';
        } else if (this.islandPhase === 'shrink') {
          this.islandHalf -= 3;
          if (this.islandHalf <= 0) {
            this.islandHalf = 0; this.islandActive = false;
            this.islandCooldown = Phaser.Math.Between(70, 150);
          }
        }
        // додатковий запобіжник: острів не повинен перевищувати поточну
        // безпечну межу, навіть якщо ми не в фазі "grow" (річка могла
        // звузитись саме зараз, у фазі hold/shrink)
        if (this.islandActive && this.islandHalf > maxSafeIslandHalf) this.islandHalf = maxSafeIslandHalf;

        if (this.islandActive && this.islandHalf > 4) {
          islandLeft = this.centerX - this.islandHalf;
          islandRight = this.centerX + this.islandHalf;
        }
      }
    }

    // --- мости ---
    let bridgeRef = null;
    this.distSinceBridge += scrollDeltaPx;
    if (this.bridgeRowsLeft > 0) {
      bridgeRef = this.currentBridge;
      this.bridgeRowsLeft--;
      if (this.bridgeRowsLeft === 0) this.currentBridge = null;
    } else if (this.distSinceBridge >= this.bridgeDistance && !this.islandActive) {
      this.distSinceBridge = 0;
      this.currentBridge = { hp: 1, alive: true, scored: false, left: this.centerX - this.halfWidth, right: this.centerX + this.halfWidth };
      this.bridgeRowsLeft = 4;
      bridgeRef = this.currentBridge;
      this.bridgeRowsLeft--;
    }

    // --- дерева/кущі на зеленій частині берега ---
    // з'являються з випадковим інтервалом на кожному березі окремо, щоб не
    // тулитись одне до одного; вимкнено біля мостів і на "заморожених"
    // рядках, щоб не заважати конструкції моста.
    // inset — відстань від берега (не від краю екрана!), тож розкидані по
    // ВСІЙ ширині зеленої смуги (від берега аж до краю екрана), а не тільки
    // тісною смужкою біля самої води, як було раніше.
    let decoLeft = null, decoRight = null;
    if (!frozen && !bridgeRef) {
      const leftGreenW = this.centerX - this.halfWidth; // ширина зеленої смуги зліва (0..row.left)
      const rightGreenW = W - (this.centerX + this.halfWidth); // те саме справа
      const leftInsetMax = Math.max(DECO_EDGE_MARGIN, leftGreenW - DECO_EDGE_MARGIN);
      const rightInsetMax = Math.max(DECO_EDGE_MARGIN, rightGreenW - DECO_EDGE_MARGIN);

      this.decoLeftCooldown--;
      if (this.decoLeftCooldown <= 0) {
        // variant — який саме з двох PNG-варіантів свого типу показати
        // (tree1/tree2 чи bush1/bush2), суто візуальна різноманітність
        decoLeft = { tree: Phaser.Math.Between(0, 1) === 0, inset: Phaser.Math.Between(DECO_EDGE_MARGIN, leftInsetMax), variant: Phaser.Math.Between(0, 1) };
        this.decoLeftCooldown = Phaser.Math.Between(7, 18);
      }
      this.decoRightCooldown--;
      if (this.decoRightCooldown <= 0) {
        decoRight = { tree: Phaser.Math.Between(0, 1) === 0, inset: Phaser.Math.Between(DECO_EDGE_MARGIN, rightInsetMax), variant: Phaser.Math.Between(0, 1) };
        this.decoRightCooldown = Phaser.Math.Between(7, 18);
      }
    }

    // --- жовтий пісок біля води ---
    // та сама "інерція з м'яким відбиттям", що й halfVel/centerVel вище, і
    // навмисно в ТІЙ САМІЙ пропорції "крок/діапазон" — щоб внутрішній край
    // піску був так само плавним, як і сам берег, а не зубчастим/шумним
    // (крок і межа швидкості тут пропорційно зменшені під менший діапазон
    // 0..SAND_MAX_WIDTH, а не скопійовані як є). Діапазон [0, SAND_MAX_WIDTH]
    // включає сам нуль — тож пісок то з'являється, то зникає, і ніде не
    // тягнеться суворо паралельно воді. Рахується щорядка незалежно від
    // "заморожених" рядків мосту — це просто косметична смуга поверх уже
    // намальованого берега.
    this.sandAVel = Phaser.Math.Clamp(this.sandAVel + Phaser.Math.FloatBetween(-0.06, 0.06), -0.28, 0.28);
    let newSandA = this.sandA + this.sandAVel;
    if (newSandA < 0 || newSandA > SAND_MAX_WIDTH) this.sandAVel *= -0.4;
    this.sandA = Phaser.Math.Clamp(newSandA, 0, SAND_MAX_WIDTH);

    this.sandBVel = Phaser.Math.Clamp(this.sandBVel + Phaser.Math.FloatBetween(-0.06, 0.06), -0.28, 0.28);
    let newSandB = this.sandB + this.sandBVel;
    if (newSandB < 0 || newSandB > SAND_MAX_WIDTH) this.sandBVel *= -0.4;
    this.sandB = Phaser.Math.Clamp(newSandB, 0, SAND_MAX_WIDTH);

    return {
      left: this.centerX - this.halfWidth,
      right: this.centerX + this.halfWidth,
      islandLeft, islandRight,
      bridge: bridgeRef,
      decoLeft, decoRight,
      sandA: this.sandA, sandB: this.sandB
    };
  }
}

// ---------------------------------------------------------------------------
// ПІКСЕЛЬНІ МАСКИ ХІТБОКСІВ — для готових PNG-іконок хітбокс визначається не
// прямокутником "на око" (як було раніше), а реальними непрозорими пікселями
// самої картинки: якщо в конкретній точці PNG прозорий піксель — влучання НЕ
// рахується, навіть якщо точка формально в межах bounding box іконки. Це
// прибирає відчуття "перекошених"/хибних влучань біля країв асиметричних
// іконок (щогла корабля, лопаті гелікоптера, нерівна крона дерева тощо), яке
// було з фіксованими hw/hh-прямокутниками, підігнаними "на око" під старі
// процедурні спрайти.
// ---------------------------------------------------------------------------
const SPRITE_MASKS = {};   // texture key -> { width, height, alpha: Uint8ClampedArray }

// будує альфа-маску для однієї текстури — викликається один раз при
// завантаженні (BootScene.create()) для кожної PNG-іконки, по якій реально
// перевіряється влучання пострілу/ракети
function buildSpriteMask(scene, key) {
  const src = scene.textures.get(key).getSourceImage();
  const w = src.width, h = src.height;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data; // RGBA, 4 байти на піксель
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  SPRITE_MASKS[key] = { width: w, height: h, alpha };
}

// чи є непрозорий піксель картинки img (Phaser.Image) у світовій точці
// (worldX, worldY)? Враховує позицію, масштаб, кут повороту й дзеркалення
// (flipX/flipY) самого об'єкта — тобто хітбокс завжди точно збігається з
// тим, що реально намальовано на екрані в цей момент, а не зі старою
// фіксованою "коробкою" навколо центру.
function pixelHit(img, worldX, worldY) {
  const mask = SPRITE_MASKS[img.texture.key];
  if (!mask) return false; // немає маски для цієї текстури — вважаємо промахом
  let dx = worldX - img.x;
  let dy = worldY - img.y;
  if (img.angle) {
    const rad = Phaser.Math.DegToRad(-img.angle);
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    dx = rx; dy = ry;
  }
  dx /= img.scaleX;
  dy /= img.scaleY;
  if (img.flipX) dx = -dx;
  if (img.flipY) dy = -dy;
  const px = Math.round(mask.width / 2 + dx);
  const py = Math.round(mask.height / 2 + dy);
  if (px < 0 || py < 0 || px >= mask.width || py >= mask.height) return false;
  return mask.alpha[py * mask.width + px] > 20; // поріг відсікає майже прозорі краї (антиаліасинг)
}

// ---------------------------------------------------------------------------
// BOOT SCENE — генерація текстур
// ---------------------------------------------------------------------------
class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  preload() {
    // танк, гелікоптер, повітряна куля, гравець, "бічний" реактивний
    // літак-ворог, ворожий корабель, паливна бочка й вибух — готові іконки
    // замість процедурної піксель-графіки; решта спрайтів і далі малюється
    // кодом (generateAllTextures). Вантажимо їх як окремі PNG-файли з
    // assets/ (кожен заздалегідь відмасштабований до потрібного розміру —
    // див. коментар про SCALE-константи вище), а НЕ як base64 — свідомий
    // компроміс: гра важить менше, але через це вже НЕ відкривається просто
    // подвійним кліком (file://), потрібен http-сервер (`npx http-server`,
    // `python3 -m http.server` тощо).
    this.load.image('tank', 'assets/tank.png');
    this.load.image('heli', 'assets/heli.png');
    this.load.image('balloon', 'assets/balloon.png');
    this.load.image('player', 'assets/player.png');
    this.load.image('jet', 'assets/jet.png');
    this.load.image('ship', 'assets/ship.png');
    this.load.image('fuel', 'assets/fuel.png');
    this.load.image('explo', 'assets/explo.png');
    // дерева/кущі на березі — по два варіанти картинки на кожен тип
    // (tree1/tree2, bush1/bush2), обираються випадково при спавні
    this.load.image('tree1', 'assets/tree1.png');
    this.load.image('tree2', 'assets/tree2.png');
    this.load.image('bush1', 'assets/bush1.png');
    this.load.image('bush2', 'assets/bush2.png');
    // ракета самонаведення (бонус M) — готова іконка замість процедурного
    // прямокутника; звичайний/потрійний постріл і далі малюються процедурно
    // (текстура 'missile', без змін)
    this.load.image('homingMissile', 'assets/homingMissile.png');
  }
  create() {
    generateAllTextures(this);
    // ці картинки — плоскі "іконкові" зображення (не піксель-арт), тож
    // вмикаємо їм лінійну фільтрацію: глобальний pixelArt:true в конфігу гри
    // інакше даватиме грубе "сходинкове" масштабування при зменшенні розміру
    for (const key of ['tank', 'heli', 'balloon', 'player', 'jet', 'ship', 'fuel', 'explo',
                        'tree1', 'tree2', 'bush1', 'bush2', 'homingMissile']) {
      this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
    }
    // альфа-маски для хітбоксів "по пікселях" — лише для іконок, по яких
    // реально перевіряється влучання пострілу/ракети (resolveMissileCollision)
    for (const key of ['tank', 'heli', 'ship', 'jet', 'fuel', 'balloon', 'tree1', 'tree2', 'bush1', 'bush2']) {
      buildSpriteMask(this, key);
    }
    this.scene.start('Title');
  }
}

// ---------------------------------------------------------------------------
// TITLE SCENE
// ---------------------------------------------------------------------------
class TitleScene extends Phaser.Scene {
  constructor() { super('Title'); }
  create() {
    this.cameras.main.setBackgroundColor('#04122b');

    // Розкладка тайтл-екрана — фіксовані Y-координати (як і раніше), але
    // підібрані так, щоб жоден напис не заходив на зображення літака
    // (раніше блок керування "← → ↑ ↓ SPACE" наїжджав просто на картинку).
    // Літак підняли вище й зменшили, а решту блоків підсунули під нього з
    // явним запасом.
    this.add.text(W / 2, 68, 'RIVER RAID', {
      fontFamily: 'Courier New, monospace', fontSize: '44px', fontStyle: 'bold',
      color: '#39ff6a'
    }).setOrigin(0.5).setShadow(3, 3, '#0a3d17', 0, false, true);

    this.add.image(W / 2, 150, 'player').setScale(PLAYER_TITLE_SCALE * 0.8);

    const lines = [
      '← →  рух літака      ↑ прискорення',
      '↓ гальмо              SPACE постріл',
      'P/ESC   пауза'
    ];
    this.add.text(W / 2, 226, lines, {
      fontFamily: 'Courier New, monospace', fontSize: '15px', color: '#cfe8ff', align: 'center', lineSpacing: 4
    }).setOrigin(0.5);

    this.add.text(W / 2, 280, [
      'Не врізайся в береги, збивай мости,',
      'не дай закінчитись пальному.'
    ], {
      fontFamily: 'Courier New, monospace', fontSize: '14px', color: '#cfe8ff', align: 'center', lineSpacing: 3
    }).setOrigin(0.5);

    this.add.text(W / 2, 320, 'Збий веселкову кульку — отримай бонус!', {
      fontFamily: 'Courier New, monospace', fontSize: '14px', color: '#ffd6f5'
    }).setOrigin(0.5);
    this.add.image(W / 2 - 110, 375, 'balloon').setScale(BALLOON_SCALE * 1.6);
    this.add.text(W / 2 - 65, 350, [
      'T — потрійний вогонь',
      'M — самонаведення',
      'D — швидкий вогонь',
      'F — паливо на повний бак',
      'N — знищує всіх ворогів',
      'X — додаткове життя'
    ], {
      fontFamily: 'Courier New, monospace', fontSize: '13px', color: '#cfe8ff', align: 'left', lineSpacing: 3
    }).setOrigin(0, 0);

    this.blink = this.add.text(W / 2, 550, 'НАТИСНІТЬ ПРОБІЛ ДЛЯ ПОЧАТКУ', {
      fontFamily: 'Courier New, monospace', fontSize: '19px', fontStyle: 'bold', color: '#ffe066'
    }).setOrigin(0.5);

    this.add.text(W / 2, 582, `v${GAME_VERSION} by Alex Raven`, {
      fontFamily: 'Courier New, monospace', fontSize: '12px', color: '#5a7089'
    }).setOrigin(0.5);

    this.tweens.add({ targets: this.blink, alpha: 0.15, duration: 550, yoyo: true, repeat: -1 });

    const start = () => { SFX.ensure(); this.scene.start('Game'); };
    this.input.keyboard.once('keydown-SPACE', start);
    this.input.keyboard.once('keydown-ENTER', start);
    this.input.once('pointerdown', start);
  }
}

// ---------------------------------------------------------------------------
// GAME SCENE
// ---------------------------------------------------------------------------
class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  create() {
    this.cameras.main.setBackgroundColor('#1560c4');

    // --- стан гри ---
    this.state = 'playing';           // playing | paused | gameover
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.fuel = FUEL_MAX;
    this.nextExtraLife = EXTRA_LIFE_STEP;
    this.scrollSpeed = CRUISE_SPEED;
    this.minSpeed = MIN_SPEED;
    this.maxSpeed = BASE_MAX_SPEED;
    this.scrollAccum = 0;
    this.invulnTimer = INVULN_TIME;
    this.levelFlashTimer = 0;

    // --- рельєф ---
    this.terrainGen = new TerrainGen();
    this.terrainGen.setLevel(this.level);
    this.rows = [];
    for (let i = 0; i < ROWS_COUNT; i++) this.rows.unshift(this.terrainGen.nextRow(ROW_H));
    this.terrainGfx = this.add.graphics();
    // дерева/кущі початкових рядків — картинки-об'єкти (не Graphics), тож
    // спавнимо їх окремим проходом одразу після заповнення this.rows;
    // scrollAccum === 0 у цей момент, тож екранний Y = i * ROW_H напряму
    for (let i = 0; i < this.rows.length; i++) this.spawnDecoImages(this.rows[i], i * ROW_H + this.scrollAccum);
    this.bridgeVisuals = new Map(); // bridge obj -> {tiles:[Image], towers:[Image]}

    // --- гравець ---
    this.player = this.add.image(W / 2, PLAYER_Y, 'player').setScale(PLAYER_SCALE);
    this.player.setDepth(10);

    // --- сутності ---
    this.enemies = [];      // {img, type, vx, x, y, alive}
    this.fuels = [];        // {img, x, y, alive}
    this.tanks = [];        // танки на березі {img, side, x, y, fireTimer}
    this.tankBullets = [];  // снаряди танків {img, x, y, vx, vy}
    this.heliBullets = [];  // снаряди гелікоптерів {img, x, y, vx, vy}
    this.balloons = [];     // бонусні кульки {img, label, letter, x, y}
    this.missiles = [];     // ракети гравця {img, x, y, vx, vy, homing, target}
    this.explosions = [];
    this.activePower = null; // null | 'triple' | 'missile' | 'double'
    // скільки самонавідних пострілів лишилось у бонусі 'missile' (HOMING).
    // Актуальне лише поки this.activePower === 'missile'; зменшується на 1
    // за КОЖЕН постріл (handleShooting), а не за кожну окрему ракету (їх дві
    // за постріл — вліво і вправо). Коли досягає 0 — activePower скидається
    // в null, і гравець повертається до звичайного одиночного пострілу, як
    // на самому початку гри.
    this.homingCount = 0;

    this.enemyTimer = 1.6;
    this.fuelTimer = 1.6;
    this.tankTimer = 3.5;
    this.balloonTimer = 6.0;

    // --- керування ---
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('SPACE,P,ESC,ENTER');
    this.spaceLock = false;

    // --- HUD ---
    const hudStyle = { fontFamily: 'Courier New, monospace', fontSize: '18px', color: '#39ff6a', fontStyle: 'bold' };
    this.scoreText = this.add.text(10, 8, 'SCORE 0', hudStyle).setDepth(30);
    this.levelText = this.add.text(W - 10, 8, 'LEVEL 1', hudStyle).setOrigin(1, 0).setDepth(30);
    this.livesText = this.add.text(10, 30, '', hudStyle).setDepth(30);
    this.powerText = this.add.text(W / 2, 8, '', {
      fontFamily: 'Courier New, monospace', fontSize: '15px', fontStyle: 'bold', color: '#ff6ad5'
    }).setOrigin(0.5, 0).setDepth(30);
    this.fuelLabel = this.add.text(10, H - 26, 'FUEL', { fontFamily: 'Courier New, monospace', fontSize: '14px', color: '#cfe8ff' }).setDepth(30);
    this.fuelBarBg = this.add.rectangle(58, H - 20, 200, 14, 0x223344).setOrigin(0, 0.5).setDepth(30).setStrokeStyle(2, 0x0a1a2a);
    this.fuelBarFill = this.add.rectangle(60, H - 20, 196, 10, 0xffcc00).setOrigin(0, 0.5).setDepth(30);

    this.centerMsg = this.add.text(W / 2, H / 2, '', {
      fontFamily: 'Courier New, monospace', fontSize: '30px', fontStyle: 'bold', color: '#ffffff', align: 'center'
    }).setOrigin(0.5).setDepth(40).setShadow(2, 2, '#000', 0, true, true);
    this.subMsg = this.add.text(W / 2, H / 2 + 46, '', {
      fontFamily: 'Courier New, monospace', fontSize: '18px', color: '#ffe066', align: 'center'
    }).setOrigin(0.5).setDepth(40);

    this.updateHUD();
  }

  // -------------------------------------------------------------------
  updateHUD() {
    this.scoreText.setText('SCORE ' + this.score);
    this.levelText.setText('LEVEL ' + this.level);
    this.livesText.setText('LIVES ' + Math.max(0, this.lives));
    const powerNames = { triple: 'TRIPLE ★', double: 'DOUBLE ★' };
    this.powerText.setText(
      this.activePower === 'missile' ? `HOMING ★ ${this.homingCount}` :
      this.activePower ? powerNames[this.activePower] : ''
    );
    const frac = Phaser.Math.Clamp(this.fuel / FUEL_MAX, 0, 1);
    this.fuelBarFill.width = 196 * frac;
    this.fuelBarFill.fillColor = frac < 0.25 ? 0xe03c3c : 0xffcc00;
  }

  rowAtScreenY(y) {
    const idx = Math.round((y - this.scrollAccum) / ROW_H);
    return this.rows[Phaser.Math.Clamp(idx, 0, this.rows.length - 1)];
  }

  isChannelSafe(row, x, halfW) {
    if (row.bridge && row.bridge.alive) return false;
    if (row.islandLeft != null) {
      const leftOk = (x - halfW > row.left) && (x + halfW < row.islandLeft);
      const rightOk = (x - halfW > row.islandRight) && (x + halfW < row.right);
      return leftOk || rightOk;
    }
    return (x - halfW > row.left) && (x + halfW < row.right);
  }

  // -------------------------------------------------------------------
  update(time, delta) {
    const dt = Math.min(delta / 1000, 0.05);

    if (this.state === 'title-unused') return;

    if (Phaser.Input.Keyboard.JustDown(this.keys.P) || Phaser.Input.Keyboard.JustDown(this.keys.ESC)) {
      if (this.state === 'playing') this.pauseGame();
      else if (this.state === 'paused') this.resumeGame();
    }

    if (this.state === 'gameover') {
      if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE) || Phaser.Input.Keyboard.JustDown(this.keys.ENTER)) {
        this.scene.restart();
      }
      return;
    }

    if (this.state === 'paused') return;

    this.updatePlaying(dt);
  }

  pauseGame() {
    this.state = 'paused';
    this.centerMsg.setText('PAUSE');
    this.subMsg.setText('P / ESC — продовжити');
  }
  resumeGame() {
    this.state = 'playing';
    this.centerMsg.setText('');
    this.subMsg.setText('');
  }

  // -------------------------------------------------------------------
  updatePlaying(dt) {
    // керування газом
    if (this.cursors.up.isDown) this.scrollSpeed = Math.min(this.maxSpeed, this.scrollSpeed + THROTTLE_ACCEL * dt);
    else if (this.cursors.down.isDown) this.scrollSpeed = Math.max(this.minSpeed, this.scrollSpeed - THROTTLE_ACCEL * dt);

    const scrollDelta = this.scrollSpeed * dt;
    this.scrollAccum += scrollDelta;
    while (this.scrollAccum >= ROW_H) {
      this.scrollAccum -= ROW_H;
      const poppedRow = this.rows.pop();
      // рядок, що щойно вислизнув за нижній край масиву, міг ще мати
      // непідстрелене дерево/кущ — приберемо його картинку, інакше вона
      // лишиться "висіти" в сцені й нікуди не рухатиметься (memory leak)
      this.destroyRowDecoImages(poppedRow);
      const newRow = this.terrainGen.nextRow(ROW_H);
      this.rows.unshift(newRow);
      // новий рядок щойно з'явився зверху екрана — його екранний Y у цю
      // мить точно дорівнює this.scrollAccum (той самий i*ROW_H+scrollAccum
      // з i=0, бо unshift ставить його на позицію 0)
      this.spawnDecoImages(newRow, this.scrollAccum);
      if (newRow.bridge && !newRow.bridge._spawned) {
        newRow.bridge._spawned = true;
        this.spawnBridgeVisual(newRow.bridge);
      }
    }

    // бічний рух гравця (керування доступне завжди, недоторканність впливає лише на колізії)
    let bankTarget = 0;
    if (this.cursors.left.isDown) { this.player.x -= PLAYER_SPEED_X * dt; bankTarget = -24; }
    if (this.cursors.right.isDown) { this.player.x += PLAYER_SPEED_X * dt; bankTarget = 24; }
    this.player.x = Phaser.Math.Clamp(this.player.x, 6, W - 6);
    // плавний крен "на крило" при повороті, як в оригіналі
    this.player.angle = Phaser.Math.Linear(this.player.angle, bankTarget, Math.min(1, dt * 12));

    // паливо
    const speedFrac = (this.scrollSpeed - this.minSpeed) / (this.maxSpeed - this.minSpeed);
    this.fuel -= (FUEL_DRAIN_BASE + (FUEL_DRAIN_MAX - FUEL_DRAIN_BASE) * speedFrac) * dt;
    if (this.fuel <= 0) {
      this.fuel = 0;
      this.crashPlayer();
    }

    if (this.invulnTimer > 0) {
      this.invulnTimer -= dt;
      this.player.setAlpha(Math.floor(this.invulnTimer * 10) % 2 === 0 ? 0.3 : 1);
      if (this.invulnTimer <= 0) this.player.setAlpha(1);
    }

    if (this.levelFlashTimer > 0) {
      this.levelFlashTimer -= dt;
      if (this.levelFlashTimer <= 0) { this.centerMsg.setText(''); this.subMsg.setText(''); }
    }

    this.drawTerrain();
    this.updateBridgeVisuals(scrollDelta, dt);
    this.updateDecoImages(scrollDelta);
    this.updateEnemies(scrollDelta, dt);
    this.updateFuels(scrollDelta, dt);
    this.updateTanks(scrollDelta, dt);
    this.updateTankBullets(dt);
    this.updateHeliBullets(dt);
    this.updateBalloons(scrollDelta, dt);
    this.updateSpawners(dt);
    this.updateMissiles(dt);
    this.updateExplosions(dt);
    this.handleShooting();
    this.checkPlayerCollisions();

    this.updateHUD();
  }

  // -------------------------------------------------------------------
  drawTerrain() {
    const g = this.terrainGfx;
    g.clear();
    g.fillStyle(COL.landGreen, 1);
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      const y = i * ROW_H + this.scrollAccum;
      if (y > H + ROW_H || y < -ROW_H * 2) continue;
      g.fillRect(0, y, row.left, ROW_H + 1);
      g.fillRect(row.right, y, W - row.right, ROW_H + 1);
      if (row.islandLeft != null) {
        g.fillRect(row.islandLeft, y, row.islandRight - row.islandLeft, ROW_H + 1);
      }
    }

    // жовтий пісок біля води — вузька смуга змінної ширини (0-32px, ніде не
    // паралельна воді — «дихає» незалежно по кожному рядку, часом зникає
    // зовсім), намальована ПОВЕРХ зеленого, впритул до самої води. sandA —
    // краї, де суша ЗЛІВА від лінії води (головний лівий берег і правий
    // край острова); sandB — краї, де суша СПРАВА (головний правий берег і
    // лівий край острова). Ширина завжди притиснута до наявної суші, щоб не
    // вилазити ні у воду, ні за екран.
    g.fillStyle(COL.sand, 1);
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      const y = i * ROW_H + this.scrollAccum;
      if (y > H + ROW_H || y < -ROW_H * 2) continue;

      const wLeftBank = Math.min(row.sandA, row.left);
      if (wLeftBank > 0.5) g.fillRect(row.left - wLeftBank, y, wLeftBank, ROW_H + 1);

      const wRightBank = Math.min(row.sandB, W - row.right);
      if (wRightBank > 0.5) g.fillRect(row.right, y, wRightBank, ROW_H + 1);

      if (row.islandLeft != null) {
        const islandW = row.islandRight - row.islandLeft;
        const wIslandLeftEdge = Math.min(row.sandB, islandW); // краю островa, що дивиться в лівий канал
        if (wIslandLeftEdge > 0.5) g.fillRect(row.islandLeft, y, wIslandLeftEdge, ROW_H + 1);
        const wIslandRightEdge = Math.min(row.sandA, islandW); // краю острова, що дивиться в правий канал
        if (wIslandRightEdge > 0.5) g.fillRect(row.islandRight - wIslandRightEdge, y, wIslandRightEdge, ROW_H + 1);
      }
    }

    // тонка світліша лінія на межі берега для контрасту (косметика)
    g.lineStyle(1, COL.landGreenEdge, 0.5);
  }

  // Дерева/кущі більше НЕ малюються тут через Graphics щокадру — це готові
  // PNG-іконки (tree1/tree2/bush1/bush2), кожна з яких живе як окремий
  // Image-об'єкт, що спавниться разом зі своїм рядком рельєфу
  // (spawnDecoImages) і рухається неперервно через updateDecoImages(), як і
  // решта сутностей (fuel/tanks/balloons). Причина: Graphics не вміє
  // малювати растрові картинки, лише примітиви (прямокутники/кола).

  // створює Image-об'єкти для decoLeft/decoRight щойно з'явленого рядка
  // (викликається і для початкового заповнення this.rows, і для кожного
  // нового рядка під час скролу). y — поточна екранна Y-координата рядка
  // в момент спавну.
  spawnDecoImages(row, y) {
    if (row.decoLeft) {
      const dx = row.left - row.decoLeft.inset;
      const key = (row.decoLeft.tree ? DECO_TREE_KEYS : DECO_BUSH_KEYS)[row.decoLeft.variant];
      row.decoLeft.img = this.add.image(dx, y + 6, key).setDepth(3);
    }
    if (row.decoRight) {
      const dx = row.right + row.decoRight.inset;
      const key = (row.decoRight.tree ? DECO_TREE_KEYS : DECO_BUSH_KEYS)[row.decoRight.variant];
      row.decoRight.img = this.add.image(dx, y + 6, key).setDepth(3);
    }
  }

  // прибирає Image-об'єкти decoLeft/decoRight рядка (якщо вони ще живі —
  // гравець міг уже підстрелити дерево/кущ раніше, тоді row.decoLeft вже
  // null і чіпати нічого не треба)
  destroyRowDecoImages(row) {
    if (row.decoLeft && row.decoLeft.img) row.decoLeft.img.destroy();
    if (row.decoRight && row.decoRight.img) row.decoRight.img.destroy();
  }

  // неперервний рух картинок дерев/кущів разом зі скролом — той самий
  // патерн, що й для fuel/tanks/balloons (entity.y += scrollDelta), а не
  // перерахунок з індексу рядка щокадру
  updateDecoImages(scrollDelta) {
    for (const row of this.rows) {
      if (row.decoLeft && row.decoLeft.img) row.decoLeft.img.y += scrollDelta;
      if (row.decoRight && row.decoRight.img) row.decoRight.img.y += scrollDelta;
    }
  }

  spawnBridgeVisual(bridge) {
    // рухаємо міст тим самим неперервним скролом, що й інші сутності —
    // це прибирає "сіпання", яке було при прив'язці до індексу рядка рельєфу.
    bridge.visualY = this.scrollAccum + ROW_H * 1.5;
    const width = bridge.right - bridge.left;
    const tileImg = this.add.tileSprite(bridge.left, bridge.visualY, width, 16, 'bridgeTile').setOrigin(0, 0.5).setDepth(5);
    const towerL = this.add.image(bridge.left, bridge.visualY, 'bridgeTower').setOrigin(1, 0.5).setDepth(6);
    const towerR = this.add.image(bridge.right, bridge.visualY, 'bridgeTower').setOrigin(0, 0.5).setDepth(6).setFlipX(true);
    this.bridgeVisuals.set(bridge, { tileImg, towerL, towerR, bridge });

    // танк: як в оригіналі, спочатку їде по дорозі на березі, і тільки
    // потім заїжджає на сам міст і перетинає його. Якщо встигнути знищити
    // міст ДО того, як танк доїхав по мосту до кінця — очки потроюються,
    // а сам танк гине разом з мостом (destroyBridgeTank).
    if (width > 70) {
      bridge.tankAlive = true;
      bridge.tankOnBridge = false; // ще на "дорозі", чи вже заїхав на проліт
      bridge.tankProgress = 0;
      bridge.tankDir = Phaser.Math.Between(0, 1) === 0 ? 1 : -1;
      // дорога довжиною ROAD_LEN до краю мосту, обрізана екраном, якщо
      // берег вузький
      const ROAD_LEN = 90;
      bridge.tankStartX = bridge.tankDir === 1
        ? Math.max(0, bridge.left - ROAD_LEN)
        : Math.min(W, bridge.right + ROAD_LEN);
      bridge.tankEndX = bridge.tankDir === 1 ? bridge.right - 16 : bridge.left + 16;
      bridge.tankSpeed = 70; // px/сек, уздовж усього шляху (дорога + міст)
      const tankImg = this.add.image(bridge.tankStartX, bridge.visualY - 7, 'tank').setDepth(7).setScale(TANK_SCALE * 1.1);
      tankImg.setFlipX(bridge.tankDir === -1);
      bridge.tankImg = tankImg;
    } else {
      bridge.tankAlive = false;
      bridge.tankImg = null;
    }
  }

  // Танк не встиг переїхати міст до того, як його знищили — гине разом з
  // мостом (вибух + звук), а не "застрягає" на воді, як раніше.
  destroyBridgeTank(bridge, score = 0) {
    if (!bridge.tankImg) return;
    this.spawnExplosion(bridge.tankImg.x, bridge.tankImg.y);
    SFX.explode();
    if (score) this.addScore(score);
    bridge.tankImg.destroy();
    bridge.tankImg = null;
    bridge.tankAlive = false;
  }

  updateBridgeVisuals(scrollDelta, dt) {
    for (const [bridge, v] of this.bridgeVisuals) {
      bridge.visualY += scrollDelta;
      v.tileImg.y = bridge.visualY; v.towerL.y = bridge.visualY; v.towerR.y = bridge.visualY;
      if (!bridge.alive) {
        v.tileImg.setAlpha(0.25);
        v.towerL.setAlpha(0.25);
        v.towerR.setAlpha(0.25);
      }

      if (bridge.tankAlive && bridge.tankImg) {
        if (!bridge.alive) {
          // міст зруйновано, поки танк ще їхав дорогою або мостом — гине
          // разом з мостом (safety net на випадок, якщо смерть мосту чомусь
          // не пройшла через resolveMissileCollision)
          this.destroyBridgeTank(bridge);
        } else {
          const span = Math.max(1, Math.abs(bridge.tankEndX - bridge.tankStartX));
          bridge.tankProgress += (bridge.tankSpeed * dt) / span;
          if (bridge.tankProgress >= 1) {
            // танк доїхав до кінця мосту і втік — бонус більше не отримати
            bridge.tankProgress = 1;
            bridge.tankAlive = false;
            bridge.tankImg.destroy();
            bridge.tankImg = null;
          } else {
            const x = Phaser.Math.Linear(bridge.tankStartX, bridge.tankEndX, bridge.tankProgress);
            bridge.tankImg.x = x;
            bridge.tankImg.y = bridge.visualY - 7;
            bridge.tankOnBridge = bridge.tankDir === 1 ? x >= bridge.left : x <= bridge.right;
          }
        }
      }

      if (bridge.visualY > H + 40) {
        v.tileImg.destroy(); v.towerL.destroy(); v.towerR.destroy();
        if (bridge.tankImg) bridge.tankImg.destroy();
        this.bridgeVisuals.delete(bridge);
      }
    }
  }

  // -------------------------------------------------------------------
  spawnEnemy() {
    const row = this.rows[3];
    if (!row) return;
    // трохи більше шансу на швидкий проліт ворожого літака (jet)
    const roll = Math.random();
    const type = roll < 0.32 ? 'heli' : roll < 0.6 ? 'ship' : 'jet';

    // не більше 3 ворогів кожного типу одночасно на екрані (щоб не рябіло на малій швидкості)
    const countOfType = this.enemies.reduce((n, e) => n + (e.type === type ? 1 : 0), 0);
    if (countOfType >= 3) return;

    let x0, x1;
    if (row.islandLeft != null && Phaser.Math.Between(0, 1) === 0) {
      x0 = row.left + 16; x1 = row.islandLeft - 16;
    } else if (row.islandLeft != null) {
      x0 = row.islandRight + 16; x1 = row.right - 16;
    } else {
      x0 = row.left + 16; x1 = row.right - 16;
    }
    if (x1 - x0 < 20) return;
    const x = Phaser.Math.Between(x0, x1);
    const y = -20;

    const img = this.add.image(x, y, type).setDepth(8);
    let vx = 0;
    if (type === 'jet') {
      img.setScale(JET_SCALE);
      const fromLeft = Phaser.Math.Between(0, 1) === 0;
      img.x = fromLeft ? -20 : W + 20;
      // картинка 'jet' за замовчуванням "дивиться" вліво (стара процедурна
      // текстура дивилась вправо) — тому тут напрямок flip інвертовано
      // відносно попередньої версії: fromLeft (летить управо) → flip=true
      img.setFlipX(fromLeft);
      vx = fromLeft ? 190 : -190;
    } else if (type === 'heli') {
      vx = 0;
      img.setScale(HELI_SCALE);
    } else if (type === 'ship') {
      vx = 0;
      img.setScale(SHIP_SCALE);
    }
    const enemy = { img, type, x: img.x, y, vx, phase: Math.random() * Math.PI * 2, alive: true, dir: Phaser.Math.Between(0, 1) === 0 ? 1 : -1 };
    if (type === 'heli') {
      // гелікоптери стріляють по гравцю, як в оригінальній River Raid
      enemy.fireTimer = Phaser.Math.FloatBetween(1.6, 2.8);
    }
    this.enemies.push(enemy);
  }

  spawnFuel() {
    if (this.fuels.length >= 3) return; // не більше 3 заправок одночасно на екрані
    const row = this.rows[3];
    if (!row) return;
    let x0, x1;
    if (row.islandLeft != null && Phaser.Math.Between(0, 1) === 0) {
      x0 = row.left + 14; x1 = row.islandLeft - 14;
    } else if (row.islandLeft != null) {
      x0 = row.islandRight + 14; x1 = row.right - 14;
    } else {
      x0 = row.left + 14; x1 = row.right - 14;
    }
    if (x1 - x0 < 16) return;
    const x = Phaser.Math.Between(x0, x1);
    // напис "FUEL" над бочкою прибрано — сама іконка бочки з паливом і так
    // впізнавана, окремий текстовий лейбл більше не потрібен
    const img = this.add.image(x, -20, 'fuel').setDepth(7).setScale(FUEL_SCALE);
    this.fuels.push({ img, x, y: -20, alive: true });
  }

  spawnShoreTank() {
    if (this.tanks.length >= 2) return; // не даємо танкам накопичуватись на екрані
    const row = this.rows[3];
    if (!row || row.bridge) return;
    const side = Phaser.Math.Between(0, 1) === 0 ? 'left' : 'right';
    // танк заїжджає з того краю екрана, з якого боку його берег
    const startX = side === 'left' ? 0 : W;
    const img = this.add.image(startX, -20, 'tank').setDepth(4).setScale(TANK_SCALE);
    if (side === 'right') img.setFlipX(true);
    this.tanks.push({
      img, side, x: startX, y: -20,
      // пряме посилання на "свій" рядок берега (left/right/decoLeft/decoRight
      // в ньому незмінні після створення) — надійніше за повторний пошук
      // через rowAtScreenY(t.y), бо той при від'ємному y (танк ще над
      // екраном) клампиться на "поточний" rows[0], який щокадру змінюється,
      // поки не з'явиться перший стабільний рядок
      row,
      atBank: false, // стріляє лише коли реально доїхав до берега
      fireTimer: Phaser.Math.FloatBetween(2.0, 3.4)
    });
  }

  updateSpawners(dt) {
    const diffFactor = Math.min(1, this.level / 8);
    this.enemyTimer -= dt;
    if (this.enemyTimer <= 0) {
      this.spawnEnemy();
      this.enemyTimer = Phaser.Math.FloatBetween(1.5 - diffFactor * 0.9, 2.6 - diffFactor * 1.2);
      this.enemyTimer = Math.max(0.55, this.enemyTimer);
    }
    this.fuelTimer -= dt;
    if (this.fuelTimer <= 0) {
      this.spawnFuel();
      this.fuelTimer = Phaser.Math.FloatBetween(2.75, 4.25); // вдвічі частіше, ніж раніше
    }
    this.tankTimer -= dt;
    if (this.tankTimer <= 0) {
      this.spawnShoreTank();
      this.tankTimer = Phaser.Math.FloatBetween(8.5 - diffFactor * 2.0, 13 - diffFactor * 3.0);
      this.tankTimer = Math.max(5.5, this.tankTimer);
    }
    this.balloonTimer -= dt;
    if (this.balloonTimer <= 0) {
      this.spawnBalloon();
      this.balloonTimer = Phaser.Math.FloatBetween(11, 17);
    }
  }

  updateEnemies(scrollDelta, dt) {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.alive) continue;
      e.y += scrollDelta;
      if (e.type === 'heli') {
        e.phase += dt * 2;
        const vx = Math.cos(e.phase) * 40;
        e.x += vx * dt;
        e.img.setFlipX(vx < 0);
        // стрільба по гравцю, поки гелікоптер видно на екрані — приціл
        // береться в момент пострілу (без самонаведення в польоті)
        if (e.y > 6 && e.y < H - 10) {
          e.fireTimer -= dt;
          if (e.fireTimer <= 0) {
            this.fireHeliShell(e);
            const diffFactor = Math.min(1, this.level / 8);
            e.fireTimer = Phaser.Math.FloatBetween(2.6 - diffFactor * 0.9, 4.2 - diffFactor * 1.3);
            e.fireTimer = Math.max(1.5, e.fireTimer);
          }
        }
      } else if (e.type === 'ship') {
        e.phase += dt;
        e.x += e.dir * 26 * dt;
        if (e.phase > 2.4) { e.dir *= -1; e.phase = 0; }
      } else if (e.type === 'jet') {
        e.x += e.vx * dt;
      }
      e.img.x = e.x;
      e.img.y = e.y;

      if (e.y > H + 40 || e.x < -60 || e.x > W + 60) {
        e.img.destroy();
        this.enemies.splice(i, 1);
      }
    }
  }

  updateFuels(scrollDelta, dt) {
    for (let i = this.fuels.length - 1; i >= 0; i--) {
      const f = this.fuels[i];
      f.y += scrollDelta;
      f.img.y = f.y;
      if (f.y > H + 40) { f.img.destroy(); this.fuels.splice(i, 1); continue; }

      // рефueling: гравець над станцією
      if (f.alive && this.invulnTimer <= 0) {
        const dx = Math.abs(this.player.x - f.x);
        const dy = Math.abs(PLAYER_Y - f.y);
        if (dx < 22 && dy < 20 && this.fuel < FUEL_MAX) {
          this.fuel = Math.min(FUEL_MAX, this.fuel + FUEL_REFILL_RATE * dt);
          if (Math.random() < 0.06) SFX.fuel();
        }
      }
    }
  }

  updateTanks(scrollDelta, dt) {
    const DRIVE_SPEED = 60; // px/сек — швидкість заїзду від краю екрана до берега
    const TREE_CLEARANCE = 20; // px — на скільки танк зупиняється, не доїжджаючи до дерева

    for (let i = this.tanks.length - 1; i >= 0; i--) {
      const t = this.tanks[i];
      t.y += scrollDelta;
      if (t.y > H + 40) { t.img.destroy(); this.tanks.splice(i, 1); continue; }

      // фіксований рядок, збережений при спавні (left/right/decoLeft/decoRight
      // в ньому не змінюються) — навмисно НЕ шукаємо через rowAtScreenY(t.y)
      // щокадру: біля від'ємного y це клампиться на "поточний" rows[0], який
      // щокадру змінюється, поки не з'явиться перший стабільний рядок, і
      // дерево, поставлене на "свій" рядок, могло взагалі не збігтися
      const row = t.row;
      if (row) {
        const bankX = t.side === 'left' ? row.left - 12 : row.right + 12;
        let targetX = bankX;

        // якщо на шляху від краю екрана до берега стоїть дерево — доїжджаємо
        // тільки до нього і застрягаємо там назавжди (доки танк не зникне)
        const deco = t.side === 'left' ? row.decoLeft : row.decoRight;
        if (deco && deco.tree) {
          const treeX = t.side === 'left' ? row.left - deco.inset : row.right + deco.inset;
          const blocked = t.side === 'left' ? (treeX < bankX) : (treeX > bankX);
          if (blocked) {
            let stopX = t.side === 'left' ? treeX - TREE_CLEARANCE : treeX + TREE_CLEARANCE;
            stopX = t.side === 'left' ? Math.max(0, stopX) : Math.min(W, stopX);
            targetX = stopX;
          }
        }

        if (t.side === 'left') t.x = Math.min(targetX, t.x + DRIVE_SPEED * dt);
        else t.x = Math.max(targetX, t.x - DRIVE_SPEED * dt);

        // "доїхав" вважається лише якщо реально дістався берега, а не
        // зупинився перед деревом
        t.atBank = Math.abs(t.x - bankX) < 1;
      }
      // синхронізуємо спрайт з x/y завжди, навіть без "row"
      t.img.x = t.x;
      t.img.y = t.y;

      if (t.atBank && t.y > 0 && t.y < H) {
        t.fireTimer -= dt;
        if (t.fireTimer <= 0) {
          this.fireTankShell(t);
          const diffFactor = Math.min(1, this.level / 8);
          t.fireTimer = Phaser.Math.FloatBetween(3.2 - diffFactor * 1.0, 5.0 - diffFactor * 1.4);
          t.fireTimer = Math.max(1.8, t.fireTimer);
        }
      }
    }
  }

  fireTankShell(t) {
    // як в оригіналі: постріл летить прямо через річку до протилежного берега,
    // а не прицілюється в літак — ухилятись можна, змістившись по горизонталі.
    // vy ЗАВЖДИ 0 і ніде більше не змінюється (updateTankBullets теж не додає
    // скрол до .y) — постріл виключно горизонтальний, без жодного відхилення.
    const speed = 200;
    const vx = t.side === 'left' ? speed : -speed;
    const img = this.add.image(t.x, t.y, 'tankShell').setDepth(9);
    this.tankBullets.push({ img, x: t.x, y: t.y, vx, vy: 0 });
    SFX.tankShot();
  }

  updateTankBullets(dt) {
    for (let i = this.tankBullets.length - 1; i >= 0; i--) {
      const b = this.tankBullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.img.x = b.x;
      b.img.y = b.y;

      if (b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) {
        b.img.destroy();
        this.tankBullets.splice(i, 1);
        continue;
      }

      if (this.invulnTimer <= 0 && Math.abs(b.x - this.player.x) < 11 && Math.abs(b.y - PLAYER_Y) < 13) {
        b.img.destroy();
        this.tankBullets.splice(i, 1);
        this.crashPlayer();
      }
    }
  }

  // гелікоптер стріляє СУВОРО ГОРИЗОНТАЛЬНО, як в оригінальній River Raid —
  // НЕ прицільна ракета по вертикалі (так було раніше, і це робило гру
  // надто складною). vy ЗАВЖДИ 0, так само як і в fireTankShell() — лише
  // напрямок (вліво/вправо) береться один раз у момент пострілу, залежно
  // від того, з якого боку зараз гравець.
  fireHeliShell(e) {
    const speed = 190;
    const vx = this.player.x >= e.x ? speed : -speed;
    const img = this.add.image(e.x, e.y, 'heliShell').setDepth(9);
    this.heliBullets.push({ img, x: e.x, y: e.y, vx, vy: 0 });
    SFX.heliShot();
  }

  updateHeliBullets(dt) {
    for (let i = this.heliBullets.length - 1; i >= 0; i--) {
      const b = this.heliBullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.img.x = b.x;
      b.img.y = b.y;

      if (b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) {
        b.img.destroy();
        this.heliBullets.splice(i, 1);
        continue;
      }

      if (this.invulnTimer <= 0 && Math.abs(b.x - this.player.x) < 11 && Math.abs(b.y - PLAYER_Y) < 13) {
        b.img.destroy();
        this.heliBullets.splice(i, 1);
        this.crashPlayer();
      }
    }
  }

  // -------------------------------------------------------------------
  spawnBalloon() {
    const row = this.rows[3];
    if (!row) return;
    let x0, x1;
    if (row.islandLeft != null && Phaser.Math.Between(0, 1) === 0) {
      x0 = row.left + 16; x1 = row.islandLeft - 16;
    } else if (row.islandLeft != null) {
      x0 = row.islandRight + 16; x1 = row.right - 16;
    } else {
      x0 = row.left + 16; x1 = row.right - 16;
    }
    if (x1 - x0 < 20) return;
    const x = Phaser.Math.Between(x0, x1);

    // T/M/D частіше, F трохи рідше, N (ядерка) і X (життя) — рідкісний джекпот
    const pool = ['T', 'T', 'M', 'M', 'D', 'D', 'F', 'F', 'N', 'X'];
    const letter = pool[Phaser.Math.Between(0, pool.length - 1)];

    const img = this.add.image(x, -24, 'balloon').setDepth(7).setScale(BALLOON_SCALE);
    const label = this.add.text(x, -30, letter, {
      fontFamily: 'Courier New, monospace', fontSize: '13px', fontStyle: 'bold', color: '#ffffff', stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5).setDepth(8);
    this.balloons.push({ img, label, letter, x, y: -24, phase: Math.random() * Math.PI * 2 });
  }

  updateBalloons(scrollDelta, dt) {
    for (let i = this.balloons.length - 1; i >= 0; i--) {
      const b = this.balloons[i];
      b.y += scrollDelta;
      b.phase += dt;
      b.x += Math.sin(b.phase) * 8 * dt;
      b.img.x = b.x; b.img.y = b.y;
      b.label.x = b.x; b.label.y = b.y - 6;

      if (b.y > H + 40) {
        b.img.destroy(); b.label.destroy();
        this.balloons.splice(i, 1);
      }
    }
  }

  collectBalloon(b, idx) {
    const letter = b.letter;
    this.addScore(40);
    this.spawnExplosion(b.x, b.y);
    b.img.destroy();
    b.label.destroy();
    this.balloons.splice(idx, 1);

    if (letter === 'F') {
      this.fuel = FUEL_MAX;
      SFX.fuel();
    } else if (letter === 'N') {
      this.nukeAllEnemies();
    } else if (letter === 'X') {
      this.lives++;
      SFX.extraLife();
    } else if (letter === 'M') {
      // якщо самонавідні ракети вже активні й лічильник ще не вичерпаний —
      // додаємо ЗВЕРХУ наявної кількості; інакше (перший підбір або
      // лічильник уже дійшов до нуля) — стартуємо заново з HOMING_BONUS_AMOUNT
      if (this.activePower === 'missile' && this.homingCount > 0) {
        this.homingCount += HOMING_BONUS_AMOUNT;
      } else {
        this.homingCount = HOMING_BONUS_AMOUNT;
      }
      this.activePower = 'missile';
      SFX.life();
    } else {
      this.activePower = letter === 'T' ? 'triple' : 'double';
      SFX.life();
    }
  }

  nukeAllEnemies() {
    for (const e of this.enemies) {
      this.spawnExplosion(e.x, e.y);
      e.img.destroy();
      this.addScore({ heli: 60, ship: 30, jet: 100 }[e.type] || 50);
    }
    this.enemies = [];
    for (const t of this.tanks) {
      this.spawnExplosion(t.x, t.y);
      t.img.destroy();
      this.addScore(70);
    }
    this.tanks = [];
    for (const b of this.tankBullets) b.img.destroy();
    this.tankBullets = [];
    for (const b of this.heliBullets) b.img.destroy();
    this.heliBullets = [];
    SFX.explode();
  }

  handleShooting() {
    if (!Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) return;

    if (this.activePower === 'double') {
      if (this.missiles.length >= 2) return;
      this.spawnMissile(0, -MISSILE_SPEED, true);
    } else if (this.activePower === 'triple') {
      if (this.missiles.length > 0) return;
      this.spawnMissile(0, -MISSILE_SPEED, true);   // звичайний постріл вперед
      this.spawnMissile(-MISSILE_SPEED, 0, false);  // спеціальний вліво
      this.spawnMissile(MISSILE_SPEED, 0, false);   // спеціальний вправо
    } else if (this.activePower === 'missile') {
      if (this.missiles.length > 0) return;
      this.spawnMissile(0, -MISSILE_SPEED, true);   // звичайний постріл залишається
      this.spawnHomingMissile(-1);                  // + самонавідні з боків
      this.spawnHomingMissile(1);
      // лічильник зменшується на 1 за ВЕСЬ постріл (не за кожну з двох
      // ракет окремо) — коли доходить до нуля, бонус закінчується і
      // наступний постріл буде вже звичайним, як на початку гри
      this.homingCount--;
      if (this.homingCount <= 0) {
        this.homingCount = 0;
        this.activePower = null;
      }
    } else {
      if (this.missiles.length > 0) return;
      this.spawnMissile(0, -MISSILE_SPEED, true);
    }
    SFX.shoot();
  }

  spawnMissile(vx, vy, isNormal = true) {
    const sideways = vx !== 0;
    const offsetX = sideways ? (vx < 0 ? -13 : 13) : 0;
    const startX = this.player.x + offsetX;
    const startY = sideways ? PLAYER_Y - 4 : PLAYER_Y - 20;
    const img = this.add.image(startX, startY, 'missile').setDepth(9);
    if (sideways) img.setAngle(vx < 0 ? -90 : 90);
    this.missiles.push({ img, x: startX, y: startY, vx, vy, homing: false, target: null, normal: isNormal });
  }

  spawnHomingMissile(side) {
    const startX = this.player.x + side * 13;
    const startY = PLAYER_Y - 8;
    const target = this.findNearestTarget(startX, startY);
    let vx = 0, vy = -MISSILE_SPEED;
    if (target) {
      const d = Math.max(1, Math.hypot(target.x - startX, target.y - startY));
      vx = (target.x - startX) / d * MISSILE_SPEED;
      vy = (target.y - startY) / d * MISSILE_SPEED;
    }
    // готова іконка ('homingMissile'), а не процедурна текстура 'missile' —
    // ніс дивиться вгору за замовчуванням, так само як і стара процедурна,
    // тож формула повороту (rotation = atan2(vy,vx) + PI/2) не змінювалась
    const img = this.add.image(startX, startY, 'homingMissile').setDepth(9).setScale(HOMING_MISSILE_SCALE);
    img.rotation = Math.atan2(vy, vx) + Math.PI / 2;
    // самонавідні ракети — спеціальна зброя, кулі-бонуси не чіпають
    this.missiles.push({ img, x: startX, y: startY, vx, vy, homing: true, target, normal: false });
  }

  findNearestTarget(x, y) {
    let best = null, bestDist = Infinity;
    for (const e of this.enemies) {
      const d = Phaser.Math.Distance.Between(x, y, e.x, e.y);
      if (d < bestDist) { bestDist = d; best = e; }
    }
    for (const t of this.tanks) {
      const d = Phaser.Math.Distance.Between(x, y, t.x, t.y);
      if (d < bestDist) { bestDist = d; best = t; }
    }
    return best;
  }

  isTargetAlive(target) {
    return this.enemies.includes(target) || this.tanks.includes(target);
  }

  updateMissiles(dt) {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];

      if (m.homing) {
        if (!m.target || !this.isTargetAlive(m.target)) {
          m.target = this.findNearestTarget(m.x, m.y);
        }
        if (m.target) {
          const d = Math.max(1, Math.hypot(m.target.x - m.x, m.target.y - m.y));
          m.vx = (m.target.x - m.x) / d * MISSILE_SPEED;
          m.vy = (m.target.y - m.y) / d * MISSILE_SPEED;
          m.img.rotation = Math.atan2(m.vy, m.vx) + Math.PI / 2;
        }
      }

      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.img.x = m.x;
      m.img.y = m.y;

      if (m.x < -30 || m.x > W + 30 || m.y < -30 || m.y > H + 30) {
        m.img.destroy();
        this.missiles.splice(i, 1);
        continue;
      }

      if (this.resolveMissileCollision(m)) {
        this.missiles.splice(i, 1);
      }
    }
  }

  resolveMissileCollision(m) {
    const mx = m.x, my = m.y;

    // влучання по ворогах — хітбокс по реальних непрозорих пікселях іконки
    // (pixelHit), а не по прямокутнику "на око"
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (pixelHit(e.img, mx, my)) {
        this.destroyEnemy(e, i);
        m.img.destroy();
        return true;
      }
    }

    // влучання по паливній станції
    for (let i = 0; i < this.fuels.length; i++) {
      const f = this.fuels[i];
      if (pixelHit(f.img, mx, my)) {
        this.destroyFuel(f, i);
        m.img.destroy();
        return true;
      }
    }

    // влучання по танку на березі
    for (let i = 0; i < this.tanks.length; i++) {
      const t = this.tanks[i];
      if (pixelHit(t.img, mx, my)) {
        this.destroyTank(t, i);
        m.img.destroy();
        return true;
      }
    }

    // влучання по дереву/кущу на березі — тепер їх можна знищувати, і теж
    // по реальних пікселях картинки (не по грубому прямокутнику). Швидкий
    // грубий відсів по Y лишається — щоб не гонити pixelHit по КОЖНОМУ
    // рядку масиву щоразу, а тільки по тих, що фізично близько до пострілу.
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      const y = i * ROW_H + this.scrollAccum;
      if (Math.abs(my - (y + 6)) > 22) continue;
      if (row.decoLeft && row.decoLeft.img && pixelHit(row.decoLeft.img, mx, my)) {
        const img = row.decoLeft.img;
        this.destroyDeco(row, 'decoLeft', img.x, img.y);
        m.img.destroy();
        return true;
      }
      if (row.decoRight && row.decoRight.img && pixelHit(row.decoRight.img, mx, my)) {
        const img = row.decoRight.img;
        this.destroyDeco(row, 'decoRight', img.x, img.y);
        m.img.destroy();
        return true;
      }
    }

    // влучання по повітряній кулі-бонусу — тільки звичайний постріл,
    // спеціальна зброя (бокові/самонавідні постріли) кулі ігнорує
    for (let i = 0; m.normal && i < this.balloons.length; i++) {
      const b = this.balloons[i];
      if (pixelHit(b.img, mx, my)) {
        this.collectBalloon(b, i);
        m.img.destroy();
        return true;
      }
    }

    // влучання по танку на мосту (окремо від самого мосту — знімає бонус x3)
    for (const [bridge] of this.bridgeVisuals) {
      if (bridge.tankAlive && bridge.tankImg && pixelHit(bridge.tankImg, mx, my)) {
        this.addScore(80);
        this.spawnExplosion(bridge.tankImg.x, bridge.tankImg.y);
        SFX.explode();
        bridge.tankImg.destroy();
        bridge.tankImg = null;
        bridge.tankAlive = false;
        m.img.destroy();
        return true;
      }
    }

    // влучання по мосту
    const row = this.rowAtScreenY(my);
    if (row && row.bridge && row.bridge.alive) {
      const bridge = row.bridge;
      // бонус x3 лише якщо танк реально ВЖЕ був на прольоті мосту (не на
      // дорозі до нього) в момент вибуху
      const tankBonus = bridge.tankAlive && bridge.tankOnBridge;
      const tankStillEnRoute = bridge.tankAlive; // не встиг втекти взагалі
      bridge.alive = false;
      bridge.hp = 0;
      this.addScore(tankBonus ? 500 * 3 : 500);
      this.spawnExplosion(mx, my);
      SFX.bridge();
      m.img.destroy();
      this.advanceLevel();
      if (tankBonus) {
        this.centerMsg.setText('LEVEL ' + this.level + '\nТАНК НА МОСТУ! x3 ОЧОК');
        this.levelFlashTimer = 1.9;
      }
      // танк гине разом з мостом, якщо ще не встиг проїхати (був на дорозі
      // чи на прольоті); якщо це саме той момент, коли бонус x3 нарахований
      // за танк на прольоті — окремих очок за сам танк вже не додаємо
      if (tankStillEnRoute) this.destroyBridgeTank(bridge, tankBonus ? 0 : 80);
      return true;
    }

    return false;
  }

  destroyTank(t, idx) {
    this.addScore(70);
    this.spawnExplosion(t.x, t.y);
    SFX.explode();
    t.img.destroy();
    this.tanks.splice(idx, 1);
  }

  destroyEnemy(e, idx) {
    const points = { heli: 60, ship: 30, jet: 100 }[e.type] || 50;
    this.addScore(points);
    this.spawnExplosion(e.x, e.y);
    SFX.explode();
    e.img.destroy();
    this.enemies.splice(idx, 1);
  }

  // знищує дерево/кущ на березі: прибирає його з рядка рельєфу (drawTerrain
  // більше його не намалює), дає трохи очок і невеликий вибух. Танки, що ще
  // не доїхали до цього дерева, вже наступного кадру зможуть проїхати далі,
  // бо updateTanks() перевіряє deco саме через row.decoLeft/decoRight.
  destroyDeco(row, key, x, y) {
    const wasTree = row[key].tree;
    if (row[key].img) row[key].img.destroy();
    row[key] = null;
    this.addScore(wasTree ? 30 : 15);
    this.spawnExplosion(x, y);
    SFX.chop();
  }

  destroyFuel(f, idx) {
    this.addScore(80);
    this.spawnExplosion(f.x, f.y);
    SFX.explode();
    f.img.destroy();
    this.fuels.splice(idx, 1);
  }

  spawnExplosion(x, y) {
    // єдина картинка вибуху (текстура 'explo'): "росте" від маленької до
    // повного розміру й назад, весь час обертаючись за годинниковою
    // стрілкою — сама анімація рахується вручну по dt в updateExplosions()
    // (state зберігається в this.explosions[]), а не Phaser-твіном, щоб
    // лишатись у тому самому патерні ручного per-frame оновлення, що й
    // решта сутностей гри.
    const img = this.add.image(x, y, 'explo').setDepth(15).setScale(EXPLO_START_SCALE).setAngle(0);
    this.explosions.push({ img, t: 0 });
  }

  updateExplosions(dt) {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const ex = this.explosions[i];
      ex.t += dt;
      if (ex.t > EXPLO_DURATION) { ex.img.destroy(); this.explosions.splice(i, 1); continue; }
      const frac = ex.t / EXPLO_DURATION; // 0..1
      // трикутний профіль розміру: перша половина тривалості — ріст від
      // START_SCALE до PEAK_SCALE, друга половина — зменшення назад до
      // START_SCALE (не до нуля, щоб вибух не "зникав" різким стрибком)
      const growFrac = frac < 0.5 ? frac / 0.5 : 1 - (frac - 0.5) / 0.5;
      ex.img.setScale(EXPLO_START_SCALE + (EXPLO_PEAK_SCALE - EXPLO_START_SCALE) * growFrac);
      // обертання йде МОНОТОННО (завжди в один бік, за годинниковою
      // стрілкою) увесь час життя вибуху — це окремий від scale процес, він
      // НЕ "відкочується" назад під час фази зменшення
      ex.img.angle = EXPLO_ROTATION_SPEED * ex.t;
    }
  }

  addScore(v) {
    this.score += v;
    if (this.score >= this.nextExtraLife) {
      this.lives++;
      this.nextExtraLife += EXTRA_LIFE_STEP;
      SFX.life();
    }
  }

  advanceLevel() {
    this.level++;
    this.terrainGen.setLevel(this.level);
    const speedMultiplier = 1 + 0.1 * (this.level - 1);
    this.minSpeed = MIN_SPEED * speedMultiplier;
    this.maxSpeed = BASE_MAX_SPEED * speedMultiplier;
    this.scrollSpeed = Math.max(this.scrollSpeed, this.minSpeed);
    this.centerMsg.setText('LEVEL ' + this.level);
    this.subMsg.setText('');
    this.levelFlashTimer = 1.4;
  }

  // -------------------------------------------------------------------
  checkPlayerCollisions() {
    if (this.invulnTimer > 0) return;

    // берег / острів / міст
    const samples = [PLAYER_Y - 12, PLAYER_Y, PLAYER_Y + 12];
    for (const sy of samples) {
      const row = this.rowAtScreenY(sy);
      if (!this.isChannelSafe(row, this.player.x, PLAYER_HALF_W)) {
        this.crashPlayer();
        return;
      }
    }

    // зіткнення з ворогами
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const hw = e.type === 'ship' ? 24 : e.type === 'jet' ? 18 : 13;
      if (Math.abs(this.player.x - e.x) < hw + PLAYER_HALF_W - 4 && Math.abs(PLAYER_Y - e.y) < 14) {
        this.spawnExplosion(e.x, e.y);
        e.img.destroy();
        this.enemies.splice(this.enemies.indexOf(e), 1);
        this.crashPlayer();
        return;
      }
    }
  }

  crashPlayer() {
    if (this.invulnTimer > 0 || this.state !== 'playing') return;
    SFX.crash();
    this.spawnExplosion(this.player.x, PLAYER_Y);
    this.lives--;
    for (const m of this.missiles) m.img.destroy();
    this.missiles = [];
    // бонус пострілів діє до втрати життя — після краху скидається
    this.activePower = null;
    this.homingCount = 0;

    if (this.lives < 0) {
      this.gameOver();
      return;
    }
    this.player.x = W / 2;
    this.player.angle = 0;
    this.fuel = FUEL_MAX;
    this.scrollSpeed = CRUISE_SPEED * 0.7;
    this.invulnTimer = INVULN_TIME;
  }

  gameOver() {
    this.state = 'gameover';
    this.centerMsg.setText('ГРА ВСЬО');
    this.subMsg.setText('SCORE ' + this.score + '\n\nSPACE — ще раз');
    this.player.setVisible(false);
  }
}

// ---------------------------------------------------------------------------
// КОНФІГ ТА СТАРТ
// ---------------------------------------------------------------------------
const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: W,
  height: H,
  backgroundColor: '#000000',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [BootScene, TitleScene, GameScene]
};

window.addEventListener('load', () => {
  window.game = new Phaser.Game(config);
});
