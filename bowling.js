/* ボウリング。ゲームコーナーで、ポモドーロの休憩の間だけ遊べる。
   1ゲーム = 3フレーム(1フレーム2投まで)。タップ1回目で立つ位置、2回目で向きを決めて投げる。
   たおしたピンは町のみんなの合計に足される。個人の記録や順位は残さない。 */
(function(){
'use strict';
var town=window.onstaylyTown;
if(!town||!town.game)return;
var G=town.game,$=function(id){return document.getElementById(id);};
var btn=$('play-btn'),panel=$('game'),cv=$('game-cv'),ctx=cv.getContext('2d');
var info=$('game-info'),msg=$('game-msg'),againBtn=$('game-again'),closeBtn=$('game-close');
var W=300,H=400,LANE_L=62,LANE_R=238,FOUL=352,BALL_R=10,PIN_R=6.5;
var open=false,raf=0,last=0,S=null;

function mmss(s){return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}
function setupPins(){
  var pins=[];
  for(var r=0;r<4;r++)for(var i=0;i<=r;i++)pins.push({x:150+(i-r/2)*24,y:118-r*21,vx:0,vy:0,down:false,gone:false,rot:0});
  return pins;
}
function newGame(){
  S={frame:1,ball:1,score:0,pins:setupPins(),phase:'pos',t:Math.random()*3,bx:150,ang:0,b:null,settle:0,flash:'',flashT:0,before:0,over:false};
  againBtn.hidden=true;closeBtn.textContent='やめる';
  say('タップで立つ位置を決めます。');
}
function say(t){msg.textContent=t;}
function standing(){return S.pins.filter(function(p){return !p.down;}).length;}

function act(){
  if(!S||S.over)return;
  if(S.phase==='pos'){S.phase='aim';S.t=Math.random()*2.4;say('もう一度タップで、向きを決めて投げます。');}
  else if(S.phase==='aim'){
    var v=300;
    S.b={x:S.bx,y:FOUL-6,vx:Math.sin(S.ang)*v,vy:-Math.cos(S.ang)*v,gutter:false};
    S.before=standing();S.phase='roll';say('');
  }
}
function collide(a,ra,ma,b,rb,mb,rest){
  var dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),min=ra+rb;
  if(d>=min||d===0)return 0;
  var nx=dx/d,ny=dy/d,rel=(a.vx-b.vx)*nx+(a.vy-b.vy)*ny;
  var push=(min-d)/2;a.x-=nx*push*(mb/(ma+mb))*2;a.y-=ny*push*(mb/(ma+mb))*2;b.x+=nx*push*(ma/(ma+mb))*2;b.y+=ny*push*(ma/(ma+mb))*2;
  if(rel<=0)return 0;
  var j=(1+rest)*rel/(1/ma+1/mb);
  a.vx-=j/ma*nx;a.vy-=j/ma*ny;b.vx+=j/mb*nx;b.vy+=j/mb*ny;
  return rel;
}
function step(dt){
  S.t+=dt;if(S.flashT>0)S.flashT-=dt;
  if(S.phase==='pos')S.bx=150+Math.sin(S.t*2.1)*66;
  else if(S.phase==='aim')S.ang=Math.sin(S.t*2.6)*0.2;
  else if(S.phase==='roll'||S.phase==='settle'){
    var b=S.b,i,j,p,q,moving=false;
    if(b){
      b.x+=b.vx*dt;b.y+=b.vy*dt;
      if(!b.gutter&&(b.x<LANE_L+BALL_R-2||b.x>LANE_R-BALL_R+2)){b.gutter=true;b.vx=0;b.x=b.x<150?LANE_L-9:LANE_R+9;}
      if(!b.gutter)for(i=0;i<S.pins.length;i++){p=S.pins[i];if(p.gone)continue;
        if(collide(b,BALL_R,6,p,PIN_R,1,0.55)>25)p.down=true;}
      if(b.y<30||Math.hypot(b.vx,b.vy)<25){S.b=null;S.phase='settle';S.settle=1.1;}
    }
    for(i=0;i<S.pins.length;i++){p=S.pins[i];if(p.gone)continue;
      var sp=Math.hypot(p.vx,p.vy);
      if(sp>2){moving=true;p.x+=p.vx*dt;p.y+=p.vy*dt;p.rot+=sp*dt*0.05;var f=Math.exp(-2.4*dt);p.vx*=f;p.vy*=f;
        for(j=0;j<S.pins.length;j++){q=S.pins[j];if(q===p||q.gone)continue;
          if(collide(p,PIN_R,1,q,PIN_R,1,0.6)>30){q.down=true;p.down=true;}}
        if(p.x<LANE_L-4||p.x>LANE_R+4||p.y<34)p.gone=true;
      }
    }
    if(S.phase==='settle'){S.settle-=dt;if(S.settle<=0&&!moving)endThrow();}
  }
}
function endThrow(){
  var got=S.before-standing();S.score+=got;
  var all=standing()===0;
  if(all){S.flash=S.ball===1?'ストライク！':'スペア！';S.flashT=1.3;}
  else if(got===0){S.flash='ざんねん';S.flashT=0.9;}
  var nextFrame=all||S.ball===2;
  if(nextFrame){
    if(S.frame>=3)return finish(false);
    S.frame++;S.ball=1;S.pins=setupPins();
  }else{
    S.ball=2;S.pins.forEach(function(p){if(p.down)p.gone=true;});
  }
  // 集中の時間が来たら、投げ終わったところで終わりにする
  if(!G.canPlay().ok)return finish(true);
  S.phase='pos';S.t=Math.random()*3;say(got+'本たおしました。タップで立つ位置を決めます。');
}
function finish(early){
  S.over=true;S.phase='done';
  var score=S.score,head=(early?'集中の時間になりました。':'')+score+'本たおしました。';
  say(head);closeBtn.textContent='とじる';
  G.addPins(score).then(function(total){
    if(!open||!S||!S.over)return;
    say(head+(total===null?'':'今日、町のみんなで '+total.toLocaleString('ja-JP')+'本になりました。'));
    againBtn.hidden=!G.canPlay().ok;
  });
}

function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#2f3b46';ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#1f2830';ctx.fillRect(LANE_L-18,20,18,H-20);ctx.fillRect(LANE_R,20,18,H-20);
  ctx.fillStyle='#d9b77e';ctx.fillRect(LANE_L,20,LANE_R-LANE_L,H-20);
  ctx.strokeStyle='rgba(120,80,40,.25)';ctx.lineWidth=1;
  for(var x=LANE_L+16;x<LANE_R;x+=16){ctx.beginPath();ctx.moveTo(x,20);ctx.lineTo(x,H);ctx.stroke();}
  ctx.fillStyle='#b98552';ctx.fillRect(LANE_L,20,LANE_R-LANE_L,30);
  ctx.fillStyle='#a8453f';ctx.fillRect(LANE_L,FOUL,LANE_R-LANE_L,3);
  ctx.fillStyle='rgba(120,80,40,.5)';for(var a=0;a<5;a++){ctx.beginPath();ctx.moveTo(90+a*30,250);ctx.lineTo(96+a*30,262);ctx.lineTo(84+a*30,262);ctx.closePath();ctx.fill();}
  if(!S)return;
  S.pins.forEach(function(p){
    if(p.gone)return;
    if(p.down){ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rot+0.8);ctx.fillStyle='#cfc8bb';ctx.beginPath();ctx.ellipse(0,0,PIN_R+3,PIN_R-2.5,0,0,7);ctx.fill();ctx.restore();}
    else{ctx.fillStyle='rgba(60,40,20,.25)';ctx.beginPath();ctx.arc(p.x+1.5,p.y+2,PIN_R,0,7);ctx.fill();
      ctx.fillStyle='#fbf8f0';ctx.beginPath();ctx.arc(p.x,p.y,PIN_R,0,7);ctx.fill();
      ctx.strokeStyle='#c9453f';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,PIN_R-2.5,0,7);ctx.stroke();}
  });
  var bx=S.b?S.b.x:S.bx,by=S.b?S.b.y:FOUL-6;
  if(S.phase==='aim'){
    ctx.strokeStyle='rgba(44,122,104,.9)';ctx.lineWidth=3;ctx.setLineDash([8,6]);ctx.beginPath();ctx.moveTo(bx,by);
    ctx.lineTo(bx+Math.sin(S.ang)*150,by-Math.cos(S.ang)*150);ctx.stroke();ctx.setLineDash([]);
  }
  if(S.phase!=='done'&&(S.b||S.phase==='pos'||S.phase==='aim')){
    ctx.fillStyle='rgba(30,20,10,.3)';ctx.beginPath();ctx.arc(bx+2,by+3,BALL_R,0,7);ctx.fill();
    ctx.fillStyle='#2f4f8a';ctx.beginPath();ctx.arc(bx,by,BALL_R,0,7);ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.35)';ctx.beginPath();ctx.arc(bx-3,by-3,3,0,7);ctx.fill();
  }
  if(S.flashT>0){
    ctx.font='28px DotGothic16, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle='rgba(20,30,28,.7)';ctx.fillRect(40,180,220,48);ctx.fillStyle='#ffe07a';ctx.fillText(S.flash,150,205);
  }
  info.textContent=S.over?'合計 '+S.score+'本':S.frame+'/3フレーム・'+S.ball+'投目・'+S.score+'本';
}
function loop(t){
  if(!open)return;
  var dt=Math.min(0.033,(t-last)/1000||0);last=t;
  // 細かく刻んで、速いボールがピンをすり抜けないようにする
  for(var i=0;i<3;i++)step(dt/3);
  draw();raf=requestAnimationFrame(loop);
}
function show(){
  if(open||window.onstaylyGameOpen||!G.inZone()||!G.canPlay().ok)return;
  open=true;window.onstaylyGameOpen=true;$('game-title').textContent='ボウリング';panel.hidden=false;btn.hidden=true;G.setPlaying(true);newGame();
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

// 遊べる場所と時間のときだけ、ボタンを出す
setInterval(function(){
  var inZone=G.inZone(),cp=G.canPlay();
  if(open){
    if(!inZone)hide();
    else if(S&&S.over&&!cp.ok)againBtn.hidden=true;
    return;
  }
  btn.hidden=!inZone;
  if(!inZone)return;
  btn.disabled=!cp.ok;
  btn.textContent=cp.ok?'ボウリングで遊ぶ(休憩のあいだ)':'休憩になったら遊べます(あと'+mmss(cp.left)+')';
},400);
})();
