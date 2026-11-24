// Logo 牆動畫算圖：啟動本機伺服器與無頭瀏覽器，把每一格畫面交給 ffmpeg 編碼成影片。
//
// 用法（在專案根目錄）：
//   node tools/logo_film/render.mjs            產生橫式與直式影片與開場靜態圖
//   node tools/logo_film/render.mjs wide       只產生橫式
//   node tools/logo_film/render.mjs tall       只產生直式
//   node tools/logo_film/render.mjs stills wide 0,2,5,9 輸出資料夾   只看幾格（調整動畫時用）
//
// 需要：Node 22 以上、Edge 或 Chrome、ffmpeg。Logo 來自 js/portal-data.js，更新 Logo 後重跑即可。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
// Windows 優先用 Edge：有些電腦把 Chrome 設成「以系統管理員身分執行」，每次啟動都會跳使用者帳戶控制視窗
const BROWSER = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find((p) => p && existsSync(p));
if (!BROWSER) throw new Error('找不到 Edge 或 Chrome，請設定環境變數 BROWSER_PATH');

const FORMATS = {
  wide: { w: 2240, h: 1080, out: 'assets/video/logo-wall.mp4', poster: 'assets/portal/logo-wall-poster.webp', crf: 20, level: '5.0' },
  tall: { w: 1080, h: 1920, out: 'assets/video/logo-wall-m.mp4', poster: 'assets/portal/logo-wall-poster-m.webp', crf: 23, level: '4.2' }
};

function run(query, { onFrame, onStill } = {}) {
  return new Promise((done, fail) => {
    const profile = mkdtempSync(join(tmpdir(), 'logo-film-'));
    let ended = false, seen = Date.now();
    let child;
    const finish = async (err) => {
      if (ended) return;
      ended = true;
      clearInterval(watchdog);
      if (child) child.kill();
      server.close();
      server.closeAllConnections();
      setTimeout(() => {
        try { rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch { /* 瀏覽器還沒完全結束，留給系統清 */ }
        if (err) fail(err); else done();
      }, 800);
    };
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      seen = Date.now();
      if (req.method === 'POST') {
        const parts = [];
        req.on('data', (d) => parts.push(d));
        req.on('end', async () => {
          const body = Buffer.concat(parts);
          try {
            if (url.pathname === '/frame') await onFrame(body);
            else if (url.pathname === '/still') await onStill(url.searchParams.get('t'), body);
            else if (url.pathname === '/log') {
              console.log('  ' + body.toString());
              if (/^(ERROR|REJECT|SHADER|LINK)/.test(body.toString())) { res.end(); finish(new Error(body.toString())); return; }
            }
            res.end('ok');
            if (url.pathname === '/done') finish();
          } catch (e) { res.statusCode = 500; res.end(); finish(e); }
        });
        return;
      }
      const file = join(ROOT, normalize(decodeURIComponent(url.pathname)).replace(/^[/\\.]+/, ''));
      if (!file.startsWith(ROOT) || !existsSync(file)) { res.statusCode = 404; res.end(); return; }
      res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
      createReadStream(file).pipe(res);
    });
    const open = () => {
      const params = Object.entries(query).map(([k, v]) => `${k}=${v}`).join('&'); // 只用英數與逗號，不需要 % 編碼
      const page = `http://127.0.0.1:${server.address().port}/tools/logo_film/index.html?${params}`;
      child = spawn(BROWSER, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', '--use-angle=d3d11',
        '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-watchdog', `--user-data-dir=${profile}`, '--window-size=1280,720', page], { stdio: 'ignore' });
      child.on('error', finish);
    };
    const watchdog = setInterval(() => {
      if (Date.now() - seen > 90000) finish(new Error('瀏覽器超過 90 秒沒有回應'));
    }, 1000);
    server.listen(0, '127.0.0.1', open);
  });
}

async function still(fmt, times, dir, type = 'jpeg', samples = 48) {
  mkdirSync(dir, { recursive: true });
  const f = FORMATS[fmt];
  await run({ w: f.w, h: f.h, stills: times, samples, type }, {
    onStill: async (t, body) => {
      const file = join(dir, `${fmt}_${String(t).replace('.', '_')}.${type === 'webp' ? 'webp' : 'jpg'}`);
      writeFileSync(file, body);
      console.log('  still', file);
    }
  });
}

async function film(fmt) {
  const f = FORMATS[fmt];
  const out = join(ROOT, f.out);
  const tmp = out.replace(/\.mp4$/, '.tmp.mp4'); // 編碼完成才換上，網站不會讀到半截影片
  mkdirSync(dirname(out), { recursive: true });
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${f.w}x${f.h}`, '-r', '30', '-i', '-',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryslow', '-crf', String(f.crf), '-profile:v', 'high', '-level', f.level, '-refs', '4',
    '-g', '60', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', '-an', tmp], { stdio: ['pipe', 'inherit', 'inherit'] });
  const encoded = new Promise((ok, no) => ff.on('close', (c) => (c === 0 ? ok() : no(new Error('ffmpeg ' + c)))));
  console.log(`算圖 ${fmt} ${f.w}×${f.h}`);
  await run({ w: f.w, h: f.h, samples: process.env.SAMPLES || 128 }, {
    onFrame: (body) => new Promise((ok) => { if (ff.stdin.write(body)) ok(); else ff.stdin.once('drain', ok); })
  });
  ff.stdin.end();
  await encoded;
  renameSync(tmp, out);
  // 開場靜態圖＝影片第一格，影片載入前後不會跳動
  await run({ w: f.w, h: f.h, stills: '0', samples: 128, type: 'webp' }, { onStill: async (t, body) => writeFileSync(join(ROOT, f.poster), body) });
  console.log('完成', f.out, f.poster);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'stills') await still(rest[0], rest[1], resolve(rest[2] || '.'));
else if (cmd) await film(cmd);
else for (const fmt of Object.keys(FORMATS)) await film(fmt);
process.exit(0);
