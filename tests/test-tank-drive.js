const { chromium } = require('playwright');
const path = require('path');
const { startServer } = require('./serve');

(async () => {
  const { server, url } = await startServer(path.join(__dirname, '..'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });

  await page.goto(url + 'index.html');
  await page.waitForTimeout(300);

  // перевірка висоти canvas (має відповідати innerHeight, з межами 640..1400)
  const dims = await page.evaluate(() => {
    return { winH: window.innerHeight, gameH: window.game.config.height, gameW: window.game.config.width };
  });
  console.log('canvas dims:', JSON.stringify(dims));

  await page.keyboard.press('Space');
  await page.waitForTimeout(200);

  // штучно спавнимо танк без дерева на шляху - має доїхати до берега і вистрелити
  const noTreeResult = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    // блокуємо природний спавнер танків/ворогів на весь тест, щоб вони не
    // "забруднювали" підрахунок пострілів чи кількість танків на екрані
    s.tankTimer = 999999;
    s.enemyTimer = 999999;
    // прибираємо дерева з усіх рядків, щоб гарантовано не заважали
    s.rows.forEach(r => { r.decoLeft = null; r.decoRight = null; });
    s.tanks.forEach(t => t.img.destroy());
    s.tanks.length = 0;
    s.tankBullets.forEach(b => b.img.destroy());
    s.tankBullets.length = 0;
    const row = s.rows[3];
    const img = s.add.image(0, -20, 'tank').setDepth(4);
    s.tanks.push({ img, side: 'left', x: 0, y: -20, row, atBank: false, fireTimer: 0.1 });
    return { bankTargetApprox: row.left - 12 };
  });
  console.log('no-tree spawn, expected bank near:', JSON.stringify(noTreeResult));

  // одразу після спавну танк має бути на краю (x=0), ще не доїхав
  const immediately = await page.evaluate(() => {
    const t = window.game.scene.keys.Game.tanks[0];
    return { x: t.x, atBank: t.atBank };
  });
  console.log('immediately after spawn:', JSON.stringify(immediately));

  // чекаємо, поки доїде до берега; опитуємо замість фіксованої паузи, щоб
  // тест не залежав від нестабільного frame-timing у headless-браузері
  let afterDrive = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    afterDrive = await page.evaluate(() => {
      const s = window.game.scene.keys.Game;
      const t = s.tanks[0];
      return t ? { x: t.x, atBank: t.atBank, bulletsSpawned: s.tankBullets.length } : { destroyed: true };
    });
    if (afterDrive.atBank) break;
  }
  // невелика додаткова пауза, щоб fireTimer (0.1с) встиг спрацювати після паркування
  await page.waitForTimeout(300);
  afterDrive = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    const t = s.tanks[0];
    return t ? { x: t.x, atBank: t.atBank, bulletsSpawned: s.tankBullets.length } : { destroyed: true };
  });
  console.log('after driving (no tree):', JSON.stringify(afterDrive));

  // ------------------------------------------------------------------
  // тепер тест з деревом на шляху — танк має застрягти і НЕ стріляти
  const treeResult = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    s.tanks.forEach(t => t.img.destroy());
    s.tanks.length = 0;
    s.tankBullets.forEach(b => b.img.destroy());
    s.tankBullets.length = 0;

    const spawnY = -20;
    // те саме посилання на рядок, яке реально використовує spawnShoreTank()
    const row = s.rows[3];
    // ставимо дерево прямо на шляху (близько до краю, далеко від берега)
    row.decoLeft = { tree: true, inset: 24 };
    const img = s.add.image(0, spawnY, 'tank').setDepth(4);
    s.tanks.push({ img, side: 'left', x: 0, y: spawnY, row, atBank: false, fireTimer: 0.1 });
    return { rowLeft: row.left, treeX: row.left - 24 };
  });
  console.log('tree blocking test setup:', JSON.stringify(treeResult));

  // тут навпаки — чекаємо ДОВШЕ (щоб дати шанс помилково доїхати до берега,
  // якби блокування не спрацювало) і перевіряємо, що воно й далі не atBank
  let afterTreeBlock = null;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    afterTreeBlock = await page.evaluate(() => {
      const s = window.game.scene.keys.Game;
      const t = s.tanks[0];
      return t ? { x: t.x, atBank: t.atBank, bulletsSpawned: s.tankBullets.length } : { destroyed: true };
    });
  }
  console.log('after driving (blocked by tree):', JSON.stringify(afterTreeBlock));

  // ------------------------------------------------------------------
  // перевірка суто горизонтального пострілу (y не змінюється взагалі)
  const shotTest = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    s.tankBullets.forEach(b => b.img.destroy());
    s.tankBullets.length = 0;
    const fakeT = { side: 'left', x: 100, y: 300 };
    s.fireTankShell(fakeT);
    const b = s.tankBullets[0];
    return { y0: b.y, vy: b.vy };
  });
  await page.waitForTimeout(300);
  const shotAfter = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    const b = s.tankBullets[0];
    return b ? { y: b.y } : { gone: true };
  });
  console.log('shot horizontal check:', JSON.stringify(shotTest), '->', JSON.stringify(shotAfter));

  // ------------------------------------------------------------------
  // перевірка тексту ГРА ВСЬО (invulnTimer треба скидати перед КОЖНИМ
  // крашем, інакше наступні виклики в ту саму мить ігноруються)
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      const s = window.game.scene.keys.Game;
      s.invulnTimer = 0;
      s.crashPlayer();
    });
    await page.waitForTimeout(30);
  }
  const gameOverText = await page.evaluate(() => window.game.scene.keys.Game.centerMsg.text);
  console.log('game over text:', JSON.stringify(gameOverText));

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');

  const okHeight = dims.gameH === Math.min(1400, Math.max(640, dims.winH));
  const okDrive = !immediately.atBank && afterDrive.atBank && afterDrive.bulletsSpawned > 0;
  const okBlocked = !afterTreeBlock.atBank && afterTreeBlock.bulletsSpawned === 0 && afterTreeBlock.x < treeResult.treeX + 1;
  const okShot = shotTest.vy === 0 && shotAfter.y === shotTest.y0;
  const okText = gameOverText === 'ГРА ВСЬО';

  console.log('okHeight:', okHeight, 'okDrive:', okDrive, 'okBlocked:', okBlocked, 'okShot:', okShot, 'okText:', okText);

  await browser.close();
  server.close();
  process.exitCode = (errors.length || !okHeight || !okDrive || !okBlocked || !okShot || !okText) ? 1 : 0;
})();
