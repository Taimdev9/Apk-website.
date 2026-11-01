const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs/promises');
const crypto   = require('crypto');
const sharp    = require('sharp');
const { exec } = require('child_process');
const { promisify } = require('util');
const AdmZip   = require('adm-zip');

const execAsync = promisify(exec);

const app  = express();
const PORT = process.env.PORT || 3000;

const ROOT     = __dirname;
const TEMPLATE = path.join(ROOT, 'template');
const BUILDS   = path.join(ROOT, 'builds');
const UPLOADS  = path.join(ROOT, 'uploads');

const upload = multer({
  dest: UPLOADS,
  limits: { fileSize: 25 * 1024 * 1024 }
});

app.use(express.static(path.join(ROOT, 'public')));
app.use(express.json());

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
  })[c]);
}

async function ensureDirs() {
  await fs.mkdir(BUILDS,  { recursive: true });
  await fs.mkdir(UPLOADS, { recursive: true });
}

async function cleanupUploads(files) {
  if (!files) return;
  for (const key of Object.keys(files)) {
    for (const f of files[key]) {
      await fs.rm(f.path, { force: true }).catch(() => {});
    }
  }
}

async function ensureTemplate() {
  if (await exists(path.join(TEMPLATE, 'config.xml'))) {
    console.log('✔ Cordova template ready');
    return;
  }
  console.log('⟳ Creating Cordova template (first run, takes a few minutes)...');

  await execAsync('cordova create template com.htmltoapk.app HtmlToApk', { cwd: ROOT });
  await execAsync('cordova platform add android', { cwd: TEMPLATE });

  const cfgPath = path.join(TEMPLATE, 'config.xml');
  const cfg = await fs.readFile(cfgPath, 'utf8');
  const patched = cfg.replace(
    /<widget([^>]*)>/,
    '<widget$1>\n    <allow-intent href="*" />\n    <allow-navigation href="*" />'
  );
  await fs.writeFile(cfgPath, patched);
}

async function extractUpload(file, dest) {
  const ext = (file.originalname.split('.').pop() || '').toLowerCase();

  if (ext === 'zip') {
    const zip = new AdmZip(file.path);
    zip.extractAllTo(dest, true);

    const entries = await fs.readdir(dest);
    if (entries.length === 1) {
      const inner = path.join(dest, entries[0]);
      const st = await fs.stat(inner);
      if (st.isDirectory()) {
        const inside = await fs.readdir(inner);
        for (const f of inside) {
          await fs.rename(path.join(inner, f), path.join(dest, f));
        }
        await fs.rm(inner, { recursive: true, force: true });
      }
    }
  } else if (ext === 'html' || ext === 'htm') {
    await fs.copyFile(file.path, path.join(dest, 'index.html'));
  } else {
    throw new Error('File must be .html or .zip');
  }

  if (!(await exists(path.join(dest, 'index.html')))) {
    throw new Error('index.html not found inside the upload');
  }
}

async function applyNameAndIcon(workDir, appName, iconPath) {
  const safeName = escapeXml(appName);

  const cfgPath = path.join(workDir, 'config.xml');
  let cfg = await fs.readFile(cfgPath, 'utf8');
  cfg = cfg.replace(/<name>[^<]*<\/name>/, `<name>${safeName}</name>`);
  await fs.writeFile(cfgPath, cfg);

  const stringsPath = path.join(workDir, 'platforms', 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
  if (await exists(stringsPath)) {
    let s = await fs.readFile(stringsPath, 'utf8');
    s = s.replace(/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${safeName}</string>`);
    s = s.replace(/<string name="launcher_name">[^<]*<\/string>/, `<string name="launcher_name">${safeName}</string>`);
    s = s.replace(/<string name="activity_name">[^<]*<\/string>/, `<string name="activity_name">${safeName}</string>`);
    await fs.writeFile(stringsPath, s);
  }

  if (iconPath) {
    const sizes = {
      'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96,
      'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192
    };
    const resDir = path.join(workDir, 'platforms', 'android', 'app', 'src', 'main', 'res');

    for (const [folder, size] of Object.entries(sizes)) {
      const target = path.join(resDir, folder);
      if (!(await exists(target))) continue;
      const png      = path.join(target, 'ic_launcher.png');
      const roundPng = path.join(target, 'ic_launcher_round.png');

      try {
        await sharp(iconPath).resize(size, size, { fit: 'cover', position: 'center' }).png().toFile(png);
        if (await exists(roundPng)) await fs.copyFile(png, roundPng);
      } catch (e) { console.error('Icon error:', e.message); }
    }

    const anydpi = path.join(resDir, 'mipmap-anydpi-v26');
    if (await exists(anydpi)) {
      for (const f of await fs.readdir(anydpi)) await fs.unlink(path.join(anydpi, f)).catch(() => {});
    }
  }
}

async function buildApk(workDir) {
  await execAsync('cordova build android', { cwd: workDir, maxBuffer: 30 * 1024 * 1024 });
  const apkPath = path.join(workDir, 'platforms', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (!(await exists(apkPath))) throw new Error('Build finished but APK is missing');
  return apkPath;
}

app.post(
  '/api/build',
  upload.fields([{ name: 'file', maxCount: 1 }, { name: 'icon', maxCount: 1 }]),
  async (req, res) => {
    const htmlFile = req.files && req.files.file && req.files.file[0];
    const iconFile = req.files && req.files.icon && req.files.icon[0];
    const appName  = (req.body.name || '').trim() || 'My App';

    if (!htmlFile) return res.status(400).json({ error: 'لم يتم رفع ملف' });

    const id = crypto.randomBytes(6).toString('hex');
    const workDir = path.join(BUILDS, id);

    try {
      await fs.cp(TEMPLATE, workDir, { recursive: true });
      const www = path.join(workDir, 'www');
      await fs.rm(www, { recursive: true, force: true });
      await fs.mkdir(www, { recursive: true });
      await extractUpload(htmlFile, www);
      await applyNameAndIcon(workDir, appName, iconFile ? iconFile.path : null);
      const apkPath = await buildApk(workDir);

      const safeFileName = appName.replace(/[^\w\u0600-\u06FF\- ]+/g, '').trim() || 'app';
      res.download(apkPath, `${safeFileName}.apk`, async () => {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
        await cleanupUploads(req.files);
      });
    } catch (err) {
      console.error('BUILD ERROR:', err.stderr || err.message);
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
      await cleanupUploads(req.files);
      res.status(500).json({ error: 'فشل البناء: ' + (err.stderr || err.message) });
    }
  }
);

(async () => {
  await ensureDirs();
  await ensureTemplate();
  app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`));
})();
