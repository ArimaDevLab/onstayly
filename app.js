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
  {st:'exercise',name:'運動広場',x:1030,y:495,w:320,h:100,floor:'#d6b98c'}
];
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
var SLEEP_TTL=8*3600; // 「おやすみ中」の痕跡は朝まで残す
var POND={x:1080,y:790,rx:120,ry:62};
var TREES=[[50,130],[420,290],[610,150],[750,130],[1345,150],[1355,345],[590,350],[40,345],[600,640],[30,810],
  [360,820],[600,900],[840,640],[900,940],[1330,900],[780,770],[1220,940],[980,650],[740,560],[1370,640]];
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
var me={x:675,y:435,st:'zone',manual:'zone',zone:null,c:0,tx:null,ty:null,phase:0,moving:false,dir:1,fd:0,side:1};
var others={};      // presence key -> 人
var traces=[],tracesAt=0;
var foot=[];        // 足あと {x,y,t}
var cat={x:960,y:700,tx:960,ty:700,wait:2,phase:0,dir:1,moving:false};
var keys={};

function saveLocal(){lsSet('irudake-me',JSON.stringify({x:me.x,y:me.y,st:me.manual,c:me.c}));}
function blocked(x,y){
  if(x<14||y<24||x>W-14||y>H-6)return true;
  for(var i=0;i<BUILDINGS.length;i++){var b=BUILDINGS[i];
    if(x>b.x-8&&x<b.x+b.w+8&&y>b.y+b.h*0.35&&y<b.y+b.h+6)return true;}
  var dx=(x-POND.x)/(POND.rx+8),dy=(y-POND.y)/(POND.ry+8);
  return dx*dx+dy*dy<1;
}

function zoneAt(x,y){
  for(var i=0;i<ZONES.length;i++){var z=ZONES[i];if(x>=z.x&&x<=z.x+z.w&&y>=z.y&&y<=z.y+z.h)return z;}
  return null;
}
function zoneBySt(st){for(var i=0;i<ZONES.length;i++)if(ZONES[i].st===st)return ZONES[i];return null;}
function zoneCount(z){
  var n=zoneAt(me.x,me.y)===z?1:0,k;
  for(k in others)if(zoneAt(others[k].x,others[k].y)===z)n++;
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
  if(x!==null&&y!==null&&!blocked(x,y)){me.x=x;me.y=y;}
  else{me.x=560+Math.random()*230;me.y=415+Math.random()*40;}
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
    if(!o)o=others[k]={x:x,y:y,tx:null,ty:null,phase:0,moving:false,dir:1,fd:0,side:1};
    else if(o.tx===null&&Math.hypot(o.x-x,o.y-y)>40){o.tx=x;o.ty=y;o.direct=true;}
    o.st=STATUS_MAP[m.st]?m.st:'zone';
    o.c=colorIdx(m.c,5);
    o.t=typeof m.t==='string'?m.t:null;
  }
  for(k in others)if(!seen[k])delete others[k];
  setCount();
}
function onMove(p){
  if(!p||typeof p.k!=='string')return;
  var o=others[p.k];if(!o)return;
  var x=num(p.x,0,W),y=num(p.y,0,H),tx=num(p.tx,0,W),ty=num(p.ty,0,H);
  if(x===null||y===null||tx===null||ty===null)return;
  if(Math.hypot(o.x-x,o.y-y)>90){o.x=x;o.y=y;}
  o.tx=tx;o.ty=ty;o.direct=!!p.d;o.stuck=0;
}
function sendMove(tx,ty,direct){
  if(!online||!ch)return;
  ch.send({type:'broadcast',event:'mv',payload:{k:myKey,x:Math.round(me.x),y:Math.round(me.y),
    tx:Math.round(tx),ty:Math.round(ty),d:direct?1:0}});
}
function track(now){
  if(!online||!ch||!trackDirty||now-lastTrack<1000)return;
  lastTrack=now;trackDirty=false;
  ch.track({x:Math.round(me.x),y:Math.round(me.y),st:me.st,c:me.c,t:traceId});
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
function saveTrace(){
  if(!sb)return;
  lastTrace={x:me.x,y:me.y,st:me.st,c:me.c};traceAt=Date.now();
  sb.rpc('leave_trace',{tid:traceId,px:Math.round(me.x),py:Math.round(me.y),pst:me.st,pc:me.c}).then(function(){},function(){});
}
function traceStale(){
  return !lastTrace||Math.hypot(lastTrace.x-me.x,lastTrace.y-me.y)>10||lastTrace.st!==me.st||lastTrace.c!==me.c;
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
  me.tx=Math.min(W-16,Math.max(16,(e.clientX-r.left)/scale+camX));
  me.ty=Math.min(H-8,Math.max(26,(e.clientY-r.top)/scale+camY));
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
  if(p.fd>20){p.fd=0;p.side=-p.side;var fz=zoneAt(p.x,p.y);if(!fz||fz.st!=='bath')foot.push({x:p.x+p.side*3,y:p.y,t:Date.now()});if(foot.length>700)foot.shift();}
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
  if(was&&!me.moving){sendMove(me.x,me.y,true);trackDirty=true;saveLocal();}
  stepZone();
}
function stepOther(o,dt){
  if(o.tx===null){o.moving=false;return;}
  if(Math.hypot(o.tx-o.x,o.ty-o.y)>500){o.x=o.tx;o.y=o.ty;o.tx=null;o.moving=false;return;}
  o.moving=toward(o,dt,o.direct);
}
function stepCat(dt){
  var dx=cat.tx-cat.x,dy=cat.ty-cat.y,d=Math.hypot(dx,dy);
  if(d<2){
    cat.moving=false;cat.wait-=dt;
    if(cat.wait<=0){for(var i=0;i<8;i++){var nx=820+Math.random()*500,ny=620+Math.random()*320;
      if(!blocked(nx,ny)){cat.tx=nx;cat.ty=ny;break;}}cat.wait=3+Math.random()*7;}
  }else{var s=Math.min(d,45*dt);cat.x+=dx/d*s;cat.y+=dy/d*s;cat.moving=true;if(Math.abs(dx)>1)cat.dir=dx>0?1:-1;}
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
}
function drawZones(t){
  ZONES.forEach(function(z){
    var i,j;
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
function updateBell(){
  bell=bellState();
  var el=$('bell');
  if(bell.bell){
    var n=zoneCount(bell.zone);
    el.textContent=bell.bell.name+'の時間です('+hhmm(bell.end)+'まで)。'+bell.zone.name+'に'+(n?n+'人います':'まだ誰もいません');
    el.classList.add('on');
  }else{
    el.textContent='つぎの鐘は '+hhmm(bell.next.h*60+bell.next.m)+' '+bell.next.name;
    el.classList.remove('on');
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
  ctx.fillStyle='#4f8a4c';ctx.beginPath();ctx.arc(x,y-40,24,0,7);ctx.fill();
  ctx.fillStyle='#62a05a';ctx.beginPath();ctx.arc(x-7,y-46,14,0,7);ctx.fill();
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
}
function drawBody(p,isMe,still,bath){
  var x=p.x,y=p.y+(bath?9:0),sw=p.moving?Math.sin(p.phase):0,bob=(!p.moving&&!still)?Math.sin(p.phase*0.25)*0.6:0;
  if(!bath){ctx.fillStyle='rgba(20,40,20,.25)';ctx.beginPath();ctx.ellipse(x,y,11,4,0,0,7);ctx.fill();}
  if(isMe){ctx.strokeStyle='#fff7c2';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,y,15,6,0,0,7);ctx.stroke();}
  if(!bath){ctx.fillStyle='#39424d';
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
  if(bow)ctx.restore();
  if(bath){ctx.fillStyle='#8fd0da';ctx.beginPath();ctx.ellipse(x,p.y-3,14,6,0,0,7);ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.7)';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(x,p.y-3,14,6,0,0,7);ctx.stroke();}
}
function drawCat(){
  var x=cat.x,y=cat.y,d=cat.dir;
  ctx.fillStyle='rgba(20,40,20,.2)';ctx.beginPath();ctx.ellipse(x,y,9,3,0,0,7);ctx.fill();
  ctx.fillStyle='#e9e2d6';rr(x-8,y-9,16,8,4);ctx.fill();
  ctx.beginPath();ctx.arc(x+8*d,y-10,5,0,7);ctx.fill();
  ctx.fillRect(x+8*d-5,y-17,3,4);ctx.fillRect(x+8*d+2,y-17,3,4);
  ctx.fillRect(x-9*d-(d>0?2:0),y-14,2,8);
}
// 表示が重ならないよう、先に置いたものを避けて上へずらす。優先順は 自分 → ほかの人 → 痕跡。
function placeLabels(list,fixed){
  ctx.font='13px DotGothic16, sans-serif';
  var placed=fixed.slice();
  list.forEach(function(L){
    L.w=ctx.measureText(L.text).width+14;L.x=L.p.x;L.y=L.p.y-58;
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
  var x=L.x,y=L.y,base=L.p.y-58;
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
  stepCat(dt);stepTrace(dt);track(t);
  bellT-=dt;if(bellT<=0){bellT=1;updateBell();}
  clockT-=dt;if(clockT<=0){clockT=20;light=daylight();$('clock').textContent=light.text;}

  var vw=cw/scale,vh=chh/scale;
  camX=vw>=W?(W-vw)/2:Math.min(W-vw,Math.max(0,me.x-vw/2));
  camY=vh>=H?(H-vh)/2:Math.min(H-vh,Math.max(0,me.y-30-vh/2));
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#7fa866';ctx.fillRect(0,0,cv.width,cv.height);
  ctx.setTransform(scale*dpr,0,0,scale*dpr,-camX*scale*dpr,-camY*scale*dpr);
  drawGround();drawZones(t);
  if(bell.bell&&!reduce){var bz=bell.zone;ctx.strokeStyle='rgba(255,210,74,'+(0.55+0.35*Math.sin(t/350))+')';ctx.lineWidth=4;rr(bz.x-3,bz.y-3,bz.w+6,bz.h+6,10);ctx.stroke();}
  drawFootprints();
  var ghosts=visibleTraces(),items=[];
  BUILDINGS.forEach(function(b){items.push([b.y+b.h,0,b]);});
  TREES.forEach(function(p){items.push([p[1],1,p]);});
  BENCHES.forEach(function(p){items.push([p[1],2,p]);});
  LAMPS.forEach(function(p){items.push([p[1],3,p]);});
  items.push([TOWER.y,8,TOWER]);
  ghosts.forEach(function(g){items.push([g.y,7,g]);});
  for(k in others)items.push([others[k].y,4,others[k]]);
  items.push([me.y,5,me]);items.push([cat.y,6,cat]);
  items.sort(function(a,b){return a[0]-b[0];});
  items.forEach(function(it){var o=it[2];
    if(it[1]===0)drawBuilding(o);else if(it[1]===1)drawTree(o[0],o[1]);else if(it[1]===2)drawBench(o[0],o[1]);
    else if(it[1]===3)drawLamp(o[0],o[1]);else if(it[1]===4)drawPerson(o,false,reduce);
    else if(it[1]===5)drawPerson(o,true,reduce);
    else if(it[1]===7){ctx.globalAlpha=o.alpha;drawPerson(o,false,true);ctx.globalAlpha=1;}
    else if(it[1]===8)drawTower(bell.bell&&bell.elapsed<60&&!reduce?Math.sin(t/160)*0.45:0);
    else drawCat();});
  if(!reduce)drawSteam(t);
  if(light.warm>0){ctx.fillStyle='rgba(255,150,70,'+(0.16*light.warm)+')';ctx.fillRect(camX,camY,vw,vh);}
  if(light.dark>0){
    ctx.fillStyle='rgba(18,26,66,'+(0.58*light.dark)+')';ctx.fillRect(camX,camY,vw,vh);
    ctx.globalCompositeOperation='lighter';
    LAMPS.forEach(function(p){var g=ctx.createRadialGradient(p[0],p[1]-40,2,p[0],p[1]-20,90);
      g.addColorStop(0,'rgba(255,225,140,'+(0.5*light.dark)+')');g.addColorStop(1,'rgba(255,225,140,0)');
      ctx.fillStyle=g;ctx.fillRect(p[0]-90,p[1]-110,180,180);});
    ctx.fillStyle='rgba(255,214,120,'+(0.75*light.dark)+')';
    BUILDINGS.forEach(function(b){winRects(b).forEach(function(w){ctx.fillRect(w[0],w[1],w[2],w[3]);});});
    ctx.globalCompositeOperation='source-over';
  }
  if(bell.bell&&bell.elapsed<60&&!reduce){for(var ri=0;ri<3;ri++){var rad=((t/25)+ri*40)%120;
    ctx.strokeStyle='rgba(255,224,122,'+(0.7*(1-rad/120))+')';ctx.lineWidth=2;ctx.beginPath();ctx.arc(TOWER.x,TOWER.y-40,rad,0,7);ctx.stroke();}}
  var signs=ZONES.map(function(z){return drawSign(z,!!bell.bell&&bell.zone===z);});
  var labels=[{p:me,text:'あなた・'+STATUS_MAP[me.st],fill:'#fff7c2',alpha:1}];
  Object.keys(others).sort().forEach(function(key){labels.push({p:others[key],text:STATUS_MAP[others[key].st],fill:'#ffffff',alpha:1});});
  ghosts.forEach(function(g){labels.push({p:g,text:STATUS_MAP[g.st]+'・'+ageText(g.now),fill:'#ffffff',alpha:Math.min(0.75,g.alpha+0.2)});});
  placeLabels(labels,signs);
  if(bell.bell)drawPointer(bell.zone,vw,vh);
  requestAnimationFrame(frame);
}
start();
})();
