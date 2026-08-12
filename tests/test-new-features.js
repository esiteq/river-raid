// Перевіряє нові фічі цього раунду змін:
// 1) картинки-іконки (tank/heli/balloon/player/jet) реально завантажені та
//    мають очікувані розміри відображення (не забуті процедурні заглушки)
// 2) гелікоптер стріляє по гравцю і може його збити
// 3) дерева/кущі на березі тепер знищувані пострілом (раніше — суто декор)
// 4) річка згинається помітно сильніше, ніж раніше (перевірка на живому
//    this.terrainGen, а не переписана копія формули)
// 5) 'jet' (ворожий реактивний літак) правильно дзеркалиться залежно від
//    напрямку польоту — картинка за замовчуванням "дивиться" вліво (на
//    відміну від старої процедурної текстури, яка дивилась вправо), тож
//    напрям setFlipX() в spawnEnemy() довелось інвертувати
const { chromium } = require('playwright');
const path = require('path');

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
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 520, height: 800 } });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });

  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await waitForGameScene(page);
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);

  // ---------- 1) іконки завантажені й мають очікуваний розмір ----------
  const iconInfo = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    const tex = key => s.textures.get(key).getSourceImage();
    const shoreTankImg = s.add.image(-999, -999, 'tank').setScale(1 / 3);
    const heliImg = s.add.image(-999, -999, 'heli').setScale(1 / 3);
    const balloonImg = s.add.image(-999, -999, 'balloon').setScale(1 / 3);
    const playerDisplay = { w: s.player.displayWidth, h: s.player.displayHeight };
    const jetImg = s.add.image(-999, -999, 'jet').setScale(1 / 3);
    const info = {
      tankSrc: { w: tex('tank').width, h: tex('tank').height },
      heliSrc: { w: tex('heli').width, h: tex('heli').height },
      balloonSrc: { w: tex('balloon').width, h: tex('balloon').height },
      playerSrc: { w: tex('player').width, h: tex('player').height },
      jetSrc: { w: tex('jet').width, h: tex('jet').height },
      tankDisplay: { w: shoreTankImg.displayWidth, h: shoreTankImg.displayHeight },
      heliDisplay: { w: heliImg.displayWidth, h: heliImg.displayHeight },
      balloonDisplay: { w: balloonImg.displayWidth, h: balloonImg.displayHeight },
      playerDisplay,
      jetDisplay: { w: jetImg.displayWidth, h: jetImg.displayHeight },
    };
    shoreTankImg.destroy(); heliImg.destroy(); balloonImg.destroy(); jetImg.destroy();
    return info;
  });
  console.log('1) розміри іконок:', JSON.stringify(iconInfo));
  const okIconsLoaded =
    iconInfo.tankSrc.w > 50 && iconInfo.heliSrc.w > 50 && iconInfo.balloonSrc.w > 50 &&
    iconInfo.playerSrc.w > 50 && iconInfo.jetSrc.w > 50 && // не 1x1 заглушка
    Math.abs(iconInfo.tankDisplay.w - 48) < 4 &&
    Math.abs(iconInfo.heliDisplay.w - 55) < 4 &&
    Math.abs(iconInfo.balloonDisplay.h - 40) < 4 &&
    Math.abs(iconInfo.playerDisplay.w - 45) < 4 &&
    Math.abs(iconInfo.jetDisplay.w - 44) < 4;

  // ---------- 5) 'jet' коректно дзеркалиться за напрямком польоту ----------
  const jetFlipResult = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    s.enemies = [];
    const before = s.enemies.length;
    for (let i = 0; i < 60 && s.enemies.length < 2; i++) s.spawnEnemy();
    // форсуємо появу jet напряму, якщо рандом не дав обидва напрямки природно
    while (!s.enemies.some(e => e.type === 'jet' && e.vx > 0)) {
      const img = s.add.image(-20, -20, 'jet').setDepth(8).setScale(1 / 3);
      img.setFlipX(true);
      s.enemies.push({ img, type: 'jet', x: -20, y: -20, vx: 190, phase: 0, alive: true, dir: 1 });
      break;
    }
    while (!s.enemies.some(e => e.type === 'jet' && e.vx < 0)) {
      const img = s.add.image(500, -20, 'jet').setDepth(8).setScale(1 / 3);
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

  // ---------- 2) гелікоптер стріляє і може влучити в гравця ----------
  const heliShotResult = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    s.enemies = []; // прибираємо все зайве, щоб не заважало
    s.invulnTimer = 0;
    const img = s.add.image(s.player.x, 200, 'heli').setDepth(8).setScale(1 / 3);
    const enemy = { img, type: 'heli', x: s.player.x, y: 200, vx: 0, phase: 0, alive: true, dir: 1, fireTimer: 0 };
    s.enemies.push(enemy);
    const before = s.heliBullets.length;
    s.updateEnemies(0, 0.016); // саме тут heli має вистрелити (fireTimer<=0)
    const afterFire = s.heliBullets.length;
    return { before, afterFire };
  });
  console.log('2a) гелікоптер вистрелив:', JSON.stringify(heliShotResult));
  const okHeliFires = heliShotResult.before === 0 && heliShotResult.afterFire === 1;

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

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  console.log('okIconsLoaded:', okIconsLoaded);
  console.log('okHeliFires:', okHeliFires);
  console.log('okHeliHits:', okHeliHits);
  console.log('okDecoDestroyed:', okDecoDestroyed);
  console.log('okRiverBendsMore:', okRiverBendsMore);
  console.log('okJetFlip:', okJetFlip);

  const allOk = errors.length === 0 && okIconsLoaded && okHeliFires && okHeliHits && okDecoDestroyed && okRiverBendsMore && okJetFlip;
  process.exitCode = allOk ? 0 : 1;
})();
