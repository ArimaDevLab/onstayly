/* いるだけの町
   - いまいる人: Supabase Realtime (presence = 誰がいるか / broadcast = どこへ歩くか)
   - いた場所の痕跡と今日の人数: supabase/schema.sql の関数
   - 足あと: 見ている間だけの表示で、保存しない */
(function(){
'use strict';
var CFG=window.ONSTAYLY_CONFIG||{};
var TRACE_TTL=(CFG.traceHours||3)*3600, FOOT_TTL=CFG.footprintSeconds||60;
var STATUSES=[
  ['zone','ぼーっとしてる'],['study','勉強中'],['work','作業中'],['game','ゲーム中'],['read','読書中'],
  ['draw','おえかき中'],['music','音楽きいてる'],['eat','ごはん中'],['cook','料理中'],['exercise','運動中'],
  ['bath','おふろ中'],['rest','ひとやすみ'],['walk','さんぽ中'],['sleep','おやすみ中']
];
var STATUS_MAP={}; STATUSES.forEach(function(s){STATUS_MAP[s[0]]=s[1];});
var COLORS=['#d9694a','#3f7fbf','#4f9d6a','#b0589c','#d6a531','#5a6470'];
var W=1400,H=1000,SPEED=120;

var BUILDINGS=[
  {x:120,y:50,w:260,h:190,wall:'#d8c7a6',roof:'#7a4b3a',label:'図書館'},
  {x:440,y:90,w:130,h:130,wall:'#e6dccb',roof:'#4f6f8a'},
  {x:800,y:40,w:230,h:180,wall:'#c9d3e0',roof:'#a8453f',label:'ゲームセンター'},
  {x:1090,y:70,w:190,h:150,wall:'#ead9b8',roof:'#3f6b55',label:'食堂'},
  {x:60,y:500,w:200,h:150,wall:'#e2d2c0',roof:'#5b5f7a',label:'銭湯'},
  {x:350,y:500,w:210,h:150,wall:'#d5ddd2',roof:'#8a5a44',label:'宿'},
  {x:420,y:850,w:130,h:130,wall:'#eadfce',roof:'#93523f'}
];
// 入るだけで頭の上の表示が変わる場所
var ZONES=[
  {st:'study',name:'自習テラス',x:130,y:262,w:240,h:118,floor:'#c9a878'},
  {st:'game',name:'ゲームコーナー',x:800,y:245,w:230,h:135,floor:'#b9bfd0'},
  {st:'eat',name:'食堂テラス',x:1085,y:245,w:215,h:135,floor:'#e3d3b0'},
  {st:'bath',name:'露天風呂',x:65,y:672,w:195,h:110,floor:'#9b988f'},
  {st:'sleep',name:'ねどこ',x:350,y:672,w:215,h:110,floor:'#b9c48a'},
  {st:'cook',name:'みんなの台所',x:65,y:850,w:215,h:110,floor:'#d9d2c4'},
  {st:'exercise',name:'運動広場',x:1030,y:495,w:320,h:100,floor:'#d6b98c'},
  {st:'rest',name:'焚き火',x:1245,y:800,w:130,h:105,floor:'#a9966f',fire:true}
];
var FIRE={x:1310,y:856};
// 時間の鐘。len は続く分数。時刻は見ている人の時計に合わせる。
var BELLS=[
  {h:7,m:0,len:60,st:'eat',name:'朝ごはん'},
  {h:12,m:0,len:60,st:'eat',name:'ひるごはん'},
  {h:19,m:0,len:60,st:'eat',name:'夕ごはん'},
  {h:21,m:0,len:30,st:'exercise',name:'運動'},
  {h:22,m:0,len:60,st:'bath',name:'おふろ'},
  {h:23,m:30,len:60,st:'sleep',name:'消灯'}
];
var TOWER={x:585,y:394};
/* 図書館の中。町とは別の部屋で、同じ部屋にいる人だけが見える。 */
var LIB={w:900,h:600,door:{x:250,y:250},out:{x:250,y:278},inn:{x:450,y:556}};
var LIB_ZONES=[
  {r:'lib',st:'read',name:'読書コーナー',x:650,y:372,w:215,h:206},
  {r:'lib',st:'study',name:'',x:0,y:0,w:900,h:600}
];
var LIB_DESKS=[],LIB_SEATS=[];
(function(){
  for(var j=0;j<3;j++)for(var i=0;i<3;i++){var d={x:80+i*190,y:215+j*110,w:120,h:30};LIB_DESKS.push(d);
    LIB_SEATS.push({x:d.x+32,y:d.y+6,desk:d},{x:d.x+88,y:d.y+6,desk:d});}
  [[700,440],[790,440],[700,525],[820,525]].forEach(function(c){LIB_SEATS.push({x:c[0],y:c[1],chair:true});});
})();
function roomOf(p){return p.r==='lib'?'lib':'town';}
function here(p){return roomOf(p)===me.r;}
function seatOf(p){
  if(roomOf(p)!=='lib'||p.moving)return null;
  for(var i=0;i<LIB_SEATS.length;i++){var q=LIB_SEATS[i];if(Math.abs(p.x-q.x)<5&&Math.abs(p.y-q.y)<5)return q;}
  return null;
}
function libBlocked(x,y){
  if(Math.abs(x-LIB.inn.x)<40&&y>580&&y<=602)return false; // 出口のマット
  return x<40||x>860||y<134||y>586;
}
// みんなで同じ時計を使うポモドーロ(毎時 0〜25分・30〜55分が集中、残り5分ずつが休憩)
function pomodoro(){
  var d=new Date(),m=d.getMinutes()%30,sec=d.getSeconds(),focus=m<25,left=(focus?25-m:30-m)*60-sec;
  return {focus:focus,left:left,frac:focus?(m*60+sec)/1500:((m-25)*60+sec)/300,
    text:(focus?'集中':'休憩')+' あと'+Math.floor(left/60)+':'+String(left%60).padStart(2,'0')};
}
function libCount(){var n=me.r==='lib'?1:0;for(var k in others)if(roomOf(others[k])==='lib')n++;return n;}
var SLEEP_TTL=8*3600; // 「おやすみ中」の痕跡は朝まで残す
var POND={x:1080,y:790,rx:120,ry:62};
var TREES=[[50,130],[420,290],[610,150],[750,130],[1345,150],[1355,345],[590,350],[40,345],[600,640],[30,810],
  [360,820],[600,900],[840,640],[900,940],[1378,960],[780,770],[1220,940],[980,650],[740,560],[1370,640]];
var BENCHES=[[900,760],[1240,780],[1060,900]];
var LAMPS=[]; (function(){var i;for(i=110;i<W;i+=215)LAMPS.push([i,392]);for(i=110;i<H;i+=215){if(Math.abs(i-435)>60)LAMPS.push([630,i]);}})();

/* ---------- 自分の状態 ---------- */
function uuid(){
  if(window.crypto&&crypto.randomUUID)return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(ch){
    var r=Math.random()*16|0;return (ch==='x'?r:(r&3|8)).toString(16);});
}
function lsGet(k){try{return localStorage.getItem(k);}catch(e){return null;}}
function lsSet(k,v){try{localStorage.setItem(k,v);}catch(e){}}
function storedId(k){var v=lsGet(k);if(!/^[0-9a-f-]{36}$/.test(v||'')){v=uuid();lsSet(k,v);}return v;}
function num(v,lo,hi){return (typeof v==='number'&&isFinite(v))?Math.min(hi,Math.max(lo,v)):null;}
function colorIdx(v,fallback){return (Number.isInteger(v)&&v>=0&&v<COLORS.length)?v:fallback;}

var myKey=uuid();                       // このタブ
var traceId=storedId('irudake-trace');  // 自分の痕跡(1人1つ)
var visitorId=storedId('irudake-visitor'); // 今日の人数を数えるためだけの番号
var me={r:'town',ss:0,x:675,y:435,st:'zone',manual:'zone',zone:null,c:0,tx:null,ty:null,phase:0,moving:false,dir:1,fd:0,side:1};
var others={};      // presence key -> 人
var traces=[],tracesAt=0;
var foot=[];        // 足あと {x,y,t}
/* 動物。動きは時計から決まるので、全員に同じ場所に見える。
   道順を1つずつ進み、着いた先でしばらく座る。 */
var CAT_ROUTE=[[880,772],[930,690],[1080,700],[1240,700],[1262,792],[1230,890],[1082,888],[920,880]];
var DOG_ROUTE=[[150,476],[520,476],[722,476],[722,230],[722,476],[915,476],[915,560],[915,476],[1250,476],[915,476],[722,476],[520,476]]; // 車道を避けて道ばたを歩く
var PETS={cat:{x:880,y:772,dir:1,sitting:true,phase:0},dog:{x:150,y:445,dir:1,sitting:true,phase:0}};
function petAt(route,T,sit,walk){
  var L=sit+walk,k=Math.floor(T/L),ph=T-k*L,n=route.length,a=route[k%n],b=route[(k+1)%n],pv=route[(k+n-1)%n];
  if(ph<sit)return {x:a[0],y:a[1],dir:a[0]>=pv[0]?1:-1,sitting:true,phase:T};
  var f=(ph-sit)/walk;f=f*f*(3-2*f);
  return {x:a[0]+(b[0]-a[0])*f,y:a[1]+(b[1]-a[1])*f,dir:b[0]>=a[0]?1:-1,sitting:false,phase:T*9};
}
function updatePets(){
  var T=Date.now()/1000;
  PETS.cat=petAt(CAT_ROUTE,T,55,25);
  PETS.dog=petAt(DOG_ROUTE,T+20,40,24);
  PETS.cat.loved=petLoved(PETS.cat);PETS.dog.loved=petLoved(PETS.dog);
}
function nearPet(p,a){return roomOf(p)==='town'&&a.sitting&&!p.moving&&Math.hypot(p.x-a.x,p.y-a.y)<40;}
function petLoved(a){
  if(nearPet(me,a))return true;
  for(var k in others)if(nearPet(others[k],a))return true;
  return false;
}
function onBench(p){
  if(p.moving||roomOf(p)!=='town')return false;
  for(var i=0;i<BENCHES.length;i++){var b=BENCHES[i];if(Math.abs(p.x-b[0])<22&&p.y>b[1]-4&&p.y<b[1]+16)return true;}
  return false;
}
// 屋台でもらったもの。4分で食べ終わる。
var ITEMS={imo:'焼き芋たべてる',ice:'かき氷たべてる'};
function hasItem(p){return !!(p.it&&ITEMS[p.it]&&p.iu>Date.now());}
function stepCartGift(){
  var c=wx.cart;
  if(me.it&&!hasItem(me)){me.it=null;me.iu=0;trackDirty=true;}
  if(!c||!c.stopped||me.moving||hasItem(me)||me.r!=='town')return;
  if(Math.abs(me.x-(c.x-4))<75&&Math.abs(me.y-455)<45){me.it=c.warm?'imo':'ice';me.iu=Date.now()+240000;trackDirty=true;}
}
function drawItem(p,x,y){
  var hx=x+11*p.dir,hy=y-17;
  if(p.it==='imo'){
    ctx.fillStyle='#7a3f52';ctx.beginPath();ctx.ellipse(hx,hy,5.5,3.2,-0.5*p.dir,0,7);ctx.fill();
    ctx.fillStyle='#f0c24a';ctx.beginPath();ctx.ellipse(hx+2.5*p.dir,hy-1.5,2.6,2.2,0,0,7);ctx.fill();
  }else{
    ctx.fillStyle='#f4f7fa';ctx.beginPath();ctx.moveTo(hx-4,hy-2);ctx.lineTo(hx+4,hy-2);ctx.lineTo(hx+2.5,hy+4);ctx.lineTo(hx-2.5,hy+4);ctx.closePath();ctx.fill();
    ctx.fillStyle='#e0607a';ctx.beginPath();ctx.arc(hx,hy-3,4,Math.PI,0);ctx.fill();
  }
}
// 頭の上に出す言葉。動物のそばに座っている間はそちらを出す(保存はしない)。
function statusText(p){
  if(nearPet(p,PETS.cat))return 'ねこといっしょ';
  if(nearPet(p,PETS.dog))return 'いぬといっしょ';
  if(hasItem(p))return ITEMS[p.it];
  if(p.ss&&seatOf(p)){ // 図書館の席に着いてからの時間
    var mins=Math.floor((Date.now()-p.ss)/60000);
    if(mins>=1)return STATUS_MAP[p.st]+' '+(mins>=60?Math.floor(mins/60)+'時間'+(mins%60)+'分':mins+'分');
  }
  return STATUS_MAP[p.st];
}
var keys={};

function saveLocal(){lsSet('irudake-me',JSON.stringify({x:me.x,y:me.y,st:me.manual,c:me.c,r:me.r,ss:me.ss,at:Date.now()}));}
function blocked(x,y){
  if(me.r==='lib')return libBlocked(x,y);
  if(x<14||y<24||x>W-14||y>H-6)return true;
  for(var i=0;i<BUILDINGS.length;i++){var b=BUILDINGS[i];
    if(x>b.x-8&&x<b.x+b.w+8&&y>b.y+b.h*0.35&&y<b.y+b.h+6)return true;}
  if(Math.abs(x-FIRE.x)<20&&Math.abs(y-FIRE.y)<12)return true;
  var dx=(x-POND.x)/(POND.rx+8),dy=(y-POND.y)/(POND.ry+8);
  return dx*dx+dy*dy<1;
}

function inRect(p,z){return p.x>=z.x&&p.x<=z.x+z.w&&p.y>=z.y&&p.y<=z.y+z.h;}
// 自分がいる部屋の中で、その位置にある場所
function zoneAt(x,y){
  var list=me.r==='lib'?LIB_ZONES:ZONES,q={x:x,y:y};
  for(var i=0;i<list.length;i++)if(inRect(q,list[i]))return list[i];
  return null;
}
function zoneBySt(st){for(var i=0;i<ZONES.length;i++)if(ZONES[i].st===st)return ZONES[i];return null;}
function zoneCount(z){
  var room=z.r||'town',n=(me.r===room&&inRect(me,z))?1:0,k;
  for(k in others)if(roomOf(others[k])===room&&inRect(others[k],z))n++;
  return n;
}
// 場所に入ったらその表示に、出たら自分で選んだ表示に戻す
function stepZone(){
  var z=zoneAt(me.x,me.y);
  if(z===me.zone)return;
  me.zone=z;me.st=z?z.st:me.manual;
  trackDirty=true;syncUI();
}
function hhmm(min){min=(min+1440)%1440;return String(Math.floor(min/60)).padStart(2,'0')+':'+String(min%60).padStart(2,'0');}
function bellState(){
  var d=new Date(),now=d.getHours()*60+d.getMinutes(),next=null,nd=1e9;
  for(var i=0;i<BELLS.length;i++){
    var b=BELLS[i],start=b.h*60+b.m,since=(now-start+1440)%1440;
    if(since<b.len)return {bell:b,zone:zoneBySt(b.st),end:start+b.len,elapsed:since*60+d.getSeconds()};
    var until=(start-now+1440)%1440;if(until<nd){nd=until;next=b;}
  }
  return {bell:null,next:next};
}
function start(){
  var s={};try{s=JSON.parse(lsGet('irudake-me')||'{}')||{};}catch(e){}
  var x=num(s.x,0,W),y=num(s.y,0,H);
  me.r=s.r==='lib'?'lib':'town';
  if(x!==null&&y!==null&&!blocked(x,y)){me.x=x;me.y=y;}
  else{me.r='town';me.x=560+Math.random()*230;me.y=415+Math.random()*40;}
  // 席に着いたまま開き直したときは、5分以内なら勉強時間を引き継ぐ
  if(me.r==='lib'&&typeof s.ss==='number'&&s.ss>0&&s.ss<=Date.now()&&Date.now()-(s.at||0)<300000)me.ss=s.ss;
  if(STATUS_MAP[s.st])me.st=me.manual=s.st;
  me.c=colorIdx(s.c,Math.floor(Math.random()*COLORS.length));
  buildUI();resize();requestAnimationFrame(frame);connect();
}

/* ---------- 画面下の操作 ---------- */
var $=function(id){return document.getElementById(id);};
function buildUI(){
  STATUSES.forEach(function(s){
    var b=document.createElement('button');b.type='button';b.className='chip';b.id='st-'+s[0];b.textContent=s[1];
    b.addEventListener('click',function(){me.st=me.manual=s[0];changed();});
    $('chips').appendChild(b);
  });
  COLORS.forEach(function(c,i){
    var b=document.createElement('button');b.type='button';b.className='swatch';b.id='col-'+i;
    b.style.background=c;b.setAttribute('aria-label','服の色 '+(i+1));
    b.addEventListener('click',function(){me.c=i;changed();});
    $('swatches').appendChild(b);
  });
  $('g-wave').addEventListener('click',function(){doGesture('wave');});
  $('g-bow').addEventListener('click',function(){doGesture('bow');});
  syncUI();
}
function changed(){trackDirty=true;saveLocal();syncUI();if(lastTrace)saveTrace();}
function syncUI(){
  STATUSES.forEach(function(s){$('st-'+s[0]).setAttribute('aria-pressed',String(me.st===s[0]));});
  COLORS.forEach(function(c,i){$('col-'+i).setAttribute('aria-pressed',String(me.c===i));});
}
function setCount(){$('count').textContent='いま '+(1+Object.keys(others).length)+'人';}
function setNote(t){$('note').textContent=t;}

/* ---------- 通信 ---------- */
var sb=null,ch=null,online=false,trackDirty=true,lastTrack=0,lastKeyMv=0,lastTrace=null,stillT=0,traceAt=0;
function offline(){
  online=false;others={};setCount();
  setNote('いまは一人で歩いています。つながると、ほかの人が町に現れます。');
}
function connect(){
  if(!window.supabase||!CFG.url||!CFG.key){offline();return;}
  try{
    sb=window.supabase.createClient(CFG.url,CFG.key,{auth:{persistSession:false,autoRefreshToken:false},
      realtime:{params:{eventsPerSecond:10}}});
  }catch(e){offline();return;}
  join();
  checkIn();loadTraces();
  setInterval(loadTraces,60000);setInterval(checkIn,300000);
}
// 町の回線に入る。切れたら5秒後に入り直す。
var rejoinT=null;
function join(){
  var c;
  try{c=sb.channel('town',{config:{presence:{key:myKey},broadcast:{self:false}}});}catch(e){offline();rejoinSoon(5000);return;}
  ch=c;
  c.on('presence',{event:'sync'},function(){if(c===ch)syncPeers();})
    .on('broadcast',{event:'mv'},function(m){if(c===ch)onMove(m&&m.payload);})
    .on('broadcast',{event:'g'},function(m){if(c===ch)onGesture(m&&m.payload);})
    .subscribe(function(status){
      if(c!==ch)return;
      if(status==='SUBSCRIBED'){online=true;trackDirty=true;lastTrack=0;setNote('話す機能はありません。歩いて、いるだけ。');}
      else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){offline();rejoinSoon(5000);}
    });
}
function rejoinSoon(ms){
  if(rejoinT)return;
  rejoinT=setTimeout(function(){
    rejoinT=null;if(online)return;
    var old=ch;ch=null;try{if(old)sb.removeChannel(old);}catch(e){}
    join();
  },ms);
}
/* ---------- しぐさ(相手を選ばず、自分がその場で動くだけ) ---------- */
var GESTURES={wave:1800,bow:1400},lastGesture=0;
function doGesture(type){
  var now=performance.now();
  if(!GESTURES[type]||now-lastGesture<2500)return;
  lastGesture=now;me.g={type:type,t:now};
  if(online&&ch)ch.send({type:'broadcast',event:'g',payload:{k:myKey,g:type}});
}
function onGesture(p){
  if(!p||typeof p.k!=='string'||!GESTURES[p.g])return;
  var o=others[p.k],now=performance.now();if(!o)return;
  if(o.g&&now-o.g.t<2000)return;
  o.g={type:p.g,t:now};
}
function gestureOf(p){
  if(!p.g)return null;
  var k=(performance.now()-p.g.t)/GESTURES[p.g.type];
  if(k>=1){p.g=null;return null;}
  return {type:p.g.type,k:k};
}
function syncPeers(){
  // 同じブラウザで複数のタブを開いている人は1人として扱う(自分の別タブは出さない)
  if(!ch)return;
  var state=ch.presenceState(),seen={},who={},k;
  who[traceId]=1;
  var ks=Object.keys(state).sort();
  for(var i=0;i<ks.length;i++){
    k=ks[i];
    if(k===myKey)continue;
    var m=state[k]&&state[k][0];if(!m)continue;
    var x=num(m.x,0,W),y=num(m.y,0,H);if(x===null||y===null)continue;
    if(typeof m.t==='string'){if(who[m.t])continue;who[m.t]=1;}
    seen[k]=1;
    var o=others[k];
    var room=m.r==='lib'?'lib':'town';
    if(!o)o=others[k]={r:room,x:x,y:y,tx:null,ty:null,phase:0,moving:false,dir:1,fd:0,side:1};
    else if(o.r!==room){o.r=room;o.x=x;o.y=y;o.tx=null;o.moving=false;}
    else if(o.tx===null&&Math.hypot(o.x-x,o.y-y)>40){o.tx=x;o.ty=y;o.direct=true;}
    o.ss=(typeof m.ss==='number'&&m.ss>Date.now()-86400000&&m.ss<=Date.now()+5000)?m.ss:0;
    o.st=STATUS_MAP[m.st]?m.st:'zone';
    o.c=colorIdx(m.c,5);
    o.t=typeof m.t==='string'?m.t:null;
    o.it=ITEMS[m.it]?m.it:null;o.iu=num(m.iu,0,Date.now()+300000)||0;
  }
  for(k in others)if(!seen[k])delete others[k];
  setCount();
}
function onMove(p){
  if(!p||typeof p.k!=='string')return;
  var o=others[p.k];if(!o)return;
  var x=num(p.x,0,W),y=num(p.y,0,H),tx=num(p.tx,0,W),ty=num(p.ty,0,H);
  if(x===null||y===null||tx===null||ty===null)return;
  var room=p.r==='lib'?'lib':'town';
  if(o.r!==room){o.r=room;o.x=x;o.y=y;}
  if(Math.hypot(o.x-x,o.y-y)>90){o.x=x;o.y=y;}
  o.tx=tx;o.ty=ty;o.direct=!!p.d;o.stuck=0;
}
function sendMove(tx,ty,direct){
  if(!online||!ch)return;
  ch.send({type:'broadcast',event:'mv',payload:{k:myKey,r:me.r,x:Math.round(me.x),y:Math.round(me.y),
    tx:Math.round(tx),ty:Math.round(ty),d:direct?1:0}});
}
function track(now){
  if(!online||!ch||!trackDirty||now-lastTrack<1000)return;
  lastTrack=now;trackDirty=false;
  ch.track({r:me.r,ss:me.ss||0,x:Math.round(me.x),y:Math.round(me.y),st:me.st,c:me.c,t:traceId,it:hasItem(me)?me.it:null,iu:hasItem(me)?me.iu:0});
}
function checkIn(){
  sb.rpc('check_in',{v:visitorId}).then(function(r){
    if(r.error||typeof r.data!=='number')return;
    $('today').hidden=false;$('today').textContent='今日は '+r.data+'人が立ち寄りました';
  },function(){});
}
function loadTraces(){
  sb.rpc('recent_traces').then(function(r){
    if(r.error||!Array.isArray(r.data))return;
    traces=r.data.map(function(t){
      var x=num(t.x,0,W),y=num(t.y,0,H),age=num(t.age_seconds,0,SLEEP_TTL);
      if(x===null||y===null||age===null||!STATUS_MAP[t.st])return null;
      return {id:String(t.id),x:x,y:y,st:t.st,c:colorIdx(t.c,5),age:age,dir:1,phase:0,moving:false};
    }).filter(Boolean);
    tracesAt=Date.now();
  },function(){});
}
function tracePos(){return me.r==='lib'?{x:LIB.out.x,y:LIB.out.y}:{x:me.x,y:me.y};}
function saveTrace(){
  if(!sb)return;
  var tp=tracePos();
  lastTrace={x:tp.x,y:tp.y,st:me.st,c:me.c};traceAt=Date.now();
  sb.rpc('leave_trace',{tid:traceId,px:Math.round(tp.x),py:Math.round(tp.y),pst:me.st,pc:me.c}).then(function(){},function(){});
}
function traceStale(){
  var tp=tracePos();
  return !lastTrace||Math.hypot(lastTrace.x-tp.x,lastTrace.y-tp.y)>10||lastTrace.st!==me.st||lastTrace.c!==me.c;
}
// 15秒とどまった場所を「いた場所」として残す。いる間は5分ごとに時刻だけ更新する。
function stepTrace(dt){
  if(me.moving){stillT=0;return;}
  stillT+=dt;
  if(stillT>15&&(traceStale()||Date.now()-traceAt>300000))saveTrace();
}
document.addEventListener('visibilitychange',function(){
  if(document.visibilityState==='visible'&&sb&&!online){clearTimeout(rejoinT);rejoinT=null;rejoinSoon(300);}
  if(document.visibilityState==='hidden'){saveLocal();if(traceStale()||Date.now()-traceAt>60000)saveTrace();}
});

/* ---------- 入力 ---------- */
var cv=$('town'),ctx=cv.getContext('2d'),stage=$('stage');
var cw=300,chh=300,dpr=1,scale=1,camX=0,camY=0;
function resize(){
  var r=stage.getBoundingClientRect();cw=Math.max(50,r.width);chh=Math.max(50,r.height);
  dpr=Math.min(2,window.devicePixelRatio||1);
  cv.width=Math.round(cw*dpr);cv.height=Math.round(chh*dpr);
  scale=Math.max(cw/1000,chh/640,0.55);
}
if(window.ResizeObserver)new ResizeObserver(resize).observe(stage);else window.addEventListener('resize',resize);
cv.addEventListener('pointerdown',function(e){
  var r=cv.getBoundingClientRect();
  var RW=me.r==='lib'?LIB.w:W,RH=me.r==='lib'?LIB.h:H,lb=BUILDINGS[0];
  me.tx=Math.min(RW-16,Math.max(16,(e.clientX-r.left)/scale+camX));
  me.ty=Math.min(RH-2,Math.max(26,(e.clientY-r.top)/scale+camY));
  // 図書館の建物をタップしたら入口へ向かう
  if(me.r==='town'&&me.tx>lb.x&&me.tx<lb.x+lb.w&&me.ty>lb.y&&me.ty<lb.y+lb.h+8){me.tx=LIB.door.x;me.ty=LIB.door.y-6;}
  me.stuck=0;sendMove(me.tx,me.ty,false);cv.focus({preventScroll:true});
});
var KEYMAP={ArrowUp:'u',ArrowDown:'d',ArrowLeft:'l',ArrowRight:'r',w:'u',s:'d',a:'l',d:'r',W:'u',S:'d',A:'l',D:'r'};
cv.addEventListener('keydown',function(e){var k=KEYMAP[e.key];if(k){keys[k]=true;me.tx=null;e.preventDefault();}});
cv.addEventListener('keyup',function(e){var k=KEYMAP[e.key];if(k)keys[k]=false;});
cv.addEventListener('blur',function(){keys={};});

/* ---------- 動き ---------- */
// 壁や池にぶつかったら滑る。戻り値は実際に進んだ距離。
function walk(p,vx,vy,dt,free){
  var sx=vx*SPEED*dt,sy=vy*SPEED*dt,ox=p.x,oy=p.y;
  if(free){p.x+=sx;p.y+=sy;}
  else{if(!blocked(p.x+sx,p.y))p.x+=sx;if(!blocked(p.x,p.y+sy))p.y+=sy;}
  var d=Math.hypot(p.x-ox,p.y-oy);
  if(Math.abs(vx)>0.2)p.dir=vx>0?1:-1;
  p.phase+=dt*9;p.fd+=d;
  if(p.fd>20){p.fd=0;p.side=-p.side;var fz=zoneAt(p.x,p.y);if(here(p)&&(!fz||fz.st!=='bath'))foot.push({x:p.x+p.side*3,y:p.y,t:Date.now()});if(foot.length>700)foot.shift();}
  return d;
}
function toward(p,dt,free){
  var dx=p.tx-p.x,dy=p.ty-p.y,d=Math.hypot(dx,dy);
  if(d<3){p.tx=null;return false;}
  var moved=walk(p,dx/d,dy/d,Math.min(dt,d/SPEED),free);
  if(moved<SPEED*dt*0.2){p.stuck=(p.stuck||0)+dt;if(p.stuck>0.4){p.tx=null;return false;}}else p.stuck=0;
  return true;
}
function stepMe(dt,now){
  var was=me.moving,vx=(keys.r?1:0)-(keys.l?1:0),vy=(keys.d?1:0)-(keys.u?1:0);
  if(vx||vy){
    var l=Math.hypot(vx,vy);walk(me,vx/l,vy/l,dt,false);me.moving=true;
    if(now-lastKeyMv>250){lastKeyMv=now;sendMove(me.x,me.y,true);}
  }else if(me.tx!==null){me.moving=toward(me,dt,false);}
  else me.moving=false;
  if(was&&!me.moving){
    var q=me.r==='lib'?freeSeatNear():null;
    if(q){me.tx=q.x;me.ty=q.y;me.moving=true;sendMove(q.x,q.y,true);} // 席の近くで止まったら席に着く
    else{sendMove(me.x,me.y,true);trackDirty=true;saveLocal();}
  }
  stepDoors();
  var seated=!!seatOf(me);
  if(seated&&!me.ss){me.ss=Date.now();trackDirty=true;saveLocal();}
  else if(!seated&&me.ss&&me.moving){me.ss=0;trackDirty=true;}
  stepZone();stepCartGift();
}
function freeSeatNear(){
  var best=null,bd=38;
  LIB_SEATS.forEach(function(q){
    var d=Math.hypot(me.x-q.x,me.y-q.y);if(d>=bd||d<3)return;
    for(var k in others){var o=others[k];if(roomOf(o)==='lib'&&Math.hypot(o.x-q.x,o.y-q.y)<8)return;}
    bd=d;best=q;
  });
  return best;
}
function moveRoom(room,x,y){
  me.r=room;me.x=x;me.y=y;me.tx=null;me.moving=false;me.ss=0;me.stuck=0;keys={};foot=[];
  trackDirty=true;lastTrack=0;sendMove(x,y,true);saveLocal();
}
// 図書館の入口と出口
function stepDoors(){
  if(me.r==='town'){
    if(Math.abs(me.x-LIB.door.x)<24&&me.y<LIB.door.y+9&&me.y>LIB.door.y-16&&(!me.moving||keys.u))moveRoom('lib',LIB.inn.x,LIB.inn.y);
  }else if(me.y>591)moveRoom('town',LIB.out.x,LIB.out.y);
}
function stepOther(o,dt){
  if(o.tx===null){o.moving=false;return;}
  if(!here(o)){o.x=o.tx;o.y=o.ty;o.tx=null;o.moving=false;return;}
  if(Math.hypot(o.tx-o.x,o.ty-o.y)>500){o.x=o.tx;o.y=o.ty;o.tx=null;o.moving=false;return;}
  o.moving=toward(o,dt,o.direct);
}

/* ---------- 描画 ---------- */
function rr(x,y,w,h,r){ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,y,w,h,r);else ctx.rect(x,y,w,h);}
function drawGround(){
  ctx.fillStyle='#9cc27a';ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#a9cc85';
  for(var i=0;i<90;i++){var gx=(i*397)%W,gy=(i*251+i*i*7)%H;ctx.fillRect(gx,gy,10,3);}
  ctx.fillStyle='#8fb872';rr(800,600,560,370,26);ctx.fill();
  ctx.fillStyle='#d9cfb6';ctx.fillRect(0,400,W,70);ctx.fillRect(640,0,70,H);
  ctx.fillStyle='#cbbf9f';ctx.fillRect(0,468,W,4);ctx.fillRect(0,398,W,4);ctx.fillRect(638,0,4,H);ctx.fillRect(708,0,4,H);
  ctx.fillStyle='#d9cfb6';ctx.fillRect(642,400,66,72);
  ctx.fillStyle='#e6dec9';
  for(var s=20;s<W;s+=70){ctx.fillRect(s,433,30,4);}
  ctx.fillStyle='#d9cfb6';ctx.fillRect(900,470,30,150);ctx.fillRect(295,470,30,510);
  ctx.fillStyle='#7aa35f';ctx.beginPath();ctx.ellipse(POND.x,POND.y,POND.rx+8,POND.ry+7,0,0,7);ctx.fill();
  ctx.fillStyle='#6fb3c9';ctx.beginPath();ctx.ellipse(POND.x,POND.y,POND.rx,POND.ry,0,0,7);ctx.fill();
  ctx.fillStyle='#8fc8d8';ctx.beginPath();ctx.ellipse(POND.x-30,POND.y-14,46,12,0,0,7);ctx.fill();
  drawPondLife(0);
}
function drawZones(t){
  ZONES.forEach(function(z){
    var i,j;
    if(z.fire){ctx.fillStyle=z.floor;ctx.beginPath();ctx.ellipse(z.x+z.w/2,z.y+z.h/2,z.w/2,z.h/2,0,0,7);ctx.fill();return;}
    ctx.fillStyle=z.floor;rr(z.x,z.y,z.w,z.h,8);ctx.fill();
    if(z.st==='study'){
      ctx.fillStyle='rgba(90,60,30,.18)';for(i=20;i<z.h;i+=20)ctx.fillRect(z.x+4,z.y+i,z.w-8,1.5);
      for(i=0;i<3;i++)for(j=0;j<2;j++){var dx=z.x+28+i*72,dy=z.y+26+j*50;
        ctx.fillStyle='#7a5a3c';ctx.fillRect(dx,dy,46,20);ctx.fillStyle='#a07c56';ctx.fillRect(dx,dy,46,15);
        ctx.fillStyle='#f4efe2';ctx.fillRect(dx+8,dy+4,12,8);}
    }else if(z.st==='game'){
      var cols=['#ff7a7a','#7ad1ff','#ffe07a','#9aff9a','#d59aff'];
      ctx.fillStyle='rgba(255,255,255,.25)';for(i=0;i<z.w;i+=46)for(j=(i/46)%2?0:23;j<z.h;j+=46)ctx.fillRect(z.x+i,z.y+j,23,23);
      ctx.fillStyle=z.floor;ctx.fillRect(z.x+z.w-12,z.y,12,z.h);
      for(i=0;i<5;i++){var gx=z.x+14+i*42;
        ctx.fillStyle='#3b4a6b';ctx.fillRect(gx,z.y+8,30,30);
        ctx.fillStyle=cols[(i+Math.floor(t/900))%5];ctx.fillRect(gx+5,z.y+12,20,12);}
    }else if(z.st==='eat'){
      for(i=0;i<3;i++)for(j=0;j<2;j++){var ex=z.x+42+i*65,ey=z.y+40+j*55;
        ctx.fillStyle='rgba(60,40,20,.15)';ctx.beginPath();ctx.ellipse(ex+2,ey+4,15,9,0,0,7);ctx.fill();
        ctx.fillStyle='#fbf6e6';ctx.beginPath();ctx.ellipse(ex,ey,15,9,0,0,7);ctx.fill();
        ctx.fillStyle='#d9694a';ctx.beginPath();ctx.arc(ex,ey-1,3,0,7);ctx.fill();}
    }else if(z.st==='bath'){
      ctx.fillStyle='#7fc4cf';rr(z.x+9,z.y+9,z.w-18,z.h-18,14);ctx.fill();
      ctx.fillStyle='#a5dbe3';ctx.beginPath();ctx.ellipse(z.x+z.w*0.4,z.y+z.h*0.38,z.w*0.22,9,0,0,7);ctx.fill();
    }else if(z.st==='sleep'){
      for(i=0;i<2;i++)for(j=0;j<3;j++){var fx=z.x+12+i*100,fy=z.y+9+j*33;
        ctx.fillStyle='#f6f3ea';rr(fx,fy,90,27,4);ctx.fill();
        ctx.fillStyle='#ffffff';rr(fx+5,fy+6,13,15,3);ctx.fill();
        ctx.fillStyle=['#9fb7d6','#d6a9a9','#a9d6b4','#d6cba9','#b9a9d6','#a9cfd6'][i*3+j];rr(fx+30,fy,60,27,4);ctx.fill();}
    }else if(z.st==='cook'){
      ctx.fillStyle='#8a6446';ctx.fillRect(z.x+10,z.y+8,z.w-20,28);ctx.fillStyle='#c9a27c';ctx.fillRect(z.x+10,z.y+8,z.w-20,20);
      for(i=0;i<4;i++){var px=z.x+36+i*48;
        ctx.fillStyle='#4b5560';ctx.beginPath();ctx.ellipse(px,z.y+18,11,7,0,0,7);ctx.fill();
        ctx.fillStyle=i%2?'#e9b44c':'#c9d6c0';ctx.beginPath();ctx.ellipse(px,z.y+17,8,4.5,0,0,7);ctx.fill();}
    }else if(z.st==='exercise'){
      ctx.strokeStyle='rgba(255,255,255,.85)';ctx.lineWidth=3;
      rr(z.x+12,z.y+12,z.w-24,z.h-24,38);ctx.stroke();rr(z.x+30,z.y+30,z.w-60,z.h-60,20);ctx.stroke();
    }
  });
}
function drawSteam(t){
  var z=zoneBySt('bath');
  for(var i=0;i<7;i++){
    var ph=((t/4200)+i/7)%1,sx=z.x+24+((i*53)%(z.w-48)),sy=z.y+z.h*0.6-ph*46;
    ctx.fillStyle='rgba(255,255,255,'+(0.34*(1-ph))+')';
    ctx.beginPath();ctx.arc(sx+Math.sin(ph*6+i)*5,sy,7+ph*7,0,7);ctx.fill();
  }
}
function drawTower(ang){
  var x=TOWER.x,y=TOWER.y;
  ctx.fillStyle='rgba(30,50,30,.2)';ctx.beginPath();ctx.ellipse(x,y,20,6,0,0,7);ctx.fill();
  ctx.fillStyle='#6b4a36';ctx.fillRect(x-16,y-62,4,62);ctx.fillRect(x+12,y-62,4,62);
  ctx.fillStyle='#7a4b3a';ctx.beginPath();ctx.moveTo(x-24,y-60);ctx.lineTo(x,y-78);ctx.lineTo(x+24,y-60);ctx.closePath();ctx.fill();
  ctx.save();ctx.translate(x,y-58);ctx.rotate(ang);
  ctx.fillStyle='#d6a531';ctx.beginPath();ctx.moveTo(-9,20);ctx.lineTo(-7,6);ctx.arc(0,6,7,Math.PI,0);ctx.lineTo(9,20);ctx.closePath();ctx.fill();
  ctx.fillStyle='#8a6a1c';ctx.fillRect(-10,19,20,3);ctx.beginPath();ctx.arc(0,24,2.5,0,7);ctx.fill();
  ctx.restore();
}
function drawSign(z,active){
  var n=zoneCount(z),text=z.name+(n?' '+n+'人':'');
  ctx.font='13px DotGothic16, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  var tw=ctx.measureText(text).width+16,x=z.x+z.w/2,y=z.y-3;
  ctx.fillStyle=active?'#ffe07a':'#fbf6e6';rr(x-tw/2,y-11,tw,22,3);ctx.fill();
  ctx.strokeStyle='#5b4634';ctx.lineWidth=1.5;ctx.stroke();
  ctx.fillStyle='#3b2d22';ctx.fillText(text,x,y+1);
  return {x:x,y:y,w:tw};
}
// 鐘の場所が画面の外にあるとき、端に方向を出す
function drawPointer(z,vw,vh){
  var cx=z.x+z.w/2,cy=z.y+z.h/2;
  if(cx>camX+20&&cx<camX+vw-20&&cy>camY+20&&cy<camY+vh-20)return;
  var text=z.name+'はこちら';
  ctx.font='13px DotGothic16, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  var tw=ctx.measureText(text).width+18;
  var px=Math.min(camX+vw-tw/2-26,Math.max(camX+tw/2+26,cx)),py=Math.min(camY+vh-34,Math.max(camY+34,cy));
  var a=Math.atan2(cy-py,cx-px),ax=px+Math.cos(a)*(tw/2+12),ay=py+Math.sin(a)*22;
  ctx.fillStyle='#ffe07a';rr(px-tw/2,py-12,tw,24,12);ctx.fill();ctx.strokeStyle='#5b4634';ctx.lineWidth=1.5;ctx.stroke();
  ctx.save();ctx.translate(ax,ay);ctx.rotate(a);ctx.beginPath();ctx.moveTo(8,0);ctx.lineTo(-4,-7);ctx.lineTo(-4,7);ctx.closePath();
  ctx.fillStyle='#ffe07a';ctx.fill();ctx.stroke();ctx.restore();
  ctx.fillStyle='#3b2d22';ctx.fillText(text,px,py+1);
}
/* ---------- 町のイベント ----------
   すべて時計から決まるので、サーバーなしで全員が同じ瞬間に同じものを見る。
   時刻は日本時間。アドレスの末尾に #rain #snow #star #hanabi #imo #sakura #momiji を付けると、その場で試せる。 */
var FORCE=(location.hash||'').slice(1),LOADED=Date.now();
function h32(n){n=Math.imul(n^0x9e3779b9,0x85ebca6b);n^=n>>>13;n=Math.imul(n,0xc2b2ae35);return (n^(n>>>16))>>>0;}
function townTime(){
  var ms=Date.now()+9*3600000,d=new Date(ms);
  return {ms:ms,dow:d.getUTCDay(),h:d.getUTCHours(),m:d.getUTCMinutes(),s:d.getUTCSeconds()+d.getUTCMilliseconds()/1000,
    md:(d.getUTCMonth()+1)*100+d.getUTCDate()};
}
var SEASONS={
  sakura:{a:'#e9a9bf',b:'#f5c6d3',fall:'#f7c9d6'},
  momiji:{a:'#c9762e',b:'#e09a3c',fall:'#d9813a'},
  winter:{a:'#4a7a58',b:'#5c8c68',fall:null},
  green:{a:'#4f8a4c',b:'#62a05a',fall:null}
};
var wx={rain:0,snow:false,season:SEASONS.green,hanabi:false,cart:null,night:false};
function updateWorld(){
  var n=townTime(),md=n.md;
  var season=FORCE==='sakura'?'sakura':FORCE==='momiji'?'momiji':FORCE==='snow'?'winter':
    (md>=325&&md<=410)?'sakura':(md>=1015&&md<=1130)?'momiji':(md>=1201||md<=228)?'winter':'green';
  wx.season=SEASONS[season];
  wx.hanabi=FORCE==='hanabi'||((n.dow===6||n.dow===0)&&n.h===20&&n.m<10);
  // 雨(冬は雪): 1時間ごとに決まり、だいたい8時間に1回。最初と最後の2分でゆっくり変わる。
  var wet=h32(Math.floor(n.ms/3600000))%100<12&&!((n.dow===6||n.dow===0)&&n.h===20);
  var edge=Math.min(1,n.m/2+n.s/120,(60-n.m)/2-n.s/120);
  wx.rain=(FORCE==='rain'||FORCE==='snow')?1:wet?Math.max(0,edge):0;
  wx.snow=season==='winter';
  // 屋台: 10時〜21時の毎時40分に左から来て、交差点の手前で2分止まり、右へ去る
  var sec=(n.m-40)*60+n.s,forced=FORCE==='imo';
  if(forced)sec=((Date.now()-LOADED)/1000)%200;
  var IN=CART_STOP_X+110,inT=IN/26,stopT=120,outT=(W+110-CART_STOP_X)/26;
  if((forced||(n.h>=10&&n.h<=21))&&sec>=0&&sec<inT+stopT+outT){
    var stopped=sec>=inT&&sec<inT+stopT;
    wx.cart={warm:md>=1001||md<=331,stopped:stopped,left:Math.ceil((inT+stopT-sec)/60),
      x:sec<inT?-110+sec*26:stopped?CART_STOP_X:CART_STOP_X+(sec-inT-stopT)*26};
  }else wx.cart=null;
  wx.night=light.dark>0.6||FORCE==='star'||FORCE==='hanabi';
  LBL=wx.rain>0.3?84:58;
}
var CART_STOP_X=540;
var LBL=58; // 頭の上の表示の高さ(傘をさしている間は少し上げる)
function drawUmbrella(p){
  var x=p.x,y=p.y-50;
  ctx.strokeStyle='#4b5560';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x+9*p.dir,p.y-24);ctx.lineTo(x+3*p.dir,y);ctx.stroke();
  ctx.fillStyle=COLORS[p.c]||COLORS[5];ctx.beginPath();ctx.arc(x+3*p.dir,y,17,Math.PI,0);ctx.closePath();ctx.fill();
  ctx.fillStyle='rgba(255,255,255,.3)';ctx.beginPath();ctx.arc(x+3*p.dir,y,17,Math.PI,Math.PI*1.5);ctx.lineTo(x+3*p.dir,y);ctx.closePath();ctx.fill();
}
function drawCart(c,t){
  var x=c.x,y=455,bobc=c.stopped?0:Math.sin(t/120)*0.8;
  ctx.fillStyle='rgba(20,40,20,.22)';ctx.beginPath();ctx.ellipse(x,y,46,7,0,0,7);ctx.fill();
  ctx.fillStyle='#8a5a3a';ctx.fillRect(x-38,y-30+bobc,64,24);
  ctx.fillStyle=c.warm?'#a8453f':'#3f7fbf';ctx.fillRect(x-42,y-52+bobc,72,8);
  ctx.fillStyle='#6b4a36';ctx.fillRect(x-38,y-46+bobc,3,18);ctx.fillRect(x+23,y-46+bobc,3,18);
  ctx.fillStyle='#39424d';ctx.fillRect(x+26,y-22+bobc,22,16);ctx.fillStyle='#bcd9e6';ctx.fillRect(x+34,y-20+bobc,12,7);
  ctx.fillStyle='#2b2422';ctx.beginPath();ctx.arc(x-24,y-4,6,0,7);ctx.arc(x+12,y-4,6,0,7);ctx.arc(x+40,y-4,5,0,7);ctx.fill();
  ctx.fillStyle='#fbf6e6';ctx.fillRect(x-30,y-28+bobc,48,16);
  ctx.fillStyle='#3b2d22';ctx.font='12px DotGothic16, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(c.warm?'焼き芋':'かき氷',x-6,y-19+bobc);
  if(c.warm&&!reduce)for(var i=0;i<3;i++){var ph=((t/1500)+i/3)%1;
    ctx.fillStyle='rgba(255,255,255,'+(0.4*(1-ph))+')';ctx.beginPath();ctx.arc(x-20+i*4+Math.sin(ph*5+i)*3,y-54-ph*26,4+ph*5,0,7);ctx.fill();}
}
// 雨・雪・花びら・落ち葉。画面に対して降らせる。
var SKY=[];(function(){for(var i=0;i<110;i++)SKY.push([h32(i*2+11)/4294967296,h32(i*2+12)/4294967296]);})();
function drawSky(t,vw,vh){
  var i,px,py;
  if(wx.rain>0&&!wx.snow){
    ctx.strokeStyle='rgba(205,225,255,'+(0.55*wx.rain)+')';ctx.lineWidth=1.3;ctx.beginPath();
    for(i=0;i<110;i++){
      px=camX+((SKY[i][0]*(vw+40)+t*0.07)%(vw+40))-20;py=camY+((SKY[i][1]*(vh+30)+t*(0.75+(i%5)*0.07))%(vh+30))-15;
      ctx.moveTo(px,py);ctx.lineTo(px-4,py+13);}
    ctx.stroke();
  }
  var flake=wx.rain>0&&wx.snow?'#ffffff':wx.season.fall;
  if(flake&&!reduce){
    var n=wx.rain>0&&wx.snow?90:26,a=wx.rain>0&&wx.snow?0.85*wx.rain:0.8;
    ctx.fillStyle=flake;ctx.globalAlpha=a;
    for(i=0;i<n;i++){
      px=camX+((SKY[i][0]*(vw+20)+Math.sin(t/900+i)*18+t*0.012+40)%(vw+20))-10;py=camY+((SKY[i][1]*(vh+20)+t*(0.05+(i%4)*0.012))%(vh+20))-10;
      ctx.beginPath();ctx.ellipse(px,py,2.6,1.8,i,0,7);ctx.fill();}
    ctx.globalAlpha=1;
  }
}
function drawStars(vw,vh){
  if(!wx.night||wx.rain>0||reduce)return;
  var ms=Date.now(),slot=FORCE==='star'?Math.floor(ms/4000):Math.floor(ms/60000),hv=h32(slot*7+1);
  if(FORCE!=='star'&&hv%3!==0)return;
  var start=FORCE==='star'?0.5:(hv>>>4)%55,sec=FORCE==='star'?(ms%4000)/1000:(ms%60000)/1000,k=(sec-start)/1.2;
  if(k<0||k>1)return;
  var sx=camX+vw*(0.3+((hv>>>8)%55)/100),sy=camY+vh*(0.06+((hv>>>14)%25)/100);
  var hx=sx-k*vw*0.28,hy=sy+k*vh*0.22,tx=hx+vw*0.07,ty=hy-vh*0.055;
  var g=ctx.createLinearGradient(hx,hy,tx,ty);
  g.addColorStop(0,'rgba(255,255,235,'+(0.95*Math.sin(k*Math.PI))+')');g.addColorStop(1,'rgba(255,255,235,0)');
  ctx.strokeStyle=g;ctx.lineWidth=2.2;ctx.beginPath();ctx.moveTo(hx,hy);ctx.lineTo(tx,ty);ctx.stroke();
}
var HANABI={x:POND.x-190,y:POND.y-175,w:380,h:150,name:'花火'};
function drawHanabi(){
  if(!wx.hanabi)return;
  var ms=Date.now(),gap=1400,s0=Math.floor(ms/gap);
  ctx.globalCompositeOperation='lighter';
  for(var s=s0-2;s<=s0;s++){
    var hv=h32(s),age=(ms-s*gap)/1000;
    var cx=HANABI.x+(hv%HANABI.w),cy=HANABI.y+((hv>>>9)%HANABI.h),hue=(hv>>>17)%360;
    if(age<0.55){ // 打ち上がる
      var r=age/0.55;ctx.fillStyle='rgba(255,240,200,.9)';ctx.beginPath();ctx.arc(cx,POND.y+(cy-POND.y)*r,2,0,7);ctx.fill();continue;
    }
    var a=age-0.55,life=2.2;if(a>life)continue;
    var R=(46+hv%44)*(1-Math.exp(-3.2*a)),al=Math.max(0,1-a/life),n=reduce?12:26;
    var gl=ctx.createRadialGradient(cx,cy,2,cx,cy,R*1.5+10);
    gl.addColorStop(0,'hsla('+hue+',90%,70%,'+(0.22*al)+')');gl.addColorStop(1,'hsla('+hue+',90%,70%,0)');
    ctx.fillStyle=gl;ctx.fillRect(cx-R*1.5-10,cy-R*1.5-10,R*3+20,R*3+20);
    ctx.fillStyle='hsla('+hue+',95%,'+(62+18*al)+'%,'+al+')';
    for(var i=0;i<n;i++){var ang=i/n*Math.PI*2+(hv%7);
      ctx.beginPath();ctx.arc(cx+Math.cos(ang)*R,cy+Math.sin(ang)*R+14*a*a,2.3,0,7);ctx.fill();
      ctx.beginPath();ctx.arc(cx+Math.cos(ang)*R*0.55,cy+Math.sin(ang)*R*0.55+14*a*a,1.6,0,7);ctx.fill();}
  }
  ctx.globalCompositeOperation='source-over';
}
function updateBell(){
  updateWorld();
  bell=bellState();
  var el=$('bell');
  if(bell.bell){
    var n=zoneCount(bell.zone);
    el.textContent=bell.bell.name+'の時間です('+hhmm(bell.end)+'まで)。'+bell.zone.name+'に'+(n?n+'人います':'まだ誰もいません');
    el.classList.add('on');
  }else{
    var tn=townTime();
    if(me.r==='lib'){var pm=pomodoro();el.textContent='図書館・'+pm.text;el.classList.toggle('on',pm.focus);}
    else if(wx.hanabi){el.textContent='花火があがっています。公園の池の上です';el.classList.add('on');}
    else{
      el.textContent=wx.cart?(wx.cart.warm?'焼き芋屋':'かき氷屋')+(wx.cart.stopped?'が交差点に止まっています(あと'+wx.cart.left+'分)。近くに立つともらえます':'が大通りを通っています'):
        'つぎの鐘は '+hhmm(bell.next.h*60+bell.next.m)+' '+bell.next.name+((tn.dow===6||tn.dow===0)&&tn.h<20?'・今夜20:00 花火':'');
      el.classList.remove('on');
    }
  }
}
function drawFootprints(){
  var now=Date.now(),ttl=FOOT_TTL*1000;
  while(foot.length&&now-foot[0].t>ttl)foot.shift();
  ctx.fillStyle='#3d3528';
  for(var i=0;i<foot.length;i++){var f=foot[i];
    ctx.globalAlpha=0.3*(1-(now-f.t)/ttl);
    ctx.beginPath();ctx.ellipse(f.x,f.y,2.6,1.6,0,0,7);ctx.fill();}
  ctx.globalAlpha=1;
}
function winRects(b){
  var out=[],wy=b.y+b.h*0.38+26,n=Math.floor((b.w-30)/46),gap=(b.w-n*26)/(n+1);
  for(var i=0;i<n;i++){var x=b.x+gap+i*(26+gap);if(Math.abs(x+13-(b.x+b.w/2))<26)continue;out.push([x,wy,26,24]);}
  return out;
}
function drawBuilding(b){
  var wy=b.y+b.h*0.38,wh=b.h*0.62;
  ctx.fillStyle='rgba(30,50,30,.18)';ctx.fillRect(b.x+6,b.y+b.h-2,b.w,8);
  ctx.fillStyle=b.wall;ctx.fillRect(b.x,wy,b.w,wh);
  ctx.fillStyle=b.roof;ctx.beginPath();ctx.moveTo(b.x-10,wy+4);ctx.lineTo(b.x+16,b.y);ctx.lineTo(b.x+b.w-16,b.y);ctx.lineTo(b.x+b.w+10,wy+4);ctx.closePath();ctx.fill();
  ctx.fillStyle='rgba(0,0,0,.12)';ctx.fillRect(b.x,wy+4,b.w,5);
  var dw=26,dx=b.x+b.w/2-dw/2;
  ctx.fillStyle='#6b4a36';ctx.fillRect(dx,b.y+b.h-40,dw,40);
  ctx.fillStyle='#f3e7a8';ctx.fillRect(dx+17,b.y+b.h-22,4,4);
  winRects(b).forEach(function(w){ctx.fillStyle='#bcd9e6';ctx.fillRect(w[0],w[1],w[2],w[3]);ctx.fillStyle='rgba(255,255,255,.5)';ctx.fillRect(w[0],w[1],w[2],4);});
  if(b.label==='図書館'){ctx.fillStyle='#7a8a6a';rr(b.x+b.w/2-20,b.y+b.h-1,40,11,3);ctx.fill();}
  if(b.label){
    ctx.font='15px DotGothic16, sans-serif';var tw=ctx.measureText(b.label).width+18;
    ctx.fillStyle='#fbf6e6';rr(b.x+b.w/2-tw/2,wy-8,tw,24,3);ctx.fill();
    ctx.strokeStyle='#5b4634';ctx.lineWidth=1.5;ctx.stroke();
    ctx.fillStyle='#3b2d22';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(b.label,b.x+b.w/2,wy+5);
  }
}
function drawTree(x,y){
  ctx.fillStyle='rgba(30,50,30,.2)';ctx.beginPath();ctx.ellipse(x,y,22,7,0,0,7);ctx.fill();
  ctx.fillStyle='#7a5a3c';ctx.fillRect(x-4,y-24,8,24);
  ctx.fillStyle=wx.season.a;ctx.beginPath();ctx.arc(x,y-40,24,0,7);ctx.fill();
  ctx.fillStyle=wx.season.b;ctx.beginPath();ctx.arc(x-7,y-46,14,0,7);ctx.fill();
  if(wx.snow&&wx.rain>0){ctx.fillStyle='rgba(255,255,255,'+(0.85*wx.rain)+')';ctx.beginPath();ctx.arc(x-2,y-52,15,Math.PI*1.05,Math.PI*1.95);ctx.fill();}
}
function drawBench(x,y){
  ctx.fillStyle='#8a6a48';ctx.fillRect(x-22,y-12,44,6);ctx.fillRect(x-22,y-22,44,5);
  ctx.fillStyle='#5f4731';ctx.fillRect(x-20,y-6,4,7);ctx.fillRect(x+16,y-6,4,7);
}
function drawLamp(x,y){
  ctx.fillStyle='#4b5560';ctx.fillRect(x-2,y-44,4,44);
  ctx.fillStyle='#f5e7a6';ctx.beginPath();ctx.arc(x,y-48,6,0,7);ctx.fill();
}
function drawPerson(p,isMe,still){
  var z=zoneAt(p.x,p.y),kind=z?z.st:'';
  if(kind==='sleep'&&p.st==='sleep'&&!p.moving){
    // ふとんで横になる
    ctx.save();ctx.translate(p.x,p.y-4);ctx.rotate(-Math.PI/2);ctx.translate(-p.x,-p.y);
    drawBody(p,isMe,true,false);ctx.restore();
    ctx.fillStyle='#e8e4f0';rr(p.x-25,p.y-15,27,18,3);ctx.fill();
    ctx.fillStyle='#4a5a6a';ctx.font='11px DotGothic16, sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';
    var f=still?0:(p.phase*0.12)%1;ctx.fillText('z',p.x-44,p.y-20-f*8);ctx.fillText('z',p.x-51,p.y-30-f*8);
    return;
  }
  drawBody(p,isMe,still,kind==='bath');
  if(wx.rain>0.3&&me.r==='town')drawUmbrella(p);
}
function drawBody(p,isMe,still,bath){
  var fz=zoneAt(p.x,p.y);
  var sit=!bath&&!p.moving&&(!!seatOf(p)||onBench(p)||nearPet(p,PETS.cat)||nearPet(p,PETS.dog)||!!(fz&&fz.fire));
  var x=p.x,y=p.y+(bath?9:0)+(sit?6:0),sw=p.moving?Math.sin(p.phase):0,bob=(!p.moving&&!still)?Math.sin(p.phase*0.25)*0.6:0;
  var gy=y-(sit?6:0);
  if(!bath){ctx.fillStyle='rgba(20,40,20,.25)';ctx.beginPath();ctx.ellipse(x,gy,11,4,0,0,7);ctx.fill();}
  if(isMe){ctx.strokeStyle='#fff7c2';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,gy,15,6,0,0,7);ctx.stroke();}
  if(sit){ctx.fillStyle='#39424d';ctx.fillRect(x-6,y-12,5,6);ctx.fillRect(x+1,y-12,5,6);}
  else if(!bath){ctx.fillStyle='#39424d';
    ctx.fillRect(x-6+sw*3,y-12,5,12-Math.max(0,sw)*2);
    ctx.fillRect(x+1-sw*3,y-12,5,12-Math.max(0,-sw)*2);}
  var g=gestureOf(p),bow=g&&g.type==='bow',wave=g&&g.type==='wave';
  if(bow){ctx.save();ctx.translate(x,y-12);ctx.rotate(p.dir*Math.sin(g.k*Math.PI)*0.5);ctx.translate(-x,-(y-12));}
  ctx.fillStyle=COLORS[p.c]||COLORS[5];rr(x-8,y-28+bob,16,18,4);ctx.fill();
  if(!(wave&&p.dir<0))ctx.fillRect(x-11,y-26+bob+sw*2,4,11);
  if(!(wave&&p.dir>0))ctx.fillRect(x+7,y-26+bob-sw*2,4,11);
  if(wave){
    // 向いている側の腕を上げて振る
    ctx.save();ctx.translate(x+9*p.dir,y-25+bob);ctx.rotate(-p.dir*(2.5+Math.sin(g.k*Math.PI*6)*0.45));
    ctx.fillRect(-2,0,4,12);ctx.fillStyle='#f0cfae';ctx.beginPath();ctx.arc(0,13,2.6,0,7);ctx.fill();ctx.restore();
  }
  ctx.fillStyle='#f0cfae';ctx.beginPath();ctx.arc(x,y-35+bob,8,0,7);ctx.fill();
  ctx.fillStyle='#3a2c26';ctx.beginPath();ctx.arc(x,y-37+bob,8,Math.PI,0);ctx.fill();
  ctx.fillRect(x-8*p.dir-(p.dir>0?0:3),y-38+bob,3,6);
  ctx.fillStyle='#2b2422';ctx.fillRect(x+3*p.dir-1,y-35+bob,2,2);
  if(hasItem(p)&&!wave)drawItem(p,x,y+bob);
  if(bow)ctx.restore();
  if(bath){ctx.fillStyle='#8fd0da';ctx.beginPath();ctx.ellipse(x,p.y-3,14,6,0,0,7);ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.7)';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(x,p.y-3,14,6,0,0,7);ctx.stroke();}
}
/* 車。大通りをゆっくり走る。出てくる時刻は時計から決まり、前に人がいると止まって待つ。
   20秒ごとに1台ぶんの枠があり、昼は半分ほど、深夜は1割ほどの枠に車が来る。 */
var CAR_SLOT=20,CAR_SPEED=85,CAR_COLORS=['#c94f4f','#4f7fc9','#e0b64a','#6fa377','#8a8f98','#f2efe6'];
var cars={};
function stepCars(dt){
  var T=Date.now()/1000,s0=Math.floor(T/CAR_SLOT),hr=townTime().h,rate=(hr>=22||hr<6)?10:(FORCE==='car'?100:48),s,k;
  for(s=s0-3;s<=s0;s++){
    if(cars[s])continue;
    var hv=h32(s*13+5),dir=(hv>>>8)&1?1:-1;
    if(hv%100>=rate)continue;
    if(dir>0&&wx.cart)continue; // 屋台がいる間、同じ車線には来ない
    var age=T-s*CAR_SLOT,x=dir>0?-60+age*CAR_SPEED:W+60-age*CAR_SPEED;
    if(x<-60||x>W+60)continue;
    cars[s]={x:x,y:dir>0?456:420,dir:dir,c:CAR_COLORS[(hv>>>12)%CAR_COLORS.length],wait:0,v:CAR_SPEED};
  }
  for(k in cars){
    var c=cars[k],stop=false,ahead;
    function blocks(px,py){ahead=(px-c.x)*c.dir;return Math.abs(py-c.y)<17&&ahead>14&&ahead<78;}
    if(c.wait<12){
      if(me.r==='town'&&blocks(me.x,me.y))stop=true;
      for(var o in others)if(roomOf(others[o])==='town'&&blocks(others[o].x,others[o].y))stop=true;
    }
    for(var j in cars)if(j!==k&&cars[j].dir===c.dir&&(cars[j].x-c.x)*c.dir>0&&(cars[j].x-c.x)*c.dir<70)stop=true;
    if(wx.cart&&c.dir>0&&(wx.cart.x-c.x)>0&&(wx.cart.x-c.x)<110)stop=true;
    if(stop)c.wait+=dt;
    c.v+=((stop?0:CAR_SPEED)-c.v)*Math.min(1,dt*5);
    c.x+=c.v*c.dir*dt;
    if(c.x<-70||c.x>W+70)delete cars[k];
  }
}
function drawCar(c){
  var x=c.x,y=c.y,d=c.dir;
  ctx.fillStyle='rgba(20,40,20,.22)';ctx.beginPath();ctx.ellipse(x,y,27,6,0,0,7);ctx.fill();
  ctx.fillStyle='#2b2422';ctx.beginPath();ctx.arc(x-14,y-4,5,0,7);ctx.arc(x+14,y-4,5,0,7);ctx.fill();
  ctx.fillStyle=c.c;rr(x-25,y-18,50,13,4);ctx.fill();
  rr(x-13-2*d,y-27,28,12,5);ctx.fill();
  ctx.fillStyle='#bcd9e6';ctx.fillRect(x-9-2*d,y-24,9,7);ctx.fillRect(x+2-2*d,y-24,9,7);
  ctx.fillStyle='#fff3b0';ctx.fillRect(x+(d>0?22:-25),y-15,3,4);
  ctx.fillStyle='#d9534f';ctx.fillRect(x+(d>0?-25:22),y-15,3,4);
}
function drawLibrary(t,vw,vh){
  var i,j,pm=pomodoro(),k;
  ctx.fillStyle='#e9dfcc';ctx.fillRect(20,20,860,110);
  ctx.fillStyle='#c8a57a';ctx.fillRect(20,128,860,472);
  ctx.fillStyle='rgba(90,60,30,.14)';for(i=160;i<600;i+=32)ctx.fillRect(20,i,860,1.5);
  ctx.fillStyle='#8a6a48';ctx.fillRect(20,122,860,8);
  // 窓。外の明るさと雨が見える
  [50,760].forEach(function(wxp){
    ctx.fillStyle='#6b4a36';ctx.fillRect(wxp-4,36,98,72);
    var g=ctx.createLinearGradient(0,40,0,104),d=light.dark,w=light.warm;
    g.addColorStop(0,d>0.6?'#1d2748':w>0.3?'#f2b27a':'#a9d8ee');g.addColorStop(1,d>0.6?'#2c3a66':w>0.3?'#f6d7a6':'#d6eef7');
    ctx.fillStyle=g;ctx.fillRect(wxp,40,90,64);
    if(wx.rain>0){ctx.strokeStyle='rgba(220,235,255,.7)';ctx.lineWidth=1;ctx.beginPath();
      for(j=0;j<14;j++){var rx=wxp+((j*37+t*0.05)%90),ry=40+((j*23+t*0.2)%56);ctx.moveTo(rx,ry);ctx.lineTo(rx-2,ry+8);}ctx.stroke();}
    ctx.fillStyle='#6b4a36';ctx.fillRect(wxp+43,40,4,64);ctx.fillRect(wxp,70,90,3);
  });
  // 本棚
  var spine=['#a8453f','#3f6b55','#4f6f8a','#d6a531','#7a4b3a','#b0589c','#e6dccb','#5b5f7a'];
  [[160,240],[500,240]].forEach(function(sh,si){
    ctx.fillStyle='#6b4a36';ctx.fillRect(sh[0],30,sh[1],94);
    for(j=0;j<3;j++){ctx.fillStyle='#4a3324';ctx.fillRect(sh[0]+5,35+j*29,sh[1]-10,25);
      var bx=sh[0]+7;for(i=0;bx<sh[0]+sh[1]-12;i++){var hv=h32(si*1000+j*100+i),bw=5+hv%5,bh=17+(hv>>>4)%7;
        ctx.fillStyle=spine[(hv>>>8)%spine.length];ctx.fillRect(bx,35+j*29+(25-bh),bw,bh);bx+=bw+1;}}
  });
  // ポモドーロの掲示
  ctx.fillStyle='#3b2d22';rr(405,34,90,74,6);ctx.fill();
  ctx.fillStyle=pm.focus?'#2c7a68':'#d6a531';rr(409,38,82,66,4);ctx.fill();
  ctx.fillStyle='#ffffff';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font='17px DotGothic16, sans-serif';ctx.fillText(pm.focus?'集中':'休憩',450,56);
  ctx.font='15px DotGothic16, sans-serif';ctx.fillText(Math.floor(pm.left/60)+':'+String(pm.left%60).padStart(2,'0'),450,78);
  ctx.fillStyle='rgba(255,255,255,.35)';ctx.fillRect(417,92,66,5);ctx.fillStyle='#ffffff';ctx.fillRect(417,92,66*pm.frac,5);
  // 読書コーナー
  ctx.fillStyle='#b56b5b';rr(660,384,196,190,10);ctx.fill();
  ctx.strokeStyle='#e9c9a8';ctx.lineWidth=2;rr(668,392,180,174,7);ctx.stroke();
  ctx.fillStyle='#7a5a3c';ctx.fillRect(738,468,26,26);ctx.fillStyle='#a8453f';ctx.fillRect(743,473,16,10);
  ctx.fillStyle='#8a5a44';ctx.fillRect(834,548,18,22);ctx.fillStyle='#4f8a4c';ctx.beginPath();ctx.arc(843,538,15,0,7);ctx.fill();
  // 出口
  ctx.fillStyle='#7a8a6a';rr(410,576,80,24,4);ctx.fill();
  ctx.fillStyle='#f4efe2';ctx.font='12px DotGothic16, sans-serif';ctx.fillText('出口',450,589);
  drawFootprints();

  var items=[];
  LIB_DESKS.forEach(function(d){items.push([d.y+12,1,d]);}); // 席に着いた人より手前に描く
  LIB_SEATS.forEach(function(q){if(q.chair)items.push([q.y-2,2,q]);});
  for(k in others)if(here(others[k]))items.push([others[k].y,4,others[k]]);
  items.push([me.y,5,me]);
  items.sort(function(a,b){return a[0]-b[0]||a[1]-b[1];});
  items.forEach(function(it){var o=it[2];
    if(it[1]===1){
      ctx.fillStyle='rgba(60,40,20,.18)';ctx.fillRect(o.x+3,o.y+o.h+8,o.w,5);
      ctx.fillStyle='#7a5a3c';ctx.fillRect(o.x,o.y+o.h-10,o.w,20);
      ctx.fillStyle='#a07c56';ctx.fillRect(o.x,o.y,o.w,o.h-8);
      ctx.fillStyle='#39424d';ctx.fillRect(o.x+o.w/2-2,o.y-12,4,14);ctx.fillStyle='#f5e7a6';ctx.beginPath();ctx.arc(o.x+o.w/2,o.y-13,6,Math.PI,0);ctx.fill();
      // 誰かが座っている席には、開いたノートを置く
      [32,88].forEach(function(sx){
        var used=(me.r==='lib'&&!me.moving&&Math.abs(me.x-(o.x+sx))<5&&Math.abs(me.y-(o.y+6))<5);
        for(var kk in others){var p=others[kk];if(roomOf(p)==='lib'&&!p.moving&&Math.abs(p.x-(o.x+sx))<5&&Math.abs(p.y-(o.y+6))<5)used=true;}
        if(used){ctx.fillStyle='#f4efe2';ctx.fillRect(o.x+sx-11,o.y+7,10,11);ctx.fillRect(o.x+sx+1,o.y+7,10,11);
          ctx.fillStyle='rgba(60,60,80,.35)';for(var l=0;l<3;l++){ctx.fillRect(o.x+sx-9,o.y+10+l*3,6,1);ctx.fillRect(o.x+sx+3,o.y+10+l*3,6,1);}}
      });
    }else if(it[1]===2){
      ctx.fillStyle='rgba(60,40,20,.18)';ctx.beginPath();ctx.ellipse(o.x,o.y+3,19,6,0,0,7);ctx.fill();
      ctx.fillStyle='#4f6f8a';rr(o.x-17,o.y-30,34,32,7);ctx.fill();
      ctx.fillStyle='#6488a6';rr(o.x-17,o.y-10,34,13,5);ctx.fill();
    }else drawPerson(o,it[1]===5,reduce);
  });
  var signs=[drawSign(LIB_ZONES[0],false)];
  var labels=[{p:me,text:'あなた・'+statusText(me),fill:'#fff7c2',alpha:1}];
  Object.keys(others).sort().forEach(function(key){if(here(others[key]))labels.push({p:others[key],text:statusText(others[key]),fill:'#ffffff',alpha:1});});
  placeLabels(labels,signs);
}
// 町から見た図書館の入口。中にいる人数を出す
function drawDoorSign(){
  var n=libCount(),text=n?'入口・中に'+n+'人':'入口・中に入れます',x=LIB.door.x,y=LIB.door.y-66;
  ctx.font='13px DotGothic16, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  var tw=ctx.measureText(text).width+16;
  ctx.fillStyle=n?'#ffe07a':'#fbf6e6';rr(x-tw/2,y-11,tw,22,3);ctx.fill();ctx.strokeStyle='#5b4634';ctx.lineWidth=1.5;ctx.stroke();
  ctx.fillStyle='#3b2d22';ctx.fillText(text,x,y+1);
  return {x:x,y:y,w:tw};
}
function drawFire(t){
  var x=FIRE.x,y=FIRE.y,i;
  ctx.fillStyle='#5f4731';ctx.save();ctx.translate(x,y-3);ctx.rotate(0.35);ctx.fillRect(-13,-3,26,6);ctx.rotate(-0.7);ctx.fillRect(-13,-3,26,6);ctx.restore();
  ctx.fillStyle='#8f8a80';for(i=0;i<7;i++){var a=i/7*Math.PI*2;ctx.beginPath();ctx.ellipse(x+Math.cos(a)*17,y-2+Math.sin(a)*7,4,3,0,0,7);ctx.fill();}
  var cols=['#e2572b','#f08a2c','#f7cf55'];
  for(i=0;i<3;i++){
    var w=11-i*3,h=(26-i*7)*(reduce?1:0.85+0.15*Math.sin(t/(90+i*37)+i)),sx=reduce?0:Math.sin(t/(130+i*50)+i*2)*2;
    ctx.fillStyle=cols[i];ctx.beginPath();ctx.moveTo(x-w,y-5);ctx.quadraticCurveTo(x-w*0.6+sx,y-5-h*0.6,x+sx,y-5-h);
    ctx.quadraticCurveTo(x+w*0.6+sx,y-5-h*0.6,x+w,y-5);ctx.closePath();ctx.fill();
  }
  if(!reduce)for(i=0;i<3;i++){var ph=((t/1300)+i/3)%1;ctx.fillStyle='rgba(247,207,85,'+(0.8*(1-ph))+')';
    ctx.fillRect(x+Math.sin(ph*7+i*2)*8,y-28-ph*30,2,2);}
}
function drawHeart(x,y,t){
  var k=1+Math.sin(t/260)*0.12;
  ctx.fillStyle='#e0607a';ctx.beginPath();
  ctx.arc(x-3*k,y,3.2*k,Math.PI,0);ctx.arc(x+3*k,y,3.2*k,Math.PI,0);ctx.lineTo(x,y+7*k);ctx.closePath();ctx.fill();
}
function drawCat(c,t){
  var x=c.x,y=c.y,d=c.dir;
  ctx.fillStyle='rgba(20,40,20,.2)';ctx.beginPath();ctx.ellipse(x,y,9,3,0,0,7);ctx.fill();
  ctx.fillStyle='#e9e2d6';
  if(c.sitting){
    rr(x-6,y-13,12,13,5);ctx.fill();
    ctx.beginPath();ctx.arc(x+2*d,y-17,5.5,0,7);ctx.fill();
    ctx.fillRect(x+2*d-5,y-24,3,4);ctx.fillRect(x+2*d+2,y-24,3,4);
    ctx.strokeStyle='#e9e2d6';ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(x-5*d,y-2);
    ctx.quadraticCurveTo(x-13*d,y-2,x-11*d,y-9-Math.sin(t/500)*2);ctx.stroke();
    ctx.fillStyle='#2b2422';ctx.fillRect(x+4*d-1,y-18,2,c.loved?1:2);
    if(c.loved)drawHeart(x+2*d,y-36,t);
  }else{
    var st=Math.sin(c.phase)*1.5;
    rr(x-8,y-9,16,8,4);ctx.fill();
    ctx.fillRect(x-6,y-3,2,3+st);ctx.fillRect(x+4,y-3,2,3-st);
    ctx.beginPath();ctx.arc(x+8*d,y-10,5,0,7);ctx.fill();
    ctx.fillRect(x+8*d-5,y-17,3,4);ctx.fillRect(x+8*d+2,y-17,3,4);
    ctx.fillRect(x-9*d-(d>0?2:0),y-14,2,8);
  }
}
function drawDog(c,t){
  var x=c.x,y=c.y,d=c.dir,wag=Math.sin(t/(c.loved?70:220))*(c.loved?4:1.5);
  ctx.fillStyle='rgba(20,40,20,.2)';ctx.beginPath();ctx.ellipse(x,y,12,4,0,0,7);ctx.fill();
  ctx.fillStyle='#b98552';
  if(c.sitting){
    rr(x-8,y-17,15,17,6);ctx.fill();
    ctx.beginPath();ctx.arc(x+4*d,y-22,7,0,7);ctx.fill();
    ctx.fillRect(x+9*d-(d>0?0:5),y-22,5,4);
    ctx.strokeStyle='#b98552';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x-7*d,y-3);ctx.lineTo(x-14*d,y-7+wag);ctx.stroke();
    ctx.fillStyle='#7a5230';ctx.fillRect(x+1*d-(d>0?0:4),y-30,4,7);
    ctx.fillStyle='#2b2422';ctx.fillRect(x+6*d-1,y-24,2,2);ctx.fillRect(x+13*d-(d>0?0:2),y-22,2,2);
    if(c.loved)drawHeart(x+4*d,y-42,t);
  }else{
    var st=Math.sin(c.phase)*2;
    rr(x-11,y-15,22,10,5);ctx.fill();
    ctx.fillRect(x-9,y-6,3,6+st);ctx.fillRect(x+6,y-6,3,6-st);
    ctx.beginPath();ctx.arc(x+12*d,y-17,6.5,0,7);ctx.fill();
    ctx.fillRect(x+16*d-(d>0?0:5),y-17,5,4);
    ctx.strokeStyle='#b98552';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x-10*d,y-12);ctx.lineTo(x-16*d,y-18+wag);ctx.stroke();
    ctx.fillStyle='#7a5230';ctx.fillRect(x+9*d-(d>0?0:4),y-24,4,7);
    ctx.fillStyle='#2b2422';ctx.fillRect(x+14*d-1,y-19,2,2);
  }
}
// 池の魚(水面下の影)と鴨
function drawPondLife(t){
  var T=Date.now()/1000,i;
  for(i=0;i<3;i++){
    var a=T*(0.11+i*0.03)+i*2.1,fx=POND.x+Math.cos(a)*POND.rx*(0.35+i*0.13),fy=POND.y+Math.sin(a*1.3+i)*POND.ry*0.5;
    var ang=Math.atan2(Math.cos(a*1.3+i)*1.3*POND.ry*0.5,-Math.sin(a)*POND.rx*(0.35+i*0.13));
    ctx.save();ctx.translate(fx,fy);ctx.rotate(ang);ctx.fillStyle='rgba(40,80,100,.45)';
    ctx.beginPath();ctx.ellipse(0,0,7,2.6,0,0,7);ctx.fill();
    ctx.beginPath();ctx.moveTo(-6,0);ctx.lineTo(-11,-3);ctx.lineTo(-11,3);ctx.closePath();ctx.fill();ctx.restore();
  }
  for(i=0;i<2;i++){
    var b=T*0.07+i*2.6,dx=POND.x+Math.cos(b)*POND.rx*(0.62-i*0.2),dy=POND.y+Math.sin(b)*POND.ry*(0.6-i*0.2),dd=-Math.sin(b)>=0?1:-1;
    ctx.strokeStyle='rgba(255,255,255,.5)';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(dx,dy+2,11,3.5,0,0,7);ctx.stroke();
    ctx.fillStyle=i?'#f4efe2':'#a8845a';ctx.beginPath();ctx.ellipse(dx,dy-2,8,5,0,0,7);ctx.fill();
    ctx.fillStyle=i?'#f4efe2':'#3f6b55';ctx.beginPath();ctx.arc(dx+7*dd,dy-8,3.6,0,7);ctx.fill();
    ctx.fillStyle='#e9a43c';ctx.fillRect(dx+10*dd-(dd>0?0:3),dy-8,3,2);
  }
}
// 表示が重ならないよう、先に置いたものを避けて上へずらす。優先順は 自分 → ほかの人 → 痕跡。
function placeLabels(list,fixed){
  ctx.font='13px DotGothic16, sans-serif';
  var placed=fixed.slice();
  list.forEach(function(L){
    L.w=ctx.measureText(L.text).width+14;L.x=L.p.x;L.y=L.p.y-LBL;
    for(var n=0;n<8;n++){
      var hit=false;
      for(var i=0;i<placed.length;i++){var q=placed[i];
        if(Math.abs(q.x-L.x)<(q.w+L.w)/2+4&&Math.abs(q.y-L.y)<23){hit=true;break;}}
      if(!hit)break;
      L.y-=24;
    }
    placed.push(L);
  });
  for(var j=list.length-1;j>=0;j--)drawLabel(list[j]);
}
function drawLabel(L){
  var x=L.x,y=L.y,base=L.p.y-LBL;
  ctx.globalAlpha=L.alpha;
  ctx.font='13px DotGothic16, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  if(y<base){ctx.strokeStyle='#2c3a36';ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(x,y+10);ctx.lineTo(x,base+12);ctx.stroke();}
  ctx.fillStyle=L.fill;rr(x-L.w/2,y-10,L.w,20,4);ctx.fill();
  ctx.strokeStyle='#2c3a36';ctx.lineWidth=1.2;ctx.stroke();
  if(y===base){ctx.beginPath();ctx.moveTo(x-4,y+9.4);ctx.lineTo(x+4,y+9.4);ctx.lineTo(x,y+14);ctx.closePath();ctx.fillStyle=L.fill;ctx.fill();}
  ctx.fillStyle='#22302b';ctx.fillText(L.text,x,y+1);
  ctx.globalAlpha=1;
}
function ageText(s){
  if(s<90)return 'さっき';
  if(s<3600)return Math.round(s/60)+'分前';
  return Math.floor(s/3600)+'時間前';
}
// いまここにいる人の痕跡は出さない。残りは古いほど薄くする。
function visibleTraces(){
  var here={},k,out=[],extra=(Date.now()-tracesAt)/1000;
  here[traceId]=1;for(k in others)if(others[k].t)here[others[k].t]=1;
  traces.forEach(function(t){
    var age=t.age+extra,ttl=t.st==='sleep'?SLEEP_TTL:TRACE_TTL;if(here[t.id]||age>=ttl)return;
    t.now=age;t.alpha=(t.st==='sleep'?0.4:0.12)+(t.st==='sleep'?0.25:0.43)*(1-age/ttl);out.push(t);
  });
  return out;
}
function daylight(){
  var d=new Date(),h=d.getHours()+d.getMinutes()/60,dark,warm=0,name;
  if(h<5||h>=19.5){dark=1;name='よる';}
  else if(h<7){dark=1-(h-5)/2;warm=1-Math.abs(h-6);name='あさ';}
  else if(h<17){dark=0;name=h<11?'あさ':'ひる';}
  else{dark=(h-17)/2.5;warm=1-Math.abs(h-18)/1.5;name='ゆうがた';}
  return {dark:dark,warm:Math.max(0,warm),
    text:String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+' '+name};
}
var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var last=0,clockT=0,bellT=0,light=daylight(),bell=bellState();
function frame(t){
  var dt=Math.min(0.05,(t-last)/1000||0);last=t;
  stepMe(dt,t);if(!me.moving)me.phase+=dt*9;
  var k;for(k in others){stepOther(others[k],dt);if(!others[k].moving)others[k].phase+=dt*9;}
  updatePets();stepCars(dt);stepTrace(dt);track(t);
  bellT-=dt;if(bellT<=0){bellT=1;updateBell();}
  clockT-=dt;if(clockT<=0){clockT=20;light=daylight();$('clock').textContent=light.text;}

  var vw=cw/scale,vh=chh/scale,inLib=me.r==='lib',RW=inLib?LIB.w:W,RH=inLib?LIB.h:H;
  camX=vw>=RW?(RW-vw)/2:Math.min(RW-vw,Math.max(0,me.x-vw/2));
  camY=vh>=RH?(RH-vh)/2:Math.min(RH-vh,Math.max(0,me.y-30-vh/2));
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle=inLib?'#3a2f2a':'#7fa866';ctx.fillRect(0,0,cv.width,cv.height);
  ctx.setTransform(scale*dpr,0,0,scale*dpr,-camX*scale*dpr,-camY*scale*dpr);
  if(inLib){drawLibrary(t,vw,vh);requestAnimationFrame(frame);return;}
  drawGround();drawZones(t);
  if(bell.bell&&!reduce){var bz=bell.zone;ctx.strokeStyle='rgba(255,210,74,'+(0.55+0.35*Math.sin(t/350))+')';ctx.lineWidth=4;rr(bz.x-3,bz.y-3,bz.w+6,bz.h+6,10);ctx.stroke();}
  drawFootprints();
  var ghosts=visibleTraces(),items=[];
  BUILDINGS.forEach(function(b){items.push([b.y+b.h,0,b]);});
  TREES.forEach(function(p){items.push([p[1],1,p]);});
  BENCHES.forEach(function(p){items.push([p[1],2,p]);});
  LAMPS.forEach(function(p){items.push([p[1],3,p]);});
  items.push([TOWER.y,8,TOWER]);
  if(wx.cart)items.push([455,9,wx.cart]);
  for(k in cars)items.push([cars[k].y,12,cars[k]]);
  ghosts.forEach(function(g){items.push([g.y,7,g]);});
  for(k in others)if(here(others[k]))items.push([others[k].y,4,others[k]]);
  items.push([me.y,5,me]);items.push([PETS.cat.y,6,PETS.cat]);items.push([PETS.dog.y,10,PETS.dog]);items.push([FIRE.y,11,FIRE]);
  items.sort(function(a,b){return a[0]-b[0];});
  items.forEach(function(it){var o=it[2];
    if(it[1]===0)drawBuilding(o);else if(it[1]===1)drawTree(o[0],o[1]);else if(it[1]===2)drawBench(o[0],o[1]);
    else if(it[1]===3)drawLamp(o[0],o[1]);else if(it[1]===4)drawPerson(o,false,reduce);
    else if(it[1]===5)drawPerson(o,true,reduce);
    else if(it[1]===7){ctx.globalAlpha=o.alpha;drawPerson(o,false,true);ctx.globalAlpha=1;}
    else if(it[1]===8)drawTower(bell.bell&&bell.elapsed<60&&!reduce?Math.sin(t/160)*0.45:0);
    else if(it[1]===9)drawCart(o,t);
    else if(it[1]===10)drawDog(o,t);
    else if(it[1]===11)drawFire(t);
    else if(it[1]===12)drawCar(o);
    else drawCat(o,t);});
  if(wx.rain>0){ctx.fillStyle=(wx.snow?'rgba(225,232,240,':'rgba(60,80,115,')+(0.17*wx.rain)+')';ctx.fillRect(camX,camY,vw,vh);}
  if(!reduce)drawSteam(t);
  if(light.warm>0){ctx.fillStyle='rgba(255,150,70,'+(0.16*light.warm)+')';ctx.fillRect(camX,camY,vw,vh);}
  if(light.dark>0){
    ctx.fillStyle='rgba(18,26,66,'+(0.58*light.dark)+')';ctx.fillRect(camX,camY,vw,vh);
    ctx.globalCompositeOperation='lighter';
    LAMPS.forEach(function(p){var g=ctx.createRadialGradient(p[0],p[1]-40,2,p[0],p[1]-20,90);
      g.addColorStop(0,'rgba(255,225,140,'+(0.5*light.dark)+')');g.addColorStop(1,'rgba(255,225,140,0)');
      ctx.fillStyle=g;ctx.fillRect(p[0]-90,p[1]-110,180,180);});
    for(var ck in cars){var cc=cars[ck],hx=cc.x+cc.dir*46,hg=ctx.createRadialGradient(hx,cc.y-10,2,hx,cc.y-10,46);
      hg.addColorStop(0,'rgba(255,240,170,'+(0.5*light.dark)+')');hg.addColorStop(1,'rgba(255,240,170,0)');
      ctx.fillStyle=hg;ctx.fillRect(hx-46,cc.y-56,92,92);}
    var fg=ctx.createRadialGradient(FIRE.x,FIRE.y-12,4,FIRE.x,FIRE.y-12,120);
    fg.addColorStop(0,'rgba(255,170,80,'+(0.6*light.dark)+')');fg.addColorStop(1,'rgba(255,170,80,0)');
    ctx.fillStyle=fg;ctx.fillRect(FIRE.x-120,FIRE.y-132,240,240);
    ctx.fillStyle='rgba(255,214,120,'+(0.75*light.dark)+')';
    BUILDINGS.forEach(function(b){winRects(b).forEach(function(w){ctx.fillRect(w[0],w[1],w[2],w[3]);});});
    ctx.globalCompositeOperation='source-over';
  }
  if(bell.bell&&bell.elapsed<60&&!reduce){for(var ri=0;ri<3;ri++){var rad=((t/25)+ri*40)%120;
    ctx.strokeStyle='rgba(255,224,122,'+(0.7*(1-rad/120))+')';ctx.lineWidth=2;ctx.beginPath();ctx.arc(TOWER.x,TOWER.y-40,rad,0,7);ctx.stroke();}}
  drawSky(t,vw,vh);drawStars(vw,vh);drawHanabi();
  var signs=ZONES.map(function(z){return drawSign(z,!!bell.bell&&bell.zone===z);});
  signs.push(drawDoorSign());
  var labels=[{p:me,text:'あなた・'+statusText(me),fill:'#fff7c2',alpha:1}];
  Object.keys(others).sort().forEach(function(key){if(here(others[key]))labels.push({p:others[key],text:statusText(others[key]),fill:'#ffffff',alpha:1});});
  ghosts.forEach(function(g){labels.push({p:g,text:STATUS_MAP[g.st]+'・'+ageText(g.now),fill:'#ffffff',alpha:Math.min(0.75,g.alpha+0.2)});});
  placeLabels(labels,signs);
  if(bell.bell)drawPointer(bell.zone,vw,vh);
  else if(wx.hanabi)drawPointer(HANABI,vw,vh);
  requestAnimationFrame(frame);
}
// 環境音(sound.js)に渡す、いまの天気と自分の位置
window.onstaylyTown={env:function(){
  var b=zoneBySt('bath');
  function near(px,py){var d=Math.hypot(me.x-px,me.y-py),f=Math.max(0,Math.min(1,1-(d-70)/320));return f*f;}
  if(me.r==='lib')return {car:0,anyCar:0,rain:(wx.snow?0:wx.rain)*0.35,night:0,bath:0,pond:0,fire:0};
  var car=0,any=0,ck;for(ck in cars){any=1;car=Math.max(car,near(cars[ck].x,cars[ck].y)*(0.35+0.65*cars[ck].v/CAR_SPEED));}
  return {car:car,anyCar:any,rain:wx.snow?0:wx.rain,night:wx.rain>0?0:light.dark,bath:near(b.x+b.w/2,b.y+b.h/2),pond:near(POND.x,POND.y),fire:near(FIRE.x,FIRE.y)};
}};
start();
})();
