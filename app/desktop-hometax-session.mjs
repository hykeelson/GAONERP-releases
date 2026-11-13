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
