// Address reading shared by the app (offline parser) and the AI endpoint (prompt).
export const SERVICES=['TCS','Leopards','Daewoo','Faisal Movers','InDrive','Yango','Bike','Cargo','Pickup'];
export const SVC_ORDER=['TCS','Leopards','Daewoo','Faisal Movers','Cargo','InDrive','Yango','Bike','Pickup'];
export const CITIES=['Lahore','Karachi','Islamabad','Rawalpindi','Faisalabad','Multan','Peshawar','Quetta','Sialkot','Gujranwala','Hyderabad','Sargodha','Bahawalpur','Sadiqabad','Rahim Yar Khan','Sukkur','Abbottabad','Mardan','Gujrat','Sahiwal','Okara','Kasur','Sheikhupura','Jhelum','Mirpur','Muzaffarabad','Dera Ghazi Khan','Larkana','Nawabshah','Mingora','Swat','Chiniot','Jhang','Wah Cantt','Attock','Taxila','Chakwal','Mandi Bahauddin','Hafizabad','Narowal','Khanewal','Vehari','Bahawalnagar','Muzaffargarh','Layyah','Mianwali','Bannu','Kohat','Gilgit','Skardu','Dera Ismail Khan','Burewala','Pakpattan','Toba Tek Singh','Khairpur','Mirpur Khas','Jacobabad','Gwadar','Turbat','Gujar Khan','Dina','Kharian','Lalamusa','Wazirabad','Daska','Muridke','Raiwind','Pattoki','Arifwala','Depalpur','Hasilpur','Khanpur','Liaquatpur','Ahmedpur East','Kot Addu','Taunsa','Rajanpur','Shikarpur','Dadu','Thatta','Badin','Tando Adam','Tando Allahyar','Charsadda','Nowshera','Swabi','Haripur','Mansehra','Chitral','Sambrial','Pasrur','Shakargarh','Murree','Fateh Jang','Pindi Gheb','Talagang','Bhakkar','Khushab','Bhalwal','Kamalia','Gojra','Jaranwala','Samundri','Chichawatni','Mian Channu','Lodhran','Jampur','Kamoke','Sanghar','Umerkot','Ghotki','Kandhkot','Zhob','Loralai','Hub','Khuzdar','Batagram','Timergara','Lakki Marwat','Karak','Hangu','Tank','Kotli','Bagh','Rawalakot','Bhimber'];
export const FIELDS=['name','phone','phone2','address','city','service','note'];

// Mobiles (03xx) and landlines (042-xxxxxxx, 021-xxxxxxxx, +92 51 xxxxxxx). B17.
const MOBILE_SRC='(?:\\+?92[\\s-]?|\\b0)3\\d{2}[\\s-]?\\d{3}[\\s-]?\\d{4}\\b';
const LAND_SRC='(?:\\+?92[\\s-]?|\\b0)(?:[1-24-9]\\d{1,3})[\\s-]?\\d{3,4}[\\s-]?\\d{3,5}\\b';
export const PHONE_RE=new RegExp(MOBILE_SRC+'|'+LAND_SRC,'g');
export function phoneDigits(p){ let d=String(p||'').replace(/\D/g,''); if(d.startsWith('92')&&d.length>=11) d='0'+d.slice(2); return d; }
export function findPhones(text){
 const out=[];
 for(const m of String(text||'').matchAll(PHONE_RE)){ const d=phoneDigits(m[0]); if(d.length<10||d.length>11) continue; out.push(m[0].trim()); }
 return out;
}
export function phoneKey(p){ const d=phoneDigits(p); return d.length>=10?d.slice(-10):''; }
export function isMobile(p){ const d=phoneDigits(p); return d.length===11&&d.startsWith('03'); }
export function waNumber(p){ const d=phoneDigits(p); return isMobile(d)?'92'+d.slice(1):''; }
export function fmtPhone(p){ const s=String(p||''); const d=phoneDigits(s); if(d.length===11&&d.startsWith('03')) return d.slice(0,4)+' '+d.slice(4); return s; }

export const SVC_RE=[[/\btcs\b/i,'TCS'],[/leopards?/i,'Leopards'],[/daewoo|\bdivo\b|\bdevo\b|\bdaiwoo\b|\bdewoo\b/i,'Daewoo'],[/faisal\s*movers?|\bfaisal\b/i,'Faisal Movers'],[/in ?drive/i,'InDrive'],[/yango/i,'Yango'],[/\bbike\b|\brider\b/i,'Bike'],[/cargo/i,'Cargo'],[/pick ?up|\bcollect\b/i,'Pickup']];
const ADDR_WORDS=/\d|road|street|st\.|house|shop|market|near|mohall?ah?|colony|town|block|sector|phase|bazaa?r|plaza|gali|chowk|village|tehsil|district|post|cantt|saddar|ward|flat|floor|building|lane|nagar|abad|pura|garden|society|scheme|mall|branch|office|tower|centre|center/i;
const CITY_RES=[...CITIES].sort((x,y)=>y.length-x.length).map(c=>[c,new RegExp('\\b'+c.replace(/ /g,'\\s*')+'\\b','i')]);
export function findCity(text){ for(const [c,re] of CITY_RES) if(re.test(text)) return c; return ''; }
export function findServices(text){ const out=[]; for(const [re,m] of SVC_RE){ const k=text.search(re); if(k>=0) out.push([k,m]); } return out.sort((a,b)=>a[0]-b[0]).map(x=>x[1]).join(' / '); }

export function localParse(text){
 text=String(text||'');
 const phones=findPhones(text);
 const service=findServices(text), city=findCity(text);
 const names=[], addr=[], notes=[];
 for(let line of text.split(/\n/)){
  const pairs=[...line.matchAll(/([A-Za-z][A-Za-z .]{1,30}?)\s*[:\-]\s*(?=(?:\+?92|0)\d)/g)].map(m=>m[1].trim());
  if(pairs.length) names.push(...pairs);
  let l=line; phones.forEach(p=>l=l.split(p).join(' ')); pairs.forEach(n=>l=l.replace(n,' '));
  for(const [re] of SVC_RE) l=l.replace(new RegExp(re.source,'ig'),' ');
  l=l.replace(/\b(address|addr|name|phone|mobile|contact|cell|number|whats ?app no)\s*[:\-]/ig,' ').replace(/\bonly\b/ig,' ').replace(/[\s,:;\-–/]+$|^[\s,:;\-–/]+/g,'').replace(/\s{2,}/g,' ').trim();
  if(!l) continue;
  if(/^(whats ?app|properly pack.*|pack properly.*|fragile.*|handle with care.*|urgent)$/i.test(l)){ notes.push(l); continue; }
  if(!ADDR_WORDS.test(l)&&l.split(/\s+/).length<=5&&!pairs.length&&!names.length){ names.push(l); continue; }
  addr.push(l);
 }
 return {name:names.join(' & '),phone:phones[0]||'',phone2:phones.slice(1).join(', '),address:addr.join(', '),city,service,note:notes.join(', ')};
}
export function fixUp(r,text){
 r={name:'',phone:'',phone2:'',address:'',city:'',service:'',note:'',...r};
 for(const k of FIELDS) r[k]=String(r[k]??'').trim();
 const phones=findPhones(text);
 const have=(r.phone+' '+r.phone2).replace(/\D/g,'');
 const miss=phones.filter(p=>!have.includes(p.replace(/\D/g,'').slice(-9)));
 if(!r.phone&&miss.length) r.phone=miss.shift();
 if(miss.length) r.phone2=[r.phone2,...miss].filter(Boolean).join(', ');
 if(!r.city) r.city=findCity(text);
 if(!r.service) r.service=findServices(text);
 return r;
}
// Split a long WhatsApp chat into likely one-parcel chunks (offline bulk fallback).
export function splitChat(text){
 const lines=String(text||'').replace(/\r/g,'').split('\n');
 const blocks=[]; let cur=[];
 const push=()=>{ const t=cur.join('\n').trim(); if(t) blocks.push(t); cur=[]; };
 for(let l of lines){
  l=l.replace(/^\[?\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?\]?\s*(?:-\s*)?(?:[^:]{1,40}:\s)?/i,m=>{ push(); return ''; });
  if(!l.trim()){ if(cur.length&&findPhones(cur.join(' ')).length) push(); continue; }
  cur.push(l);
 }
 push();
 return blocks.filter(b=>findPhones(b).length);
}
export const PARSE_PROMPT=`You read ONE delivery message for ONE parcel, copied from WhatsApp or WeChat by a courier dispatcher in Pakistan. It can be English, Roman Urdu or Urdu, in any order, with any line breaks. It is always ONE parcel, even when it lists two names or several phone numbers.
Fields:
- name: every receiver name exactly as written, joined the way it is written ("Khalid and Abuzar", "Jehanzeb & Waqas"). Keep spelling, initials and titles ("M. Hamza Aziz").
- phone: the first phone number, exactly as written.
- phone2: every other phone number, as written, separated by ", ". If a number is written next to a name, put the name in brackets after it: "0311-9923247 (Waqas)".
- address: the full delivery address with every word kept: shop name, shop number, market, street, house, mohallah, landmark, "near ...", post code. Keep the original order and spelling, join lines with ", ". Remove only names, phone numbers and the service word. If the city is written inside the address, keep it there too.
- city: the city or town of the address. It can be anywhere in the text, not only at the end, and can be two words ("Gujar Khan", "Mandi Bahauddin"). Use "" if none is written.
- service: TCS, Leopards, Daewoo, Faisal Movers, InDrive, Yango, Bike, Cargo or Pickup. "divo", "devo", "daiwoo" mean Daewoo; "leopard" means Leopards; "faisal" means Faisal Movers; "pick up" or "collect" means Pickup. If more than one is written ("TCS/Leopard") keep all, in the written order, joined with " / ". "TCS ONLY" is TCS. Use "" if none.
- note: everything else, such as "properly pack", "fragile", "whatsapp".
Never invent or correct anything. Never drop words from the address. Leave a field "" when it is not in the message.

Example message:
Jehanzeb:0300-4443234 Waqas:0311-9923247
MJ MOBILE
Branch2 Peshawar Saddar Cantt. Muslim Market Shop # 30
TCS
Example answer:
{"name":"Jehanzeb & Waqas","phone":"0300-4443234","phone2":"0311-9923247 (Waqas)","address":"MJ MOBILE, Branch2 Peshawar Saddar Cantt., Muslim Market Shop # 30","city":"Peshawar","service":"TCS","note":""}

Example message:
Wasu Road Near Chungi Number 8 /Old Ghega Flour Mills School Mohallah Mandi Bahauddin
Post Code 50400
Qasim Imtiaz
03161749964
TCS
Example answer:
{"name":"Qasim Imtiaz","phone":"03161749964","phone2":"","address":"Wasu Road Near Chungi Number 8 / Old Ghega Flour Mills School Mohallah, Mandi Bahauddin, Post Code 50400","city":"Mandi Bahauddin","service":"TCS","note":""}

Reply with only one JSON object with exactly these keys: name, phone, phone2, address, city, service, note.
Message:
"""`;
