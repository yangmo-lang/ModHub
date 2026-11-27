// 解壓與安裝：下載來的壓縮檔一律當成不可信資料
//  - 只解壓、不執行任何檔案
//  - 先解到暫存區（staging），檢查路徑都在暫存區內、移除符號連結
//  - 預設排除可執行檔（.exe/.dll/.bat…）
//  - 使用者確認後才搬進 Mods
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const EXEC_EXT = new Set(['.exe', '.dll', '.bat', '.cmd', '.ps1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.scr', '.msi', '.com', '.lnk', '.reg', '.hta', '.cpl', '.jar', '.sys']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const JUNK = new Set(['__macosx', '.ds_store', 'thumbs.db', 'desktop.ini']);
const ARCHIVE_EXT = new Set(['.zip', '.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2', '.xz']);

function sevenZipPath() {
  // 打包成 asar 時要改用 app.asar.unpacked 裡的路徑
  return require('7zip-bin').path7za.replace('app.asar', 'app.asar.unpacked');
}

/** 把壓縮檔內的路徑整理成安全的相對路徑（去掉磁碟代號、開頭斜線、.. 與非法字元） */
function sanitizeEntryPath(name) {
  const parts = String(name).replace(/\\/g, '/').split('/')
    .map((p) => p.trim())
    .filter((p) => p && p !== '.' && p !== '..' && !/^[a-z]:$/i.test(p))
    .map((p) => p.replace(/[<>:"|?*\x00-\x1f]/g, '_'));
  return parts.join(path.sep) || '_';
}

function isInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function run7z(args) {
  return new Promise((resolve, reject) => {
    execFile(sevenZipPath(), args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`解壓失敗：${(stderr || stdout || err.message).toString().trim().split('\n').slice(-2).join(' ')}`));
      else resolve(stdout);
    });
  });
}

async function extractRar(archive, dest) {
  const { createExtractorFromFile } = require('node-unrar-js');
  const extractor = await createExtractorFromFile({ filepath: archive, targetPath: dest, filenameTransform: sanitizeEntryPath });
  // extract() 是惰性的，要把 files 迭代完才會真的寫檔
  const { files } = extractor.extract();
  for (const _f of files) { /* consume */ }
}

/** 解壓到 dest（必須是空資料夾） */
async function extractArchive(archive, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const ext = path.extname(archive).toLowerCase();
  if (ext === '.rar') {
    await extractRar(archive, dest);
  } else {
    // -snl- 不建立符號連結；7z 本身也會拒絕危險路徑
    await run7z(['x', archive, `-o${dest}`, '-y', '-bd', '-bso0', '-bsp0', '-snl-']);
  }
  hardenTree(dest);
}

/** 移除符號連結 / junction，確認所有檔案都在 root 內 */
function hardenTree(root) {
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) { fs.rmSync(full, { force: true, recursive: true }); continue; }
      if (!isInside(root, fs.realpathSync(full))) { fs.rmSync(full, { force: true, recursive: true }); continue; }
      if (st.isDirectory()) walk(full);
    }
  };
  walk(root);
}

function listTree(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listTree(full, base, out);
    else out.push({ rel: path.relative(base, full), size: fs.statSync(full).size });
  }
  return out;
}

/** 找出真正的 MOD 根目錄：一路往下穿過「只有一個子資料夾、沒有檔案」的外層 */
function findModRoot(dir) {
  let cur = dir;
  for (let i = 0; i < 6; i++) {
    const entries = fs.readdirSync(cur, { withFileTypes: true }).filter((e) => !JUNK.has(e.name.toLowerCase()));
    const dirs = entries.filter((e) => e.isDirectory());
    const files = entries.filter((e) => e.isFile());
    if (files.length === 0 && dirs.length === 1) cur = path.join(cur, dirs[0].name);
    else break;
  }
  return cur;
}

function analyze(stagingDir) {
  const root = findModRoot(stagingDir);
  const files = listTree(root);
  const lower = (f) => f.rel.toLowerCase();
  const inis = files.filter((f) => lower(f).endsWith('.ini'));
  const executables = files.filter((f) => EXEC_EXT.has(path.extname(lower(f))));
  const archives = files.filter((f) => ARCHIVE_EXT.has(path.extname(lower(f))));
  const images = files.filter((f) => IMAGE_EXT.has(path.extname(lower(f))));
  // 多個獨立 MOD 包在一起：第一層有多個資料夾且各自含 ini
  const topDirs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !JUNK.has(e.name.toLowerCase()));
  const variants = topDirs.filter((d) => listTree(path.join(root, d.name)).some((f) => lower(f).endsWith('.ini'))).map((d) => d.name);
  return {
    root,
    rootName: path.basename(root),
    fileCount: files.length,
    totalSize: files.reduce((s, f) => s + f.size, 0),
    iniCount: inis.length,
    inis: inis.slice(0, 20).map((f) => f.rel),
    executables: executables.map((f) => f.rel),
    nestedArchives: archives.map((f) => f.rel),
    hasImage: images.length > 0,
    variants: hasDirectIni(root) ? [] : variants,
  };
}

function hasDirectIni(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).some((e) => e.isFile() && e.name.toLowerCase().endsWith('.ini'));
}

function removeFiles(root, rels) {
  for (const rel of rels) {
    const full = path.join(root, rel);
    if (isInside(root, full)) fs.rmSync(full, { force: true });
  }
}

function uniqueTarget(dir, name) {
  let target = path.join(dir, name);
  for (let i = 2; fs.existsSync(target) || fs.existsSync(path.join(dir, `DISABLED_${name}`)); i++) {
    target = path.join(dir, `${name} (${i})`);
  }
  return target;
}

function moveDir(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
}

/**
 * 安裝：把 staging 裡的 MOD 根目錄搬進分類資料夾
 * @param {object} o
 *  modsRoot, categoryDir（已建立好的分類資料夾）, analysis, folderName,
 *  excludeExecutables, replacePath（更新時要取代的舊 MOD）, backupDir, meta（寫入 .modhub.json）
 */
function install(o) {
  const { analysis, categoryDir, modsRoot } = o;
  if (!isInside(modsRoot, categoryDir)) throw new Error('目標分類不在 Mods 目錄內');
  if (o.excludeExecutables && analysis.executables.length) removeFiles(analysis.root, analysis.executables);

  const folderName = sanitizeEntryPath(o.folderName || analysis.rootName).split(path.sep).pop();
  let target;
  if (o.replacePath && fs.existsSync(o.replacePath)) {
    if (!isInside(modsRoot, o.replacePath)) throw new Error('要取代的 MOD 不在 Mods 目錄內');
    // 舊版本先備份；保留原本的啟用/停用狀態與位置
    const wasDisabled = /^disabled_?/i.test(path.basename(o.replacePath));
    fs.mkdirSync(o.backupDir, { recursive: true });
    moveDir(o.replacePath, path.join(o.backupDir, `${path.basename(o.replacePath)}-${Date.now()}`));
    target = path.join(path.dirname(o.replacePath), wasDisabled ? `DISABLED_${folderName}` : folderName);
    if (fs.existsSync(target)) target = uniqueTarget(path.dirname(o.replacePath), folderName);
  } else {
    target = uniqueTarget(categoryDir, folderName);
  }
  moveDir(analysis.root, target);
  if (o.meta) fs.writeFileSync(path.join(target, '.modhub.json'), JSON.stringify({ ...o.meta, installedAt: new Date().toISOString() }, null, 2), 'utf8');
  return target;
}

function newStagingDir(base) {
  const dir = path.join(base, crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function md5File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

module.exports = { extractArchive, analyze, install, sanitizeEntryPath, newStagingDir, md5File, isInside, hardenTree, ARCHIVE_EXT };
