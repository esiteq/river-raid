// Запускає всі регресійні тести послідовно і виводить підсумок.
// Використання: node tests/run-all.js   (або npm test)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testFiles = fs.readdirSync(__dirname)
  .filter(f => f.startsWith('test-') && f.endsWith('.js'))
  .sort();

let failed = 0;
for (const file of testFiles) {
  console.log('\n=== ' + file + ' ===');
  try {
    const out = execFileSync('node', [path.join(__dirname, file)], { encoding: 'utf8' });
    console.log(out.trim());
  } catch (err) {
    failed++;
    console.log('FAILED');
    if (err.stdout) console.log(err.stdout.toString());
    if (err.stderr) console.log(err.stderr.toString());
  }
}

console.log('\n============================');
if (failed) {
  console.log(`${failed}/${testFiles.length} тестів провалено`);
  process.exitCode = 1;
} else {
  console.log(`Всі ${testFiles.length} тести пройдено успішно`);
}
