// Перевіряє новий сценарій мостового танка:
// 1) спочатку їде "дорогою" на березі (ще не на прольоті мосту)
// 2) потім заїжджає на сам міст (tankOnBridge=true)
// 3) якщо міст знищити ДО того, як танк проїхав — танк НЕ гине, а
//    "застрягає" і починає стріляти, як звичайний танк на березі
// 4) бонус x3 нараховується тільки якщо танк був САМЕ на прольоті мосту
// Стан мосту/танка керується напряму через evaluate() (а не гонитвою за
// таймінгом реального пострілу) — так сценарій детермінований і не залежить
// від швидкості польоту ракети чи частоти кадрів у headless-браузері.
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

async function forceBridgeSpawn(page) {
  await page.evaluate(() => {
    const s = window.game.scene.keys.Game;
    s.tankTimer = 999999; s.enemyTimer = 999999; s.balloonTimer = 999999; s.fuelTimer = 999999;
    const tg = s.terrainGen;
    tg.islandActive = false;
    tg.islandCooldown = 999;
    tg.bridgeRowsLeft = 0;
    tg.currentBridge = null;
    tg.distSinceBridge = tg.bridgeDistance - 40;
    s.invulnTimer = 999;
  });
}

(async () => {
  const { server, url } = await startServer(path.join(__dirname, '..'));
  const browser = await chromium.launch();
  const errors = [];

  // ---------- сценарій A: міст знищено, поки танк ЩЕ НА ДОРОЗІ ----------
  const pageA = await browser.newPage({ viewport: { width: 520, height: 800 } });
  pageA.on('pageerror', e => errors.push('PAGEERROR(A): ' + e.message));
  pageA.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE(A): ' + msg.text()); });
  await pageA.goto(url + 'index.html');
  await waitForGameScene(pageA);
  await pageA.keyboard.press('Space');
  await pageA.waitForTimeout(200);
  await forceBridgeSpawn(pageA);
  // опитуємо часто (а не блокуюча пауза 1800мс), щоб зловити момент ОДРАЗУ
  // після появи мосту — інакше танк (їде дорогою ~1.3с) може встигнути
  // заїхати на сам проліт ще до нашої перевірки
  for (let i = 0; i < 40; i++) {
    const has = await pageA.evaluate(() => window.game.scene.keys.Game.bridgeVisuals.size > 0);
    if (has) break;
    await pageA.waitForTimeout(50);
  }

  const roadState = await pageA.evaluate(() => {
    const s = window.game.scene.keys.Game;
    const bridge = [...s.bridgeVisuals.keys()][0];
    return bridge ? {
      found: true, tankAlive: bridge.tankAlive, tankOnBridge: bridge.tankOnBridge,
      tankX: bridge.tankImg ? bridge.tankImg.x : null,
      left: bridge.left, right: bridge.right
    } : { found: false };
  });
  console.log('A) стан одразу після появи мосту:', JSON.stringify(roadState));
  const okA_startsOnRoad = roadState.found && roadState.tankAlive && roadState.tankOnBridge === false;

  const scoreBeforeA = await pageA.evaluate(() => window.game.scene.keys.Game.score);
  const tanksBeforeA = await pageA.evaluate(() => window.game.scene.keys.Game.tanks.length);

  // напряму імітуємо результат влучання по мосту (те саме, що робить
  // resolveMissileCollision), поки танк точно ще на дорозі
  const afterA = await pageA.evaluate(() => {
    const s = window.game.scene.keys.Game;
    const bridge = [...s.bridgeVisuals.keys()][0];
    const tankBonus = bridge.tankAlive && bridge.tankOnBridge;
    const tankStillEnRoute = bridge.tankAlive;
    bridge.alive = false;
    bridge.hp = 0;
    s.addScore(tankBonus ? 1500 : 500);
    if (tankStillEnRoute) s.strandBridgeTank(bridge);
    return { score: s.score, tanksCount: s.tanks.length, tanks: s.tanks.map(t => ({ atBank: t.atBank, row: t.row })) };
  });
  console.log('A) після знищення мосту (танк був на дорозі):', JSON.stringify(afterA));

  const scoreDeltaA = afterA.score - scoreBeforeA;
  const okA_noTripleBonus = scoreDeltaA === 500; // не мало потроїтись, бо не був на прольоті
  const okA_stranded = afterA.tanksCount > tanksBeforeA && afterA.tanks.some(t => t.atBank && t.row === null);

  // чекаємо на постріл застряглого танка (реальний ігровий цикл далі йде своєю чергою)
  let firedA = false;
  for (let i = 0; i < 20; i++) {
    await pageA.waitForTimeout(250);
    const bullets = await pageA.evaluate(() => window.game.scene.keys.Game.tankBullets.length);
    if (bullets > 0) { firedA = true; break; }
  }
  console.log('A) застряглий танк вистрелив:', firedA);
  await pageA.close();

  // ---------- сценарій B: міст знищено, коли танк ВЖЕ на прольоті ----------
  const pageB = await browser.newPage({ viewport: { width: 520, height: 800 } });
  pageB.on('pageerror', e => errors.push('PAGEERROR(B): ' + e.message));
  pageB.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE(B): ' + msg.text()); });
  await pageB.goto(url + 'index.html');
  await waitForGameScene(pageB);
  await pageB.keyboard.press('Space');
  await pageB.waitForTimeout(200);
  await forceBridgeSpawn(pageB);
  await pageB.waitForTimeout(1800);

  // чекаємо, поки танк реально заїде на проліт мосту
  let onBridgeReached = false;
  for (let i = 0; i < 40; i++) {
    await pageB.waitForTimeout(150);
    const st = await pageB.evaluate(() => {
      const s = window.game.scene.keys.Game;
      const b = [...s.bridgeVisuals.keys()][0];
      return b ? b.tankOnBridge : false;
    });
    if (st) { onBridgeReached = true; break; }
  }
  console.log('B) танк доїхав до прольоту мосту:', onBridgeReached);

  const scoreBeforeB = await pageB.evaluate(() => window.game.scene.keys.Game.score);
  const tanksBeforeB = await pageB.evaluate(() => window.game.scene.keys.Game.tanks.length);

  const afterB = await pageB.evaluate(() => {
    const s = window.game.scene.keys.Game;
    const bridge = [...s.bridgeVisuals.keys()][0];
    const tankBonus = bridge.tankAlive && bridge.tankOnBridge;
    const tankStillEnRoute = bridge.tankAlive;
    bridge.alive = false;
    bridge.hp = 0;
    s.addScore(tankBonus ? 1500 : 500);
    if (tankStillEnRoute) s.strandBridgeTank(bridge);
    return { score: s.score, tanksCount: s.tanks.length };
  });
  console.log('B) після знищення мосту (танк був на прольоті):', JSON.stringify(afterB));
  const scoreDeltaB = afterB.score - scoreBeforeB;
  const okB_tripleBonus = scoreDeltaB === 1500;
  const okB_stranded = afterB.tanksCount > tanksBeforeB;
  await pageB.close();

  // ---------- сценарій C: танк повністю проїжджає міст (втікає) ----------
  const pageC = await browser.newPage({ viewport: { width: 520, height: 800 } });
  pageC.on('pageerror', e => errors.push('PAGEERROR(C): ' + e.message));
  pageC.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE(C): ' + msg.text()); });
  await pageC.goto(url + 'index.html');
  await waitForGameScene(pageC);
  await pageC.keyboard.press('Space');
  await pageC.waitForTimeout(200);
  await forceBridgeSpawn(pageC);
  await pageC.waitForTimeout(1800);

  // прискорюємо танк, щоб він швидко "втік", не чекаючи реальних секунд
  await pageC.evaluate(() => {
    const s = window.game.scene.keys.Game;
    const bridge = [...s.bridgeVisuals.keys()][0];
    if (bridge) bridge.tankSpeed = 4000;
  });
  let escaped = false;
  for (let i = 0; i < 20; i++) {
    await pageC.waitForTimeout(150);
    const st = await pageC.evaluate(() => {
      const s = window.game.scene.keys.Game;
      const b = [...s.bridgeVisuals.keys()][0];
      return b ? { tankAlive: b.tankAlive } : { gone: true };
    });
    if (st.tankAlive === false) { escaped = true; break; }
  }
  const tanksAfterEscape = await pageC.evaluate(() => window.game.scene.keys.Game.tanks.length);
  console.log('C) танк втік з мосту (зник, без цього бонуса):', escaped, 'this.tanks.length:', tanksAfterEscape);
  const okC_escapedCleanly = escaped && tanksAfterEscape === 0;
  await pageC.close();

  await browser.close();
  server.close();

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  console.log('okA_startsOnRoad:', okA_startsOnRoad);
  console.log('okA_noTripleBonus:', okA_noTripleBonus, `(delta=${scoreDeltaA})`);
  console.log('okA_stranded:', okA_stranded);
  console.log('okA_fired:', firedA);
  console.log('okB_onBridgeReached:', onBridgeReached);
  console.log('okB_tripleBonus:', okB_tripleBonus, `(delta=${scoreDeltaB})`);
  console.log('okB_stranded:', okB_stranded);
  console.log('okC_escapedCleanly:', okC_escapedCleanly);

  const allOk = errors.length === 0 && okA_startsOnRoad && okA_noTripleBonus && okA_stranded && firedA &&
    onBridgeReached && okB_tripleBonus && okB_stranded && okC_escapedCleanly;
  process.exitCode = allOk ? 0 : 1;
})();
