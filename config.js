// Supabase の接続先。どちらも公開してよい値です(service_role キーは絶対にここへ書かないこと)。
window.ONSTAYLY_CONFIG = {
  url: 'https://mlztqonvezvyncsfdeuk.supabase.co',
  key: 'sb_publishable_lAhwenObC8RH3KBb30ZKpw_nw7-afsI',
  traceHours: 3,       // 「いた場所」が残る時間。変えるときは supabase/schema.sql の '3 hours' も合わせる
  footprintSeconds: 60 // 足あとが残る時間
};
