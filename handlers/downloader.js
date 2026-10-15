const fs = require('fs');
const path = require('path');

const OMDB_API = process.env.OMDB_API || '966ab6ea';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const COBALT_API_URL = process.env.COBALT_API_URL;
const COBALT_API_KEY = process.env.COBALT_API_KEY;

const MY_API_URL = 'https://raw.githubusercontent.com/hansaka56789/Moviebox_movieproAPI/main/output/api.json';
const ALIVE_LOCAL_PATH = path.join(__dirname, '..', 'alive.jpg');
const MAX_TG_SIZE = 48 * 1024 * 1024;

const socialCache = new Map();
const directCache = new Map();
const movieCache = new Map();

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
  if(/^https?:\/\/.+/i.test(url) &&!detectPlatform(url)) return 'direct';
  return null;
}
function convertGoogleDriveLink(url){
  const match = url.match(/\/d\/(.*?)\/|\?id=(.*?)(&|$)/);
  const fileId = match? (match[1]||match[2]) : null;
  if(fileId) return `https://drive.google.com/uc?export=download&id=${fileId}`;
  return url;
}
function extractYouTubeId(url){
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return m? m[1]: null;
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
async function searchMyAPI(movieName){
  try{
    const res=await fetchWithTimeout(MY_API_URL);
    const data=await res.json();
    const movies=Array.isArray(data)?data:data.movies||data.data||[];
    return movies.find(m=>(m.title||m.name||'').toLowerCase().includes(movieName.toLowerCase()));
  }catch(e){return null;}
}
async function sendVideoFromUrl(ctx, videoLink){
  const caption='✅ Done! POWERED BY CINEMAX';
  try{await ctx.replyWithVideo(videoLink,{caption}); return{ok:true};}catch(e){}
  try{
    const res=await fetchWithTimeout(videoLink,{},120000);
    if(!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const len=Number(res.headers.get('content-length')||0);
    if(len>MAX_TG_SIZE) return{ok:false,tooBig:true,size:len};
    const buf=await res.arrayBuffer();
    if(buf.byteLength>MAX_TG_SIZE) return{ok:false,tooBig:true,size:buf.byteLength};
    await ctx.replyWithVideo({source:Buffer.from(buf),filename:'video.mp4'},{caption});
    return{ok:true};
  }catch(err){return{ok:false,error:err.message};}
}

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

  // ===== MOVIE SEARCH - YOUR FORMAT =====
  await ctx.reply(`🔍 "${query}" හොයනවා...`);
  try{
    let omdb={Response:'False'};
    if(OMDB_API){
      const r=await fetchWithTimeout(`https://www.omdbapi.com/?t=${encodeURIComponent(query)}&apikey=${OMDB_API}`);
      omdb=await r.json();
    }
    const myMovie=await searchMyAPI(query);
    if(omdb.Response==='False' &&!myMovie) return ctx.reply('❌ Film එක හම්බුනේ නෑ');

    // OMDB DATA
    const title = omdb.Title || myMovie?.title || query;
    const release = omdb.Released && omdb.Released!=='N/A'? omdb.Released : (omdb.Year || 'N/A');
    const duration = omdb.Runtime && omdb.Runtime!=='N/A'? omdb.Runtime : 'N/A';
    const imdb = omdb.imdbRating && omdb.imdbRating!=='N/A'? omdb.imdbRating : 'N/A';
    const genres = omdb.Genre && omdb.Genre!=='N/A'? omdb.Genre : 'N/A';
    const country = omdb.Country && omdb.Country!=='N/A'? omdb.Country : 'N/A';
    const plot = omdb.Plot && omdb.Plot!=='N/A'? omdb.Plot : 'No description available.';
    const poster = omdb.Poster && omdb.Poster!=='N/A'? omdb.Poster : null;

    const photoSource = poster || myMovie?.poster || (fs.existsSync(ALIVE_LOCAL_PATH)? {source:fs.createReadStream(ALIVE_LOCAL_PATH)} : 'https://via.placeholder.com/300x450?text=No+Poster');

    const movieId=createId();
    setCache(movieCache, movieId, {query,title,myMovie,omdb});

    // YOUR EXACT FORMAT
    const caption =
`☘️ *NAME* ☛ ${title}

*▫️📅 𝗥𝗲𝗹𝗲𝗮𝘀𝗲* ☛ ${release}
*▫️⏱ 𝗗ᴜʀᴀᴛɪᴏɴ* ☛ ${duration}
*▫️⭐ 𝗜𝗠𝗗𝗕* ☛ ${imdb}

*▫️🎭 𝗚ᴇ𝗻𝗿𝗲𝘀* ☛ ${genres}
*▫️🌎 𝗖𝗼𝘂𝗻𝘁𝗿𝘆* ☛ ${country}

*▫️📃 𝗗𝗲𝘀𝗰𝗿𝗶𝗽𝘁𝗶𝗼𝗻* ☛
${plot}

*➟➟➟➟➟➟➟➟*
*▫️🔗 𝗠𝗼𝘃𝗶𝗲 SITE ♡*
cinemaxlk.vercel.app ◇
*➟➟➟➟➟➟➟➟*`;

    await ctx.replyWithPhoto(photoSource, {
      caption,
      parse_mode:'Markdown',
      reply_markup:{
        inline_keyboard:[
          [{text:'480P', callback_data:`mq_${movieId}_480p`}, {text:'720P', callback_data:`mq_${movieId}_720p`}],
          [{text:'1080P', callback_data:`mq_${movieId}_1080p`}],
          [{text:'🌐 Visit Site', url:'https://cinemaxlk.vercel.app'}]
        ]
      }
    });

  }catch(e){ console.log('Movie search error', e.message); ctx.reply('❌ Error එකක් ආවා.'); }
}

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
      if(result.tooBig) return ctx.reply(`⚠️ File එක ලොකුයි (${(result.size/1024/1024).toFixed(1)}MB). Limit 50MB.\n\nDirect Link:\n${videoLink}`);
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
    if(!result.ok) return ctx.reply('❌ Fail.'); return;
  }
  if(data.startsWith('mq_')){
    await ctx.answerCbQuery().catch(()=>{});
    const parts=data.split('_'); const id=parts[1]; const quality=parts[2];
    const cached=movieCache.get(id); if(!cached) return ctx.reply('⌛ Expired.');
    const fileLink=cached.myMovie?.[quality]||cached.myMovie?.links?.[quality]||cached.myMovie?.downloadUrl;
    if(fileLink){
      await ctx.reply(`✅ ${cached.title} - ${quality} Ready!\n\n🔗 ${fileLink}`,{reply_markup:{inline_keyboard:[[{text:`📥 Download ${quality}`,url:fileLink}]]}});
    }else{ await ctx.reply(`❌ ${quality} නෑ. Site එකේ බලන්න:\nhttps://cinemaxlk.vercel.app`); }
    return;
  }
}

module.exports={handleText,handleCallback};
