// Загальний smoke-тест: тайтл, старт гри, рух, постріл, пауза — без помилок у консолі.
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
  await page.waitForTimeout(500);

  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(300);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.press('Space'); // постріл
  await page.waitForTimeout(2500);

  const st = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    return { state: s.state, score: s.score, lives: s.lives, fuel: Math.round(s.fuel), level: s.level, enemies: s.enemies.length, fuels: s.fuels.length };
  });
  console.log('state:', JSON.stringify(st));

  await page.keyboard.press('KeyP');
  await page.waitForTimeout(150);
  await page.keyboard.press('KeyP');

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  server.close();
  process.exitCode = errors.length ? 1 : 0;
})();
