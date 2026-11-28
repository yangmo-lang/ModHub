// 透過 XXMI Launcher 啟動遊戲
//
// 與 XXMI 自己建立的「<遊戲> Quick Start」捷徑相同：
//   <XXMI 資料夾>\Resources\Bin\XXMI Launcher.exe --nogui --xxmi <SRMI|WWMI|ZZMI|EFMI>
// --nogui 會直接注入 3DMigoto 並啟動遊戲；不加則開啟 XXMI Launcher 視窗並切到該遊戲。
//
// XXMI Launcher.exe 的 manifest 要求系統管理員權限（requireAdministrator）。
// child_process.spawn（CreateProcess）不會觸發 UAC，會直接以錯誤 740 失敗；
// 所以改用 Windows Shell 啟動（cmd 的 start = ShellExecute），和雙擊捷徑一樣會跳出 UAC 詢問。
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

/** cmd 的 start 指令：start "" /D "<資料夾>" "<exe>" <參數> */
function startCommand(exe, args) {
  if (/["%^&|<>]/.test(exe)) throw new Error(`XXMI Launcher 路徑含有不支援的字元：${exe}`);
  return `start "" /D "${path.dirname(exe)}" "${exe}" ${args.join(' ')}`;
}

/**
 * 透過 Shell 啟動；start 在 XXMI 開起來（或 UAC 被拒）後就結束，不會等遊戲。
 * @returns Promise<{ exe, args }>，UAC 被拒或找不到檔案時 reject
 */
function launch(xxmiRoot, gameId, opts = {}, spawnImpl = spawn) {
  const exe = launcherExe(xxmiRoot);
  if (!fs.existsSync(exe)) return Promise.reject(new Error(`找不到 XXMI Launcher：${exe}\n請到「設定」確認 XXMI Launcher 資料夾。`));
  const args = launchArgs(gameId, opts);
  let cmd;
  try { cmd = startCommand(exe, args); } catch (e) { return Promise.reject(e); }
  return new Promise((resolve, reject) => {
    const child = spawnImpl(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${cmd}"`], {
      windowsVerbatimArguments: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on('error', (e) => reject(new Error(`無法啟動 XXMI Launcher：${e.message}`)));
    child.on('exit', (code) => {
      if (code === 0) resolve({ exe, args });
      else reject(new Error('XXMI Launcher 沒有啟動（可能是在系統管理員權限詢問視窗按了「否」）'));
    });
  });
}

module.exports = { launcherExe, launchArgs, startCommand, launch };
