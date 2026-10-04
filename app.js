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
  ['draw','おえかき中'],['music','音楽きいてる'],['eat','ごはん中'],['rest','ひとやすみ'],['walk','さんぽ中']
];
var STATUS_MAP={}; STATUSES.forEach(function(s){STATUS_MAP[s[0]]=s[1];});
var COLORS=['#d9694a','#3f7fbf','#4f9d6a','#b0589c','#d6a531','#5a6470'];
var W=1400,H=1000,SPEED=120;

var BUILDINGS=[
  {x:120,y:150,w:260,h:190,wall:'#d8c7a6',roof:'#7a4b3a',label:'図書館'},
  {x:440,y:210,w:130,h:130,wall:'#e6dccb',roof:'#4f6f8a'},
  {x:800,y:160,w:230,h:180,wall:'#c9d3e0',roof:'#a8453f',label:'ゲームセンター'},
  {x:1090,y:200,w:170,h:140,wall:'#ead9b8',roof:'#3f6b55',label:'喫茶店'},
  {x:110,y:640,w:140,h:130,wall:'#e2d2c0',roof:'#8a5a44'},
  {x:300,y:720,w:130,h:130,wall:'#d5ddd2',roof:'#5b5f7a'},
  {x:470,y:600,w:130,h:130,wall:'#eadfce',roof:'#93523f'}
];
var POND={x:1080,y:790,rx:120,ry:62};
var TREES=[[60,90],[420,110],[620,120],[760,90],[1300,110],[1340,330],[60,560],[280,580],[560,880],[90,900],
  [840,620],[900,930],[1290,640],[1330,900],[780,760],[1220,930],[980,640],[600,560],[40,330],[740,560]];
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
var me={x:675,y:435,st:'zone',c:0,tx:null,ty:null,phase:0,moving:false,dir:1,fd:0,side:1};
var others={};      // presence key -> 人
var traces=[],tracesAt=0;
var foot=[];        // 足あと {x,y,t}
var cat={x:960,y:700,tx:960,ty:700,wait:2,phase:0,dir:1,moving:false};
var keys={};

function saveLocal(){lsSet('irudake-me',JSON.stringify({x:me.x,y:me.y,st:me.st,c:me.c}));}
function blocked(x,y){
  if(x<14||y<24||x>W-14||y>H-6)return true;
  for(var i=0;i<BUILDINGS.length;i++){var b=BUILDINGS[i];
    if(x>b.x-8&&x<b.x+b.w+8&&y>b.y+b.h*0.35&&y<b.y+b.h+6)return true;}
  var dx=(x-POND.x)/(POND.rx+8),dy=(y-POND.y)/(POND.ry+8);
  return dx*dx+dy*dy<1;
}

function start(){
  var s={};try{s=JSON.parse(lsGet('irudake-me')||'{}')||{};}catch(e){}
  var x=num(s.x,0,W),y=num(s.y,0,H);
  if(x!==null&&y!==null&&!blocked(x,y)){me.x=x;me.y=y;}
  else{me.x=560+Math.random()*230;me.y=415+Math.random()*40;}
  if(STATUS_MAP[s.st])me.st=s.st;
  me.c=colorIdx(s.c,Math.floor(Math.random()*COLORS.length));
  buildUI();resize();requestAnimationFrame(frame);connect();
}

/* ---------- 画面下の操作 ---------- */
var $=function(id){return document.getElementById(id);};
function buildUI(){
  STATUSES.forEach(function(s){
    var b=document.createElement('button');b.type='button';b.className='chip';b.id='st-'+s[0];b.textContent=s[1];
    b.addEventListener('click',function(){me.st=s[0];changed();});
    $('chips').appendChild(b);
  });
  COLORS.forEach(function(c,i){
    var b=document.createElement('button');b.type='button';b.className='swatch';b.id='col-'+i;
    b.style.background=c;b.setAttribute('aria-label','服の色 '+(i+1));
    b.addEventListener('click',function(){me.c=i;changed();});
    $('swatches').appendChild(b);
  });
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
    ch=sb.channel('town',{config:{presence:{key:myKey},broadcast:{self:false}}});
  }catch(e){offline();return;}
  ch.on('presence',{event:'sync'},syncPeers)
    .on('broadcast',{event:'mv'},function(m){onMove(m&&m.payload);})
    .subscribe(function(status){
      if(status==='SUBSCRIBED'){online=true;trackDirty=true;lastTrack=0;setNote('話す機能はありません。歩いて、いるだけ。');}
      else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){offline();}
    });
  checkIn();loadTraces();
  setInterval(loadTraces,60000);setInterval(checkIn,300000);
}
function syncPeers(){
  // 同じブラウザで複数のタブを開いている人は1人として扱う(自分の別タブは出さない)
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
  if(!online)return;
  ch.send({type:'broadcast',event:'mv',payload:{k:myKey,x:Math.round(me.x),y:Math.round(me.y),
    tx:Math.round(tx),ty:Math.round(ty),d:direct?1:0}});
}
function track(now){
  if(!online||!trackDirty||now-lastTrack<1000)return;
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
      var x=num(t.x,0,W),y=num(t.y,0,H),age=num(t.age_seconds,0,TRACE_TTL);
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
  if(p.fd>20){p.fd=0;p.side=-p.side;foot.push({x:p.x+p.side*3,y:p.y,t:Date.now()});if(foot.length>700)foot.shift();}
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
  ctx.fillStyle='#d9cfb6';ctx.fillRect(1160,340,30,60);ctx.fillRect(900,340,30,60);ctx.fillRect(235,340,30,60);
  ctx.fillRect(900,470,30,150);
  ctx.fillStyle='#7aa35f';ctx.beginPath();ctx.ellipse(POND.x,POND.y,POND.rx+8,POND.ry+7,0,0,7);ctx.fill();
  ctx.fillStyle='#6fb3c9';ctx.beginPath();ctx.ellipse(POND.x,POND.y,POND.rx,POND.ry,0,0,7);ctx.fill();
  ctx.fillStyle='#8fc8d8';ctx.beginPath();ctx.ellipse(POND.x-30,POND.y-14,46,12,0,0,7);ctx.fill();
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
  var x=p.x,y=p.y,sw=p.moving?Math.sin(p.phase):0,bob=(!p.moving&&!still)?Math.sin(p.phase*0.25)*0.6:0;
  ctx.fillStyle='rgba(20,40,20,.25)';ctx.beginPath();ctx.ellipse(x,y,11,4,0,0,7);ctx.fill();
  if(isMe){ctx.strokeStyle='#fff7c2';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,y,15,6,0,0,7);ctx.stroke();}
  ctx.fillStyle='#39424d';
  ctx.fillRect(x-6+sw*3,y-12,5,12-Math.max(0,sw)*2);
  ctx.fillRect(x+1-sw*3,y-12,5,12-Math.max(0,-sw)*2);
  ctx.fillStyle=COLORS[p.c]||COLORS[5];rr(x-8,y-28+bob,16,18,4);ctx.fill();
  ctx.fillRect(x-11,y-26+bob+sw*2,4,11);ctx.fillRect(x+7,y-26+bob-sw*2,4,11);
  ctx.fillStyle='#f0cfae';ctx.beginPath();ctx.arc(x,y-35+bob,8,0,7);ctx.fill();
  ctx.fillStyle='#3a2c26';ctx.beginPath();ctx.arc(x,y-37+bob,8,Math.PI,0);ctx.fill();
  ctx.fillRect(x-8*p.dir-(p.dir>0?0:3),y-38+bob,3,6);
  ctx.fillStyle='#2b2422';ctx.fillRect(x+3*p.dir-1,y-35+bob,2,2);
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
function placeLabels(list){
  ctx.font='13px DotGothic16, sans-serif';
  var placed=[];
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
    var age=t.age+extra;if(here[t.id]||age>=TRACE_TTL)return;
    t.now=age;t.alpha=0.12+0.43*(1-age/TRACE_TTL);out.push(t);
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
var last=0,clockT=0,light=daylight();
function frame(t){
  var dt=Math.min(0.05,(t-last)/1000||0);last=t;
  stepMe(dt,t);if(!me.moving)me.phase+=dt*9;
  var k;for(k in others){stepOther(others[k],dt);if(!others[k].moving)others[k].phase+=dt*9;}
  stepCat(dt);stepTrace(dt);track(t);
  clockT-=dt;if(clockT<=0){clockT=20;light=daylight();$('clock').textContent=light.text;}

  var vw=cw/scale,vh=chh/scale;
  camX=vw>=W?(W-vw)/2:Math.min(W-vw,Math.max(0,me.x-vw/2));
  camY=vh>=H?(H-vh)/2:Math.min(H-vh,Math.max(0,me.y-30-vh/2));
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#7fa866';ctx.fillRect(0,0,cv.width,cv.height);
  ctx.setTransform(scale*dpr,0,0,scale*dpr,-camX*scale*dpr,-camY*scale*dpr);
  drawGround();drawFootprints();
  var ghosts=visibleTraces(),items=[];
  BUILDINGS.forEach(function(b){items.push([b.y+b.h,0,b]);});
  TREES.forEach(function(p){items.push([p[1],1,p]);});
  BENCHES.forEach(function(p){items.push([p[1],2,p]);});
  LAMPS.forEach(function(p){items.push([p[1],3,p]);});
  ghosts.forEach(function(g){items.push([g.y,7,g]);});
  for(k in others)items.push([others[k].y,4,others[k]]);
  items.push([me.y,5,me]);items.push([cat.y,6,cat]);
  items.sort(function(a,b){return a[0]-b[0];});
  items.forEach(function(it){var o=it[2];
    if(it[1]===0)drawBuilding(o);else if(it[1]===1)drawTree(o[0],o[1]);else if(it[1]===2)drawBench(o[0],o[1]);
    else if(it[1]===3)drawLamp(o[0],o[1]);else if(it[1]===4)drawPerson(o,false,reduce);
    else if(it[1]===5)drawPerson(o,true,reduce);
    else if(it[1]===7){ctx.globalAlpha=o.alpha;drawPerson(o,false,true);ctx.globalAlpha=1;}
    else drawCat();});
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
  var labels=[{p:me,text:'あなた・'+STATUS_MAP[me.st],fill:'#fff7c2',alpha:1}];
  Object.keys(others).sort().forEach(function(key){labels.push({p:others[key],text:STATUS_MAP[others[key].st],fill:'#ffffff',alpha:1});});
  ghosts.forEach(function(g){labels.push({p:g,text:STATUS_MAP[g.st]+'・'+ageText(g.now),fill:'#ffffff',alpha:Math.min(0.75,g.alpha+0.2)});});
  placeLabels(labels);
  requestAnimationFrame(frame);
}
start();
})();
