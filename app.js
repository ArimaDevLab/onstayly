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
  {h:21,m:30,len:30,st:'sleep',name:'おやすみ(小中学生)',text:'小中学生はそろそろおやすみの時間です'},
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
var TREES=[[50,130],[420,290],[610,150],[1345,150],[1355,345],[590,350],[40,345],[600,640],[30,810],
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
var me={r:'town',ss:0,aw:0,x:675,y:435,st:'zone',manual:'zone',zone:null,c:0,tx:null,ty:null,phase:0,moving:false,dir:1,fd:0,side:1};
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
/* 町の住人。本物の人ではないので、エプロンや帽子で見分けがつくようにし、人数にも数えない。
   動物と同じく、動きは時計から決まる。from〜to は出てくる時間帯(日本時間)。 */
var RESIDENTS=[
  {r:'lib',label:'司書さん',col:'#7a6a8a',apron:'#f4efe2',hat:'bun',from:8,to:22,sit:30,walk:14,off:0,
    route:[[440,152],[250,152],[440,152],[620,152],[800,160],[620,152]]},
  {r:'town',label:'番台さん',col:'#5b7a8a',apron:'#f4efe2',hat:'band',from:7,to:22,sit:40,walk:8,off:11,
    route:[[205,662],[118,662]]},
  {r:'town',label:'食堂の人',col:'#c9774a',apron:'#ffffff',hat:'chef',from:7,to:21,sit:25,walk:8,off:5,
    route:[[1112,262],[1192,304],[1272,262],[1192,362]]},
  {r:'town',label:'そうじの人',col:'#6f8f5a',apron:null,hat:'straw',tool:'broom',from:7,to:18,sit:12,walk:20,off:31,
    route:[[842,692],[850,932],[1190,946],[850,932]]}
];
var residents=[];
function updateResidents(){
  var T=Date.now()/1000,h=townTime().h;
  residents=[];
  RESIDENTS.forEach(function(d,i){
    if(h<d.from||h>=d.to)return;
    var a=petAt(d.route,T+d.off,d.sit,d.walk);
    residents.push({seed:i*5+2,npc:d,r:d.r,x:a.x,y:a.y,dir:a.dir,moving:!a.sitting,phase:a.phase,c:5,col:d.col,st:'zone'});
  });
}
function drawResident(p){
  var d=p.npc,x=p.x,y=p.y;
  if(d.apron){ctx.fillStyle=d.apron;rr(x-6,y-25,12,15,3);ctx.fill();ctx.fillRect(x-4,y-28,2,4);ctx.fillRect(x+2,y-28,2,4);}
  if(d.hat==='chef'){ctx.fillStyle='#ffffff';rr(x-7,y-52,14,11,4);ctx.fill();ctx.fillRect(x-7,y-44,14,3);}
  else if(d.hat==='straw'){ctx.fillStyle='#d9b96a';ctx.beginPath();ctx.ellipse(x,y-42,14,4,0,0,7);ctx.fill();ctx.beginPath();ctx.arc(x,y-43,7,Math.PI,0);ctx.fill();}
  else if(d.hat==='bun'){ctx.fillStyle='#3a2c26';ctx.beginPath();ctx.arc(x,y-46,4.5,0,7);ctx.fill();
    ctx.strokeStyle='#2b2422';ctx.lineWidth=1;ctx.strokeRect(x-6.5,y-37.5,5,4);ctx.strokeRect(x+1.5,y-37.5,5,4);}
  else if(d.hat==='band'){ctx.fillStyle='#f4efe2';ctx.fillRect(x-8,y-42,16,3);}
  if(d.tool==='broom'){var bx=x+13*p.dir,sw=p.moving?Math.sin(p.phase*0.6)*3:0;
    ctx.strokeStyle='#8a6a48';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(bx-2*p.dir,y-30);ctx.lineTo(bx+sw,y-3);ctx.stroke();
    ctx.fillStyle='#d9b96a';ctx.fillRect(bx+sw-4,y-4,8,5);}
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
  if(p.pl)return p.pl===2?'つみき中':'ボウリング中';
  if(nearPet(p,PETS.cat))return 'ねこといっしょ';
  if(nearPet(p,PETS.dog))return 'いぬといっしょ';
  if(hasItem(p))return ITEMS[p.it];
  if(p.ss&&seatOf(p)){ // 図書館の席に着いてからの時間(席をはずしている間は止まる)
    var away=isAway(p),mins=Math.floor(((away?p.aw:Date.now())-p.ss)/60000);
    var dur=mins>=60?Math.floor(mins/60)+'時間'+(mins%60)+'分':mins+'分';
    if(away)return '席をはずしています'+(mins>=1?'('+dur+')':'');
    if(mins>=1)return STATUS_MAP[p.st]+' '+dur;
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
  if(propBlocked(x,y))return true;
  if(Math.abs(x-TWR.x)<34&&y>TWR.y-22&&y<TWR.y+6)return true;
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
  // はじめての人にだけ案内を出す。「あそびかた」でいつでも開ける。
  var guide=$('guide');
  if(!lsGet('irudake-seen'))guide.hidden=false;
  $('guide-close').addEventListener('click',function(){guide.hidden=true;lsSet('irudake-seen','1');});
  $('guide-open').addEventListener('click',function(){guide.hidden=false;$('guide-close').focus();});
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
  loadPins();setInterval(loadPins,60000);
  loadTower();setInterval(loadTower,60000);
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
    if(!o)o=others[k]={r:room,x:x,y:y,tx:null,ty:null,phase:0,moving:false,dir:1,fd:0,side:1,seed:strSeed(k)};
    else if(o.r!==room){o.r=room;o.x=x;o.y=y;o.tx=null;o.moving=false;}
    else if(o.tx===null&&Math.hypot(o.x-x,o.y-y)>40){o.tx=x;o.ty=y;o.direct=true;}
    o.pl=(m.pl===1||m.pl===2)?m.pl:0;
    o.aw=(typeof m.aw==='number'&&m.aw>Date.now()-86400000&&m.aw<=Date.now()+5000)?m.aw:0;
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
// 町のみんなで今日たおしたピンの合計(ボウリング)。データベースが未設定のときは出さない。
/* みんなの塔。図書館で勉強した1分がレンガ1個になり、町の塔が伸びる。
   5段で1本が完成し、完成したら次の塔を建て始める。 */
var TWR={x:755,y:242};
var TIERS=[{need:100,h:60},{need:300,h:55},{need:600,h:50},{need:1000,h:42},{need:1500,h:28}];
var TOWER_FULL=TIERS.reduce(function(a,t){return a+t.need;},0);
var tower={total:null,today:0},partyUntil=0,studyAcc=0,floats=[];
function towerStage(total){
  var n=Math.floor(total/TOWER_FULL),left=total%TOWER_FULL,h=0;
  for(var i=0;i<TIERS.length;i++){
    if(left<TIERS[i].need)return {n:n,tier:i,height:h+TIERS[i].h*left/TIERS[i].need,toNext:TIERS[i].need-left};
    left-=TIERS[i].need;h+=TIERS[i].h;
  }
  return {n:n,tier:0,height:0,toNext:TIERS[0].need};
}
function setTower(row){
  if(!row||typeof row.bricks_total!=='number')return;
  var before=tower.total===null?null:towerStage(tower.total),after=towerStage(row.bricks_total);
  // 段か塔が完成した瞬間は、塔の上に花火を上げる
  if(before&&(after.n>before.n||after.tier>before.tier))partyUntil=Date.now()+25000;
  tower.total=row.bricks_total;tower.today=typeof row.bricks_today==='number'?row.bricks_today:0;
}
function loadTower(){
  if(!sb)return;
  sb.rpc('tower_state').then(function(r){if(!r.error&&Array.isArray(r.data))setTower(r.data[0]);},function(){});
}
function addBricks(n){
  n=Math.max(1,Math.min(30,Math.floor(n)));
  if(!sb)return Promise.resolve(null);
  return sb.rpc('add_bricks',{n:n}).then(function(r){
    if(r.error||!Array.isArray(r.data)||!r.data[0])return null;
    setTower(r.data[0]);return tower.total;
  },function(){return null;});
}
// 席に着いて画面を見ている時間を数え、5分ごとにレンガ5個を塔へ送る
function stepStudyBricks(dt,seated){
  var rate=FORCE==='tower'?60:1;
  if(seated&&!me.aw){
    studyAcc+=dt*rate;
    if(studyAcc>=300){studyAcc-=300;giveBricks(5);}
  }else if(!seated){
    if(studyAcc>=60)giveBricks(Math.floor(studyAcc/60));
    studyAcc=0;
  }
}
function giveBricks(n){
  floats.push({x:me.x,y:me.y-74,text:'レンガ +'+n,t:performance.now(),r:me.r});
  addBricks(n);
}
function drawFloats(){
  var now=performance.now();
  floats=floats.filter(function(f){return now-f.t<2600;});
  ctx.font='14px DotGothic16, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  floats.forEach(function(f){
    if(f.r!==me.r)return;
    var k=(now-f.t)/2600;ctx.globalAlpha=1-k*k;
    ctx.strokeStyle='#ffffff';ctx.lineWidth=3;ctx.strokeText(f.text,f.x,f.y-k*26);
    ctx.fillStyle='#8a4a2f';ctx.fillText(f.text,f.x,f.y-k*26);
  });
  ctx.globalAlpha=1;
}
function towerHalf(h){return 3+38*Math.pow(1-h/235,1.7);} // 高さ h での塔の半分の幅
function drawTownTower(){
  var x=TWR.x,y=TWR.y,st=tower.total===null?{n:0,tier:0,height:0}:towerStage(tower.total),H=st.height,i,h;
  ctx.fillStyle='rgba(30,50,30,.2)';ctx.beginPath();ctx.ellipse(x,y,46,9,0,0,7);ctx.fill();
  ctx.fillStyle='#8f8a80';ctx.fillRect(x-44,y-5,88,7);
  if(H>0){
    ctx.strokeStyle='#8a4a2f';ctx.lineWidth=2.4;ctx.beginPath();
    for(i=0;i<=H;i+=3){h=Math.min(i,H);ctx.lineTo(x-towerHalf(h),y-5-h);}
    ctx.stroke();ctx.beginPath();
    for(i=0;i<=H;i+=3){h=Math.min(i,H);ctx.lineTo(x+towerHalf(h),y-5-h);}
    ctx.stroke();
    ctx.lineWidth=1.1;ctx.beginPath();
    for(h=0;h+11<=H;h+=11){var a=towerHalf(h),b=towerHalf(h+11);
      ctx.moveTo(x-a,y-5-h);ctx.lineTo(x+b,y-5-h-11);ctx.moveTo(x+a,y-5-h);ctx.lineTo(x-b,y-5-h-11);
      ctx.moveTo(x-b,y-5-h-11);ctx.lineTo(x+b,y-5-h-11);}
    ctx.stroke();
    // 段のさかいに展望台
    var acc=0;ctx.fillStyle='#6b3a26';
    for(i=0;i<TIERS.length-1;i++){acc+=TIERS[i].h;if(acc<=H){var w=towerHalf(acc)+5;ctx.fillRect(x-w,y-5-acc-2,w*2,4);}}
    // 建てている途中の足場
    ctx.strokeStyle='rgba(90,70,50,.6)';ctx.lineWidth=1;ctx.setLineDash([3,3]);
    var tw=towerHalf(H)+6;ctx.strokeRect(x-tw,y-5-H-9,tw*2,9);ctx.setLineDash([]);
  }
  // 完成した塔の数だけ、ふもとに旗を立てる
  for(i=0;i<Math.min(st.n,8);i++){var fx=x-40+i*11;ctx.fillStyle='#5b4634';ctx.fillRect(fx,y-22,1.5,18);
    ctx.fillStyle=['#c94f4f','#e0b64a','#4f7fc9','#6fa377'][i%4];ctx.beginPath();ctx.moveTo(fx+1.5,y-22);ctx.lineTo(fx+9,y-19);ctx.lineTo(fx+1.5,y-16);ctx.closePath();ctx.fill();}
}
function drawTowerSign(){
  if(tower.total===null)return null;
  var st=towerStage(tower.total);
  var l1='みんなの塔 '+(st.n+1)+'本め',l2='今日 +'+tower.today.toLocaleString('ja-JP')+'個・次の段まで '+st.toNext.toLocaleString('ja-JP')+'個';
  ctx.font='13px DotGothic16, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  // ゲームコーナーの看板と重ならないよう、塔の右はしにそろえて左へのばす
  var tw=Math.max(ctx.measureText(l1).width,ctx.measureText(l2).width)+16,x=TWR.x+41-tw/2,y=TWR.y+28;
  ctx.fillStyle='#fbf6e6';rr(x-tw/2,y-19,tw,38,3);ctx.fill();ctx.strokeStyle='#5b4634';ctx.lineWidth=1.5;ctx.stroke();
  ctx.fillStyle='#3b2d22';ctx.fillText(l1,x,y-8);ctx.fillText(l2,x,y+10);
  return {x:x,y:y,w:tw};
}
var pinsToday=null;
function loadPins(){
  if(!sb)return;
  sb.rpc('counter_today',{k:'pins'}).then(function(r){if(!r.error&&typeof r.data==='number')pinsToday=r.data;},function(){});
}
function addPins(n){
  if(!sb)return Promise.resolve(null);
  return sb.rpc('bump_counter',{k:'pins',n:n}).then(function(r){
    if(r.error||typeof r.data!=='number')return null;
    pinsToday=r.data;return r.data;
  },function(){return null;});
}
function presenceNow(){
  return {r:me.r,ss:me.ss||0,aw:me.aw||0,pl:me.pl?1:0,x:Math.round(me.x),y:Math.round(me.y),st:me.st,c:me.c,t:traceId,it:hasItem(me)?me.it:null,iu:hasItem(me)?me.iu:0};
}
function track(now){
  if(!online||!ch||!trackDirty||now-lastTrack<1000)return;
  lastTrack=now;trackDirty=false;
  ch.track(presenceNow());
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
/* 席をはずす: ほかのアプリやタブに切りかえると、勉強時間が止まる。
   15秒以内に戻れば、はずしたことにしない。画面を消したときも同じ扱いになる。 */
var AWAY_GRACE=15000;
function isAway(p){return !!(p.aw&&seatOf(p)&&Date.now()-p.aw>AWAY_GRACE);}
function setAway(hidden){
  if(hidden){
    if(me.aw)return;
    me.aw=Date.now();
    if(online&&ch){try{ch.track(presenceNow());}catch(e){}} // 画面が隠れると後からは送れないので、その場で送る
  }else if(me.aw){
    var gone=Date.now()-me.aw;
    if(me.ss&&gone>AWAY_GRACE)me.ss+=gone; // はずしていた分は勉強時間に入れない
    me.aw=0;trackDirty=true;lastTrack=0;saveLocal();
  }
}
// 席に着いている間は、スマホの画面が自動で消えないようにする(対応していないブラウザでは何もしない)
var wake=null;
function syncWake(){
  var want=!!seatOf(me)&&document.visibilityState==='visible';
  if(want&&!wake&&navigator.wakeLock){
    wake='pending';
    navigator.wakeLock.request('screen').then(function(w){
      wake=w;w.addEventListener('release',function(){if(wake===w)wake=null;});
      if(!seatOf(me)){w.release();}
    },function(){wake=null;});
  }else if(!want&&wake&&wake!=='pending'){var w=wake;wake=null;w.release();}
}
document.addEventListener('visibilitychange',function(){
  setAway(document.visibilityState==='hidden');syncWake();
  if(document.visibilityState==='visible'&&sb&&!online){clearTimeout(rejoinT);rejoinT=null;rejoinSoon(300);}
  if(document.visibilityState==='hidden'){saveLocal();if(traceStale()||Date.now()-traceAt>60000)saveTrace();}
});

/* ---------- 入力 ---------- */
var cv=$('town'),ctx=cv.getContext('2d'),stage=$('stage');
/* ドット絵: 町を小さな板に描いてから、にじませずに拡大する。文字だけは拡大のあとにくっきり描く。
   アドレスの末尾に #smooth を付けると、前のなめらかな見た目で表示する。 */
var PIX={on:false,cv:document.createElement('canvas'),texts:[]};PIX.ctx=PIX.cv.getContext('2d');
function wtext(str,x,y,font,fill){
  if(PIX.on){PIX.texts.push([str,x,y,font,fill]);return;}
  ctx.font=font;ctx.fillStyle=fill;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(str,x,y);
}
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
  me.stuck=0;sendMove(me.tx,me.ty,false);
  // 指でのタップでは画面にフォーカスを当てない(ブラウザによっては当たった印に色が付くため)
  if(e.pointerType==='mouse')cv.focus({preventScroll:true});
});
// タップをブラウザの既定の動き(選択・強調表示・長押しメニュー)に回さない
cv.addEventListener('touchstart',function(e){e.preventDefault();},{passive:false});
cv.addEventListener('contextmenu',function(e){e.preventDefault();});
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
  stepStudyBricks(dt,seated);
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
  ctx.fillStyle='#94c46c';ctx.fillRect(0,0,W,H);
  // 草のふさ: 明るい2ドットと暗い1ドット(場所は毎回同じ)
  var d=DOT(),i,gx,gy;
  for(i=0;i<420;i++){gx=(i*397+i*i*13)%W;gy=(i*251+i*i*7)%H;
    ctx.fillStyle=i%3?'#a7d27c':'#7fb35c';ctx.fillRect(gx,gy,d,d);ctx.fillRect(gx+d,gy-d,d,d);if(i%3)ctx.fillRect(gx+2*d,gy,d,d);}
  ctx.fillStyle='#86b964';rr(800,600,560,370,26);ctx.fill();
  ctx.fillStyle='#dccba4';ctx.fillRect(0,400,W,70);ctx.fillRect(640,0,70,H);
  ctx.fillStyle='#b9a67e';ctx.fillRect(0,468,W,4);ctx.fillRect(0,398,W,4);ctx.fillRect(638,0,4,H);ctx.fillRect(708,0,4,H);
  ctx.fillStyle='#dccba4';ctx.fillRect(642,400,66,72);
  ctx.fillStyle='rgba(120,100,70,.18)';                                   // 石だたみの目地
  for(i=0;i<W;i+=28){ctx.fillRect(i,402,d,24);ctx.fillRect(i+14,446,d,22);}
  for(i=0;i<H;i+=28){if(i<398||i>470){ctx.fillRect(642,i,24,d);ctx.fillRect(684,i+14,24,d);}}
  ctx.fillStyle='#efe4c8';
  for(var s=20;s<W;s+=70){ctx.fillRect(s,433,30,4);}
  ctx.fillStyle='#dccba4';ctx.fillRect(900,470,30,150);ctx.fillRect(295,470,30,510);
  ctx.fillStyle='#7aa35f';ctx.beginPath();ctx.ellipse(POND.x,POND.y,POND.rx+8,POND.ry+7,0,0,7);ctx.fill();
  ctx.fillStyle='#6fb3c9';ctx.beginPath();ctx.ellipse(POND.x,POND.y,POND.rx,POND.ry,0,0,7);ctx.fill();
  ctx.fillStyle='#5c9fb8';ctx.beginPath();ctx.ellipse(POND.x+6,POND.y+8,POND.rx-14,POND.ry-14,0,0,7);ctx.fill();   // 深いところ
  ctx.fillStyle='#8fc8d8';ctx.beginPath();ctx.ellipse(POND.x-30,POND.y-14,46,12,0,0,7);ctx.fill();
  pixSparkles(POND.x-POND.rx*0.6,POND.y-POND.ry*0.5,POND.rx*1.2,POND.ry,77,'rgba(255,255,255,.7)');
  pixRing(POND.x,POND.y,POND.rx+6,POND.ry+5,'#a9a49a','#5f5a52',11);
  [[POND.x-POND.rx+18,POND.y+18],[POND.x+POND.rx-30,POND.y-26]].forEach(function(l){var d=DOT();   // はすの葉
    ctx.fillStyle='#3f7a45';ctx.fillRect(Math.round(l[0]/d)*d,Math.round(l[1]/d)*d,5*d,3*d);ctx.fillStyle='#5f9f5a';ctx.fillRect(Math.round(l[0]/d)*d+d,Math.round(l[1]/d)*d,3*d,2*d);});
  drawPondLife(0);
}
function drawZones(t){
  ZONES.forEach(function(z){
    var i,j;
    if(z.fire){ctx.fillStyle=z.floor;ctx.beginPath();ctx.ellipse(z.x+z.w/2,z.y+z.h/2,z.w/2,z.h/2,0,0,7);ctx.fill();return;}
    ctx.fillStyle=z.floor;rr(z.x,z.y,z.w,z.h,8);ctx.fill();
    ctx.strokeStyle=shade(z.floor,-0.25);ctx.lineWidth=DOT();rr(z.x+DOT()/2,z.y+DOT()/2,z.w-DOT(),z.h-DOT(),8);ctx.stroke();
    if(z.st==='study'){
      ctx.fillStyle='rgba(90,60,30,.18)';for(i=20;i<z.h;i+=20)ctx.fillRect(z.x+4,z.y+i,z.w-8,1.5);
      for(i=0;i<3;i++)for(j=0;j<2;j++){var dx=z.x+28+i*72,dy=z.y+26+j*50;
        drawSprite(OGRID.desk,{O:'#3a2a20',w:'#b08860',d:'#7a5a3c',W:'#f4efe2',b:['#c94f4f','#3f7fbf','#4f9d6a'][(i+j)%3],k:'#5f4731'},dx+23,dy+24,(i+j)%2===1);}
    }else if(z.st==='game'){
      var cols=['#ff7a7a','#7ad1ff','#ffe07a','#9aff9a','#d59aff'];
      ctx.fillStyle='rgba(255,255,255,.25)';for(i=0;i<z.w;i+=46)for(j=(i/46)%2?0:23;j<z.h;j+=46)ctx.fillRect(z.x+i,z.y+j,23,23);
      ctx.fillStyle=z.floor;ctx.fillRect(z.x+z.w-12,z.y,12,z.h);
      for(i=0;i<5;i++){var gx=z.x+14+i*42;
        drawSprite(OGRID.arcade,{O:'#1e1a2a',M:cols[i],C:'#3b4a6b',c:'#2c3854',S:cols[(i+Math.floor(t/900))%5],s:'#ffffff',r:'#e2553f',b:'#4f9fd0'},gx+15,z.y+42,false);}
    }else if(z.st==='eat'){
      for(i=0;i<3;i++)for(j=0;j<2;j++){var ex=z.x+42+i*65,ey=z.y+40+j*55;
        softShadow(ex+2,ey+10,15,5,0.3);
        drawSprite(OGRID.table,{O:'#5b4634',w:'#fbf6e6',W:'#ffffff',r:'#d9694a',d:'#8a6a48'},ex,ey+12,false);}
    }else if(z.st==='bath'){
      ctx.fillStyle='#7fc4cf';rr(z.x+9,z.y+9,z.w-18,z.h-18,14);ctx.fill();
      ctx.fillStyle='#a5dbe3';ctx.beginPath();ctx.ellipse(z.x+z.w*0.4,z.y+z.h*0.38,z.w*0.22,9,0,0,7);ctx.fill();
      pixSparkles(z.x+16,z.y+16,z.w-32,z.h-32,31,'rgba(255,255,255,.75)');
      pixRing(z.x+z.w/2,z.y+z.h/2,z.w/2-6,z.h/2-6,'#a9a49a','#5f5a52',12);
    }else if(z.st==='sleep'){
      var tg=DOT();ctx.fillStyle='rgba(90,110,40,.25)';for(i=0;i<z.w;i+=36)ctx.fillRect(z.x+i,z.y,tg,z.h);for(j=0;j<z.h;j+=18)ctx.fillRect(z.x,z.y+j,z.w,tg);  // たたみの目
      for(i=0;i<2;i++)for(j=0;j<3;j++){var fx=z.x+12+i*100,fy=z.y+9+j*33;
        blitPix(futonBitmap(['#9fb7d6','#d6a9a9','#a9d6b4','#d6cba9','#b9a9d6','#a9cfd6'][i*3+j],i*3+j),fx,fy);}
    }else if(z.st==='cook'){
      var cg=DOT();ctx.fillStyle='rgba(80,70,60,.18)';for(i=0;i<z.w;i+=22)for(j=0;j<z.h;j+=22)ctx.fillRect(z.x+i+((j/22)%2?11:0),z.y+j,cg,cg*4); // 石の床
      blitPix(cookBitmap(z.w-20),z.x+10,z.y+8);
    }else if(z.st==='exercise'){
      ctx.strokeStyle='rgba(255,255,255,.85)';ctx.lineWidth=DOT();
      rr(z.x+12,z.y+12,z.w-24,z.h-24,38);ctx.stroke();rr(z.x+30,z.y+30,z.w-60,z.h-60,20);ctx.stroke();
      ctx.fillStyle='rgba(120,80,40,.18)';var eg=DOT();for(i=0;i<40;i++){var hv=h32(500+i);ctx.fillRect(Math.round((z.x+8+hv%(z.w-16))/eg)*eg,Math.round((z.y+8+(hv>>>12)%(z.h-16))/eg)*eg,eg,eg);}
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
  softShadow(x,y,20,6,0.36);
  drawSprite(OGRID.belltower,{O:'#3a2a20',r:'#7a4b3a',p:'#6b4a36'},x,y,false);
  // 止まっているときはドットにぴったり合わせて描く(回すとにじむので、ゆれている間だけ回す)
  var bp={O:'#6b4f12',y:'#e2b23a',Y:'#f7d36a'};
  if(!ang){drawSprite(OGRID.bell,bp,x,y-34,false);return;}
  var d=DOT(),tx=Math.round(x/d)*d,ty=Math.round((y-56)/d)*d;
  ctx.save();ctx.translate(tx,ty);ctx.rotate(ang);drawSprite(OGRID.bell,bp,0,22,false);ctx.restore();
}
function drawSign(z,active){
  var n=zoneCount(z),text=z.name+(n?' '+n+'人':'');
  if(z.st==='game'&&!z.r&&pinsToday!==null)text+='・今日 '+pinsToday.toLocaleString('ja-JP')+'本';
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
  LBL=wx.rain>0.3?88:62;
}
var CART_STOP_X=540;
var LBL=62; // 頭の上の表示の高さ(傘をさしている間は少し上げる)
function drawUmbrella(p){
  var col=COLORS[p.c]||COLORS[5];
  drawSprite(umbrellaGrid(),{O:shade(col,-0.45),U:col,u:shade(col,0.3),k:'#4b5560'},p.x+3*p.dir,p.y-32,false);
}
function drawCart(c,t){
  var x=c.x,y=455,bobc=c.stopped?0:Math.sin(t/120)*0.8;
  softShadow(x,y,46,7,0.4);
  var cv=pixBitmap('cart'+(c.warm?1:0),33,21,function(P){
    var cc=c.warm?'#a8453f':'#3f7fbf',O='#2a2230',k;
    for(k=0;k<25;k++)P(1+k,0,1,3,(k>>1)%2?'#f4efe2':cc);P(0,0,27,1,O);
    for(k=0;k<25;k+=2)P(1+k,3,1,1,(k>>1)%2?'#f4efe2':cc);
    P(2,3,1,8,'#6b4a36');P(23,3,1,8,'#6b4a36');
    P(1,10,24,8,O);P(2,11,22,6,'#8a5a3a');for(k=12;k<17;k+=2)P(2,k,22,1,'#7a4c30');
    P(4,11,17,6,'#fbf6e6');
    P(24,11,8,7,O);P(25,12,6,5,'#39424d');P(27,12,3,3,'#bcd9e6');
    [[8,17,3],[20,17,3],[29,18,2]].forEach(function(w){for(var yy=-w[2];yy<=w[2];yy++)for(var xx=-w[2];xx<=w[2];xx++)
      if(xx*xx+yy*yy<=w[2]*w[2]+1)P(w[0]+xx,w[1]+yy,1,1,(xx*xx+yy*yy<=1)?'#8a8f98':'#2b2422');});});
  blitPix(cv,x-42,y-54+bobc);
  wtext(c.warm?'焼き芋':'かき氷',x-6,y-19+bobc,'12px DotGothic16, sans-serif','#3b2d22');
  if(c.warm&&!reduce)for(var i=0;i<3;i++){var ph=((t/1500)+i/3)%1;
    ctx.fillStyle='rgba(255,255,255,'+(0.4*(1-ph))+')';ctx.beginPath();ctx.arc(x-20+i*4+Math.sin(ph*5+i)*3,y-54-ph*26,4+ph*5,0,7);ctx.fill();}
}
// 雨・雪・花びら・落ち葉。画面に対して降らせる。
var SKY=[];(function(){for(var i=0;i<110;i++)SKY.push([h32(i*2+11)/4294967296,h32(i*2+12)/4294967296]);})();
function drawSky(t,vw,vh){
  var i,px,py;
  if(wx.rain>0&&!wx.snow){
    ctx.strokeStyle='rgba(205,225,255,'+(0.3*wx.rain)+')';ctx.lineWidth=1;ctx.beginPath();
    for(i=0;i<110;i++){
      px=camX+((SKY[i][0]*(vw+40)+t*0.07)%(vw+40))-20;py=camY+((SKY[i][1]*(vh+30)+t*(0.75+(i%5)*0.07))%(vh+30))-15;
      ctx.moveTo(px,py);ctx.lineTo(px-3,py+9);}
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
  var party=Date.now()<partyUntil||FORCE==='party';
  if(!wx.hanabi&&!party)return;
  var HB=wx.hanabi?HANABI:{x:TWR.x-170,y:10,w:340,h:170},launchY=wx.hanabi?POND.y:TWR.y-30;
  var ms=Date.now(),gap=1400,s0=Math.floor(ms/gap);
  ctx.globalCompositeOperation='lighter';
  for(var s=s0-2;s<=s0;s++){
    var hv=h32(s),age=(ms-s*gap)/1000;
    var cx=HB.x+(hv%HB.w),cy=Math.max(camY+30,HB.y+((hv>>>9)%HB.h)),hue=(hv>>>17)%360;
    if(age<0.55){ // 打ち上がる
      var r=age/0.55;ctx.fillStyle='rgba(255,240,200,.9)';ctx.beginPath();ctx.arc(cx,launchY+(cy-launchY)*r,2,0,7);ctx.fill();continue;
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
  updateWorld();syncWake();
  bell=bellState();
  var el=$('bell');
  if(bell.bell){
    var n=zoneCount(bell.zone);
    el.textContent=(bell.bell.text||bell.bell.name+'の時間です')+'('+hhmm(bell.end)+'まで)。'+bell.zone.name+'に'+(n?n+'人います':'まだ誰もいません');
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
    var fd=DOT();ctx.fillRect(Math.round(f.x/fd)*fd-fd,Math.round(f.y/fd)*fd,2*fd,fd);}
  ctx.globalAlpha=1;
}
/* 建物のドット絵。1ドット=1ピクセルの小さな板に描いて覚えておき、ぼかさずに貼る。
   ドットの大きさ(画面ごとに少し違う)と昼夜が変わったときだけ描き直す。 */
var BSTYLE={'図書館':'brick','ゲームセンター':'panel','食堂':'plank','銭湯':'plaster','宿':'lattice','家':'siding'};
function bldBitmap(b){
  var d=DOT(),night=!!wx.night,key=d.toFixed(3)+'|'+night;
  if(b._bmp&&b._bmp.key===key)return b._bmp;
  var deco=b.label||'家',style=BSTYLE[deco],Wd=Math.round(b.w/d),Hd=Math.round(b.h/d),ov=Math.round(10/d);
  var wyD=Math.round(Hd*0.38),T=deco==='銭湯'?Math.round(44/d):deco==='家'?Math.round(28/d):0;
  var cv=document.createElement('canvas');cv.width=Wd+ov*2;cv.height=Hd+T;
  var g=cv.getContext('2d'),OL='#2a2230',TRIM='#f4efe2',wins=[];
  function P(x,y,w,h,c){g.fillStyle=c;g.fillRect(x+ov,y+T,w,h);}
  var wall=b.wall,wD=shade(wall,-0.12),wDD=shade(wall,-0.25),wL=shade(wall,0.25);
  var roof=b.roof,rD=shade(roof,-0.25),rL=shade(roof,0.22);
  // 煙突(屋根の後ろ)
  if(T){var chW=deco==='銭湯'?8:6,chX=Math.round(Wd*0.72),chC=deco==='銭湯'?'#b9b2a6':'#8a5a44';
    P(chX-1,-T,chW+2,T+wyD/2,OL);P(chX,-T+1,chW,T+wyD/2-1,chC);P(chX+chW-2,-T+1,2,T+wyD/2-1,shade(chC,-0.2));
    P(chX-1,-T,chW+2,2,OL);if(deco==='銭湯'){P(chX,-T+5,chW,2,'#a8453f');}}
  // 屋根: 段ごとに瓦、左右のふちは濃く
  var rows=wyD+2;
  for(var r=0;r<rows;r++){
    var t=r/(rows-1),inset=Math.round((16/d)*(1-t)-ov*t),x0=inset,x1=Wd-1-inset;
    P(x0,r,x1-x0+1,1,(r%3===2)?rD:roof);
    if(r%3===1)for(var k=x0+((r/3|0)%2?2:0);k<=x1;k+=4)P(k,r,1,1,rD);
    if(r===0||r===1)P(x0+1,r,x1-x0-1,1,r===0?OL:rL);
    P(x0,r,1,1,OL);P(x1,r,1,1,OL);
  }
  P(-ov,rows-1,Wd+ov*2,1,OL);
  // 壁
  var wy0=rows,wh=Hd-wy0;
  P(0,wy0,Wd,wh,wall);
  for(var y=wy0;y<Hd;y++)for(var x=0;x<Wd;x++){
    var ly=y-wy0,c=null;
    if(style==='siding'&&ly%3===2)c=wD;
    else if(style==='brick'&&(ly%3===2||(x+((ly/3|0)%2)*3)%6===0))c=wD;
    else if(style==='plank'&&x%4===3)c=wD;
    else if(style==='panel'&&(x%10===9||ly===4))c=wD;
    else if(style==='lattice'&&(x%6===0)&&ly>2)c=wD;
    else if(style==='plaster'&&y>=Hd-6)c=((x+y)%3===0)?'#6f86a6':'#4f6a90';
    if(c)P(x,y,1,1,c);
  }
  P(0,wy0,Wd,2,wDD);P(0,wy0,1,wh,wL);P(Wd-1,wy0,1,wh,OL);P(0,Hd-1,Wd,1,OL);P(0,wy0,1,wh,OL);
  // ドア
  var dw=Math.max(7,Math.round(26/d)),dh=Math.round(40/d),dx=Math.round(Wd/2-dw/2),dy=Hd-dh;
  P(dx-2,dy-2,dw+4,dh+2,TRIM);P(dx-1,dy-1,dw+2,dh+1,OL);P(dx,dy,dw,dh,'#6b4a36');
  P(dx+1,dy+1,dw-2,1,'#5a3d2c');P(dx+1,dy+Math.round(dh/2),dw-2,1,'#5a3d2c');P(dx+Math.round(dw/2),dy+1,1,dh-1,'#5a3d2c');
  P(dx+dw-2,dy+Math.round(dh*0.55),1,1,'#f3e7a8');
  P(dx+Math.round(dw/2)-1,dy-4,2,2,night?'#ffe08a':'#f3e7a8');                      // 玄関の小さな灯り
  // 窓
  var ww=Math.max(6,Math.round(24/d)),wh2=Math.max(6,Math.round(24/d)),wyy=wy0+Math.max(3,Math.round(wh*0.22));
  // ドアの左右それぞれに、入るだけ窓を等間隔に並べる
  var wxs=[];
  var mg=deco==='図書館'?12:4;
  [[2,dx-mg],[dx+dw+mg,Wd-3]].forEach(function(seg){var len=seg[1]-seg[0],k=Math.max(len>=ww?1:0,Math.floor((len+5)/(ww+9)));
    if(deco==='図書館'&&k>2)k=2;
    for(var j=0;j<k;j++)wxs.push(Math.round(seg[0]+(len-ww)*(k===1?0.5:j/(k-1))));});
  for(var i=0;i<wxs.length;i++){var wx0=wxs[i];
    P(wx0-1,wyy-1,ww+2,wh2+2,OL);P(wx0,wyy,ww,wh2,TRIM);P(wx0+1,wyy+1,ww-2,wh2-2,'#9fc9da');
    P(wx0+2,wyy+2,2,1,'#e6f4f8');P(wx0+2,wyy+3,1,1,'#e6f4f8');
    P(wx0+Math.floor(ww/2),wyy,1,wh2,TRIM);P(wx0,wyy+Math.floor(wh2/2),ww,1,TRIM);
    if(style==='lattice')for(var q=wx0+2;q<wx0+ww-1;q+=2)P(q,wyy+1,1,wh2-2,'#8a6a48');
    if(deco==='図書館'){P(wx0,wyy,1,1,wall);P(wx0+ww-1,wyy,1,1,wall);P(wx0-1,wyy-1,1,1,wall);P(wx0+ww,wyy-1,1,1,wall);}
    P(wx0-2,wyy+wh2+1,ww+4,1,TRIM);P(wx0-2,wyy+wh2+2,ww+4,1,wDD);
    if(deco==='家'){P(wx0+1,wyy+1,1,wh2-2,'#e86a8a');P(wx0+ww-2,wyy+1,1,wh2-2,'#e86a8a');   // カーテン
      P(wx0-1,wyy+wh2+3,ww+2,2,'#7a5a3c');for(var f=0;f<ww;f+=2)P(wx0+f,wyy+wh2+2,1,1,(f/2)%2?'#f2c14e':'#e2553f');}
    if(deco==='食堂'){for(var f2=-1;f2<=ww;f2++){P(wx0+f2,wyy-4,1,3,((f2+1)>>1)%2?TRIM:'#c94f4f');if((f2&1)===0)P(wx0+f2,wyy-1,1,1,'#c94f4f');}}
    wins.push([wx0+1,wyy+1,ww-2,wh2-2]);
  }
  // 建物ごとの目じるし
  if(deco==='図書館'){[dx-9,dx+dw+4].forEach(function(cx){var ch=Hd-wy0-4;
    P(cx-1,wy0+3,7,ch+1,OL);P(cx,wy0+4,5,ch,'#efe6d2');P(cx+3,wy0+4,2,ch,'#d3c8b0');P(cx,wy0+4,1,ch,'#fbf6ea');
    P(cx-2,wy0+3,9,2,'#d3c8b0');P(cx-2,Hd-2,9,2,'#d3c8b0');});
    P(dx-12,Hd-1,dw+24,1,'#bdb3a0');}
  if(deco==='ゲームセンター'){for(var nx=0;nx<Wd;nx+=4)P(nx,wy0+3,3,1,(nx/4)%2?(night?'#ff6fb5':'#e88ab8'):(night?'#5fe8ff':'#8ad0e0'));
    var sx=Math.round(Wd/2)-3;P(sx-1,wy0+5,9,8,OL);P(sx,wy0+6,7,6,'#2a2a40');P(sx+3,wy0+6,1,6,'#ffd54a');P(sx,wy0+8,7,1,'#ffd54a');P(sx+2,wy0+7,3,3,'#ffd54a');
    P(dx+dw+4,dy+2,5,7,OL);P(dx+dw+5,dy+3,3,5,'#e2553f');P(dx+dw+5,dy+5,3,1,'#f2c14e');}
  if(deco==='食堂'||deco==='銭湯'){var nc=deco==='食堂'?'#3f5f8a':'#2f4a7a';P(dx-1,dy,dw+2,1,OL);
    for(var nn=0;nn<3;nn++){var nw=Math.floor((dw)/3);P(dx+nn*nw+(nn?1:0),dy+1,nw-(nn?1:0),5,nc);}
    if(deco==='銭湯'){P(dx+Math.round(dw/2)-1,dy+2,2,2,TRIM);}}
  if(deco==='宿'){[dx-4,dx+dw+1].forEach(function(lx){P(lx,dy+2,3,6,OL);P(lx,dy+3,3,4,night?'#ffb35a':'#e2553f');P(lx,dy+5,3,1,shade(night?'#ffb35a':'#e2553f',-0.3));});}
  // 町の座標での窓(夜の明かり用)
  var bx=Math.round(b.x/d)*d-ov*d,by=Math.round(b.y/d)*d-T*d;
  b._bmp={key:key,cv:cv,x:bx,y:by,d:d,wy:Math.round(b.y/d)*d+wy0*d,
    wins:wins.map(function(w){return [bx+(w[0]+ov)*d,by+(w[1]+T)*d,w[2]*d,w[3]*d];})};
  return b._bmp;
}
function winRects(b){return bldBitmap(b).wins;}
function drawBuilding(b){
  var B=bldBitmap(b);
  ctx.fillStyle='rgba(30,50,30,.16)';ctx.fillRect(b.x+6,b.y+b.h-2,b.w,8);
  if(PIX.on&&ditherPat){ctx.fillStyle=ditherPat;ctx.fillRect(b.x+6,b.y+b.h-2,b.w,8);}
  ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(B.cv,B.x,B.y,B.cv.width*B.d,B.cv.height*B.d);ctx.restore();
  if(b.label==='図書館'){ctx.fillStyle='#7a8a6a';rr(b.x+b.w/2-20,b.y+b.h-1,40,11,3);ctx.fill();}
  if(b.label){
    var wy=B.wy+2;
    ctx.font='15px DotGothic16, sans-serif';var tw=ctx.measureText(b.label).width+18;
    ctx.fillStyle='#fbf6e6';rr(b.x+b.w/2-tw/2,wy-8,tw,24,3);ctx.fill();
    ctx.strokeStyle='#5b4634';ctx.lineWidth=1.5;ctx.stroke();
    wtext(b.label,b.x+b.w/2,wy+5,'15px DotGothic16, sans-serif','#3b2d22');
  }
}
/* 木・ベンチ・街灯のドット絵 */
var treeCache={};
function treeGrid(v,snow){
  var key=v+'|'+snow;if(treeCache[key])return treeCache[key];
  var W=22,H=27,r=[9.6,9.0,10.0][v],cx=10.5,cy=10,grid=[],x,y,inside=[];
  for(y=0;y<H;y++){inside.push([]);for(x=0;x<W;x++){var dx=x-cx,dy=y-cy,a=Math.atan2(dy,dx),re=r+0.45*Math.sin(a*6+v*2)+0.3*Math.sin(a*3+v);
    inside[y].push(dx*dx+dy*dy*1.08<re*re);}}
  for(y=0;y<H;y++){var row='';for(x=0;x<W;x++){var ch='.';
    if(inside[y][x]){var edge=!(inside[y-1]&&inside[y-1][x])||!(inside[y+1]&&inside[y+1][x])||!inside[y][x-1]||!inside[y][x+1];
      if(edge)ch='O';else{var l=(-(x-cx)-(y-cy)*1.2)/r;
        ch=l>0.55?'b':l>0.35?((x+y)%2?'b':'a'):l<-0.55?'d':l<-0.35?((x+y)%2?'d':'a'):'a';
        if(snow&&y<cy-r*0.35&&l>-0.2)ch='W';}}
    else if(y>=16&&x>=9&&x<=12){ch=(x===9||x===12)?'O':(x===10?'t':'T');if(y===H-1)ch='O';}
    else if(y===H-2&&(x===8||x===13))ch='O';
    row+=ch;}grid.push(row);}
  return (treeCache[key]=grid);
}
function drawTree(x,y){
  softShadow(x,y,22,7,0.36);
  var v=((x*7+y*3)>>2)%3,snow=wx.snow&&wx.rain>0.3;
  drawSprite(treeGrid(v,snow),{O:'#24301f',a:wx.season.a,b:wx.season.b,d:shade(wx.season.a,-0.3),t:'#7a5a3c',T:'#5f4731',W:'#f4f6fb'},x,y,v===1);
}
var BENCH=['OOOOOOOOOOOOOOOO','OwwwwwwwwwwwwwwO','OOOOOOOOOOOOOOOO','OwwwwwwwwwwwwwwO','OWWWWWWWWWWWWWWO','OOOO........OOOO','.OkO........OkO.'];
function drawBench(x,y){drawSprite(BENCH,{O:'#3a2a20',w:'#a27a50',W:'#8a6a48',k:'#5f4731'},x,y+DOT(),false);}
var LAMP=['.OOO.','OYyYO','OYYYO','.OOO.','..O..'];for(var li=0;li<11;li++)LAMP.push('.OkO.');LAMP.push('OkkkO','OOOOO');
function drawLamp(x,y){drawSprite(LAMP,{O:'#2a2230',Y:'#f5e7a6',y:'#fffbe0',k:'#5b6570'},x,y,false);}
function drawPerson(p,isMe,still){
  var z=zoneAt(p.x,p.y),kind=z?z.st:'';
  if(kind==='sleep'&&p.st==='sleep'&&!p.moving){
    // ふとんで横になる
    ctx.save();ctx.translate(p.x,p.y-4);ctx.rotate(-Math.PI/2);ctx.translate(-p.x,-p.y);
    drawBody(p,isMe,true,false);ctx.restore();
    ctx.fillStyle='#e8e4f0';rr(p.x-25,p.y-15,27,18,3);ctx.fill();
    var f=still?0:(p.phase*0.12)%1,zf='11px DotGothic16, sans-serif';
    wtext('z',p.x-41,p.y-20-f*8,zf,'#4a5a6a');wtext('z',p.x-48,p.y-30-f*8,zf,'#4a5a6a');
    return;
  }
  drawBody(p,isMe,still,kind==='bath');
  if(p.npc)drawResident(p);
  if(wx.rain>0.3&&me.r==='town')drawUmbrella(p);
}
var SKIN=['#f0cfae','#e2b48c','#c98f62'];
var HAIR=['#3a2c26','#1f1d24','#6a4428','#9a6a3a','#c9a26a','#5a5f6a'];
var PANTS=['#39424d','#2f3a5c','#5a4a3a','#4a4a52'];
var CAPS=['#c94f4f','#3f6fb0','#e0b64a','#4f8a5a'];
function strSeed(k){var h=2166136261;for(var i=0;i<k.length;i++){h^=k.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
var mySeed=strSeed(storedId('irudake-look'));
// 見た目(髪型・髪の色・肌・ズボン・服の柄)は、その人のidから決まる。全員の画面で同じに見える。
function looks(p){
  if(p.lk)return p.lk;
  var s=p===me?mySeed:(p.seed!==undefined?p.seed:7);s=h32(s);
  var lk={style:s%4,hair:(s>>>3)%HAIR.length,skin:(s>>>7)%3,pants:(s>>>10)%PANTS.length,top:(s>>>13)%3,capCol:CAPS[(s>>>16)%CAPS.length]};
  if(p.npc&&p.npc.hat)lk.style=0;
  if(p!==me&&!p.npc)p.lk=lk;
  return lk;
}
/* 町の小物(ドット絵)。にぎやかさを出すためのもので、自販機と電柱だけはぶつかる。 */
var PGRID={
  vend:['OOOOOOOOOO','ORRRRRRRRO','ORWWWWWWRO','ORGGGGGGRO','ORG1G2G3RO','ORGGGGGGRO','ORG2G3G1RO','ORGGGGGGRO','ORG3G1G2RO','ORGGGGGGRO',
        'ORRRRRRRRO','ORWRRRRkRO','ORRRRRRRRO','ORkkkkkkRO','ORkkkkkkRO','ORRRRRRRRO','OrrrrrrrrO','OOOOOOOOOO'],
  ac:  ['OOOOOOOO','OWWWWWWO','OWkWkWkO','OWkWkWkO','OWWWWWWO','OOOOOOOO'],
  pot: ['.gGg..','gGGGg.','GgGGGg','.gGGg.','.OOOO.','OttttO','.OttO.','.OOOO.'],
  bin: ['OOOOOO','OLLLLO','.OBBO.','.OBbO.','.OBbO.','.OBbO.','.OBbO.','.OOOO.'],
  post:['.OOO.','ORRRO','ORkRO','ORRRO','ORRRO','OrrrO','.OOO.','..O..','..O..','.OOO.'],
  board:['.OOOOOO.','.OkkkkO.','.OkWWkO.','.OkkkkO.','.OkWkkO.','.OkkkkO.','.OOOOOO.','.O....O.','O......O'],
  crate:['OOOOOOOO','OwwwwwwO','OwOwwOwO','OwwwwwwO','OOOOOOOO','OwwwwwwO','OwOwwOwO','OOOOOOOO'],
  flowers:['.1..2..3.1','g1g.2gg3g1','gggggggggg','OOOOOOOOOO'],
  pole:(function(){var a=['OOOOOOOOO','.O.OkO.O.'];for(var i=0;i<31;i++)a.push('...OkO...');a.push('..OOOOO..');return a;})()
};
var PPAL={O:'#2a2230',W:'#f4efe2',G:'#9fd3e6',k:'#6a6f7a',L:'#8a9098',B:'#5f8a5a',b:'#4a6e47',g:'#4f8a4c',
  t:'#b8683e',w:'#c9a06a','1':'#e2553f','2':'#f2c14e','3':'#4f9fd0'};
function ppal(o){var c=o.c||'#d9534f';return Object.assign({},PPAL,{R:c,r:shade(c,-0.3),k:o.t==='pole'?'#7a6a5a':o.t==='board'?'#3a4a3e':PPAL.k,
  G:o.t==='pot'||o.t==='flowers'?'#62a05a':PPAL.G});}
var PROPS=[
  {t:'pot',x:206,y:252},{t:'pot',x:296,y:252},
  {t:'post',x:456,y:236},{t:'crate',x:548,y:236},
  {t:'vend',x:1046,y:230,c:'#d9534f',solid:1,light:1},{t:'vend',x:1074,y:230,c:'#3f7fbf',solid:1,light:1},
  {t:'ac',x:1000,y:200,k:221},{t:'ac',x:1262,y:205,k:221},{t:'ac',x:236,y:640,k:651},{t:'ac',x:540,y:640,k:651},
  {t:'board',x:1102,y:242},{t:'bin',x:1292,y:234},
  {t:'vend',x:276,y:662,c:'#4f9d6a',solid:1,light:1},
  {t:'pot',x:426,y:662},{t:'pot',x:486,y:662},{t:'bin',x:338,y:664},
  {t:'post',x:404,y:990},{t:'pot',x:566,y:990},
  {t:'flowers',x:868,y:606},{t:'flowers',x:962,y:606},{t:'flowers',x:150,y:262,k:263},
  {t:'pole',x:220,y:396,solid:1},{t:'pole',x:436,y:396,solid:1},{t:'pole',x:862,y:396,solid:1},{t:'pole',x:1080,y:396,solid:1},{t:'pole',x:1300,y:396,solid:1}
];
function drawProp(o){drawSprite(PGRID[o.t],o.pal||(o.pal=ppal(o)),o.x,o.y,false);}
function propBlocked(x,y){
  for(var i=0;i<PROPS.length;i++){var o=PROPS[i];if(!o.solid)continue;
    if(Math.abs(x-o.x)<(o.t==='pole'?8:16)&&y>o.y-8&&y<o.y+4)return true;}
  return false;
}
// 電柱のあいだの電線。少したるませる。
function drawWires(){
  var ps=PROPS.filter(function(o){return o.t==='pole';}),d=DOT(),top=34*d;
  ctx.strokeStyle='#2a2230';ctx.lineWidth=d;
  for(var i=0;i+1<ps.length;i++){var a=ps[i],b=ps[i+1];
    [-3,3].forEach(function(off){ctx.beginPath();ctx.moveTo(a.x+off*d,a.y-top+d/2);
      ctx.quadraticCurveTo((a.x+b.x)/2,a.y-top+26,b.x+off*d,b.y-top+d/2);ctx.stroke();});}
}
// ドット絵らしい網目の影
var ditherPat=null;
function softShadow(x,y,rx,ry,a){
  ctx.fillStyle='rgba(30,50,30,'+(a*0.55)+')';ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,7);ctx.fill();
  if(!PIX.on)return;
  if(!ditherPat){var c=document.createElement('canvas');c.width=c.height=2;var g=c.getContext('2d');
    g.fillStyle='rgba(20,36,24,.5)';g.fillRect(0,0,1,1);g.fillRect(1,1,1,1);ditherPat=ctx.createPattern(c,'repeat');}
  ditherPat.setTransform(new DOMMatrix().scale(PIX.dot));
  ctx.fillStyle=ditherPat;ctx.beginPath();ctx.ellipse(x,y,rx*0.85,ry*0.8,0,0,7);ctx.fill();
}
/* 地面のもの(池・露天風呂・ふとん・台所・運動広場)のドット絵 */
var TALLPLANT=['..OO.OO..','.OGgOGgO.','OGggGggGO','OgGgOgGgO','.OggGggO.','..OgGgO..','...OgO...','..OOOOO..','..OttTO..','..OttTO..','..OttTO..','..OOOOO..'];
var LIBLAMP=['.OOOOO.','OYYYYYO','.OOkOO.','...k...','..OkO..'];
var ARMCHAIR=['.OOOOOOOOOO.','OhcccccccchO','OccccccccccO','OccccccccccO','OcOOOOOOOOcO','OcCCCCCCCCcO','OcCCCCCCCCcO','OOOOOOOOOOOO','.O........O.'];
var DUCK=[['....OO..','...OggOy','...OgEOy','.OOOggO.','OwwwwwO.','OwwwwwO.','.OOOOO..'],['....OO..','...OwwOy','...OwEOy','.OOOwwO.','OwwwwwO.','OwwwwwO.','.OOOOO..']];
function pixRing(cx,cy,rx,ry,col,dark,step){ // 楕円のふちに石を並べる
  var d=DOT(),n=Math.round(2*Math.PI*Math.sqrt((rx*rx+ry*ry)/2)/(step||10));
  for(var i=0;i<n;i++){var a=i/n*Math.PI*2,x=Math.round((cx+Math.cos(a)*rx)/d)*d,y=Math.round((cy+Math.sin(a)*ry)/d)*d,w=(i%3?2:3)*d;
    ctx.fillStyle=dark;ctx.fillRect(x-d,y-d,w+d,2*d+d);ctx.fillStyle=col;ctx.fillRect(x-d,y-d,w,2*d);ctx.fillStyle='rgba(255,255,255,.35)';ctx.fillRect(x-d,y-d,d,d);}
}
function pixSparkles(x0,y0,w,h,seed,col){var d=DOT(),T=Date.now()/900;ctx.fillStyle=col;
  for(var i=0;i<14;i++){var hv=h32(seed+i),x=x0+(hv%1000)/1000*w,y=y0+((hv>>>10)%1000)/1000*h;if(((hv>>>20)+Math.floor(T))%3)continue;
    x=Math.round(x/d)*d;y=Math.round(y/d)*d;ctx.fillRect(x,y,d*3,d);}}
function futonBitmap(c,i){return pixBitmap('futon'+i,Math.round(90/DOT()),Math.round(27/DOT()),function(P){
  var w=Math.round(90/DOT()),h=Math.round(27/DOT()),O='#4a4a5a',pw=Math.round(w*0.27);
  P(0,0,w,h,O);P(1,1,w-2,h-2,'#f6f3ea');                         // しきぶとん
  P(2,2,pw-3,h-4,'#ffffff');P(2,h-3,pw-3,1,'#d9d4c6');            // まくら
  P(pw,0,w-pw,h,O);P(pw+1,1,w-pw-2,h-2,c);                       // かけぶとん
  for(var y=2;y<h-2;y+=3)for(var x=pw+2+(y%6?1:0);x<w-2;x+=4)P(x,y,1,1,shade(c,0.25));
  P(pw+1,1,2,h-2,shade(c,-0.2));});}
function cookBitmap(w){return pixBitmap('cook'+w,Math.round(w/DOT()),Math.round(30/DOT()),function(P){
  var W2=Math.round(w/DOT()),h=Math.round(30/DOT()),O='#3a2a20';
  P(0,0,W2,h,O);P(1,1,W2-2,h-4,'#c9a27c');P(1,h-3,W2-2,2,'#8a6446');
  for(var x=3;x<W2-3;x+=7)P(x,h-3,1,2,'#6b4a36');
  for(var i=0;i<4;i++){var cx=Math.round((26+i*48)/DOT()),r=4;
    for(var yy=-2;yy<=2;yy++)for(var xx=-r;xx<=r;xx++)if(xx*xx/(r*r)+yy*yy/4<=1)P(cx+xx,4+yy,1,1,(xx*xx/(r*r)+yy*yy/4>0.55)?'#4b5560':(i%2?'#e9b44c':'#c9d6c0'));
    P(cx-r-1,4,1,1,'#4b5560');P(cx+r+1,4,1,1,'#4b5560');}});}
/* 町のものドット絵(机・ゲーム機・テーブル・車・鐘・猫・犬)。右向きで描き、左向きは反転する。 */
var OGRID={"desk": ["OOOOOOOOOOOOOOOO", "OwwwwwwwwwwwwwwO", "OwwWWWWwwwwbbbwO", "OwwWWWWwwwwbbbwO", "OwwwwwwwwwwwwwwO", "OddddddddddddddO", "OOOOOOOOOOOOOOOO", ".OkO........OkO.", ".OOO........OOO."], "arcade": [".OOOOOOOOO.", "OMMMMMMMMMO", "OOOOOOOOOOO", "OCOOOOOOOCO", "OCOSSSSSOCO", "OCOSsSSSOCO", "OCOSSSSSOCO", "OCOOOOOOOCO", "OCCCCCCCCCO", "OCCrCbCCCCO", "OCCCCCCCCCO", "OcccccccccO", "OcccccccccO", "OOOOOOOOOOO"], "table": ["...OOOOOO...", ".OOwwwwwwOO.", "OwwwwWWwwwwO", "OwwwWrrWwwwO", ".OOwwwwwwOO.", "...OddddO...", "....OddO....", "...OOOOOO..."], "car": ["......OOOOOOO......", ".....OCCCCCCCO.....", "....OCGGGOGGGGO....", "...OCCGGGOGGGGCO...", "OOOOCCCCCCCCCCCOOO.", "OCCCCCCCCCCCCCCCCLO", "ORCCCCCCCCCCCCCCCCO", "OcccccccccccccccccO", ".OOOWWOOOOOOOWWOOO.", "...OWWO.....OWWO..."], "cat_a": ["........O.O.", "O......OwOwO", "OO.....OwwwO", ".OOOOOOOwEwO", ".OwwwwwwwwpO", ".OwwwwwwwwO.", ".OwOOOOwOO..", ".OO....OO..."], "cat_b": ["........O.O.", "O......OwOwO", "OO.....OwwwO", ".OOOOOOOwEwO", ".OwwwwwwwwpO", ".OwwwwwwwwO.", "..OwOOwOO...", "..OO..OO...."], "cat_sit": [".....O.O.", "....OwOwO", "....OwwEO", "..O.OwwpO", ".Ow.OwwO.", ".OwOwwwO.", "..OwwwwwO", "..OwwwwwO", "..OwwwwwO", "..OOOOOOO"], "dog_a": ["..........OOO...", "O........OeebbO.", "bO.......ObbbEbO", ".bOOOOOOOObbbbbO", ".ObbbbbbbbbbbOO.", ".ObbbbbbbbbbbO..", ".OsbbbbbbbbbsO..", ".ObOOOOOOOObO...", ".ObO......ObO...", ".OO.......OO...."], "dog_b": ["..........OOO...", "O........OeebbO.", "bO.......ObbbEbO", ".bOOOOOOOObbbbbO", ".ObbbbbbbbbbbOO.", ".ObbbbbbbbbbbO..", ".OsbbbbbbbbbsO..", ".OObOOOOOObOO...", "..ObO....ObO....", "..OO.....OO....."], "dog_sit": ["......OOO..", ".....OeebO.", ".....ObbEbO", ".....ObbbbO", "..O..ObbbO.", ".ObO.ObbbO.", ".ObOObbbbbO", "..OObbbbbbO", "...ObbbbbbO", "...ObbbbbbO", "...ObsbbsbO", "...ObObbObO", "...OOOOOOOO"], "belltower": ["........OO........", "......OOrrOO......", "....OOrrrrrrOO....", "..OOrrrrrrrrrrOO..", "OOrrrrrrrrrrrrrrOO", "OOOOOOOOOOOOOOOOOO", ".OpO..........OpO.", ".OpO..........OpO.", ".OpO..........OpO.", ".OpO..........OpO.", ".OpO..........OpO.", ".OpO..........OpO.", ".OpO..........OpO.", ".OpO..........OpO.", ".OpO..........OpO.", ".OpO..........OpO.", ".OpO..........OpO.", ".OpO..........OpO.", ".OpO..........OpO.", ".OpO..........OpO.", ".OpO..........OpO.", ".OpO..........OpO.", ".OpO..........OpO.", ".OpO..........OpO.", ".OpO..........OpO.", ".OpO..........OpO.", ".OpO..........OpO.", "OOOOO........OOOOO"], "bell": ["...OO...", "..OyyO..", ".OYyyyO.", ".OYyyyO.", ".OYyyyO.", "OYyyyyyO", "OOOOOOOO", "...OO..."]};
// 小さな板にドットで描いて覚えておく(屋台・焚き火のように形を組み立てるもの)
var pixCache={};
function pixBitmap(key,w,h,paint){var k=key+'|'+DOT().toFixed(3);if(pixCache[k])return pixCache[k];
  var c=document.createElement('canvas');c.width=w;c.height=h;var g=c.getContext('2d');
  paint(function(x,y,ww,hh,col){g.fillStyle=col;g.fillRect(x,y,ww,hh);});return (pixCache[k]=c);}
function blitPix(cv,x,y){var d=DOT();if(PIX.on){x=Math.round(x/d)*d;y=Math.round(y/d)*d;}
  ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(cv,x,y,cv.width*d,cv.height*d);ctx.restore();}
function fireGrid(f){
  var key='fire'+f;if(gridCache[key])return gridCache[key];
  var W=15,rows=[],top=[1,0,2][f],sway=[0,1,-1][f];
  for(var y=0;y<11;y++){var row='',hw=Math.pow(Math.max(0,(y-top+1)/(11-top)),0.8)*5.6,c=7+(y<5?sway:0);
    for(var x=0;x<W;x++){var r=Math.abs(x-c)/(hw||1),ch='.';
      if(y>=top&&Math.abs(x-c)<=hw)ch=r>0.66?'F':r>0.3?'f':(y<top+2?'f':'Y');row+=ch;}rows.push(row);}
  rows.push('..OwwO...OwwO..','.OwwwwOOOwwwwO.','OgggOwwwwwOgggO','.OOOOOOOOOOOOO.');
  return (gridCache[key]=rows);
}
function umbrellaGrid(){
  if(gridCache.umb)return gridCache.umb;var rows=[],x,y;
  for(y=0;y<8;y++){var row='';for(x=0;x<15;x++){var dx=x-7,dy=7.5-y,inR=dx*dx+dy*dy<=7.6*7.6,inR2=dx*dx+dy*dy<=6.4*6.4;
    row+=!inR?'.':(!inR2||y===7)?'O':(dx<-1&&dy>2?'u':'U');}rows.push(row);}
  for(y=0;y<6;y++)rows.push('.......'+(y===5?'kk':'k.')+'......');
  return (gridCache.umb=rows);
}
/* 人のドット絵。10x16 ドット、右向きで描いておき、左向きは左右反転する。
   O 輪郭 / H 髪 h 髪の影 / S 肌 s 肌の影 / E 目 / K ほお / C 服 c 服の影 W 服の明るい所 / P ズボン p ズボンの影 / B 靴 / R ぼうし */
var HEADS={
  short:['...OOOO...','..OHHHHO..','.OHHHHHhO.','.OHhHHHSO.','.OHhSSESO.','.OHSSSSSO.','..OsSSKO..','...OSSO...'],
  bangs:['...OOOO...','..OHHHHO..','.OHHHHHHO.','.OHHHHHHO.','.OHhSSESO.','.OHhSSSSO.','.OHOsSKO..','..O.OSSO..'],
  long: ['...OOOO...','..OHHHHO..','.OHHHHHhO.','.OHHhHHSO.','.OHHhSESO.','.OHHSSSSO.','.OHHsSKO..','.OHHOSSO..'],
  cap:  ['...OOOO...','..ORRRRO..','.ORRRRRRO.','.ORRRRRRRO','.OHhSSESO.','.OHSSSSSO.','..OsSSKO..','...OSSO...']
};
var BODY=['..OCCCCO..','.OWCCCCcO.','.OWCCCCcO.','.OSCCCCSO.','..OcCCcO..'];
var LEGS={
  stand:['..OPPpPO..','..OPOOpO..','..OBO.OBO.'],
  walk: ['..OPPpPO..','.OPO..OpO.','.OBO..OBO.'],
  pass: ['..OPPpPO..','...OPpO...','...OBBO...'],
  sit:  ['..OPPPPPPO','..OOOOOBBO','..........']
};
var gridCache={};
function personGrid(lk,frame,bath){
  var key=lk.style+'|'+lk.top+'|'+frame+'|'+(bath?1:0);
  if(gridCache[key])return gridCache[key];
  var head=HEADS[['short','long','bangs','cap'][lk.style]].slice(),body=BODY.slice(),legs=bath?['..........','..........','..........']:LEGS[frame].slice();
  if(lk.style===1){body[0]='.OHCCCCO..';body[1]='OHWCCCCcO.';body[2]='OHWCCCCcO.';}   // ながい髪が肩にかかる
  if(lk.top===1)body[2]=body[2].replace(/C/g,'W');                                   // ボーダー
  else if(lk.top===2)body=body.map(function(r,i){return i<4?r.slice(0,5)+'c'+r.slice(6):r;}); // 前あき
  return (gridCache[key]=head.concat(body,legs));
}
function shade(hex,k){var n=parseInt(hex.slice(1),16),r=n>>16,g=n>>8&255,b=n&255;
  function f(v){return Math.max(0,Math.min(255,Math.round(k<0?v*(1+k):v+(255-v)*k)));}
  return '#'+((1<<24)+(f(r)<<16)+(f(g)<<8)+f(b)).toString(16).slice(1);}
var palCache={};
function personPal(p,lk,col){
  var key=col+lk.hair+lk.skin+lk.pants+lk.capCol;
  if(palCache[key])return palCache[key];
  var H=HAIR[lk.hair],S=SKIN[lk.skin],P=PANTS[lk.pants];
  return (palCache[key]={O:'#2a2230',H:H,h:shade(H,-0.3),S:S,s:shade(S,-0.14),E:'#2b2422',K:'#e9a08c',
    C:col,c:shade(col,-0.25),W:shade(col,0.3),P:P,p:shade(P,-0.25),B:'#3b3036',R:lk.capCol});
}
// 1ドットの大きさ(町の座標で)。ドット絵の板に描いている間は、板の1ピクセルにぴったり合わせる。
function DOT(){return PIX.on?PIX.dot:2.8;}
function drawSprite(grid,pal,x,y,flip){
  var d=DOT(),w=grid[0].length,h=grid.length,sx=x,sy=y;
  if(PIX.on){sx=Math.round(x/d)*d;sy=Math.round(y/d)*d;}
  var x0=sx-Math.floor(w/2)*d,y0=sy-h*d,e=PIX.on?0:0.35;
  for(var j=0;j<h;j++){var row=grid[j];
    for(var i=0;i<w;i++){var ch=row[flip?w-1-i:i];if(ch==='.')continue;
      ctx.fillStyle=pal[ch];ctx.fillRect(x0+i*d,y0+j*d,d+e,d+e);}}
}
function drawBody(p,isMe,still,bath){
  var fz=zoneAt(p.x,p.y);
  var sit=!bath&&!p.moving&&(!!seatOf(p)||onBench(p)||nearPet(p,PETS.cat)||nearPet(p,PETS.dog)||!!(fz&&fz.fire));
  var x=p.x,y=p.y+(bath?9:0)+(sit?6:0),sw=p.moving?Math.sin(p.phase):0,bob=(!p.moving&&!still)?Math.sin(p.phase*0.25)*0.6:0;
  var gy=y-(sit?6:0);
  if(!bath)softShadow(x,gy,11,4,0.45);
  if(isMe){ctx.strokeStyle='#fff7c2';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,gy,15,6,0,0,7);ctx.stroke();}
  var g=gestureOf(p),bow=g&&g.type==='bow',wave=g&&g.type==='wave';
  if(bow){ctx.save();ctx.translate(x,y-12);ctx.rotate(p.dir*Math.sin(g.k*Math.PI)*0.5);ctx.translate(-x,-(y-12));}
  var lk=looks(p),col=p.col||COLORS[p.c]||COLORS[5];
  var frame=sit?'sit':(p.moving&&Math.abs(sw)>0.35)?'walk':(p.moving?'pass':'stand');
  var pal=personPal(p,lk,col);
  drawSprite(personGrid(lk,frame,bath),pal,x,y+(p.moving&&frame==='pass'?-DOT():0)+bob,p.dir<0);
  if(wave){
    // 向いている側の腕を上げて振る
    ctx.save();ctx.translate(x+8*p.dir,y-27+bob);ctx.rotate(-p.dir*(2.5+Math.sin(g.k*Math.PI*6)*0.45));
    ctx.fillStyle='#2a2230';ctx.fillRect(-3,-1,7,15);ctx.fillStyle=col;ctx.fillRect(-2,0,5,9);ctx.fillStyle=SKIN[lk.skin];ctx.fillRect(-2,9,5,4);ctx.restore();
  }
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
  softShadow(c.x,c.y,27,6,0.4);
  drawSprite(OGRID.car,{O:'#2a2230',C:c.c,c:shade(c.c,-0.28),G:'#bcd9e6',L:'#fff3b0',R:'#d9534f',W:'#2b2422'},c.x,c.y+1,c.dir<0);
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
  wtext(pm.focus?'集中':'休憩',450,56,'17px DotGothic16, sans-serif','#ffffff');
  wtext(Math.floor(pm.left/60)+':'+String(pm.left%60).padStart(2,'0'),450,78,'15px DotGothic16, sans-serif','#ffffff');
  ctx.fillStyle='rgba(255,255,255,.35)';ctx.fillRect(417,92,66,5);ctx.fillStyle='#ffffff';ctx.fillRect(417,92,66*pm.frac,5);
  // 読書コーナー
  ctx.fillStyle='#b56b5b';rr(660,384,196,190,10);ctx.fill();
  ctx.strokeStyle='#e9c9a8';ctx.lineWidth=2;rr(668,392,180,174,7);ctx.stroke();
  ctx.fillStyle='#7a5a3c';ctx.fillRect(738,468,26,26);ctx.fillStyle='#a8453f';ctx.fillRect(743,473,16,10);
  drawSprite(TALLPLANT,{O:'#24301f',g:'#4f8a4c',G:'#6aa860',t:'#b8683e',T:'#8a5a44'},843,571,false);
  // 出口
  ctx.fillStyle='#7a8a6a';rr(410,576,80,24,4);ctx.fill();
  wtext('出口',450,589,'12px DotGothic16, sans-serif','#f4efe2');
  drawFootprints();

  var items=[];
  LIB_DESKS.forEach(function(d){items.push([d.y+12,1,d]);}); // 席に着いた人より手前に描く
  LIB_SEATS.forEach(function(q){if(q.chair)items.push([q.y-2,2,q]);});
  for(k in others)if(here(others[k]))items.push([others[k].y,4,others[k]]);
  residents.forEach(function(n){if(here(n))items.push([n.y,4,n]);});
  items.push([me.y,5,me]);
  items.sort(function(a,b){return a[0]-b[0]||a[1]-b[1];});
  items.forEach(function(it){var o=it[2];
    if(it[1]===1){
      ctx.fillStyle='rgba(60,40,20,.18)';ctx.fillRect(o.x+3,o.y+o.h+8,o.w,5);
      blitPix(pixBitmap('libdesk',Math.round(o.w/DOT()),Math.round((o.h+10)/DOT())+1,function(P){var w=Math.round(o.w/DOT()),h=Math.round((o.h+10)/DOT())+1;
        P(0,0,w,h,'#3a2a20');P(1,1,w-2,h-5,'#b08860');for(var k=3;k<w-2;k+=6)P(k,1,1,h-6,'#a07c56');P(1,h-4,w-2,3,'#7a5a3c');}),o.x,o.y);
      drawSprite(LIBLAMP,{O:'#2a2230',Y:'#f5e7a6',k:'#39424d'},o.x+o.w/2,o.y+2,false);
      // 誰かが座っている席には、開いたノートを置く
      [32,88].forEach(function(sx){
        var used=(me.r==='lib'&&!me.moving&&Math.abs(me.x-(o.x+sx))<5&&Math.abs(me.y-(o.y+6))<5);
        for(var kk in others){var p=others[kk];if(roomOf(p)==='lib'&&!p.moving&&Math.abs(p.x-(o.x+sx))<5&&Math.abs(p.y-(o.y+6))<5)used=true;}
        if(used){ctx.fillStyle='#f4efe2';ctx.fillRect(o.x+sx-11,o.y+7,10,11);ctx.fillRect(o.x+sx+1,o.y+7,10,11);
          ctx.fillStyle='rgba(60,60,80,.35)';for(var l=0;l<3;l++){ctx.fillRect(o.x+sx-9,o.y+10+l*3,6,1);ctx.fillRect(o.x+sx+3,o.y+10+l*3,6,1);}}
      });
    }else if(it[1]===2){
      softShadow(o.x,o.y+3,19,6,0.36);
      drawSprite(ARMCHAIR,{O:'#2a2a40',c:'#4f6f8a',C:'#6488a6',h:'#7aa0bf'},o.x,o.y+3,false);
    }else{var aw=isAway(o);if(aw)ctx.globalAlpha=0.45;drawPerson(o,it[1]===5,reduce);if(aw)ctx.globalAlpha=1;}
  });
}
// 図書館の中の看板と名前(ドット絵の板に描いたあと、くっきり描く)
function drawLibraryLabels(){
  var signs=[drawSign(LIB_ZONES[0],false)];
  var labels=[{p:me,text:'あなた・'+statusText(me),fill:'#fff7c2',alpha:1}];
  Object.keys(others).sort().forEach(function(key){if(here(others[key]))labels.push({p:others[key],text:statusText(others[key]),fill:'#ffffff',alpha:1});});
  residents.forEach(function(n){if(here(n))labels.push({p:n,text:n.npc.label,fill:'#dfe8d8',alpha:1});});
  placeLabels(labels,signs);drawFloats();
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
  var x=FIRE.x,y=FIRE.y,i,f=reduce?0:Math.floor(t/140)%3;
  drawSprite(fireGrid(f),{O:'#3a2a20',w:'#7a5a3c',g:'#8f8a80',F:'#d8432a',f:'#f08a2c',Y:'#f7cf55'},x,y+3,false);
  if(!reduce)for(i=0;i<3;i++){var ph=((t/1300)+i/3)%1;ctx.fillStyle='rgba(247,207,85,'+(0.8*(1-ph))+')';
    var dd=DOT();ctx.fillRect(Math.round((x+Math.sin(ph*7+i*2)*8)/dd)*dd,Math.round((y-30-ph*30)/dd)*dd,dd,dd);}
}
function drawHeart(x,y,t){
  var k=1+Math.sin(t/260)*0.12;
  ctx.fillStyle='#e0607a';ctx.beginPath();
  ctx.arc(x-3*k,y,3.2*k,Math.PI,0);ctx.arc(x+3*k,y,3.2*k,Math.PI,0);ctx.lineTo(x,y+7*k);ctx.closePath();ctx.fill();
}
function drawCat(c,t){
  var x=c.x,y=c.y,d=c.dir;
  softShadow(x,y,9,3,0.36);
  var pal={O:'#4a4038',w:'#e9e2d6',E:'#2b2422',p:'#e98fa0'};
  if(c.sitting){drawSprite(OGRID.cat_sit,pal,x,y+1,d<0);if(c.loved)drawHeart(x+2*d,y-36,t);}
  else drawSprite(Math.sin(c.phase)>0?OGRID.cat_a:OGRID.cat_b,pal,x,y+1,d<0);
}
function drawDog(c,t){
  var x=c.x,y=c.y,d=c.dir;
  softShadow(x,y,12,4,0.36);
  var pal={O:'#4a3020',b:'#b98552',s:'#9a6a40',e:'#7a5230',E:'#2b2422'};
  if(c.sitting){drawSprite(OGRID.dog_sit,pal,x,y+1,d<0);if(c.loved)drawHeart(x+4*d,y-42,t);}
  else drawSprite(Math.sin(c.phase)>0?OGRID.dog_a:OGRID.dog_b,pal,x,y+1,d<0);
}
// 池の魚(水面下の影)と鴨
function drawPondLife(t){
  var T=Date.now()/1000,i,d=DOT();
  for(i=0;i<3;i++){
    var a=T*(0.11+i*0.03)+i*2.1,fx=POND.x+Math.cos(a)*POND.rx*(0.35+i*0.13),fy=POND.y+Math.sin(a*1.3+i)*POND.ry*0.5;
    var dir=-Math.sin(a)>=0?1:-1;fx=Math.round(fx/d)*d;fy=Math.round(fy/d)*d;
    ctx.fillStyle='rgba(40,80,100,.5)';ctx.fillRect(fx-2*d,fy,4*d,d);ctx.fillRect(fx-d,fy-d,2*d,3*d);ctx.fillRect(fx-dir*3*d,fy-d,d,3*d);
  }
  for(i=0;i<2;i++){
    var b=T*0.07+i*2.6,dx=POND.x+Math.cos(b)*POND.rx*(0.62-i*0.2),dy=POND.y+Math.sin(b)*POND.ry*(0.6-i*0.2),dd=-Math.sin(b)>=0?1:-1;
    ctx.fillStyle='rgba(255,255,255,.45)';ctx.fillRect(Math.round((dx-12)/d)*d,Math.round((dy+3)/d)*d,8*d,d);
    drawSprite(DUCK[i],{O:'#3a3a3a',g:'#3f6b55',w:i?'#f4efe2':'#a8845a',E:'#111',y:'#e9a43c'},dx,dy+3,dd<0);
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
// 夜: 暗さを別の板に塗り、明かりの届くところだけ穴をあけてから重ねる(灰色のもやにならない)
var nightCv=document.createElement('canvas'),nctx=nightCv.getContext('2d');
function hole(c,x,y,r,a,sy){
  c.save();c.translate(x,y);c.scale(1,sy||1);
  var g=c.createRadialGradient(0,0,0,0,0,r);
  g.addColorStop(0,'rgba(0,0,0,'+a+')');g.addColorStop(0.45,'rgba(0,0,0,'+(a*0.6)+')');g.addColorStop(1,'rgba(0,0,0,0)');
  c.fillStyle=g;c.beginPath();c.arc(0,0,r,0,7);c.fill();c.restore();
}
function glow(x,y,r,rgb,a,sy){
  ctx.save();ctx.translate(x,y);ctx.scale(1,sy||1);
  var g=ctx.createRadialGradient(0,0,0,0,0,r);
  g.addColorStop(0,'rgba('+rgb+','+a+')');g.addColorStop(1,'rgba('+rgb+',0)');
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,r,0,7);ctx.fill();ctx.restore();
}
function drawNight(D){
  var tc=ctx.canvas,tr=ctx.getTransform();
  if(nightCv.width!==tc.width||nightCv.height!==tc.height){nightCv.width=tc.width;nightCv.height=tc.height;}
  var c=nctx;
  c.setTransform(1,0,0,1,0,0);c.globalCompositeOperation='source-over';c.clearRect(0,0,nightCv.width,nightCv.height);
  c.fillStyle='rgba(10,26,50,'+(0.7*D)+')';c.fillRect(0,0,nightCv.width,nightCv.height);
  c.setTransform(tr);
  c.globalCompositeOperation='destination-out';
  LAMPS.forEach(function(p){hole(c,p[0],p[1]-4,92,0.8,0.6);hole(c,p[0],p[1]-46,26,0.9);});
  for(var ck in cars){var cc=cars[ck];hole(c,cc.x+cc.dir*44,cc.y-6,48,0.75,0.6);}
  hole(c,FIRE.x,FIRE.y-10,130,0.85,0.75);
  PROPS.forEach(function(o){if(o.light)hole(c,o.x,o.y-20,46,0.85,0.8);});
  c.fillStyle='rgba(0,0,0,.9)';
  BUILDINGS.forEach(function(b){winRects(b).forEach(function(w){c.fillRect(w[0],w[1],w[2],w[3]);});});
  c.globalCompositeOperation='source-over';
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(nightCv,0,0);ctx.restore();
}
function frame(t){
  var dt=Math.min(0.05,(t-last)/1000||0);last=t;
  stepMe(dt,t);if(!me.moving)me.phase+=dt*9;
  var k;for(k in others){stepOther(others[k],dt);if(!others[k].moving)others[k].phase+=dt*9;}
  updatePets();updateResidents();stepCars(dt);stepTrace(dt);track(t);
  bellT-=dt;if(bellT<=0){bellT=1;updateBell();}
  clockT-=dt;if(clockT<=0){clockT=20;light=daylight();$('clock').textContent=light.text;}

  var vw=cw/scale,vh=chh/scale,inLib=me.r==='lib',RW=inLib?LIB.w:W,RH=inLib?LIB.h:H;
  camX=vw>=RW?(RW-vw)/2:Math.min(RW-vw,Math.max(0,me.x-vw/2));
  camY=vh>=RH?(RH-vh)/2:Math.min(RH-vh,Math.max(0,me.y-30-vh/2));
  var P=(FORCE!=='smooth')?Math.max(2,Math.round(3*scale*dpr)):1,U=scale*dpr/P;
  if(P>1){
    // カメラは「自分のドットの位置」から決める。x と y を別々に丸めると、斜めに歩いたとき
    // 自分とカメラが1ドットずれたり戻ったりして画面が揺れるため。
    var snap=function(v){return Math.round(v*U)/U;};
    camX=vw>=RW?snap((RW-vw)/2):Math.min(snap(RW-vw),Math.max(0,snap(me.x)-snap(vw/2)));
    camY=vh>=RH?snap((RH-vh)/2):Math.min(snap(RH-vh),Math.max(0,snap(me.y)-snap(30+vh/2)));
  }
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle=inLib?'#3a2f2a':'#7fa866';ctx.fillRect(0,0,cv.width,cv.height);
  ctx.setTransform(scale*dpr,0,0,scale*dpr,-camX*scale*dpr,-camY*scale*dpr);
  var mainCtx=ctx;
  function pixBegin(){if(P<=1)return;
    var pw=Math.ceil(cv.width/P),ph=Math.ceil(cv.height/P);
    if(PIX.cv.width!==pw||PIX.cv.height!==ph){PIX.cv.width=pw;PIX.cv.height=ph;}
    ctx=PIX.ctx;PIX.on=true;PIX.texts.length=0;PIX.dot=1/U;
    ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle=inLib?'#3a2f2a':'#7fa866';ctx.fillRect(0,0,pw,ph);
    ctx.setTransform(U,0,0,U,-camX*U,-camY*U);}
  function pixEnd(){if(P<=1)return;
    ctx=mainCtx;PIX.on=false;
    ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=false;
    ctx.drawImage(PIX.cv,0,0,PIX.cv.width*P,PIX.cv.height*P);ctx.restore();
    PIX.texts.forEach(function(a){wtext(a[0],a[1],a[2],a[3],a[4]);});}
  if(inLib){pixBegin();drawLibrary(t,vw,vh);pixEnd();drawLibraryLabels();requestAnimationFrame(frame);return;}
  pixBegin();
  drawGround();drawZones(t);
  if(bell.bell&&!reduce){var bz=bell.zone;ctx.strokeStyle='rgba(255,210,74,'+(0.55+0.35*Math.sin(t/350))+')';ctx.lineWidth=4;rr(bz.x-3,bz.y-3,bz.w+6,bz.h+6,10);ctx.stroke();}
  drawFootprints();
  var ghosts=visibleTraces(),items=[];
  BUILDINGS.forEach(function(b){items.push([b.y+b.h,0,b]);});
  TREES.forEach(function(p){items.push([p[1],1,p]);});
  BENCHES.forEach(function(p){items.push([p[1],2,p]);});
  LAMPS.forEach(function(p){items.push([p[1],3,p]);});
  items.push([TOWER.y,8,TOWER]);items.push([TWR.y,14,TWR]);
  PROPS.forEach(function(o){items.push([o.k||o.y,15,o]);});
  if(wx.cart)items.push([455,9,wx.cart]);
  for(k in cars)items.push([cars[k].y,12,cars[k]]);
  ghosts.forEach(function(g){items.push([g.y,7,g]);});
  for(k in others)if(here(others[k]))items.push([others[k].y,4,others[k]]);
  residents.forEach(function(n){if(here(n))items.push([n.y,4,n]);});
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
    else if(it[1]===14)drawTownTower();
    else if(it[1]===15)drawProp(o);
    else drawCat(o,t);});
  drawWires();
  if(wx.rain>0){ctx.fillStyle=(wx.snow?'rgba(225,232,240,':'rgba(60,80,115,')+(0.17*wx.rain)+')';ctx.fillRect(camX,camY,vw,vh);}
  if(!reduce)drawSteam(t);
  if(light.warm>0){ctx.fillStyle='rgba(255,150,70,'+(0.16*light.warm)+')';ctx.fillRect(camX,camY,vw,vh);}
  if(light.dark>0){
    drawNight(light.dark,vw,vh);
    ctx.globalCompositeOperation='lighter';
    if(tower.total!==null){var th=towerStage(tower.total).height;ctx.fillStyle='rgba(255,224,140,'+(0.9*light.dark)+')';
      for(var ty=8;ty<th;ty+=14){var tw2=towerHalf(ty);ctx.fillRect(TWR.x-tw2-1,TWR.y-6-ty,2,2);ctx.fillRect(TWR.x+tw2-1,TWR.y-6-ty,2,2);}
      if(th>0){ctx.beginPath();ctx.arc(TWR.x,TWR.y-7-th,3,0,7);ctx.fill();}}
    // 光そのもの: 電球のまわりの小さなにじみと、地面に落ちる暖かい色だけを足す
    var D=light.dark;
    LAMPS.forEach(function(p){
      glow(p[0],p[1]-48,16,'255,214,140',0.5*D,1);
      glow(p[0],p[1]-2,70,'255,170,80',0.16*D,0.55);});
    for(var ck in cars){var cc=cars[ck];glow(cc.x+cc.dir*40,cc.y-6,40,'255,236,170',0.18*D,0.6);}
    glow(FIRE.x,FIRE.y-10,110,'255,150,60',0.22*D,0.7);
    PROPS.forEach(function(o){if(o.light)glow(o.x,o.y-26,40,'170,230,255',0.16*D,0.9);});
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='rgba(255,212,128,'+(0.85*D)+')';
    BUILDINGS.forEach(function(b){winRects(b).forEach(function(w){ctx.fillRect(w[0],w[1],w[2]/2-1,w[3]);ctx.fillRect(w[0]+w[2]/2+1,w[1],w[2]/2-1,w[3]);});});
  }
  if(bell.bell&&bell.elapsed<60&&!reduce){for(var ri=0;ri<3;ri++){var rad=((t/25)+ri*40)%120;
    ctx.strokeStyle='rgba(255,224,122,'+(0.7*(1-rad/120))+')';ctx.lineWidth=2;ctx.beginPath();ctx.arc(TOWER.x,TOWER.y-40,rad,0,7);ctx.stroke();}}
  drawSky(t,vw,vh);drawStars(vw,vh);drawHanabi();
  pixEnd();
  var signs=ZONES.map(function(z){return drawSign(z,!!bell.bell&&bell.zone===z);});
  signs.push(drawDoorSign());
  var tsign=drawTowerSign();if(tsign)signs.push(tsign);
  var labels=[{p:me,text:'あなた・'+statusText(me),fill:'#fff7c2',alpha:1}];
  Object.keys(others).sort().forEach(function(key){if(here(others[key]))labels.push({p:others[key],text:statusText(others[key]),fill:'#ffffff',alpha:1});});
  residents.forEach(function(n){if(here(n))labels.push({p:n,text:n.npc.label,fill:'#dfe8d8',alpha:1});});
  ghosts.forEach(function(g){labels.push({p:g,text:STATUS_MAP[g.st]+'・'+ageText(g.now),fill:'#ffffff',alpha:Math.min(0.75,g.alpha+0.2)});});
  placeLabels(labels,signs);drawFloats();
  if(bell.bell)drawPointer(bell.zone,vw,vh);
  else if(wx.hanabi)drawPointer(HANABI,vw,vh);
  requestAnimationFrame(frame);
}
// 環境音(sound.js)に渡す、いまの天気と自分の位置
// ミニゲーム(bowling.js)から使う入口
var townGame={
  inZone:function(){return me.r==='town'&&!!me.zone&&me.zone.st==='game';},
  // 遊べるのはポモドーロの休憩の間だけ
  canPlay:function(){var pm=pomodoro();return {ok:!pm.focus||FORCE==='game',left:pm.left};},
  nearTower:function(){return me.r==='town'&&Math.hypot(me.x-TWR.x,me.y-(TWR.y+14))<64;},
  addBricks:addBricks,
  setPlaying:function(v){me.pl=v===true?1:(v||0);if(v){me.tx=null;keys={};}trackDirty=true;lastTrack=0;},
  addPins:addPins
};
window.onstaylyTown={game:townGame,env:function(){
  var b=zoneBySt('bath');
  function near(px,py){var d=Math.hypot(me.x-px,me.y-py),f=Math.max(0,Math.min(1,1-(d-70)/320));return f*f;}
  if(me.r==='lib')return {car:0,anyCar:0,rain:(wx.snow?0:wx.rain)*0.35,night:0,bath:0,pond:0,fire:0};
  var car=0,any=0,ck;for(ck in cars){any=1;car=Math.max(car,near(cars[ck].x,cars[ck].y)*(0.35+0.65*cars[ck].v/CAR_SPEED));}
  return {car:car,anyCar:any,rain:wx.snow?0:wx.rain,night:wx.rain>0?0:light.dark,bath:near(b.x+b.w/2,b.y+b.h/2),pond:near(POND.x,POND.y),fire:near(FIRE.x,FIRE.y)};
}};
start();
})();
