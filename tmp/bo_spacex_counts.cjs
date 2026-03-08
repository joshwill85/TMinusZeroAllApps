const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
function loadEnv(path='.env.local'){for(const line of fs.readFileSync(path,'utf8').split('\n')){const t=line.trim();if(!t||t.startsWith('#'))continue;const i=t.indexOf('=');if(i<0)continue;const k=t.slice(0,i);let v=t.slice(i+1);if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);process.env[k]=v;}}
(async()=>{
  loadEnv();
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const s=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  const r=await s.from('blue_origin_contracts').select('id',{count:'exact',head:true}).or('customer.ilike.%SPACEX%,title.ilike.%SPACEX%,customer.ilike.%SPACE X%,title.ilike.%SPACE X%,customer.ilike.%SPACE EXPLORATION TECHNOLOGIES%,title.ilike.%SPACE EXPLORATION TECHNOLOGIES%');
  console.log(r.error?JSON.stringify(r.error):r.count);
})();
