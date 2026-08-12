// Перевіряє: після 4 послідовних крашів гра переходить у gameover,
// а після рестарту стан коректно скидається (очки, життя, паливо, паливо=100).
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

  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      const scene = window.game.scene.keys.Game;
      scene.invulnTimer = 0;
      scene.crashPlayer();
    });
    await page.waitForTimeout(50);
  }
  const info = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    return { state: s.state, score: s.score, lives: s.lives, fuel: Math.round(s.fuel), level: s.level, playerX: s.player.x, scrollSpeed: s.scrollSpeed };
  });
  console.log('after 4 crashes:', JSON.stringify(info));

  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  const info2 = await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    return { state: s.state, score: s.score, lives: s.lives, fuel: Math.round(s.fuel), level: s.level, playerX: s.player.x, scrollSpeed: s.scrollSpeed };
  });
  console.log('after restart:', JSON.stringify(info2));

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  server.close();
  process.exitCode = errors.length ? 1 : 0;
})();
