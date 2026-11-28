// 免確認啟動：用 Windows 工作排程以「最高權限」執行需要系統管理員權限的程式（XXMI Launcher、OneDragon、MaaEnd）
//
// 做法：在工作排程的 \ModHub\ 資料夾建立「沒有觸發條件、只能手動執行」的工作（RunLevel = HighestAvailable、
// LogonType = InteractiveToken，在目前登入的桌面執行），之後 ModHub 用 `schtasks /run` 觸發，就不會每次跳 UAC。
// 建立 / 移除工作本身需要系統管理員權限，所以會跳一次 UAC。
// 每個工作的命令列是固定的（schtasks /run 不能帶參數）；設定改變（例如 OneDragon 跑完動作）後命令列不同，
// 就視為「需要更新」，在更新之前改回原本會跳 UAC 的啟動方式。
const { execFile } = require('node:child_process');

const TASK_PATH = '\\ModHub\\';
const NAME_RE = /^[A-Za-z0-9-]{1,40}$/;

/** 命令列參數 → 字串（有空白的加引號；不接受引號與換行，避免命令列被拆錯） */
function joinArgs(args) {
  return (args || []).map((a) => {
    const s = String(a);
    if (/["\r\n\0]/.test(s)) throw new Error(`參數含有不支援的字元：${s}`);
    return s === '' || /\s/.test(s) ? `"${s}"` : s;
  }).join(' ');
}

/** 工作排程看得懂的命令列描述 { name, label, exe, args(字串), dir } */
function entry({ name, label, exe, args = [], dir = '' }) {
  if (!NAME_RE.test(name)) throw new Error(`工作名稱不合法：${name}`);
  if (!exe || /["\r\n\0]/.test(exe)) throw new Error(`執行檔路徑不合法：${exe}`);
  return { name, label: label || name, exe, args: joinArgs(args), dir: dir || '' };
}

const norm = (s) => String(s || '').trim().replace(/\//g, '\\').toLowerCase();
const normArgs = (s) => String(s || '').trim().replace(/\s+/g, ' ');

/**
 * 比對想要的工作與工作排程裡現有的工作
 * @param desired entry() 的陣列
 * @param existing [{ name, exe, args, dir, level, enabled }]（queryTasks 的結果）
 * @returns { items: [{ ...entry, state: 'ok' | 'outdated' | 'missing' }], extra: [工作名稱], any, allOk }
 */
function compare(desired, existing) {
  const byName = new Map((existing || []).map((t) => [String(t.name).toLowerCase(), t]));
  const items = desired.map((d) => {
    const t = byName.get(d.name.toLowerCase());
    if (!t) return { ...d, state: 'missing' };
    const same = norm(t.exe) === norm(d.exe) && normArgs(t.args) === normArgs(d.args)
      && /highest/i.test(String(t.level)) && String(t.enabled) !== 'False';
    return { ...d, state: same ? 'ok' : 'outdated' };
  });
  const want = new Set(desired.map((d) => d.name.toLowerCase()));
  const extra = (existing || []).map((t) => String(t.name)).filter((n) => !want.has(n.toLowerCase()));
  return { items, extra, any: (existing || []).length > 0, allOk: items.length > 0 && items.every((i) => i.state === 'ok') && extra.length === 0 };
}

const psq = (s) => `'${String(s).replace(/'/g, "''")}'`; // PowerShell 單引號字串
const encode = (script) => Buffer.from(script, 'utf16le').toString('base64');

/** 讀工作排程 \ModHub\ 底下的工作（不需要系統管理員權限） */
const QUERY_SCRIPT = [
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  `$t = @(Get-ScheduledTask -TaskPath ${psq(TASK_PATH)} -ErrorAction SilentlyContinue | ForEach-Object {`,
  '  $a = $_.Actions | Select-Object -First 1',
  '  [pscustomobject]@{ name = $_.TaskName; exe = [string]$a.Execute; args = [string]$a.Arguments; dir = [string]$a.WorkingDirectory; level = [string]$_.Principal.RunLevel; enabled = [string]$_.Settings.Enabled }',
  '})',
  'ConvertTo-Json -InputObject $t -Compress -Depth 3',
].join('\n');

function parseQuery(out) {
  const text = String(out || '').trim();
  if (!text) return [];
  const j = JSON.parse(text);
  return (Array.isArray(j) ? j : [j]).filter((t) => t && t.name);
}

function powershell(script, { timeout = 20000, execFileImpl = execFile } = {}) {
  return new Promise((resolve, reject) => {
    execFileImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(script)],
      { windowsHide: true, timeout, encoding: 'utf8', maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
        if (err) { err.stdout = stdout; err.stderr = stderr; reject(err); } else resolve(String(stdout || ''));
      });
  });
}

async function queryTasks(opts) {
  return parseQuery(await powershell(QUERY_SCRIPT, opts));
}

/**
 * 以系統管理員權限執行的 PowerShell：移除 \ModHub\ 裡不要的工作、建立 / 覆蓋 desired 的工作；desired 為空 = 全部移除並刪掉資料夾
 * 工作的 XML 在提升權限的 PowerShell 裡產生（用 SecurityElement.Escape 跳脫），不經過暫存檔
 */
function setupScript(desired, userId) {
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    'function X([string]$s) { [Security.SecurityElement]::Escape($s) }',
    'function New-ModHubTask([string]$name, [string]$desc, [string]$exe, [string]$arguments, [string]$dir) {',
    '  $wd = if ($dir) { "<WorkingDirectory>$(X $dir)</WorkingDirectory>" } else { "" }',
    '  $xml = "<Task version=`"1.2`" xmlns=`"http://schemas.microsoft.com/windows/2004/02/mit/task`">' +
      '<RegistrationInfo><Author>ModHub</Author><Description>$(X $desc)</Description></RegistrationInfo><Triggers />' +
      '<Principals><Principal id=`"Author`"><UserId>$(X $user)</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>' +
      '<Settings><MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>' +
      '<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>false</StartWhenAvailable>' +
      '<AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>false</Hidden><ExecutionTimeLimit>PT0S</ExecutionTimeLimit>' +
      // 優先順序 4 = 一般（工作排程預設 7 是「低於標準」，會連帶讓遊戲也變低優先）
      '<Priority>4</Priority><IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings></Settings>' +
      '<Actions Context=`"Author`"><Exec><Command>$(X $exe)</Command><Arguments>$(X $arguments)</Arguments>$wd</Exec></Actions></Task>"',
    `  Register-ScheduledTask -TaskPath ${psq(TASK_PATH)} -TaskName $name -Xml $xml -Force | Out-Null`,
    '}',
    'try {',
    `  $user = ${psq(userId)}`,
    `  $keep = @(${desired.map((d) => psq(d.name)).join(', ')})`,
    `  Get-ScheduledTask -TaskPath ${psq(TASK_PATH)} -ErrorAction SilentlyContinue | Where-Object { $keep -notcontains $_.TaskName } | Unregister-ScheduledTask -Confirm:$false`,
    ...desired.map((d) => `  New-ModHubTask ${[d.name, d.label, d.exe, d.args, d.dir].map(psq).join(' ')}`),
  ];
  if (!desired.length) {
    lines.push(
      '  try { $svc = New-Object -ComObject Schedule.Service; $svc.Connect(); $svc.GetFolder(\'\\\').DeleteFolder(\'ModHub\', 0) } catch {}',
    );
  }
  lines.push('  exit 0', '} catch { exit 1 }');
  return lines.join('\n');
}

/** 非提升權限的 PowerShell 再用 Start-Process -Verb RunAs 開提升權限的 PowerShell（跳 UAC）；UAC 按「否」回傳 1223 */
function elevatedLauncherScript(innerScript) {
  return [
    'try {',
    `  $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encode(innerScript)}'`,
    '  exit $p.ExitCode',
    '} catch { exit 1223 }',
  ].join('\n');
}

/** 跳一次 UAC，建立 / 更新（desired 非空）或全部移除（desired 為空）\ModHub\ 的工作 */
async function applyTasks(desired, userId, opts = {}) {
  if (!userId) throw new Error('讀不到目前的 Windows 使用者名稱');
  try {
    await powershell(elevatedLauncherScript(setupScript(desired, userId)), { timeout: 120000, ...opts });
  } catch (err) {
    if (err.code === 1223) throw new Error('已取消（在系統管理員權限詢問視窗按了「否」）');
    throw new Error(`工作排程設定失敗（代碼 ${err.code ?? '?'}）`);
  }
}

/** 執行 \ModHub\<name> 工作（不需要系統管理員權限、不跳 UAC） */
function runTask(name, { execFileImpl = execFile } = {}) {
  if (!NAME_RE.test(name)) return Promise.reject(new Error(`工作名稱不合法：${name}`));
  return new Promise((resolve, reject) => {
    execFileImpl('schtasks.exe', ['/run', '/tn', `${TASK_PATH}${name}`], { windowsHide: true, timeout: 15000 }, (err) => (err ? reject(new Error(`工作排程執行失敗：${name}`)) : resolve()));
  });
}

/** 以系統管理員權限啟動一般程式（ShellExecute runas，跳 UAC）；給沒有 requireAdministrator manifest 但需要權限的程式（MaaEnd） */
async function runAsAdmin(exe, args = [], dir = '', opts = {}) {
  const a = joinArgs(args);
  const script = [
    'try {',
    `  Start-Process -FilePath ${psq(exe)}${dir ? ` -WorkingDirectory ${psq(dir)}` : ''} -Verb RunAs${a ? ` -ArgumentList ${psq(a)}` : ''}`,
    '  exit 0',
    '} catch { exit 1223 }',
  ].join('\n');
  try {
    await powershell(script, { timeout: 120000, ...opts });
  } catch (err) {
    throw new Error(err.code === 1223 ? '沒有啟動（可能是在系統管理員權限詢問視窗按了「否」）' : `無法啟動：${err.message}`);
  }
}

/** 工作排程裡的使用者：網域\帳號 */
function currentUserId(env = process.env, os = require('node:os')) {
  const user = env.USERNAME || os.userInfo().username;
  const domain = env.USERDOMAIN || env.COMPUTERNAME || '';
  return user ? (domain ? `${domain}\\${user}` : user) : '';
}

module.exports = { TASK_PATH, joinArgs, entry, compare, parseQuery, setupScript, elevatedLauncherScript, queryTasks, applyTasks, runTask, runAsAdmin, currentUserId, encode, psq, powershell };
