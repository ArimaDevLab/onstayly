/* 環境音ミキサー。
   音はすべてプログラムで合成している(音声ファイルなし)。録音に差し替えるときは、
   各チャンネルの build 関数の中身を AudioBufferSourceNode の再生に置き換えればよい。
   初期状態は無音で、「音を鳴らす」を押した人の端末だけで鳴る。 */
(function(){
'use strict';
var town=window.onstaylyTown;
var CH=['rain','bugs','bath','pond','fire'];
var $=function(id){return document.getElementById(id);};
var set={auto:true,master:50,rain:60,bugs:60,bath:60,pond:60,fire:60};
try{var saved=JSON.parse(localStorage.getItem('irudake-sound')||'null');
  if(saved)Object.keys(set).forEach(function(k){if(typeof saved[k]===typeof set[k])set[k]=saved[k];});}catch(e){}
function save(){try{localStorage.setItem('irudake-sound',JSON.stringify(set));}catch(e){}}

var on=false,ctx=null,master=null,analyser=null,g={},noise=null;

function noiseBuffer(){
  var len=ctx.sampleRate*2,buf=ctx.createBuffer(1,len,ctx.sampleRate),d=buf.getChannelData(0);
  for(var i=0;i<len;i++)d[i]=Math.random()*2-1;
  return buf;
}
function noiseSrc(){var s=ctx.createBufferSource();s.buffer=noise;s.loop=true;s.start(0,Math.random()*1.5);return s;}
function filt(type,freq,q){var f=ctx.createBiquadFilter();f.type=type;f.frequency.value=freq;if(q)f.Q.value=q;return f;}
function gain(v){var n=ctx.createGain();n.gain.value=v;return n;}
function lfo(freq,depth,target,type){
  var o=ctx.createOscillator(),d=gain(depth);o.type=type||'sine';o.frequency.value=freq;o.connect(d);d.connect(target);o.start();
}
function chain(){for(var i=0;i<arguments.length-1;i++)arguments[i].connect(arguments[i+1]);}

function build(){
  var AC=window.AudioContext||window.webkitAudioContext;
  if(!AC)return false;
  ctx=new AC();noise=noiseBuffer();
  master=gain(set.master/100);analyser=ctx.createAnalyser();analyser.fftSize=2048;
  chain(master,analyser,ctx.destination);
  CH.forEach(function(k){g[k]=gain(0);g[k].connect(master);});

  // 雨: 高めのざーっという音に、低い層を少し重ねる
  chain(noiseSrc(),filt('highpass',700),filt('lowpass',6500),gain(0.32),g.rain);
  chain(noiseSrc(),filt('lowpass',900),gain(0.16),g.rain);

  // 虫の声: 高い音を細かく震わせ、ゆっくり鳴いたり止んだりさせる
  [[4300,31,0.9],[4850,27,0.62],[3900,24,0.47]].forEach(function(c){
    var o=ctx.createOscillator(),trem=gain(0.5),gate=gain(0.5);
    o.frequency.value=c[0];o.start();
    lfo(c[1],0.5,trem.gain);lfo(c[2],0.5,gate.gain);
    chain(o,trem,gate,gain(0.055),g.bugs);
  });

  // お湯: 流れ込む音。こもった帯域をゆっくり揺らし、泡の層を重ねる
  var bp=filt('bandpass',750,1.1);lfo(0.31,230,bp.frequency);
  chain(noiseSrc(),bp,gain(0.55),g.bath);
  var bub=gain(0.06);lfo(3.1,0.05,bub.gain);
  chain(noiseSrc(),filt('bandpass',2400,2.5),bub,g.bath);

  // 池: 静かな水面。低い音をゆっくり寄せては返す
  var lap=gain(0.3);lfo(0.17,0.18,lap.gain);
  chain(noiseSrc(),filt('lowpass',480),lap,g.pond);

  // 焚き火: 低いごうごうという音。ぱちぱちは下の tick で足す
  var rum=gain(0.5);lfo(0.9,0.15,rum.gain);
  chain(noiseSrc(),filt('lowpass',260),rum,g.fire);
  return true;
}
function level(k){return g[k]?g[k].gain.value:0;}
function crackle(){
  var s=ctx.createBufferSource(),e=gain(0),t=ctx.currentTime,dur=0.012+Math.random()*0.03,v=0.12+Math.random()*0.5;
  s.buffer=noise;e.gain.setValueAtTime(v,t);e.gain.exponentialRampToValueAtTime(0.001,t+dur);
  chain(s,filt('highpass',1500+Math.random()*1500),e,g.fire);s.start(t,Math.random()*1.9,dur+0.02);
}
function drip(dest,v){
  var o=ctx.createOscillator(),e=gain(0),t=ctx.currentTime,f=480+Math.random()*520;
  o.frequency.setValueAtTime(f,t);o.frequency.exponentialRampToValueAtTime(f*2.3,t+0.055);
  e.gain.setValueAtTime(v,t);e.gain.exponentialRampToValueAtTime(0.001,t+0.09);
  chain(o,e,dest);o.start(t);o.stop(t+0.1);
}
// 0.25秒ごとに、天気と立ち位置から各音の大きさを決め、ぱちぱち・ぽちゃんを足す
function tick(){
  if(!ctx)return;
  var env=town?town.env():{rain:1,night:1,bath:1,pond:1,fire:1};
  var f={rain:env.rain,bugs:env.night,bath:env.bath,pond:env.pond,fire:env.fire},t=ctx.currentTime,heard=[];
  CH.forEach(function(k){
    var v=on?(set[k]/100)*(set.auto?f[k]:1):0;
    g[k].gain.setTargetAtTime(v,t,0.5);
    if(v>0.02)heard.push(NAMES[k]);
  });
  master.gain.setTargetAtTime(set.master/100,t,0.1);
  if(on){
    if(level('fire')>0.02&&Math.random()<0.55)crackle();
    if(level('bath')>0.02&&Math.random()<0.1)drip(g.bath,0.1);
    if(level('pond')>0.02&&Math.random()<0.03)drip(g.pond,0.06);
  }
  $('snd-note').textContent=!on?'初めは無音です。「音を鳴らす」で始まります。':
    heard.length?'いま聞こえる音: '+heard.join('、'):
    set.auto?'いまは静かです。雨の日、夜、露天風呂・池・焚き火の近くで聞こえます。':'すべての音量が0です。';
}
var NAMES={rain:'雨',bugs:'虫の声',bath:'お湯',pond:'池',fire:'焚き火'};

/* ---------- 画面 ---------- */
var panel=$('snd-panel'),openBtn=$('snd-open'),onBtn=$('snd-on');
openBtn.addEventListener('click',function(){
  panel.hidden=!panel.hidden;openBtn.setAttribute('aria-expanded',String(!panel.hidden));
});
onBtn.addEventListener('click',function(){
  if(!ctx&&!build()){$('snd-note').textContent='このブラウザでは音を鳴らせません。';return;}
  on=!on;if(on)ctx.resume();
  onBtn.setAttribute('aria-pressed',String(on));onBtn.textContent=on?'音を止める':'音を鳴らす';
  openBtn.setAttribute('aria-pressed',String(on));
  tick();
});
['master'].concat(CH).forEach(function(k){
  var el=$('snd-'+k);el.value=set[k];
  el.addEventListener('input',function(){set[k]=Number(el.value);save();tick();});
});
$('snd-auto').checked=set.auto;
$('snd-auto').addEventListener('change',function(){set.auto=$('snd-auto').checked;save();tick();});
$('snd-note').textContent='初めは無音です。「音を鳴らす」で始まります。';
setInterval(tick,250);

// 動作確認用: いまの出力の大きさ(0〜1)
window.onstaylySound={rms:function(){
  if(!analyser)return 0;
  var a=new Float32Array(analyser.fftSize),s=0;analyser.getFloatTimeDomainData(a);
  for(var i=0;i<a.length;i++)s+=a[i]*a[i];
  return Math.sqrt(s/a.length);
},peak:function(){
  if(!analyser)return 0;
  var a=new Float32Array(analyser.fftSize),m=0;analyser.getFloatTimeDomainData(a);
  for(var i=0;i<a.length;i++)m=Math.max(m,Math.abs(a[i]));
  return m;
}};
})();
