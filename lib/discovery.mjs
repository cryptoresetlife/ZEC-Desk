import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request} from 'node:https';
import {StringDecoder} from 'node:string_decoder';
export async function publicUrl(raw){
  const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port||u.search.length>1000)throw new Error('扫描来源须为公开 HTTPS 网页');
  if(isIP(u.hostname)||u.hostname==='localhost'||!u.hostname.includes('.'))throw new Error('只允许公开网站域名');
  const records=await lookup(u.hostname,{all:true});
  if(!records.length||records.some(x=>x.family===6 ? !/^2[0-9a-f]{3}:/i.test(x.address) : /^(0|10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01])|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\./.test(x.address)))throw new Error('不允许扫描内网地址');
  return u;
}
export const clean=s=>String(s).replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
function imageUrl(raw,base){try{const u=new URL(clean(raw||''),base);return raw&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!isIP(u.hostname)&&u.hostname.includes('.')?u.href:null;}catch{return null;}}
function attr(tag,name){return tag.match(new RegExp('\\b'+name+'\\s*=\\s*["\']([^"\']*)["\']','i'))?.[1];}
export function earlySignal(text){
  const visible=clean(String(text).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,''));
  const matches=visible.match(/\b(?:white[\s_-]?list|allow[\s_-]?list|wait[\s_-]?list|early[\s_-]?access|pre[\s_-]?mint)\b|白名单|资格申请|早期申请|候补名单|预约登记/gi)||[];
  return [...new Set(matches.map(x=>x.toLowerCase()))].slice(0,6);
}
export function candidates(html,base){
  html=html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
  const title=clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||new URL(base).hostname).slice(0,160);
  const meta=[...html.matchAll(/<meta\b[^>]*>/gi)].map(m=>m[0]).find(t=>/^(og:image|twitter:image)$/i.test(attr(t,'property')||attr(t,'name')||''));
  const signals=earlySignal(html),out=[{name:title,url:base,kind:signals.length?'早期资格线索，开放状态未核实':'来源页面',earlySignals:signals,image:imageUrl(meta&&attr(meta,'content'),base)}];
  for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    const name=clean(m[2]).slice(0,120),early=earlySignal(name+' '+m[1]);
    const apply=/\b(?:apply|application|register)\b|申请|报名/i.test(name+' '+m[1])&&/zcash|\bzec\b|nft|mint|铸造/i.test(clean(html));
    if(!early.length&&!apply&&!/(nft|mint|collection|铸造|项目)/i.test(name+' '+m[1]))continue;
    try{const u=new URL(m[1],base);if(u.protocol!=='https:'||u.username||u.password)continue;u.hash='';
      const img=m[2].match(/<img\b[^>]*>/i)?.[0];
      if(!out.some(x=>x.url===u.href))out.push({name:name||clean(img&&attr(img,'alt')||'')||u.hostname,url:u.href,kind:early.length||apply?'早期资格线索，开放状态未核实':'公开链接候选，未核实',earlySignals:early.length?early:apply?['申请入口']:[],image:imageUrl(img&&(attr(img,'data-src')||attr(img,'src')),base)});
    }catch{} if(out.length>=40)break;
  }return out;
}
export async function readPublicPage(source){
  const u=await publicUrl(source);
  // Resolve and validate again, then pin the validated address for this connection.
  const pinned=await lookup(u.hostname,{all:true});
  for(const r of pinned){const a=r.address;if(r.family===6?!/^2[0-9a-f]{3}:/i.test(a):/^(0|10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01])|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\./.test(a))throw new Error('不允许扫描内网地址');}
  const html=await new Promise((resolve,reject)=>{let text='',size=0;const decoder=new StringDecoder('utf8');const req=request(u,{lookup:(_host,opts,cb)=>opts.all?cb(null,pinned):cb(null,pinned[0].address,pinned[0].family)},res=>{
    if(res.statusCode!==200||!res.headers['content-type']?.includes('text/html')){res.resume();reject(new Error('来源未返回公开网页'));return;}
    res.on('data',part=>{size+=part.length;if(size>1000000){req.destroy(new Error('来源网页过大'));return;}text+=decoder.write(part);});res.on('end',()=>resolve(text+decoder.end()));res.on('error',reject);
  });const timer=setTimeout(()=>req.destroy(new Error('来源超时')),10000);req.on('close',()=>clearTimeout(timer));req.on('error',reject);req.end();});
  return {url:u.href,html};
}
export async function scanSource(source){
  const {url,html}=await readPublicPage(source);
  const found=candidates(html,url);
  const checkedAt=Date.now();for(const item of found){item.checkedAt=checkedAt;item.sourceUrl=url;}
  await Promise.all(found.map(async x=>{if(x.image)try{await publicUrl(x.image);}catch{x.image=null;}}));
  return found;
}
