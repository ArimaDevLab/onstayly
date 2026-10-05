/* つみき。みんなの塔のふもとで、ポモドーロの休憩の間だけ遊べる。
   左右に動くブロックをタップで落とし、はみ出した分はけずれる。乗らなかったら終わり。
   積めた数だけ、町の塔のレンガが増える(最大20個)。個人の記録は残さない。 */
(function(){
'use strict';
var town=window.onstaylyTown;
if(!town||!town.game)return;
var G=town.game,$=function(id){return document.getElementById(id);};
var btn=$('stack-btn'),panel=$('game'),cv=$('game-cv'),ctx=cv.getContext('2d');
var info=$('game-info'),msg=$('game-msg'),againBtn=$('game-again'),closeBtn=$('game-close');
var W=300,H=400,BH=17,BASE_Y=372,MAX=20;
var COLORS=['#a8553f','#b9683f','#c97d4a','#b0603c','#9a4d38'];
var open=false,raf=0,last=0,S=null;

function mmss(s){return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}
function say(t){msg.textContent=t;}
function newGame(){
  S={blocks:[{x:150,w:150}],cx:150,w:150,t:Math.random()*6,speed:1.25,count:0,over:false,flash:'',flashT:0,drop:null};
  againBtn.hidden=true;closeBtn.textContent='やめる';
  say('タップでブロックを落とします。ずれた分はけずれます。');
}
function act(){
  if(!S||S.over||S.drop)return;
  var top=S.blocks[S.blocks.length-1];
  var l=Math.max(S.cx-S.w/2,top.x-top.w/2),r=Math.min(S.cx+S.w/2,top.x+top.w/2),ov=r-l;
  if(ov<=5)return finish(false,true);
  var perfect=Math.abs(S.cx-top.x)<7;
  var nb=perfect?{x:top.x,w:S.w}:{x:(l+r)/2,w:ov};
  S.blocks.push(nb);S.count++;S.w=nb.w;S.speed+=0.06;S.t=Math.random()*6;
  if(perfect){S.flash='ぴったり！';S.flashT=0.7;}
  if(S.count>=MAX)return finish(false,false);
  // 集中の時間が来たら、置いたところで終わりにする
  if(!G.canPlay().ok)return finish(true,false);
  say(S.count+'個つみました。');
}
function finish(early,missed){
  S.over=true;
  var n=S.count,head=(early?'集中の時間になりました。':n>=MAX?'てっぺんまで積めました。':missed&&n===0?'のりませんでした。':'')+n+'個つみました。';
  say(head);closeBtn.textContent='とじる';
  if(n<1){againBtn.hidden=!G.canPlay().ok;return;}
  G.addBricks(n).then(function(total){
    if(!open||!S||!S.over)return;
    say(head+(total===null?'':'みんなの塔のレンガが '+total.toLocaleString('ja-JP')+'個になりました。'));
    againBtn.hidden=!G.canPlay().ok;
  });
}
function step(dt){
  if(S.flashT>0)S.flashT-=dt;
  if(S.over)return;
  S.t+=dt*S.speed;
  var range=(W-S.w)/2-6;
  S.cx=150+Math.sin(S.t)*range;
}
function draw(){
  var g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#bfe3f2');g.addColorStop(1,'#e9f4ee');
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  if(!S)return;
  // 高くなったら、見える範囲を上へ送る
  var n=S.blocks.length,shift=Math.max(0,(n-12)*BH);
  ctx.fillStyle='#8fb872';ctx.fillRect(0,BASE_Y+BH+shift,W,H);
  ctx.fillStyle='#8f8a80';ctx.fillRect(60,BASE_Y+BH-3+shift,180,8);
  S.blocks.forEach(function(b,i){
    var y=BASE_Y-i*BH+shift;if(y>H||y<-BH)return;
    ctx.fillStyle=COLORS[i%COLORS.length];ctx.fillRect(b.x-b.w/2,y,b.w,BH-1);
    ctx.fillStyle='rgba(255,255,255,.18)';ctx.fillRect(b.x-b.w/2,y,b.w,3);
    ctx.fillStyle='rgba(0,0,0,.14)';for(var k=b.x-b.w/2+((i%2)*10)+16;k<b.x+b.w/2-2;k+=20)ctx.fillRect(k,y+3,1.5,BH-4);
  });
  if(!S.over){
    var my=BASE_Y-n*BH+shift-16;
    ctx.strokeStyle='rgba(60,60,70,.5)';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(S.cx,0);ctx.lineTo(S.cx,my);ctx.stroke();
    ctx.fillStyle=COLORS[n%COLORS.length];ctx.fillRect(S.cx-S.w/2,my,S.w,BH-1);
    ctx.fillStyle='rgba(255,255,255,.18)';ctx.fillRect(S.cx-S.w/2,my,S.w,3);
  }
  if(S.flashT>0){
    ctx.font='24px DotGothic16, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle='rgba(20,30,28,.7)';ctx.fillRect(60,150,180,42);ctx.fillStyle='#ffe07a';ctx.fillText(S.flash,150,172);
  }
  info.textContent=S.count+'/'+MAX+'個';
}
function loop(t){
  if(!open)return;
  var dt=Math.min(0.033,(t-last)/1000||0);last=t;
  step(dt);draw();raf=requestAnimationFrame(loop);
}
function show(){
  if(open||window.onstaylyGameOpen||!G.nearTower()||!G.canPlay().ok)return;
  open=true;window.onstaylyGameOpen=true;$('game-title').textContent='つみき';
  panel.hidden=false;btn.hidden=true;G.setPlaying(2);newGame();
  last=performance.now();raf=requestAnimationFrame(loop);cv.focus({preventScroll:true});
}
function hide(){
  if(!open)return;
  open=false;window.onstaylyGameOpen=false;panel.hidden=true;cancelAnimationFrame(raf);G.setPlaying(false);S=null;
}
btn.addEventListener('click',show);
closeBtn.addEventListener('click',hide);
againBtn.addEventListener('click',function(){if(!open)return;if(G.canPlay().ok)newGame();else againBtn.hidden=true;});
cv.addEventListener('pointerdown',function(e){if(!open)return;e.preventDefault();act();});
cv.addEventListener('keydown',function(e){if(open&&(e.key===' '||e.key==='Enter')){e.preventDefault();act();}});

setInterval(function(){
  var near=G.nearTower(),cp=G.canPlay();
  if(open){
    if(!near)hide();
    else if(S&&S.over&&!cp.ok)againBtn.hidden=true;
    return;
  }
  btn.hidden=!near||!!window.onstaylyGameOpen;
  if(btn.hidden)return;
  btn.disabled=!cp.ok;
  btn.textContent=cp.ok?'つみきで塔をのばす(休憩のあいだ)':'休憩になったら積めます(あと'+mmss(cp.left)+')';
},400);
})();
