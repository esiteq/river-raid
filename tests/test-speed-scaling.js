// Перевіряє: мінімальна і максимальна швидкість зростають на 10% за кожен
// пройдений рівень/міст, тобто на рівні 11 (10 мостів позаду) швидкість
// повинна бути точно вдвічі більшою, ніж на старті.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 520, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });

  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForTimeout(500);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);

  const initial = await page.evaluate(() => {
    const g = window.game.scene.keys.Game;
    return { level: g.level, minSpeed: g.minSpeed, maxSpeed: g.maxSpeed };
  });
  console.log('Initial:', JSON.stringify(initial));

  await page.evaluate(() => {
    const g = window.game.scene.keys.Game;
    for (let i = 0; i < 10; i++) g.advanceLevel();
  });

  const afterTen = await page.evaluate(() => {
    const g = window.game.scene.keys.Game;
    return { level: g.level, minSpeed: g.minSpeed, maxSpeed: g.maxSpeed };
  });
  console.log('After 10 advanceLevel() calls:', JSON.stringify(afterTen));

  const expectedMax = initial.maxSpeed * 2;
  const expectedMin = initial.minSpeed * 2;
  const okMax = Math.abs(afterTen.maxSpeed - expectedMax) < 0.01;
  const okMin = Math.abs(afterTen.minSpeed - expectedMin) < 0.01;
  console.log('maxSpeed doubled correctly:', okMax, `(got ${afterTen.maxSpeed}, expected ${expectedMax})`);
  console.log('minSpeed doubled correctly:', okMin, `(got ${afterTen.minSpeed}, expected ${expectedMin})`);

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  process.exitCode = (errors.length || !okMax || !okMin) ? 1 : 0;
})();
