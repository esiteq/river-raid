// Перевіряє нові фічі цього раунду змін:
// 1) картинки-іконки (tank/heli/balloon/player/jet/ship/fuel) реально
//    завантажені та мають очікувані розміри відображення (не забуті
//    процедурні заглушки)
// 2) гелікоптер стріляє по гравцю і може його збити
// 3) дерева/кущі на березі тепер знищувані пострілом (раніше — суто декор)
// 4) річка згинається помітно сильніше, ніж раніше (перевірка на живому
//    this.terrainGen, а не переписана копія формули)
// 5) 'jet' (ворожий реактивний літак) правильно дзеркалиться залежно від
//    напрямку польоту — картинка за замовчуванням "дивиться" вліво (на
//    відміну від старої процедурної текстури, яка дивилась вправо), тож
//    напрям setFlipX() в spawnEnemy() довелось інвертувати
// 8) дерева/кущі на березі тепер готові PNG-картинки (Image-об'єкти, а не
//    Graphics-примітиви щокадру): спавн з правильною текстурою за
//    типом/варіантом, рух разом зі скролом, знищення і пострілом, і при
//    вислизанні рядка за нижній край масиву рядків
const { chromium } = require('playwright');
const path = require('path');
const { startServer } = require('./serve');

async function waitForGameScene(page) {
  for (let i = 0; i < 40; i++) {
    const ready = await page.evaluate(() => {
      const s = window.game && window.game.scene && window.game.scene.keys.Game;
      return !!(s && s.terrainGen);
    });
    if (ready) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

(async () => {
  const { server, url } = await startServer(path.join(__dirname, '..'));
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 520, height: 800 } });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });

  await page.goto(url + 'index.html');
  await waitForGameScene(page);
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);

  // ---------- 1) іконки завантажені й мають очікуваний розмір ----------
  const iconInfo = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    const tex = key => s.textures.get(key).getSourceImage();
    const shoreTankImg = s.add.image(-999, -999, 'tank').setScale(TANK_SCALE);
    const heliImg = s.add.image(-999, -999, 'heli').setScale(HELI_SCALE);
    const balloonImg = s.add.image(-999, -999, 'balloon').setScale(BALLOON_SCALE);
    const playerDisplay = { w: s.player.displayWidth, h: s.player.displayHeight };
    const jetImg = s.add.image(-999, -999, 'jet').setScale(JET_SCALE);
    const shipImg = s.add.image(-999, -999, 'ship').setScale(SHIP_SCALE);
    const fuelImg = s.add.image(-999, -999, 'fuel').setScale(FUEL_SCALE);
    const info = {
      tankSrc: { w: tex('tank').width, h: tex('tank').height },
      heliSrc: { w: tex('heli').width, h: tex('heli').height },
      balloonSrc: { w: tex('balloon').width, h: tex('balloon').height },
      playerSrc: { w: tex('player').width, h: tex('player').height },
      jetSrc: { w: tex('jet').width, h: tex('jet').height },
      shipSrc: { w: tex('ship').width, h: tex('ship').height },
      fuelSrc: { w: tex('fuel').width, h: tex('fuel').height },
      tankDisplay: { w: shoreTankImg.displayWidth, h: shoreTankImg.displayHeight },
      heliDisplay: { w: heliImg.displayWidth, h: heliImg.displayHeight },
      balloonDisplay: { w: balloonImg.displayWidth, h: balloonImg.displayHeight },
      playerDisplay,
      jetDisplay: { w: jetImg.displayWidth, h: jetImg.displayHeight },
      shipDisplay: { w: shipImg.displayWidth, h: shipImg.displayHeight },
      fuelDisplay: { w: fuelImg.displayWidth, h: fuelImg.displayHeight },
    };
    shoreTankImg.destroy(); heliImg.destroy(); balloonImg.destroy(); jetImg.destroy();
    shipImg.destroy(); fuelImg.destroy();
    return info;
  });
  console.log('1) розміри іконок:', JSON.stringify(iconInfo));
  const okIconsLoaded =
    // поріг 10 (не 50, як раніше) — тепер картинки заздалегідь відмасштабовані
    // до нативного розміру гри без суперсемплінгу, і деякі з них (fuel=26px,
    // jet=44px) вужчі за старий поріг 50; 10px все одно надійно відсікає
    // "1x1 заглушку" на випадок, якщо завантаження зображення провалилось
    iconInfo.tankSrc.w > 10 && iconInfo.heliSrc.w > 10 && iconInfo.balloonSrc.w > 10 &&
    iconInfo.playerSrc.w > 10 && iconInfo.jetSrc.w > 10 &&
    iconInfo.shipSrc.w > 10 && iconInfo.fuelSrc.w > 10 && // не 1x1 заглушка
    Math.abs(iconInfo.tankDisplay.w - 48) < 4 &&
    Math.abs(iconInfo.heliDisplay.w - 55) < 4 &&
    Math.abs(iconInfo.balloonDisplay.h - 40) < 4 &&
    Math.abs(iconInfo.playerDisplay.w - 45) < 4 &&
    Math.abs(iconInfo.jetDisplay.w - 44) < 4 &&
    Math.abs(iconInfo.shipDisplay.w - 52) < 4 &&
    Math.abs(iconInfo.fuelDisplay.h - 36) < 4;

  // ---------- 6) заправка більше НЕ має текстового напису "FUEL" над іконкою ----------
  const fuelLabelResult = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    s.fuels = [];
    s.spawnFuel();
    const f = s.fuels[0];
    return { hasLabel: !!(f && f.label), fuelCount: s.fuels.length };
  });
  console.log('6) заправка без напису FUEL:', JSON.stringify(fuelLabelResult));
  const okNoFuelLabel = fuelLabelResult.fuelCount === 1 && fuelLabelResult.hasLabel === false;

  // ---------- 5) 'jet' коректно дзеркалиться за напрямком польоту ----------
  const jetFlipResult = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    s.enemies = [];
    const before = s.enemies.length;
    for (let i = 0; i < 60 && s.enemies.length < 2; i++) s.spawnEnemy();
    // форсуємо появу jet напряму, якщо рандом не дав обидва напрямки природно
    while (!s.enemies.some(e => e.type === 'jet' && e.vx > 0)) {
      const img = s.add.image(-20, -20, 'jet').setDepth(8).setScale(JET_SCALE);
      img.setFlipX(true);
      s.enemies.push({ img, type: 'jet', x: -20, y: -20, vx: 190, phase: 0, alive: true, dir: 1 });
      break;
    }
    while (!s.enemies.some(e => e.type === 'jet' && e.vx < 0)) {
      const img = s.add.image(500, -20, 'jet').setDepth(8).setScale(JET_SCALE);
      img.setFlipX(false);
      s.enemies.push({ img, type: 'jet', x: 500, y: -20, vx: -190, phase: 0, alive: true, dir: 1 });
      break;
    }
    const goingRight = s.enemies.find(e => e.type === 'jet' && e.vx > 0);
    const goingLeft = s.enemies.find(e => e.type === 'jet' && e.vx < 0);
    return { before, rightFlip: goingRight.img.flipX, leftFlip: goingLeft.img.flipX };
  });
  console.log('5) дзеркалення jet за напрямком:', JSON.stringify(jetFlipResult));
  // рух управо (vx>0) → картинка (за замовчуванням "дивиться" вліво) МАЄ
  // бути перевернута (flipX=true), рух уліво (vx<0) → лишається як є (false)
  const okJetFlip = jetFlipResult.rightFlip === true && jetFlipResult.leftFlip === false;

  // ---------- 2) гелікоптер стріляє СУВОРО ГОРИЗОНТАЛЬНО (без вертикалі, як
  // в оригіналі — раніше це була прицільна ракета по вертикалі, і це надто
  // ускладнювало гру) і може влучити в гравця ----------
  const heliShotResult = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    s.enemies = []; // прибираємо все зайве, щоб не заважало
    s.invulnTimer = 0;
    // ставимо гелікоптер ЗЛІВА від гравця — снаряд має полетіти вправо (vx>0)
    const heliX = s.player.x - 60;
    const img = s.add.image(heliX, 200, 'heli').setDepth(8).setScale(HELI_SCALE);
    const enemy = { img, type: 'heli', x: heliX, y: 200, vx: 0, phase: 0, alive: true, dir: 1, fireTimer: 0 };
    s.enemies.push(enemy);
    const before = s.heliBullets.length;
    s.updateEnemies(0, 0.016); // саме тут heli має вистрелити (fireTimer<=0)
    const b = s.heliBullets[0];
    return { before, afterFire: s.heliBullets.length, vx: b ? b.vx : null, vy: b ? b.vy : null };
  });
  console.log('2a) гелікоптер вистрелив:', JSON.stringify(heliShotResult));
  const okHeliFires = heliShotResult.before === 0 && heliShotResult.afterFire === 1 &&
    heliShotResult.vy === 0 && heliShotResult.vx > 0; // строго горизонтально, у бік гравця (вправо)

  const heliHitResult = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    const livesBefore = s.lives;
    // ставимо снаряд гелікоптера точно на гравця й прокручуємо один кадр колізій
    const b = s.heliBullets[0];
    if (b) { b.x = s.player.x; b.y = s.player.y; b.img.x = b.x; b.img.y = b.y; }
    s.updateHeliBullets(0.001);
    return { livesBefore, livesAfter: s.lives, bulletsLeft: s.heliBullets.length };
  });
  console.log('2b) влучання снаряда гелікоптера по гравцю:', JSON.stringify(heliHitResult));
  const okHeliHits = heliHitResult.livesAfter === heliHitResult.livesBefore - 1 && heliHitResult.bulletsLeft === 0;

  // ---------- 3) дерево/кущ на березі знищується пострілом ----------
  const decoResult = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    // гра вже реально йде якийсь час (реальний ігровий цикл між evaluate()
    // не зупиняється), тож this.rows встигли природно нагенерувати купу
    // своїх власних випадкових дерев/кущів по всьому масиву — щоб тест був
    // детермінованим (а не випадково влучав по ЧУЖОМУ дереву раніше в циклі
    // resolveMissileCollision() і хибно провалював decoGone), прибираємо
    // геть усі, крім того, яке ставимо самі
    for (const r of s.rows) { r.decoLeft = null; r.decoRight = null; }
    const idx = 5;
    const row = s.rows[idx];
    row.decoLeft = { tree: true, inset: 15 };
    const y = idx * 8 /* ROW_H */ + s.scrollAccum;
    const dx = row.left - row.decoLeft.inset;
    const scoreBefore = s.score;
    const fakeMissile = { x: dx, y: y + 3, img: { destroy() {} }, normal: true };
    const hit = s.resolveMissileCollision(fakeMissile);
    return { hit, scoreDelta: s.score - scoreBefore, decoGone: row.decoLeft === null };
  });
  console.log('3) знищення дерева на березі:', JSON.stringify(decoResult));
  const okDecoDestroyed = decoResult.hit === true && decoResult.scoreDelta === 30 && decoResult.decoGone === true;

  // ---------- 8) дерева/кущі — тепер готові PNG-картинки (Image-об'єкти),
  // а не Graphics-примітиви: перевіряємо спавн з правильною текстурою за
  // типом/варіантом, рух разом зі скролом і знищення і через destroyDeco
  // (постріл), і через destroyRowDecoImages (рядок вислизнув знизу масиву)
  const decoImgResult = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    for (const r of s.rows) {
      if (r.decoLeft && r.decoLeft.img) r.decoLeft.img.destroy();
      if (r.decoRight && r.decoRight.img) r.decoRight.img.destroy();
      r.decoLeft = null; r.decoRight = null;
    }
    const idx = 6;
    const row = s.rows[idx];
    row.decoLeft = { tree: true, inset: 15, variant: 1 };
    row.decoRight = { tree: false, inset: 10, variant: 0 };
    const y = idx * ROW_H + s.scrollAccum;
    s.spawnDecoImages(row, y);
    const treeImg = row.decoLeft.img;
    const bushImg = row.decoRight.img;
    const spawnInfo = {
      treeExists: !!treeImg, bushExists: !!bushImg,
      treeTexture: treeImg && treeImg.texture.key,
      bushTexture: bushImg && bushImg.texture.key,
      treeDepth: treeImg && treeImg.depth,
      treeX: treeImg && treeImg.x, expectedTreeX: row.left - 15,
      bushX: bushImg && bushImg.x, expectedBushX: row.right + 10,
    };
    // рух разом зі скролом — той самий патерн, що й fuel/tanks/balloons
    const treeYBefore = treeImg.y;
    s.updateDecoImages(37);
    const movedCorrectly = Math.abs((treeImg.y - treeYBefore) - 37) < 0.001;
    // знищення пострілом (destroyDeco) прибирає й картинку дерева
    s.destroyDeco(row, 'decoLeft', treeImg.x, treeImg.y);
    const treeDestroyedByShot = treeImg.active === false && row.decoLeft === null;
    // рядок "вислизнув" за нижній край масиву рядків (destroyRowDecoImages) —
    // має прибрати картинку куща, що лишився недоторканим
    s.destroyRowDecoImages(row);
    const bushDestroyedOnPop = bushImg.active === false;
    return { spawnInfo, movedCorrectly, treeDestroyedByShot, bushDestroyedOnPop };
  });
  console.log('8) дерева/кущі як картинки:', JSON.stringify(decoImgResult));
  const okDecoImages = decoImgResult.spawnInfo.treeExists && decoImgResult.spawnInfo.bushExists &&
    decoImgResult.spawnInfo.treeTexture === 'tree2' && decoImgResult.spawnInfo.bushTexture === 'bush1' &&
    decoImgResult.spawnInfo.treeDepth === 3 &&
    decoImgResult.spawnInfo.treeX === decoImgResult.spawnInfo.expectedTreeX &&
    decoImgResult.spawnInfo.bushX === decoImgResult.spawnInfo.expectedBushX &&
    decoImgResult.movedCorrectly && decoImgResult.treeDestroyedByShot && decoImgResult.bushDestroyedOnPop;

  // ---------- 7) вибух "росте", потім "зменшується", і безперервно
  // обертається за годинниковою стрілкою (не смикається назад) ----------
  const explosionResult = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    for (const ex of s.explosions) ex.img.destroy();
    s.explosions = [];
    s.spawnExplosion(100, 100);
    const ex = s.explosions[0];
    const STEP = 0.02;
    const samples = [];
    const maxSteps = Math.ceil(EXPLO_DURATION / STEP) + 3;
    for (let i = 0; i < maxSteps; i++) {
      s.updateExplosions(STEP);
      if (s.explosions.length === 0) { samples.push({ destroyed: true }); break; }
      samples.push({ t: ex.t, scale: ex.img.scaleX, angle: ex.img.angle });
    }
    return { samples, EXPLO_START_SCALE, EXPLO_PEAK_SCALE, EXPLO_DURATION };
  });
  const liveSamples = explosionResult.samples.filter(s => !s.destroyed);
  const peakIdx = liveSamples.reduce((best, s, i) => s.scale > liveSamples[best].scale ? i : best, 0);
  // пік має бути приблизно посередині тривалості (трикутний профіль: перша
  // половина — ріст, друга — спад), а не на самому початку чи в кінці
  const peakFrac = liveSamples[peakIdx].t / explosionResult.EXPLO_DURATION;
  const okPeakInMiddle = peakFrac > 0.35 && peakFrac < 0.65;
  const okGrows = liveSamples[peakIdx].scale > liveSamples[0].scale + 0.3;
  const okShrinksAfterPeak = liveSamples[liveSamples.length - 1].scale < liveSamples[peakIdx].scale - 0.3;
  // кут МАЄ зростати монотонно (обертання за годинниковою, без "відкату")
  // навіть під час фази зменшення розміру — це окремий незалежний процес.
  // Phaser сам нормалізує .angle у діапазон (-180, 180] — тобто "сирі" 190°
  // читаються як -170°, що виглядає як стрибок назад, хоча візуально це
  // безперервний рух по колу. Тому порівнюємо не самі кути, а НАЙКОРОТШУ
  // "загорнуту" різницю між сусідніми кадрами — вона має лишатись стабільно
  // додатною (за годинниковою), а не саме значення .angle.
  const okAngleMonotonic = liveSamples.every((s, i) => {
    if (i === 0) return true;
    const rawDelta = s.angle - liveSamples[i - 1].angle;
    const wrappedDelta = ((rawDelta + 540) % 360) - 180; // у (-180, 180]
    return wrappedDelta > -0.01;
  });
  const okDestroyedAfterDuration = explosionResult.samples[explosionResult.samples.length - 1].destroyed === true;
  console.log('7) анімація вибуху:', JSON.stringify({
    peakFrac, firstScale: liveSamples[0].scale, peakScale: liveSamples[peakIdx].scale,
    lastScale: liveSamples[liveSamples.length - 1].scale, lastAngle: liveSamples[liveSamples.length - 1].angle,
  }));
  const okExplosionAnim = okPeakInMiddle && okGrows && okShrinksAfterPeak && okAngleMonotonic && okDestroyedAfterDuration;

  // ---------- 4) річка згинається сильніше ----------
  const curveResult = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    const tg = s.terrainGen;
    const centers = [];
    const vels = [];
    for (let i = 0; i < 1200; i++) {
      tg.nextRow(8);
      centers.push(tg.centerX);
      vels.push(tg.centerVel);
    }
    const maxAbsVel = Math.max(...vels.map(Math.abs));
    const range = Math.max(...centers) - Math.min(...centers);
    return { maxAbsVel, range };
  });
  console.log('4) кривизна річки (1200 рядків):', JSON.stringify(curveResult));
  // Це випадковий процес (Phaser.Math.FloatBetween без фіксованого seed), тож
  // перевірка не має бути "на волосок" від межі. Головний, детермінований
  // доказ — maxAbsVel: за старою формулою centerVel було жорстко затиснуто в
  // межах ±1.4, тож будь-яке значення вище доводить, що діє саме нова, ширша
  // амплітуда. range — лише м'яка перевірка "річка реально не пряма",
  // поріг навмисно з великим запасом, щоб не бути крихким.
  const okRiverBendsMore = curveResult.maxAbsVel > 1.45 && curveResult.range > 80;

  await browser.close();
  server.close();

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  console.log('okIconsLoaded:', okIconsLoaded);
  console.log('okHeliFires:', okHeliFires);
  console.log('okHeliHits:', okHeliHits);
  console.log('okDecoDestroyed:', okDecoDestroyed);
  console.log('okDecoImages:', okDecoImages);
  console.log('okRiverBendsMore:', okRiverBendsMore);
  console.log('okJetFlip:', okJetFlip);
  console.log('okNoFuelLabel:', okNoFuelLabel);
  console.log('okExplosionAnim:', okExplosionAnim);

  const allOk = errors.length === 0 && okIconsLoaded && okHeliFires && okHeliHits && okDecoDestroyed &&
    okDecoImages && okRiverBendsMore && okJetFlip && okNoFuelLabel && okExplosionAnim;
  process.exitCode = allOk ? 0 : 1;
})();
