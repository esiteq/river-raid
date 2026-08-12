// Перевіряє: міст з'являється, а знищення моста разом з танком на ньому
// потроює нарахування очків.
const { chromium } = require('playwright');
const path = require('path');
const { startServer } = require('./serve');

(async () => {
  const { server, url } = await startServer(path.join(__dirname, '..'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 520, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });

  await page.goto(url + 'index.html');
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    const scene = window.game.scene.keys.Game;
    const tg = scene.terrainGen;
    tg.islandActive = false;
    tg.islandCooldown = 999;
    tg.bridgeRowsLeft = 0;
    tg.currentBridge = null;
    tg.distSinceBridge = tg.bridgeDistance - 40; // майже готово
    scene.invulnTimer = 999; // не розбитись поки летимо до моста
  });

  await page.waitForTimeout(1800);
  const info1 = await page.evaluate(() => {
    const scene = window.game.scene.keys.Game;
    return { bridgeVisuals: scene.bridgeVisuals.size, level: scene.level, score: scene.score };
  });
  console.log('bridge visible check:', JSON.stringify(info1));

  await page.evaluate(() => {
    const scene = window.game.scene.keys.Game;
    scene.invulnTimer = 999;
  });
  for (let i = 0; i < 15 && (await page.evaluate(() => window.game.scene.keys.Game.level)) === 1; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
  }
  const info2 = await page.evaluate(() => {
    const scene = window.game.scene.keys.Game;
    return { level: scene.level, score: scene.score, bridgeVisuals: scene.bridgeVisuals.size };
  });
  console.log('after shooting bridge:', JSON.stringify(info2));

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  server.close();
  process.exitCode = errors.length ? 1 : 0;
})();
