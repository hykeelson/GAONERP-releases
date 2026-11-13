import {randomUUID} from 'node:crypto';
import {homeTaxStep} from './desktop-hometax-page.mjs';

export const home='https://www.hometax.go.kr/';
export const official=value=>{
 try{const u=new URL(value);return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&/(^|\.)hometax\.go\.kr$/.test(u.hostname);}catch{return false;}
};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(probe,error,timeout=16000,interval=350){
 const end=Date.now()+timeout;
 do{const result=await probe();if(result)return result;await pause(interval);}while(Date.now()<end);
 throw Error(typeof error==='function'?error():error);
}
export async function collectPortal({visit,step,registration,month,onStage=()=>{},onBusiness=()=>{},onChooseBusiness=()=>{}}){
 if((registration!==''&&!/^\d{10}$/.test(registration))||!/^20\d\d-(0[1-9]|1[0-2])$/.test(month))throw Error('사업자번호와 조회 월을 확인하세요.');
 await visit();await onStage('login');await waitFor(async()=> (await step('login')).some(r=>r.ready),'홈택스 로그인 상태를 확인할 수 없습니다.',Infinity,1200);
 const selected=async()=>{const ids=new Set((await step('login')).map(r=>r.business).filter(Boolean));return ids.size===1?[...ids][0]:'';};
 const navigateMenu=async kind=>{
   let expanded=false;
   await waitFor(async()=>{
     if((await step('menu',kind)).some(r=>r.ready))return true;
     if(!expanded)expanded=(await step('expand',kind)).some(r=>r.ready);
   },'홈택스 조회 메뉴를 찾지 못했습니다.');
 };
 let business='';
 const result={};
 for(const kind of ['card','purchase','sale']){
   await onStage(kind);
   if(kind!=='card')await visit();
   await navigateMenu(kind);
   if(kind==='card'){
     await onStage('business');
     let checks=0;
     business=await waitFor(async()=>{const n=await selected();if(n&&(!registration||registration===n))return n;if(++checks===7)await onChooseBusiness();return '';},'홈택스에서 사업장을 확인할 수 없습니다.',90000);
     await onBusiness(business);await onStage('card');
   }
   await waitFor(async()=>(await step('query',kind)).some(r=>r.ready),'조회 월이나 매입·매출 선택 상태를 확인할 수 없습니다.');
   const rows=[];let expected;
   for(let page=1;page<=1000;page++){
     let issue='';
     const read=await waitFor(async()=>{
       const replies=await step('rows',kind,page);
       if(replies.some(r=>r.outsideMonth))throw Error('선택한 달과 다른 날짜가 포함되어 있습니다.');
       issue=replies.find(r=>r.problem)?.problem||issue;
       return replies.find(r=>r.ready);
     },()=>(kind==='card'?'사업용 카드':kind==='purchase'?'매입 계산서':'매출 계산서')+' 조회를 완료하지 못했습니다. '+(issue||'조회 결과의 전체 건수를 확인하지 못했습니다.')+' 이번 조회는 저장하지 않았습니다.',60000);
     expected??=read.total;
     if(expected!==read.total||expected>5000||rows.length+read.records.length>expected)throw Error('조회 중 건수가 달라졌거나 한도(5,000건)를 넘었습니다.');
     rows.push(...read.records);
     if(rows.length===expected)break;
     if(!read.records.length||!(await step('next',kind,page+1)).some(r=>r.ready))throw Error('전체 페이지를 가져오지 못했습니다.');
   }
   if(rows.length!==expected)throw Error('홈택스 전체 건수와 수집 건수가 다릅니다.');
   result[kind]=rows;
 }
 // The homepage and invoice search may omit the selected business. Recheck it
 // on the card inquiry that explicitly names the current taxpayer.
 await navigateMenu('card');
 await waitFor(async()=>(await selected())===business,'수집 중 사업장이 달라졌습니다.');
 return {registration:business,groups:result};
}
let busy=false;
export async function openHomeTax({BrowserWindow,session,parent,registration,month,onStage,profile}){
 if(busy)throw Error('홈택스 가져오기가 진행 중입니다.');
 busy=true;let win,isolated;
 try{
   isolated=profile?.session||session.fromPartition('gaon-hometax-'+randomUUID());
   if(profile&&!profile.valid())throw Error('직원 로그인이 변경됐습니다.');
   isolated.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));

   const options={parent,show:!profile,width:1130,height:820,autoHideMenuBar:true,title:'국세청 홈택스',webPreferences:{session:isolated,backgroundThrottling:false,sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true}};
   win=new BrowserWindow(options);
   profile?.bind(win);
   const denyDownload=e=>e.preventDefault();isolated.on('will-download',denyDownload);
   win.once('closed',()=>isolated.removeListener('will-download',denyDownload));
   const secure=(wc,popups)=>{
     const guard=(event,url)=>{if(!official(event.url||url))event.preventDefault();};
     wc.on('will-navigate',guard);wc.on('will-redirect',guard);wc.on('will-attach-webview',e=>e.preventDefault());
     wc.setWindowOpenHandler(({url})=>popups&&official(url)?{action:'allow',overrideBrowserWindowOptions:{...options,show:true,parent:win}}:{action:'deny'});
     wc.on('did-create-window',child=>{secure(child.webContents,false);win.once('closed',()=>{if(!child.isDestroyed())child.destroy();});});
   };
   secure(win.webContents,true);
   let lastReady=false,openedForAuth=false,loginChecks=0;
   const entryLinks=[];let entryStarted=0;
   const step=async(op,kind,page)=>{
     if(profile&&!profile.valid())throw Error('직원 로그인이 변경됐습니다.');
     if(win.isDestroyed())throw Error('홈택스 창이 닫혔습니다.');
     const out=[];
     for(const frame of win.webContents.mainFrame.framesInSubtree){
       if(!official(frame.url))continue;
       const args=JSON.stringify({op,kind,page,registration,month});
       const code='('+official.toString()+')(location.href)?('+homeTaxStep.toString()+')('+args+'):{}';
       const contents=win.webContents;
       const run=frame===contents.mainFrame?contents.executeJavaScriptInIsolatedWorld(301,[{code}]):frame.executeJavaScript(code);
       const r=await run.catch(()=>null);
       if(r)out.push(r);
       if(r?.ready&&op!=='login')break;
     }
     if(profile&&op==='login'){
       const ready=out.some(r=>r.ready);
       if(!ready && (entryStarted||out.some(r=>r.needsAuth)||++loginChecks>=4) && !lastReady && !openedForAuth){
         entryStarted ||= Date.now();
         if(Date.now()-entryStarted<6500){
           const moved=(await step('certificateEntry',undefined,entryLinks)).find(r=>r.ready);
           if(moved){entryLinks.push(moved.id);await onStage?.('certificateLoginStarted');return out;}
           // Allow the destination to render after the official menu click.
           if(entryLinks.length&&!entryLinks.includes('mf_txppWframe_anchor22'))return out;
         }
         win.show();win.focus();openedForAuth=true;await onStage?.('authenticationRequired');
       }
       if(ready&&!lastReady){
         if(openedForAuth)win.hide();
         await onStage?.(openedForAuth||entryLinks.length?'authenticated':'sessionReused');
         lastReady=true;loginChecks=0;
       }
     }
     if(profile&&lastReady&&out.some(r=>r.needsAuth)&&!out.some(r=>r.ready)){
       throw Object.assign(Error('홈택스 재인증이 필요합니다.'),{reauth:true});
     }
     return out;
   };
   let confirmedBusiness=registration;
   for(let attempt=0;;attempt++){
     try{return await collectPortal({visit:()=>win.loadURL(home),step,registration:confirmedBusiness,month,onStage,
       onChooseBusiness:()=>{win.show();win.focus();},onBusiness:n=>{confirmedBusiness=n;if(profile)win.hide();}});}
     catch(error){if(!error.reauth||attempt>=2)throw error;lastReady=false;openedForAuth=false;loginChecks=0;entryLinks.length=0;entryStarted=0;}
   }
 }finally{busy=false;if(win&&!win.isDestroyed())win.destroy();profile?.release();if(isolated&&!profile)await isolated.clearStorageData();}
}
