// 透過 XXMI Launcher 啟動遊戲
//
// 與 XXMI 自己建立的「<遊戲> Quick Start」捷徑相同：
//   <XXMI 資料夾>\Resources\Bin\XXMI Launcher.exe --nogui --xxmi <SRMI|WWMI|ZZMI|EFMI>
// --nogui 會直接注入 3DMigoto 並啟動遊戲；不加則開啟 XXMI Launcher 視窗並切到該遊戲。
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const GAME_IDS = new Set(['SRMI', 'WWMI', 'ZZMI', 'EFMI']);

function launcherExe(xxmiRoot) {
  return path.join(xxmiRoot, 'Resources', 'Bin', 'XXMI Launcher.exe');
}

function launchArgs(gameId, { gui = false } = {}) {
  if (!GAME_IDS.has(gameId)) throw new Error(`不支援的遊戲：${gameId}`);
  return gui ? ['--xxmi', gameId] : ['--nogui', '--xxmi', gameId];
}

/** 啟動後不等待（XXMI 與遊戲獨立執行，關掉 ModHub 也不受影響） */
function launch(xxmiRoot, gameId, opts = {}, spawnImpl = spawn) {
  const exe = launcherExe(xxmiRoot);
  if (!fs.existsSync(exe)) throw new Error(`找不到 XXMI Launcher：${exe}\n請到「設定」確認 XXMI Launcher 資料夾。`);
  const child = spawnImpl(exe, launchArgs(gameId, opts), {
    cwd: path.dirname(exe),
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.on?.('error', () => {});
  child.unref?.();
  return { exe, args: launchArgs(gameId, opts) };
}

module.exports = { launcherExe, launchArgs, launch };
