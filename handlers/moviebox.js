// handlers/moviebox.js — MovieBox (themoviebox.xyz) BFF API → Telegram direct upload
// Quality: 480p / 720p | Direct MP4 streams
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const SITE = 'https://themoviebox.xyz';
const API = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';
const CB_PREFIX = 'mb_'; // callbacks: mb_<idx> / mbq_<quality>_<idx>_<se>_<ep>

// Primary + fallback referer pairs — BFF එක එක referer එකකට whitelist කරලා තියෙන්න පුළුවන්
const REF_SITES = [
  { Referer: SITE + '/', Origin: SITE },
  { Referer: 'https://moviebox.ph/', Origin: 'https://moviebox.ph' },
];

let activeRef = 0; // fallback trigger උනාම 1 වෙනවා

const headers = () => ({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  ...REF_SITES[activeRef],
  'X-Client-Info': '{"timezone":"Asia/Colombo"}',
  'X-Request-Lang': 'en',
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'cross-site',
});

// Player-side headers for stream domain (netfilm.world etc.)
const playerHeaders = () => ({
  'User-Agent': headers()['User-Agent'],
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'cross-site',
  ...REF_SITES[activeRef],
});

const cache = new Map();
const cacheSet = (k, v, ttl = 30 * 60 * 1000) => {
  cache.set(k, { v, time: Date.now() });
  setTimeout(() => cache.delete(k), ttl).unref?.();
};

/* ================= API helpers ================= */
async function apiGet(url, extra = {}) {
  const { data } = await axios.get(url, { headers: { ...headers(), ...extra }, timeout: 25000 });
  return data;
}

async function apiPost(url, payload) {
  const { data } = await axios.post(url, payload, { headers: headers(), timeout: 25000 });
  return data;
}

/* ================= 1. Search ================= */
async function search(query, page = 1) {
  const data = await apiPost(`${API}/subject/search`, { keyword: query, page, perPage: 20 });
  const inner = data?.data || {};
  const raw = inner.items || inner.list || [];
  return raw.map(s => (s.subject || s)).filter(s => s && s.subjectId).map(s => ({
    title: s.title,
    subjectId: String(s.subjectId),
    slug: s.detailPath || '',
    poster: s.cover?.url || null,
    year: s.year || '',
    type: s.subjectType || 'movie',
  }));
}

// Fallback එකත් එක්ක search — first site block උනොත් දෙවෙනි referer එක try කරනවා
async function searchWithFallback(query, page = 1) {
  try {
    const r = await search(query, page);
    if (r.length) return r;
  } catch (e) { /* fallback try */ }
  activeRef = 1;
  try { return await search(query, page); } finally { activeRef = 0; }
}

/* ================= 2. Streams (direct MP4 480p/720p) ================= */
async function getDomain() {
  const d = await apiGet(`${API}/media-player/get-domain`);
  return (d?.data || 'https://netfilm.world').replace(/\/$/, '');
}

// movie: se=1,ep=1 | series: user දෙන se/ep
async function getStreams(subjectId, slug, se = 1, ep = 1) {
  const domain = await getDomain();
  const referer = `${domain}/spa/videoPlayPage/movies/${slug}?id=${subjectId}&type=/movie/detail&detailSe=${se}&detailEp=${ep}&lang=en`;
  const d = await apiGet(
    `${domain}/wefeed-h5api-bff/subject/play?subjectId=${subjectId}&se=${se}&ep=${ep}&detailPath=${encodeURIComponent(slug)}`,
    { Referer: referer, Accept: 'application/json' }
  );
  const pd = d?.data || {};
  if (!pd.hasResource) return [];
  return (pd.streams || []).map(s => ({
    quality: `${s.resolutions}p`,
    url: s.url,
    format: (s.format || 'MP4').toUpperCase(),
    size: s.size || 0,
    duration: s.duration || 0,
    codec: s.codecName || '',
  })).filter(s => s.url && s.format === 'MP4');
}

/* ================= Download + convert + upload ================= */
function downloadFile(url, dest, onPct, referer) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('http://') ? require('http') : require('https');
    mod.get(url, {
      headers: {
        'User-Agent': headers()['User-Agent'],
        Referer: referer || domainReferer(),
        Range: 'bytes=0-',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(downloadFile(res.headers.location, dest, onPct, referer));
      }
      if (res.statusCode !== 206 && res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      const out = fs.createWriteStream(dest);
      let got = 0, last = -1;
      res.on('data', (c) => {
        got += c.length;
        if (total && onPct) {
          const pct = Math.floor(got / total * 100);
          if (pct !== last) { last = pct; onPct(pct); }
        }
      });
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      res.on('error', reject);
    }).on('error', reject);
  });
}

let _domain = null;
function domainReferer() {
  return `${_domain || 'https://netfilm.world'}/`;
}

function convertToMp4(inPath) {
  return new Promise((resolve) => {
    const outPath = inPath.replace(/\.[^.]+$/, '') + '_c.mp4';
    execFile('ffmpeg', ['-y', '-i', inPath, '-c', 'copy', '-movflags', '+faststart', outPath],
      { timeout: 30 * 60 * 1000 }, (err) => {
        if (err || !fs.existsSync(outPath)) return resolve({ outPath: inPath, reencoded: false });
        fs.unlink(inPath, () => {});
        resolve({ outPath, reencoded: false });
      });
  });
}

async function uploadMp4(ctx, mp4Path, caption) {
  await ctx.replyWithVideo(
    { source: fs.createReadStream(mp4Path) },
    { caption, supports_streaming: true, parse_mode: 'HTML' }
  );
}

/* ================= Commands ================= */
async function cmdMoviebox(ctx) {
  const query = (ctx.message?.text || '').replace(/^\/mb\s*/i, '').trim();
  if (!query) return ctx.reply('🎬 Usage: /mb <movie name>\nඋදා: /mb fast x');
  const wait = await ctx.reply('🔎 MovieBox (themoviebox.xyz) search...');
  try {
    const results = await searchWithFallback(query);
    ctx.telegram.deleteMessage(wait.chat.id, wait.message_id).catch(() => {});
    if (!results.length) return ctx.reply(`❌ "${query}" වලට results නෑ.`);
    cacheSet(`mb_r_${ctx.chat.id}`, results);
    const buttons = results.slice(0, 10).map((r, i) =>
      [{ text: `${r.title}${r.year ? ' (' + r.year + ')' : ''}`.slice(0, 60), callback_data: `mb_${i}` }]);
    await ctx.reply(`🎬 <b>${query}</b> — MovieBox results:`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
  } catch (e) {
    console.error('mb search:', e.message);
    ctx.telegram.deleteMessage(wait.chat.id, wait.message_id).catch(() => {});
    ctx.reply('⚠️ MovieBox connect වෙන්න බැරි වුණා.');
  }
}

async function handleMbCallback(ctx) {
  const raw = ctx.callbackQuery?.data || '';
  await ctx.answerCbQuery();
  const parts = raw.split('_'); // mb_<idx> | mbq_<q>_<idx>_<se>_<ep>

  /* ---- Step 1: film select → 480p / 720p buttons ---- */
  if (parts[0] === 'mb') {
    const idx = parseInt(parts[1], 10);
    const cached = cache.get(`mb_r_${ctx.chat.id}`);
    const item = cached?.v?.[idx];
    if (!item) return ctx.reply('⌛ Expired. නැවත /mb search කරන්න.');
    cacheSet(`mb_i_${ctx.chat.id}`, { item, idx });
    try {
      _domain = await getDomain();
      const streams = await getStreams(item.subjectId, item.slug, 1, 1);
      if (!streams.length) return ctx.reply(`❌ Streams හම්බුනේ නෑ.\n${SITE}/detail/${item.slug}`);
      cacheSet(`mb_s_${ctx.chat.id}`, streams);

      const kb = ['480', '720'].map(q => {
        const s = streams.find(x => x.quality === q + 'p');
        return [{ text: s ? `🎬 ${s.quality}${s.size ? ' • ' + (s.size / 1024 / 1024 / 1024).toFixed(2) + ' GB' : ''}` : `${q}p ❌`,
                  callback_data: s ? `mbq_${q}_${idx}_1_1` : 'mb_none' }];
      });
      await ctx.editMessageText(`<b>${item.title}</b>\n\nQuality select කරන්න:`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
    } catch (e) {
      console.error('mb streams:', e.message);
      ctx.reply('⚠️ Streams error.');
    }
    return;
  }

  /* ---- Step 2: quality select → direct download → upload ---- */
  if (parts[0] === 'mbq') {
    const [, q, idx, se, ep] = parts;
    const item = cache.get(`mb_i_${ctx.chat.id}`)?.v?.item;
    const streams = cache.get(`mb_s_${ctx.chat.id}`)?.v || [];
    const chosen = streams.find(s => s.quality === q + 'p');
    if (!item || !chosen) return ctx.reply('⌛ Expired. නැවත /mb search කරන්න.');

    const prog = await ctx.reply(`⬇️ <b>${q}p</b> direct download... 0%`, { parse_mode: 'HTML' });
    const tmp = path.join(os.tmpdir(), `mb_${Date.now()}.mp4`);
    try {
      console.log(`✅ MB direct: ${chosen.url}`);
      await downloadFile(chosen.url, tmp, (pct) => {
        ctx.telegram.editMessageText(prog.chat.id, prog.message_id,
          `⬇️ Download: ${pct}%\n🎬 ${item.title} (${q}p)`, { parse_mode: 'HTML' }).catch(() => {});
      });

      ctx.telegram.editMessageText(prog.chat.id, prog.message_id,
        '🎬 MP4 faststart...', { parse_mode: 'HTML' }).catch(() => {});
      const conv = await convertToMp4(tmp);

      ctx.telegram.editMessageText(prog.chat.id, prog.message_id,
        '⬆️ Telegram upload... (ලොකු file නම් 10-30min)', { parse_mode: 'HTML' }).catch(() => {});
      await uploadMp4(ctx, conv.outPath,
        `🎬 <b>${item.title}</b> (${item.year || ''})\n🎥 <b>${q}p</b> • MP4 • MovieBox\n🔗 ${SITE}/detail/${item.slug}`);

      if (conv.outPath !== tmp) fs.unlink(conv.outPath, () => {});
      fs.unlink(tmp, () => {});
      ctx.telegram.deleteMessage(prog.chat.id, prog.message_id).catch(() => {});
    } catch (e) {
      console.error('mb flow:', e.message);
      fs.unlink(tmp, () => {});
      ctx.reply(`⚠️ Fail: ${e.message}\n\n💡 50MB+ uploads වලට LOCAL BOT API SERVER ඕනෑ.`);
    }
  }
}

module.exports = { cmdMoviebox, handleMbCallback, search, searchWithFallback, getStreams };
