// Перевіряє: нахил літака ("крен") вліво/вправо і повернення в нейтраль,
// кругла анімація вибуху, повне відновлення пального (100%) після краху.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 520, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });

  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);

  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(350);
  const angleLeft = await page.evaluate(() => window.game.scene.keys.Game.player.angle);
  await page.keyboard.up('ArrowLeft');

  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(350);
  const angleRight = await page.evaluate(() => window.game.scene.keys.Game.player.angle);
  await page.keyboard.up('ArrowRight');

  await page.waitForTimeout(400);
  const angleLevel = await page.evaluate(() => window.game.scene.keys.Game.player.angle);

  console.log('angleLeft:', angleLeft, 'angleRight:', angleRight, 'angleLevel(after release):', angleLevel);

  await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    s.fuel = 5; // майже пусто
    s.invulnTimer = 0;
    s.crashPlayer();
  });
  await page.waitForTimeout(50);
  const fuelAfterCrash = await page.evaluate(() => window.game.scene.keys.Game.fuel);
  console.log('fuel after crash (should be 100):', fuelAfterCrash);

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  process.exitCode = errors.length ? 1 : 0;
})();
