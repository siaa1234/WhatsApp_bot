// handlers/ytm.js — YouTube Music search + MP3 download (InnerTube + yt-dlp)
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const MAX_TG_SIZE = process.env.LOCAL_BOT_API ? 1900 * 1024 * 1024 : 48 * 1024 * 1024;

const BASE_ARGS = [
  '--extractor-args', 'youtube:player_client=default,web_safari;formats=duplicate,missing_pot',
  '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  '--force-ipv4', '--retries', '3', '--socket-timeout', '20', '--no-warnings'
];
const YT_COOKIES_B64 = process.env.YT_COOKIES_B64 || '';

function ensureCookies() {
  if (!YT_COOKIES_B64) return '';
  const p = '/tmp/yt_cookies.txt';
  if (!fs.existsSync(p)) fs.writeFileSync(p, Buffer.from(YT_COOKIES_B64, 'base64'));
  return p;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function runYtdlp(args) {
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', [...BASE_ARGS, ...args], { maxBuffer: 64 * 1024 * 1024, timeout: 540000 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = stderr || err.message;
          if (/Sign in to confirm/.test(msg)) return reject(new Error('YouTube IP block — YT_COOKIES_B64 දාන්න.'));
          return reject(new Error(msg.slice(-400)));
        }
        resolve(stdout);
      });
  });
}

// ---------- YouTube Music search (InnerTube WEB_REMIX) ----------
const INNERTUBE_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
const CONTEXT = {
  client: { clientName: 'WEB_REMIX', clientVersion: '1.20240401.01.00', hl: 'en', gl: 'LK' }
};

async function searchYtMusic(query, limit = 10) {
  const { data } = await axios.post(
    `https://music.youtube.com/youtubei/v1/search?key=${INNERTUBE_KEY}`,
    { context: CONTEXT, query, params: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D' }, // songs filter
    { headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }
  );

  const results = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (o.musicResponsiveListItemRenderer) {
      const r = o.musicResponsiveListItemRenderer;
      const videoId = r.playlistItemData?.videoId || r.overlay?.[0]?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
      const title = r.flexColumns?.[0]?.musicResponsiveListItemColumn?.text?.runs?.[0]?.text;
      if (videoId && title) {
        const cols = r.flexColumns || [];
        const artist = cols[1]?.musicResponsiveListItemColumn?.text?.runs?.[0]?.text || '';
        const durText = cols[cols.length - 1]?.musicResponsiveListItemColumn?.text?.runs?.[0]?.text || '';
        const dm = durText.match(/^(\d+):(\d{2})$/);
        results.push({
          videoId, title, artist,
          duration: dm ? Number(dm[1]) * 60 + Number(dm[2]) : null,
          url: `https://music.youtube.com/watch?v=${videoId}`
        });
      }
    }
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(data);
  return results.slice(0, limit);
}

// ---------- MP3 download (best quality + cover art) ----------
async function downloadMp3(url, title) {
  const dir = path.join(require('os').tmpdir(), 'ytm_' + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  const safe = title.replace(/[^\w\s()-]/g, '').slice(0, 60).trim() || 'song';
  const args = [
    '-f', 'bestaudio/best',
    '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0', // ~320kbps VBR
    '--embed-thumbnail', '--add-metadata',
    '-o', path.join(dir, safe + '.%(ext)s'), '--no-playlist', url
  ];
  const cf = ensureCookies();
  if (cf) args.push('--cookies', cf);
  await runYtdlp(args);
  const file = fs.readdirSync(dir).find(f => f.endsWith('.mp3'));
  return file ? path.join(dir, file) : null;
}

function cleanup(fp) { try { fs.rmSync(path.dirname(fp), { recursive: true, force: true }); } catch {} }

const pending = new Map();
const createId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmtDur = (s) => s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '';

// ---------- /song command ----------
async function cmdSong(ctx) {
  const arg = (ctx.message?.text || '').replace(/^\/song\s*/i, '').trim();
  if (!arg) return ctx.reply('🎵 Usage: `/song <song name>`', { parse_mode: 'Markdown' });

  const status = await ctx.reply(`🎧 YouTube Music එකේ "${esc(arg)}" search කරනවා...`);
  try {
    const results = await searchYtMusic(arg);
    await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
    if (!results.length) return ctx.reply('❌ Results නැහැ.');

    const id = createId();
    pending.set(id, results);
    setTimeout(() => pending.delete(id), 600000).unref?.();

    const keyboard = {
      inline_keyboard: results.map((r, i) => [{
        text: `🎵 ${r.title.slice(0, 35)} — ${r.artist.slice(0, 20)}${r.duration ? ` [${fmtDur(r.duration)}]` : ''}`,
        callback_data: `ytm_${id}_${i}`
      }])
    };
    return ctx.reply('🎶 Song එකක් තෝරන්න (MP3):', { reply_markup: keyboard });
  } catch (e) {
    await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
    return ctx.reply(`❌ Search error: ${e.message}`);
  }
}

// ---------- Callback ----------
async function handleYtmCallback(ctx) {
  const data = ctx.callbackQuery?.data || '';
  await ctx.answerCbQuery().catch(() => {});
  if (!data.startsWith('ytm_')) return;

  const [, id, idx] = data.split('_');
  const results = pending.get(id);
  if (!results) return ctx.reply('⌛ Expired. නැවත `/song` දාන්න.');
  pending.delete(id);

  const r = results[Number(idx)];
  if (!r) return ctx.reply('❌ Result එක හමු වුණේ නැහැ.');

  const status = await ctx.reply(`⬇️ "${esc(r.title)}" MP3 download කරනවා...`);
  let filePath = null;
  try {
    filePath = await downloadMp3(r.url, r.title);
    if (!filePath) throw new Error('Download failed');

    const size = fs.statSync(filePath).size;
    if (size > MAX_TG_SIZE) {
      cleanup(filePath);
      return ctx.reply(`⚠️ File එක ලොකු වැඩියි (${(size / 1048576).toFixed(1)} MB).`);
    }

    await ctx.replyWithAudio(
      { source: fs.createReadStream(filePath), filename: path.basename(filePath) },
      { caption: `✅ ${r.title} — ${r.artist}\nPOWERED BY CINEMAX`, title: r.title, performer: r.artist }
    );
    cleanup(filePath);
    await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
  } catch (e) {
    console.error('YTM error:', e.message);
    if (filePath) cleanup(filePath);
    await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
    return ctx.reply(`❌ අසාර්ථකයි: ${e.message}`);
  }
}

module.exports = { cmdSong, handleYtmCallback };
