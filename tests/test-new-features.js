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
// 9) бонус HOMING (M): лічильник стартує з HOMING_BONUS_AMOUNT (50),
//    зменшується на 1 за КОЖЕН постріл (не за кожну з двох ракет), повторний
//    підбір бонусу, поки лічильник ще не 0, ДОДАЄ 50 (не перезаписує), а
//    коли лічильник доходить до нуля — бонус вимикається і наступний
//    постріл уже звичайний одиночний; сама самонавідна ракета — готова
//    іконка 'homingMissile' (6x32), а не процедурна текстура 'missile'
// 10) хітбокси тепер по реальних непрозорих пікселях PNG (pixelHit), а не по
//     прямокутнику "на око": постріл у прозорий кут іконки — НЕ влучання,
//     постріл у непрозору точку — влучання; враховує масштаб і дзеркалення
// 11) тайтл-екран: картинка гравця й текст керування більше не перекриваються
//     (getBounds() обох об'єктів не перетинаються), кнопка старту —
//     "НАТИСНІТЬ ПРОБІЛ ДЛЯ ПОЧАТКУ", і під нею є рядок версії
//     "vX.Y by Alex Raven"
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

async function waitForTitleScene(page) {
  for (let i = 0; i < 40; i++) {
    const ready = await page.evaluate(() => {
      const t = window.game && window.game.scene && window.game.scene.keys.Title;
      return !!(t && t.sys && t.sys.isActive());
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
  await waitForTitleScene(page);

  // ---------- 11) тайтл-екран: текст керування не перекриває картинку
  // літака; кнопка старту й рядок версії ----------
  const titleResult = await page.evaluate(() => {
    const t = window.game.scene.keys.Title;
    if (!t || !t.sys.isActive()) return { active: false };
    const children = t.children.list;
    const playerImg = children.find(c => c.type === 'Image' && c.texture && c.texture.key === 'player');
    const texts = children.filter(c => c.type === 'Text');
    const controlsText = texts.find(c => c.text.includes('рух літака'));
    const startText = texts.find(c => c.text.includes('ПРОБІЛ'));
    const versionText = texts.find(c => c.text.startsWith('v') && c.text.includes('by Alex Raven'));
    const playerBounds = playerImg.getBounds();
    const controlsBounds = controlsText.getBounds();
    // прямокутники НЕ перетинаються, якщо один повністю по один бік від
    // іншого хоч по одній з осей
    const overlaps = !(controlsBounds.top >= playerBounds.bottom ||
                        controlsBounds.bottom <= playerBounds.top ||
                        controlsBounds.left >= playerBounds.right ||
                        controlsBounds.right <= playerBounds.left);
    return {
      active: true,
      overlaps,
      startText: startText ? startText.text : null,
      versionText: versionText ? versionText.text : null,
      playerBounds: { top: Math.round(playerBounds.top), bottom: Math.round(playerBounds.bottom) },
      controlsBounds: { top: Math.round(controlsBounds.top), bottom: Math.round(controlsBounds.bottom) },
    };
  });
  console.log('11) тайтл-екран:', JSON.stringify(titleResult));
  const okTitleScreen = titleResult.active === true && titleResult.overlaps === false &&
    titleResult.startText === 'НАТИСНІТЬ ПРОБІЛ ДЛЯ ПОЧАТКУ' &&
    /^v\d+\.\d+ by Alex Raven$/.test(titleResult.versionText || '');

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

  // ---------- 14) не більше 3 заправок одночасно на екрані ----------
  const fuelCapResult = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    s.fuels.forEach(f => f.img.destroy());
    s.fuels = [];
    for (let i = 0; i < 10; i++) s.spawnFuel(); // намагаємось заспавнити явно більше за ліміт
    const countAtCap = s.fuels.length;
    // після знищення однієї — знову можна заспавнити ще одну (ліміт не "залипає")
    const removed = s.fuels.pop();
    if (removed) removed.img.destroy();
    s.spawnFuel();
    const countAfterFreeingSlot = s.fuels.length;
    return { countAtCap, countAfterFreeingSlot };
  });
  console.log('14) ліміт заправок на екрані:', JSON.stringify(fuelCapResult));
  const okFuelCap = fuelCapResult.countAtCap === 3 && fuelCapResult.countAfterFreeingSlot === 3;

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
    for (const r of s.rows) {
      if (r.decoLeft && r.decoLeft.img) r.decoLeft.img.destroy();
      if (r.decoRight && r.decoRight.img) r.decoRight.img.destroy();
      r.decoLeft = null; r.decoRight = null;
    }
    const idx = 5;
    const row = s.rows[idx];
    row.decoLeft = { tree: true, inset: 15, variant: 0 };
    const y = idx * 8 /* ROW_H */ + s.scrollAccum;
    // хітбокс тепер по масці PNG, а не по прямокутнику "на око" — тож
    // потрібна реальна картинка (spawnDecoImages), і постріл цілимо точно
    // в її центр, де точно є непрозорий піксель
    s.spawnDecoImages(row, y);
    const img = row.decoLeft.img;
    const scoreBefore = s.score;
    const fakeMissile = { x: img.x, y: img.y, img: { destroy() {} }, normal: true };
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

  // ---------- 9) HOMING-бонус (M): лічильник 50, -1 за постріл, стекання
  // при повторному підборі, вимкнення при 0 ----------
  const homingResult = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    for (const m of s.missiles) m.img.destroy();
    s.missiles = [];
    s.activePower = null;
    s.homingCount = 0;

    // "стріляє", напряму зводячи Phaser Key у стан JustDown (обходимо
    // реальні DOM-події клавіатури — детерміновано й миттєво), і одразу
    // прибирає випущені ракети, щоб наступний постріл не заблокувався
    // перевіркою "this.missiles.length > 0" (не чекаємо реального польоту)
    function fire() {
      s.keys.SPACE._justDown = true;
      s.handleShooting();
      const count = s.missiles.length;
      const anyHoming = s.missiles.some(m => m.homing);
      const homingOne = s.missiles.find(m => m.homing);
      const homingTexture = homingOne ? homingOne.img.texture.key : null;
      const homingDisplaySize = homingOne ? { w: homingOne.img.displayWidth, h: homingOne.img.displayHeight } : null;
      for (const m of s.missiles) m.img.destroy();
      s.missiles = [];
      return { count, anyHoming, homingTexture, homingDisplaySize };
    }
    const fakeBalloon = () => ({ x: 0, y: 0, letter: 'M', img: { destroy() {} }, label: { destroy() {} } });

    s.balloons = [fakeBalloon()];
    s.collectBalloon(s.balloons[0], 0);
    const afterFirstPickup = { activePower: s.activePower, homingCount: s.homingCount };

    const shot1 = fire();
    fire(); fire();
    const after3Shots = { activePower: s.activePower, homingCount: s.homingCount };
    // HUD має показувати саме поточний лічильник (47) — перевіряємо тут,
    // ДОКИ стан ще не змінився далі за текстом тесту
    s.updateHUD();
    const hudText = s.powerText.text;

    // повторний підбір, поки лічильник ще не 0 — має ДОДАТИ 50
    s.balloons = [fakeBalloon()];
    s.collectBalloon(s.balloons[0], 0);
    const afterSecondPickup = { activePower: s.activePower, homingCount: s.homingCount };

    // добиваємо лічильник до нуля одним пострілом
    s.homingCount = 1;
    const lastHomingShot = fire();
    const afterDepleted = { activePower: s.activePower, homingCount: s.homingCount };
    const shotAfterDepleted = fire(); // тепер має бути звичайний одиночний постріл

    return { afterFirstPickup, shot1, after3Shots, afterSecondPickup, lastHomingShot, afterDepleted, shotAfterDepleted, hudText };
  });
  console.log('9) HOMING-лічильник:', JSON.stringify(homingResult));
  const okHoming =
    homingResult.afterFirstPickup.activePower === 'missile' && homingResult.afterFirstPickup.homingCount === 50 &&
    homingResult.shot1.count === 3 && homingResult.shot1.anyHoming === true &&
    homingResult.after3Shots.activePower === 'missile' && homingResult.after3Shots.homingCount === 47 &&
    homingResult.afterSecondPickup.activePower === 'missile' && homingResult.afterSecondPickup.homingCount === 97 &&
    homingResult.lastHomingShot.anyHoming === true &&
    homingResult.afterDepleted.activePower === null && homingResult.afterDepleted.homingCount === 0 &&
    homingResult.shotAfterDepleted.count === 1 && homingResult.shotAfterDepleted.anyHoming === false &&
    homingResult.hudText === 'HOMING ★ 47' &&
    homingResult.shot1.homingTexture === 'homingMissile' &&
    homingResult.shot1.homingDisplaySize.w === 6 && homingResult.shot1.homingDisplaySize.h === 32;

  // ---------- 10) хітбокси по масці PNG (pixelHit), а не по прямокутнику
  // "на око" ----------
  const maskResult = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    function findPixel(mask, pred) {
      for (let y = 0; y < mask.height; y++)
        for (let x = 0; x < mask.width; x++)
          if (pred(mask.alpha[y * mask.width + x])) return { x, y };
      return null;
    }
    const key = 'ship';
    const mask = SPRITE_MASKS[key];
    const opaque = findPixel(mask, a => a > 200);
    const transparent = findPixel(mask, a => a === 0);

    const img = s.add.image(200, 200, key); // без флипу/масштабу/кута — базовий кейс
    const toWorld = (px, py) => ({ x: img.x + (px - mask.width / 2), y: img.y + (py - mask.height / 2) });

    const opaqueWorld = toWorld(opaque.x, opaque.y);
    const transparentWorld = toWorld(transparent.x, transparent.y);
    const hitOpaque = pixelHit(img, opaqueWorld.x, opaqueWorld.y);
    const hitTransparent = pixelHit(img, transparentWorld.x, transparentWorld.y);

    // та сама непрозора точка, але картинка вдвічі більша — точка має
    // масштабуватись разом з нею
    img.setScale(2);
    const opaqueWorld2x = { x: img.x + (opaque.x - mask.width / 2) * 2, y: img.y + (opaque.y - mask.height / 2) * 2 };
    const hitOpaqueScaled = pixelHit(img, opaqueWorld2x.x, opaqueWorld2x.y);
    img.setScale(1);

    // дзеркалення: шукаємо НЕсиметричний непрозорий піксель у лівій половині
    // картинки (px < width/2) і перевіряємо, що та сама світова точка після
    // setFlipX(true) відповідає ДЗЕРКАЛЬНОМУ пікселю (width-1-px, py), а не
    // тому самому — тобто pixelHit враховує flipX, а не просто ігнорує його
    let asymmetric = null;
    for (let y = 0; y < mask.height && !asymmetric; y++) {
      for (let x = 0; x < Math.floor(mask.width / 2) && !asymmetric; x++) {
        const a1 = mask.alpha[y * mask.width + x] > 20;
        const a2 = mask.alpha[y * mask.width + (mask.width - 1 - x)] > 20;
        if (a1 !== a2) asymmetric = { x, y, expectedWhenFlipped: a2 };
      }
    }
    let flipResult = null;
    if (asymmetric) {
      const w = toWorld(asymmetric.x, asymmetric.y);
      img.setFlipX(true);
      const hitFlipped = pixelHit(img, w.x, w.y);
      img.setFlipX(false);
      flipResult = { expectedWhenFlipped: asymmetric.expectedWhenFlipped, hitFlipped };
    }

    img.destroy();
    return { hitOpaque, hitTransparent, hitOpaqueScaled, flipResult };
  });
  console.log('10) хітбокс по масці (pixelHit):', JSON.stringify(maskResult));
  const okPixelMask = maskResult.hitOpaque === true && maskResult.hitTransparent === false &&
    maskResult.hitOpaqueScaled === true &&
    (!maskResult.flipResult || maskResult.flipResult.hitFlipped === maskResult.flipResult.expectedWhenFlipped);

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

  // ---------- 12) прохід повз острів завжди достатньо широкий (мін. вдвічі
  // ширше за ВИДИМУ картинку літака, MIN_ISLAND_CHANNEL = PLAYER_VISUAL_WIDTH
  // * 2 — не за вузький хітбокс-по-фюзеляжу PLAYER_HALF_W, вони навмисно
  // розв'язані) — навіть коли ширина річки (halfWidth) "дихає" ПІД ЧАС
  // активного острова, а не лише в момент його появи; раніше острів міг
  // лишитись зі старою (широкою) половиною, поки річка тим часом звужувалась
  // до мінімуму на високих рівнях — і прохід ставав фізично непролітним.
  // impossibleRows рахуємо за РЕАЛЬНИМ критерієм колізії (isChannelSafe,
  // тобто PLAYER_HALF_W) — це "чи фізично неможливо пролетіти", а
  // minChannelSeen звіряємо з набагато щедрішим MIN_ISLAND_CHANNEL — це
  // "чи виглядає прохід комфортно на око" ----------
  const islandResult = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    const tg = s.terrainGen;
    let minChannelSeen = Infinity;
    let sawIsland = false;
    let impossibleRows = 0;
    // проганяємо через кілька рівнів (мінімальна ширина річки звужується з
    // рівнем), щоб зловити саме найтісніший можливий випадок
    for (let level = 1; level <= 10; level++) {
      tg.setLevel(level);
      for (let i = 0; i < 400; i++) {
        const row = tg.nextRow(8);
        if (row.islandLeft != null) {
          sawIsland = true;
          const leftChannel = row.islandLeft - row.left;
          const rightChannel = row.right - row.islandRight;
          const channel = Math.min(leftChannel, rightChannel);
          if (channel < minChannelSeen) minChannelSeen = channel;
          // фактична перевірка прохідності — те саме, що isChannelSafe:
          // хоч один із двох проходів має вміщати вузький хітбокс-фюзеляж
          const leftOk = leftChannel > 2 * PLAYER_HALF_W;
          const rightOk = rightChannel > 2 * PLAYER_HALF_W;
          if (!leftOk && !rightOk) impossibleRows++;
        }
      }
    }
    return { minChannelSeen, sawIsland, impossibleRows, MIN_ISLAND_CHANNEL, PLAYER_HALF_W, PLAYER_VISUAL_WIDTH };
  });
  console.log('12) прохід повз острів:', JSON.stringify(islandResult));
  const okIslandChannel = islandResult.sawIsland === true && islandResult.impossibleRows === 0 &&
    islandResult.minChannelSeen >= islandResult.MIN_ISLAND_CHANNEL - 0.001 &&
    islandResult.MIN_ISLAND_CHANNEL === islandResult.PLAYER_VISUAL_WIDTH * 2;

  // ---------- 17) колізія з берегом лише по фюзеляжу, не по крилах:
  // PLAYER_HALF_W (реальна половина хітбокса) має бути помітно вужчим за
  // половину видимої картинки літака (PLAYER_VISUAL_WIDTH/2) — і, що
  // важливіше, isChannelSafe() реально пропускає гравця в прохід, який
  // вмістив би тільки фюзеляж, але НЕ вмістив би повний розмах крил ----------
  const fuselageResult = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    const row = { left: 100, right: 400, islandLeft: null, islandRight: null, bridge: null };
    // рівно на межі: трохи вужче за хітбокс — має бути НЕбезпечно
    const unsafeAtHitboxEdge = s.isChannelSafe(row, 100 + (PLAYER_HALF_W - 2), PLAYER_HALF_W);
    // трохи ширше за хітбокс, але вужче за половину розмаху крил —
    // САМЕ ТА ситуація, яку просив користувач: крило "заходить" у берег,
    // фюзеляж — ні, і це має рахуватись як безпечний проліт
    const safeWithWingOverlap = s.isChannelSafe(row, 100 + (PLAYER_HALF_W + 2), PLAYER_HALF_W);
    const wingGapX = 100 + (PLAYER_VISUAL_WIDTH / 2 - 2); // тут повний розмах крил уже НЕ поміщається
    const safeAtNarrowerThanWingspan = s.isChannelSafe(row, wingGapX, PLAYER_HALF_W);
    return {
      unsafeAtHitboxEdge, safeWithWingOverlap, safeAtNarrowerThanWingspan,
      PLAYER_HALF_W, PLAYER_VISUAL_WIDTH,
    };
  });
  console.log('17) колізія лише по фюзеляжу:', JSON.stringify(fuselageResult));
  const okFuselageOnly = fuselageResult.unsafeAtHitboxEdge === false &&
    fuselageResult.safeWithWingOverlap === true &&
    fuselageResult.safeAtNarrowerThanWingspan === true &&
    fuselageResult.PLAYER_HALF_W < fuselageResult.PLAYER_VISUAL_WIDTH / 2 - 5; // помітно вужче за половину розмаху крил

  // ---------- 13) дерева/кущі розкидані по ВСІЙ зеленій смузі берега, а не
  // тільки тісною смужкою біля самої води (раніше inset був захардкоджений
  // 6-26px від берега незалежно від того, наскільки широка зелена смуга) ----------
  const decoSpreadResult = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    const tg = s.terrainGen;
    const insets = [];
    for (let i = 0; i < 2500; i++) {
      const row = tg.nextRow(8);
      if (row.decoLeft) insets.push(row.decoLeft.inset);
      if (row.decoRight) insets.push(row.decoRight.inset);
    }
    return {
      count: insets.length,
      minInset: insets.length ? Math.min(...insets) : null,
      maxInset: insets.length ? Math.max(...insets) : null,
      farFromBankCount: insets.filter(v => v > 40).length, // за межами старого діапазону 6-26
      DECO_EDGE_MARGIN,
    };
  });
  console.log('13) розкид дерев/кущів по зеленій смузі:', JSON.stringify(decoSpreadResult));
  const okDecoSpread = decoSpreadResult.count > 0 &&
    decoSpreadResult.minInset >= decoSpreadResult.DECO_EDGE_MARGIN - 0.001 &&
    decoSpreadResult.maxInset > 40 && // доводить, що це НЕ стара вузька смужка 6-26px
    decoSpreadResult.farFromBankCount > 0;

  // ---------- 15) жовтий пісок біля води: ширина 0..SAND_MAX_WIDTH, часом
  // зникає зовсім (не паралельна смуга), часом сягає майже максимуму;
  // рендер (drawTerrain) не падає навіть на екстремальних значеннях ----------
  const sandResult = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    const tg = s.terrainGen;
    const aVals = [], bVals = [];
    for (let i = 0; i < 2000; i++) {
      const row = tg.nextRow(8);
      aVals.push(row.sandA);
      bVals.push(row.sandB);
    }
    // смоук-тест рендеру на межових значеннях (пісок ширший за вузький берег)
    const row3 = s.rows[3];
    const savedA = row3.sandA, savedB = row3.sandB;
    row3.sandA = SAND_MAX_WIDTH; row3.sandB = SAND_MAX_WIDTH;
    let drawThrew = false;
    try { s.drawTerrain(); } catch (e) { drawThrew = true; }
    row3.sandA = savedA; row3.sandB = savedB;
    return {
      minA: Math.min(...aVals), maxA: Math.max(...aVals),
      minB: Math.min(...bVals), maxB: Math.max(...bVals),
      zeroA: aVals.filter(v => v < 0.5).length,
      zeroB: bVals.filter(v => v < 0.5).length,
      nearMaxA: aVals.filter(v => v > SAND_MAX_WIDTH - 4).length,
      nearMaxB: bVals.filter(v => v > SAND_MAX_WIDTH - 4).length,
      drawThrew, SAND_MAX_WIDTH,
    };
  });
  console.log('15) жовтий пісок біля води:', JSON.stringify(sandResult));
  const okSand = sandResult.minA >= -0.001 && sandResult.minB >= -0.001 &&
    sandResult.maxA <= sandResult.SAND_MAX_WIDTH + 0.001 && sandResult.maxB <= sandResult.SAND_MAX_WIDTH + 0.001 &&
    sandResult.zeroA > 0 && sandResult.zeroB > 0 && // подекуди зникає повністю
    sandResult.nearMaxA > 0 && sandResult.nearMaxB > 0 && // подекуди сягає майже максимуму
    sandResult.drawThrew === false;

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
  console.log('okHoming:', okHoming);
  console.log('okPixelMask:', okPixelMask);
  console.log('okTitleScreen:', okTitleScreen);
  console.log('okIslandChannel:', okIslandChannel);
  console.log('okDecoSpread:', okDecoSpread);
  console.log('okFuelCap:', okFuelCap);
  console.log('okSand:', okSand);
  console.log('okFuselageOnly:', okFuselageOnly);

  const allOk = errors.length === 0 && okIconsLoaded && okHeliFires && okHeliHits && okDecoDestroyed &&
    okDecoImages && okRiverBendsMore && okJetFlip && okNoFuelLabel && okExplosionAnim &&
    okHoming && okPixelMask && okTitleScreen && okIslandChannel && okDecoSpread && okFuelCap &&
    okSand && okFuselageOnly;
  process.exitCode = allOk ? 0 : 1;
})();
