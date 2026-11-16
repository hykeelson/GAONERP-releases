// Only a local partition reference is kept here. Chromium manages the site's storage and expiry.
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,renameSync,writeFileSync} from 'node:fs';
export function homeTaxProfileStore(session,file){
 let active,clearing=Promise.resolve();
 function saved(){
   try{const v=JSON.parse(readFileSync(file,'utf8'));return /^[a-f0-9]{64}$/.test(v?.scope)&&/^[0-9a-f-]{36}$/.test(v?.id)?v:null;}
   catch(e){if(e.code==='ENOENT')return null;throw e;}
 }
 function write(value){writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});renameSync(file+'.tmp',file);}
 const partition=id=>session.fromPartition('persist:gaon-hometax-'+id,{cache:false});
 function clear(){
   const old=active||saved();
   if(!old)return clearing;
   write(null);active=undefined;old.cancel?.();
   const ses=partition(old.id);
   clearing=Promise.all([clearing.catch(()=>{}),ses.clearStorageData(),ses.clearCache(),ses.clearAuthCache()]).then(()=>{});
   return clearing;
 }
 function acquire(org,actor){
   if(typeof org!=='string'||!org||typeof actor!=='string'||!actor)throw Error('직원과 조직을 확인하세요.');
   const scope=createHash('sha256').update(JSON.stringify([org,actor])).digest('hex');
   const last=active||saved();
   if(last&&last.scope!==scope)clear().catch(()=>{});
   if(!active){
     const ref=last?.scope===scope?last:{id:randomUUID(),scope};
     write({id:ref.id,scope});active={...ref};
   }
   const owner=active;
   return {session:partition(owner.id),valid:()=>owner===active,
     bind(win){if(owner!==active)throw Error('직원 로그인이 변경됐습니다.');owner.cancel=()=>{if(!win.isDestroyed())win.destroy();};},
     release(){delete owner.cancel;}};
 }
 return {acquire,clear};
}

// The opted-in Windows PC uses the same authorized ledger endpoint as manual imports.
export function homeTaxDailyImport({file,access,collect,commit,now=Date.now,onPause=()=>{}}){
 const scope=({org,actor})=>createHash('sha256').update(JSON.stringify([org,actor])).digest('hex');
 let job=null,verified=null,running=false;
 try{
   const saved=JSON.parse(readFileSync(file,'utf8'));
   if(saved&&/^[a-f0-9]{64}$/.test(saved.owner)&&/^\d{10}$/.test(saved.registration))job=saved;
 }catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
 function persist(value){
   writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});renameSync(file+'.tmp',file);job=value;
 }
 function disable(){if(job)persist(null);}
 function clear(){verified=null;disable();}
 function manual(identity,registration){
   if(!/^\d{10}$/.test(registration))return;
   if(job&&job.owner!==scope(identity))clear();
   verified={owner:scope(identity),registration};
   if(job?.owner===verified.owner&&job.registration===registration&&job.paused)
     persist({...job,paused:'',retryAt:0});
 }
 function settings(identity){
   const owner=scope(identity);
   return {enabled:job?.owner===owner,registration:job?.owner===owner?job.registration:verified?.owner===owner?verified.registration:'',
     months:job?.owner===owner?Object.values(job.months||{}):[],last:job?.owner===owner?job.last:null,paused:job?.owner===owner?job.paused:'',retryAt:job?.owner===owner?job.retryAt:0};
 }
 function enable(identity,registration){
   const owner=scope(identity);
   if(verified?.owner!==owner||verified.registration!==registration)throw Error('먼저 해당 사업자로 홈택스 자료를 한 번 가져오세요.');
   persist({owner,registration,day:'',retryAt:0,paused:'',last:null});
 }
 async function tick(){
   const started=now(),day=new Date(started+9*3600000).toISOString().slice(0,10);
   if(running||!job||job.paused)return;
   const previous=new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7))-2,1)).toISOString().slice(0,7);
   const months=[previous,day.slice(0,7)];
   // A legacy 0.3.8 success only covers its recorded month.
   const entries=Object.fromEntries(months.map(m=>[m,job.months?.[m]||((job.last?.month===m)?job.last:{})]));
   let current=job;
   const save=patch=>{persist({...current,...patch,months:{...entries}});current=job;};
   running=true;
   try{
     for(const month of months){
       const entry=entries[month];
       if(entry.day===day||entry.retryAt>started)continue;
       try{
         const actor=await access();
         if(job!==current)return;
         if(scope(actor)!==current.owner){clear();return;}
         const data=await collect(actor,current.registration,month);
         if(job!==current)return;
         if(data.registration!==current.registration)throw Object.assign(Error(),{code:'HT_BUSINESS'});
         const next=await access();
         if(job!==current)return;
         if(scope(next)!==current.owner){clear();return;}
         const {added,duplicate}=await commit(next,month,data);
         if(job!==current)return;
         if(!Number.isSafeInteger(added)||added<0||!Number.isSafeInteger(duplicate)||duplicate<0)throw Error('저장 결과를 확인하지 못했습니다.');
         entries[month]={day,month,added,duplicate};
         save({last:entries[month]});
       }catch(e){
         if(job!==current)return;
         const reason={HT_AUTH:'홈택스 재인증',HT_BUSINESS:'홈택스 사업장 확인',HT_PERMISSION:'가온 재무 권한 확인',HT_CONFLICT:'이전 장부와 원본 대조'}[e.code];
         if(reason){save({paused:reason,retryAt:0});onPause(reason);return;}
         entries[month]=e.code==='HT_MONTH_UNAVAILABLE'?{month,day,unavailable:true}:{month,retryAt:now()+(e.code==='HT_BUSY'?60000:30*60000)};
         save({});
       }
     }
     const retryAt=Math.max(...months.map(m=>entries[m].retryAt||0));
     const completed=months.every(m=>entries[m].day===day)?day:'';
     if(job===current&&(current.day!==completed||current.retryAt!==retryAt))save({day:completed,retryAt});
   }finally{running=false;}
 }
 return {settings,enable,disable,manual,tick,clear};
}
