const fs = require('fs');
const path = require('path');
const { getSearch, getDetails, getDownload } = require('sinhalasub.lk');
const { SinhalaSub } = require('@sl-code-lords/movie-api');

const OMDB_API = process.env.OMDB_API || '966ab6ea';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const COBALT_API_URL = process.env.COBALT_API_URL;
const COBALT_API_KEY = process.env.COBALT_API_KEY;
const LOCAL_BOT_API = process.env.LOCAL_BOT_API || ''; // e.g. http://localhost:8081

const ALIVE_LOCAL_PATH = path.join(__dirname, '..', 'alive.jpg');
// Local Bot API server එකක් නම් 2GB වෙනක් upload කරන්න පුළුවන්
const MAX_TG_SIZE = LOCAL_BOT_API ? 1900 * 1024 * 1024 : 48 * 1024 * 1024;
const SITE_NAME = 'sinhalasub.lk';

const socialCache = new Map();
const directCache = new Map();
const movieCache = new Map();
const dlCache = new Map();

const COBALT_INSTANCES = [COBALT_API_URL, 'https://api.cobalt.tools/'].filter(Boolean);

function createId(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function esc(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fetchWithTimeout(url, options={}, ms=20000){
  const controller = new AbortController();
  const t = setTimeout(()=>controller.abort(), ms);
  return fetch(url, {...options, signal: controller.signal}).finally(()=>clearTimeout(t));
}
function setCache(map,id,value,ttl=600000){ map.set(id,value); setTimeout(()=>map.delete(id),ttl); }

function detectPlatform(url){
  if(/(tiktok\.com)/i.test(url)) return 'tiktok';
  if(/(instagram\.com)/i.test(url)) return 'instagram';
  if(/(facebook\.com|fb\.watch|fb\.me)/i.test(url)) return 'facebook';
  if(/(youtube\.com|youtu\.be)/i.test(url)) return 'youtube';
  return null;
}
function detectDirectLink(url){
  if(/(drive\.google\.com|docs\.google\.com)/i.test(url)) return 'gdrive';
  if(/^https?:\/\/.+/i.test(url) && !detectPlatform(url)) return 'direct';
  return null;
}
function convertGoogleDriveLink(url){
  const match = url.match(/\/d\/(.*?)\/|\?id=(.*?)(&|$)/);
  const fileId = match ? (match[1]||match[2]) : null;
  if(fileId) return `https://drive.google.com/uc?export=download&id=${fileId}`;
  return url;
}
function extractYouTubeId(url){
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return m ? m[1] : null;
}
async function getYouTubeMetadata(url){
  try{
    if(!YOUTUBE_API_KEY) return null;
    const id = extractYouTubeId(url); if(!id) return null;
    const res = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${id}&key=${YOUTUBE_API_KEY}`);
    const data = await res.json(); if(!data.items?.length) return null;
    const item = data.items[0];
    return { title:item.snippet.title, author:item.snippet.channelTitle, views:item.statistics?.viewCount||'N/A', date:item.snippet.publishedAt?.split('T')[0]||'N/A', thumb:item.snippet.thumbnails?.high?.url||null, url };
  }catch(e){ return null; }
}
async function getCobaltDownloadLink(url, quality='720'){
  if(!COBALT_INSTANCES.length) return null;
  for(const apiUrl of COBALT_INSTANCES){
    try{
      const headers={Accept:'application/json','Content-Type':'application/json'};
      if(COBALT_API_KEY) headers['Authorization']=`Api-Key ${COBALT_API_KEY}`;
      const res = await fetchWithTimeout(apiUrl,{method:'POST',headers,body:JSON.stringify({url,videoQuality:String(quality),youtubeVideoCodec:'h264',filenameStyle:'basic'})});
      const data=await res.json();
      if(data.status==='error') continue;
      if((data.status==='tunnel'||data.status==='redirect')&&data.url) return data.url;
      if(data.status==='picker'&&data.picker?.length){
        const v=data.picker.find(p=>p.type==='video')||data.picker[0];
        if(v?.url) return v.url;
      }
    }catch(e){}
  }
  return null;
}
async function fetchSocialMediaVideo(url, platform){
  const link = await getCobaltDownloadLink(url,'720');
  if(link) return {url:link, title:`${platform.toUpperCase()} Video`, thumb:null};
  return null;
}
function buildCaption(platform, title){
  const t=(title||'No Title').toString().replace(/_/g,' ').slice(0,80);
  return `🟨🟥 ${platform.toUpperCase()} DOWNLOADER 🟥🟨\n\n🟡 Title: ${t}\n🔴 Powered By Cinemax\n\n⬇️ Ready to Download!`;
}

// ===== SINHALASUB.LK (npm: sinhalasub.lk) =====
async function searchSinhalasub(query){
  try{
    const res = await getSearch(query);
    const items = res?.result || [];
    if(!Array.isArray(items) || !items.length) return null;
    const q = query.toLowerCase();
    const best = items.find(m => (m.title||'').toLowerCase().includes(q)) || items[0];
    return best;
  }catch(e){ console.log('sinhalasub search error:', e.message); return null; }
}

async function getSinhalasubMovie(movieUrl){
  try{
    const res = await getDetails(movieUrl);
    const d = res?.result || res;
    if(!d) return null;
    const dl = Array.isArray(d.dl_links) ? d.dl_links : [];
    const links = { '480p':[], '720p':[], '1080p':[] };
    for(const item of dl){
      if(!item?.link || !item?.quality) continue;
      if(/subtitle/i.test(item.quality)) continue;
      const q = item.quality.match(/(480|720|1080)\s*p/i);
      if(!q) continue;
      const key = q[1] + 'p';
      if(!links[key].some(x=>x.link===item.link)) links[key].push(item);
    }
    return { title: d.title || '', poster: d.img || d.poster || d.image || null, url: movieUrl, links, noGateway: false };
  }catch(e){ console.log('sinhalasub details error:', e.message); return null; }
}

async function resolveGatewayLink(gwUrl){
  try{
    const res = await getDownload(gwUrl);
    const d = res?.result || res;
    return d?.link || d?.url || d?.download_link || (typeof res === 'string' ? res : null);
  }catch(e){ return null; }
}

// ===== FALLBACK: @sl-code-lords/movie-api (direct links, no gateway resolve needed) =====
async function searchCinesubz(query){
  try{
    const res = await SinhalaSub.get_list.by_search(query);
    const items = res?.result || res;
    if(!Array.isArray(items) || !items.length) return null;
    const q = query.toLowerCase();
    return items.find(m => (m.title||'').toLowerCase().includes(q)) || items[0];
  }catch(e){ console.log('cinesubz search error:', e.message); return null; }
}

async function getCinesubzMovie(movieUrl){
  try{
    const res = await SinhalaSub.movie(movieUrl);
    const d = res?.result || res;
    if(!d) return null;
    const dl = Array.isArray(d.dl_links) ? d.dl_links : [];
    const links = { '480p':[], '720p':[], '1080p':[] };
    for(const item of dl){
      const link = item?.link || item?.url;
      const quality = item?.quality || item?.label;
      if(!link || !quality) continue;
      if(/subtitle/i.test(quality)) continue;
      const q = quality.match(/(480|720|1080)\s*p/i);
      if(!q) continue;
      const key = q[1] + 'p';
      if(!links[key].some(x=>x.link===link)) links[key].push({quality, size:item?.size||'', link});
    }
    return { title: d.title || '', poster: d.image || d.poster || null, url: movieUrl, links, noGateway: true };
  }catch(e){ console.log('cinesubz details error:', e.message); return null; }
}

// ===== VIDEO SEND =====
async function sendVideoFromUrl(ctx, videoLink){
  const caption='✅ Done! POWERED BY CINEMAX';
  try{ await ctx.replyWithVideo(videoLink,{caption}); return{ok:true}; }catch(e){}
  try{
    const res=await fetchWithTimeout(videoLink,{},600000);
    if(!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const len=Number(res.headers.get('content-length')||0);
    if(len && len>MAX_TG_SIZE) return{ok:false,tooBig:true,size:len};
    const buf=await res.arrayBuffer();
    if(buf.byteLength>MAX_TG_SIZE) return{ok:false,tooBig:true,size:buf.byteLength};
    await ctx.replyWithVideo({source:Buffer.from(buf),filename:'video.mp4'},{caption});
    return{ok:true};
  }catch(err){return{ok:false,error:err.message};}
}

function buildDlKeyboard(dlId, resolved){
  const kb=[];
  resolved.forEach((r,i)=>{
    const label=`${r.quality}${r.size?` • ${r.size}`:''}`;
    const row=[];
    if(r.direct) row.push({text:`📥 ${label} (TG)`, callback_data:`mdt_${dlId}_${i}`});
    row.push({text:`🔗 ${label}`, url:r.direct || r.gw});
    kb.push(row);
  });
  return kb;
}

// ===== TEXT HANDLER =====
async function handleText(ctx){
  const query=ctx.message.text?.trim();
  if(!query||query.startsWith('/')) return;

  const platform=detectPlatform(query);
  if(platform){
    const statusMsg=await ctx.reply(`🔍 ${platform.toUpperCase()} වීඩියෝ එක analyze කරනවා...`);
    const id=createId();
    if(platform==='youtube'){
      const ytInfo=await getYouTubeMetadata(query);
      try{await ctx.telegram.deleteMessage(ctx.chat.id,statusMsg.message_id);}catch(e){}
      const info=ytInfo||{title:'YouTube Video',author:'Unknown',views:'N/A',date:'N/A',thumb:null};
      setCache(socialCache,id,{platform:'youtube',url:query});
      const kb=[[{text:'360p',callback_data:`soc_${id}_360`},{text:'480p',callback_data:`soc_${id}_480`}],[{text:'720p HD',callback_data:`soc_${id}_720`},{text:'1080p FHD',callback_data:`soc_${id}_1080`}]];
      const captionText=`🎬 <b>${esc(info.title)}</b>\n\n👤 <b>Channel:</b> ${esc(info.author)}\n👁️ <b>Views:</b> ${esc(info.views)}\n📅 <b>Date:</b> ${esc(info.date)}\n\n👇 අවශ්‍ය Quality එක තෝරන්න:`;
      if(info.thumb){try{await ctx.replyWithPhoto(info.thumb,{caption:captionText,parse_mode:'HTML',reply_markup:{inline_keyboard:kb}});return;}catch(e){}}
      await ctx.reply(captionText,{parse_mode:'HTML',reply_markup:{inline_keyboard:kb}});return;
    }
    const videoData=await fetchSocialMediaVideo(query,platform);
    try{await ctx.telegram.deleteMessage(ctx.chat.id,statusMsg.message_id);}catch(e){}
    if(videoData?.url){
      setCache(socialCache,id,{platform,videoUrl:videoData.url});
      await ctx.reply(buildCaption(platform,videoData.title),{reply_markup:{inline_keyboard:[[{text:'📥 Video එක ලබාගන්න',callback_data:`soc_${id}_get`}]]}});return;
    }
    return ctx.reply('❌ වීඩියෝ එක හොයාගන්න බැරි වුණා.');
  }

  const directType=detectDirectLink(query);
  if(directType){
    let finalUrl=directType==='gdrive'?convertGoogleDriveLink(query):query;
    const id=createId(); setCache(directCache,id,{url:finalUrl});
    await ctx.reply('🔗 Link එක හඳුනාගැනිණි!',{reply_markup:{inline_keyboard:[[{text:'📥 Send as Video',callback_data:`send_${id}`}]]}});return;
  }

  // ===== MOVIE SEARCH - SINHALASUB.LK + CINESUBZ FALLBACK =====
  await ctx.reply(`🔍 "${query}" හොයනවා...`);
  try{
    let omdb={Response:'False'};
    if(OMDB_API){
      try{
        const r=await fetchWithTimeout(`https://www.omdbapi.com/?t=${encodeURIComponent(query)}&apikey=${OMDB_API}`);
        omdb=await r.json();
      }catch(e){}
    }

    let searchHit = await searchSinhalasub(query);
    let csMovie = searchHit ? await getSinhalasubMovie(searchHit.url) : null;

    // fallback: @sl-code-lords/movie-api
    if(!csMovie || !Object.values(csMovie.links).some(a=>a.length)){
      const csHit = await searchCinesubz(query);
      if(csHit?.url){
        const csAlt = await getCinesubzMovie(csHit.url);
        if(csAlt && Object.values(csAlt.links).some(a=>a.length)) csMovie = csAlt;
      }
    }

    if(omdb.Response==='False' && !csMovie) return ctx.reply('❌ Film එක හම්බුනේ නෑ');

    const title = omdb.Title || csMovie?.title || query;
    const release = omdb.Released && omdb.Released!=='N/A'? omdb.Released : (omdb.Year || 'N/A');
    const duration = omdb.Runtime && omdb.Runtime!=='N/A'? omdb.Runtime : 'N/A';
    const imdb = omdb.imdbRating && omdb.imdbRating!=='N/A'? omdb.imdbRating : 'N/A';
    const genres = omdb.Genre && omdb.Genre!=='N/A'? omdb.Genre : 'N/A';
    const country = omdb.Country && omdb.Country!=='N/A'? omdb.Country : 'N/A';
    const plot = omdb.Plot && omdb.Plot!=='N/A'? omdb.Plot : 'No description available.';
    const poster = omdb.Poster && omdb.Poster!=='N/A'? omdb.Poster : null;

    const photoSource = poster || csMovie?.poster || (fs.existsSync(ALIVE_LOCAL_PATH)? {source:fs.createReadStream(ALIVE_LOCAL_PATH)} : null);

    const hasLinks = csMovie && Object.values(csMovie.links).some(a=>a.length);
    const movieId=createId();
    setCache(movieCache, movieId, {query,title,csMovie});

    const caption =
`☘️ *NAME* ☛ ${title}

*▫️📅 𝗥𝗲𝗹𝗲𝗮𝘀𝗲* ☛ ${release}
*▫️⏱ 𝗗ᴜʀᴀᴛɪᴏɴ* ☛ ${duration}
*▫️⭐ 𝗜𝗠𝗗𝗕* ☛ ${imdb}

*▫️🎭 𝗚ᴇɴʀᴇꜱ* ☛ ${genres}
*▫️🌎 𝗖ᴏᴜɴᴛʀʏ* ☛ ${country}

*▫️📃 𝗗ᴇꜱᴄʀɪᴘᴛɪᴏɴ* ☛
${plot}

*➟➟➟➟➟➟➟➟*
*▫️🔗 𝗠𝗼𝘃𝗶𝗲 SITE ♡*
${SITE_NAME} ◇
*➟➟➟➟➟➟➟➟*`;

    const kb=[];
    if(hasLinks){
      const q480=csMovie.links['480p'].length, q720=csMovie.links['720p'].length, q1080=csMovie.links['1080p'].length;
      const row=[];
      if(q480) row.push({text:'480P', callback_data:`mq_${movieId}_480p`});
      if(q720) row.push({text:'720P', callback_data:`mq_${movieId}_720p`});
      if(row.length) kb.push(row);
      if(q1080) kb.push([{text:'1080P', callback_data:`mq_${movieId}_1080p`}]);
    }
    kb.push([{text:'🌐 Visit Site', url: csMovie?.url || `https://${SITE_NAME}`}]);

    if(photoSource){
      try{ await ctx.replyWithPhoto(photoSource,{caption,parse_mode:'Markdown',reply_markup:{inline_keyboard:kb}}); }
      catch(e){ await ctx.reply(caption,{parse_mode:'Markdown',reply_markup:{inline_keyboard:kb}}); }
    }else{
      await ctx.reply(caption,{parse_mode:'Markdown',reply_markup:{inline_keyboard:kb}});
    }

  }catch(e){ console.log('Movie search error', e.message); ctx.reply('❌ Error එකක් ආවා.'); }
}

// ===== CALLBACK HANDLER =====
async function handleCallback(ctx){
  const data=ctx.callbackQuery.data;

  if(data.startsWith('soc_')){
    await ctx.answerCbQuery('⏳ Downloading...').catch(()=>{});
    const parts=data.split('_'); const id=parts[1]; const q=parts[2];
    const cached=socialCache.get(id); if(!cached) return ctx.reply('⌛ Expired! නැවත Link එක එවන්න.');
    let videoLink=cached.videoUrl;
    if(cached.platform==='youtube'){
      const waitMsg=await ctx.reply(`⏳ ${q}p quality එක හොයනවා...`);
      videoLink=await getCobaltDownloadLink(cached.url,q);
      try{await ctx.telegram.deleteMessage(ctx.chat.id,waitMsg.message_id);}catch(e){}
    }
    if(!videoLink) return ctx.reply('❌ Link එක ගන්න බැරිවුනා.');
    const statusMsg=await ctx.reply('⏳ Telegram එකට Upload වෙනවා...');
    const result=await sendVideoFromUrl(ctx,videoLink);
    await ctx.telegram.deleteMessage(ctx.chat.id,statusMsg.message_id).catch(()=>{});
    if(!result.ok){
      if(result.tooBig) return ctx.reply(`⚠️ File එක ලොකුයි (${(result.size/1024/1024).toFixed(1)}MB). Limit ${(MAX_TG_SIZE/1024/1024).toFixed(0)}MB.\n\nDirect Link:\n${videoLink}`);
      return ctx.reply(`❌ Upload Fail. Link:\n${videoLink}`);
    }
    return;
  }

  if(data.startsWith('send_')){
    await ctx.answerCbQuery('⏳ Downloading...').catch(()=>{});
    const id=data.split('_')[1]; const cached=directCache.get(id); if(!cached) return ctx.reply('⌛ Expired.');
    const statusMsg=await ctx.reply('⏳ Uploading...');
    const result=await sendVideoFromUrl(ctx,cached.url);
    await ctx.telegram.deleteMessage(ctx.chat.id,statusMsg.message_id).catch(()=>{});
    if(!result.ok) return ctx.reply('❌ Fail.');
    await ctx.reply('✅ Done! POWERED BY CINEMAX');
    return;
  }

  if(data.startsWith('mq_')){
    await ctx.answerCbQuery('⏳ Link හොයනවා...').catch(()=>{});
    const parts=data.split('_'); const id=parts[1]; const quality=parts[2];
    const cached=movieCache.get(id); if(!cached) return ctx.reply('⌛ Expired. නැවත Movie එක හොයන්න.');
    const items=cached.csMovie?.links?.[quality]||[];
    if(!items.length) return ctx.reply(`❌ ${quality} links නෑ. Site එකේ බලන්න:\n${cached.csMovie?.url||'https://'+SITE_NAME}`);

    // resolve all gateway links -> direct (cinesubz fallback එකෙන් ආවා නම් already direct)
    const dlId=createId();
    const resolved=[];
    for(const item of items){
      const direct = cached.csMovie.noGateway ? item.link : await resolveGatewayLink(item.link);
      resolved.push({quality:item.quality, size:item.size, gw:item.link, direct});
    }
    setCache(dlCache, dlId, {title:cached.title, resolved}, 1800000);

    // AUTO TG DOWNLOAD: first working direct link එකෙන් කෙලින්ම upload කරනවා
    const best = resolved.find(r=>r.direct);
    if(best){
      const statusMsg=await ctx.reply(`⏳ ${cached.title} - ${quality.toUpperCase()} Telegram එකට download වෙනවා...\n📦 Size: ${best.size||'Unknown'}\n\nටිකක් ගන්න පුළුවන්.`);
      const result=await sendVideoFromUrl(ctx,best.direct);
      await ctx.telegram.deleteMessage(ctx.chat.id,statusMsg.message_id).catch(()=>{});
      if(result.ok) return;

      if(result.tooBig){
        await ctx.reply(`⚠️ File එක ලොකුයි (${(result.size/1024/1024).toFixed(1)}MB) — TG limit එක ${(MAX_TG_SIZE/1024/1024).toFixed(0)}MB.\n\n👇 මේ links වලින් ඕන එක download කරගන්න:`,{reply_markup:{inline_keyboard:buildDlKeyboard(dlId, resolved)}});
        return;
      }
      await ctx.reply(`❌ Upload fail (${result.error||'unknown'}). ඒත් links මෙන්න:`,{reply_markup:{inline_keyboard:buildDlKeyboard(dlId, resolved)}});
      return;
    }

    // no direct links resolved -> show gateway/direct url buttons
    await ctx.reply(`✅ ${cached.title} - ${quality.toUpperCase()} Links\n\n👇 Download කරන්න:`,{reply_markup:{inline_keyboard:buildDlKeyboard(dlId, resolved)}});
    return;
  }

  if(data.startsWith('mdt_')){
    await ctx.answerCbQuery('⏳ Downloading to Telegram...').catch(()=>{});
    const parts=data.split('_'); const dlId=parts[1]; const idx=parseInt(parts[2]);
    const cached=dlCache.get(dlId); if(!cached) return ctx.reply('⌛ Expired. නැවත Movie එක හොයන්න.');
    const item=cached.resolved[idx];
    if(!item?.direct) return ctx.reply('❌ Link එක වැඩ කරන්නේ නෑ. Gateway link එක try කරන්න:\n'+(item?.gw||''));

    const statusMsg=await ctx.reply(`⏳ ${item.quality} download වෙනවා... ටිකක් ගන්න පුළුවන්.`);
    const result=await sendVideoFromUrl(ctx,item.direct);
    await ctx.telegram.deleteMessage(ctx.chat.id,statusMsg.message_id).catch(()=>{});
    if(!result.ok){
      if(result.tooBig){
        return ctx.reply(`⚠️ File එක ලොකුයි (${(result.size/1024/1024).toFixed(1)}MB). Bot limit ${(MAX_TG_SIZE/1024/1024).toFixed(0)}MB.\n\nDirect Link:\n${item.direct}`);
      }
      return ctx.reply(`❌ Upload Fail.\n\nDirect Link:\n${item.direct}\n\nGateway:\n${item.gw}`);
    }
    return;
  }
}

module.exports={handleText,handleCallback};
