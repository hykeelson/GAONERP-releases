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
export async function collectPortal({visit,step,registration,month,cardOnly=false,onCardSearch,onDiagnostic=()=>{},onStage=()=>{},onBusiness=()=>{},onChooseBusiness=()=>{}}){
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
 for(const kind of (cardOnly?['card']:['card','purchase','sale'])){
   await onStage(kind);
   if(kind!=='card')await visit();
   await navigateMenu(kind);
   if(kind==='card'){
     await onStage('business');
     let checks=0;
     business=await waitFor(async()=>{const n=await selected();if(n&&(!registration||registration===n))return n;if(++checks===7)await onChooseBusiness();return '';},'홈택스에서 사업장을 확인할 수 없습니다.',90000);
     await onBusiness(business);await onStage('card');
   }
   await waitFor(async()=>{
     const replies=await step('query',kind);
     if(replies.some(r=>r.ready))return true;
     if(replies.some(r=>r.monthUnavailable))throw Object.assign(Error('홈택스가 해당 조회 월을 아직 제공하지 않습니다.'),{code:'HT_MONTH_UNAVAILABLE'});
     return false;
   },'조회 월이나 매입·매출 선택 상태를 확인할 수 없습니다.');
   const rows=[];let expected,queryMode;
   for(let page=1;page<=1000;page++){
     let issue='',mismatched=false,mismatchKey='';
     const probe=async()=>{
       const replies=await step('rows',kind,page);
       const mismatch=replies.find(r=>r.outsideMonth);
       if(mismatch){const key=[mismatch.queryMode,mismatch.resultMonth,mismatch.dateBasis,mismatch.approvalMonth,mismatch.purchaseMonth].join('|');if(key!==mismatchKey){await onDiagnostic(kind,{queryMode:mismatch.queryMode,resultMonth:mismatch.resultMonth,...Object.fromEntries(['dateBasis','approvalMonth','purchaseMonth'].filter(k=>mismatch[k]).map(k=>[k,mismatch[k]]))});mismatchKey=key;}mismatched=true;issue='선택한 달과 다른 날짜가 포함되어 있습니다.';return false;}
       issue=replies.find(r=>r.problem)?.problem||issue;
       return replies.find(r=>r.ready);
     };
     const failure=()=>(kind==='card'?'사업용 카드':kind==='purchase'?'매입 계산서':'매출 계산서')+' 조회를 완료하지 못했습니다. '+(issue||'조회 결과의 전체 건수를 확인하지 못했습니다.')+' 이번 조회는 저장하지 않았습니다.';
     let read;
     try{read=await waitFor(probe,failure,60000);}
     catch(error){
       if(kind!=='card'||page!==1||!mismatched||!onCardSearch||error.message!==failure())throw error;
       if(!(await step('armCardSearch',kind)).some(r=>r.ready))throw error;
       await onCardSearch(month);
       // Accept only a new, nonempty result. An empty result cannot establish the date of a manual search.
       read=await waitFor(async()=>{
         const fresh=await probe();
         return fresh?.records?.length && fresh.total>0 ? fresh : false;
       },failure,180000);
       if(await selected()!==business)throw Error('수집 중 사업장이 달라졌습니다.');
     }
     queryMode=read.queryMode;
     expected??=read.total;
     if(expected!==read.total||expected>5000||rows.length+read.records.length>expected)throw Error('조회 중 건수가 달라졌거나 한도(5,000건)를 넘었습니다.');
     rows.push(...read.records);
     if(rows.length===expected)break;
     if(!read.records.length||!(await step('next',kind,page+1)).some(r=>r.ready))throw Error('전체 페이지를 가져오지 못했습니다.');
   }
   if(rows.length!==expected)throw Error('홈택스 전체 건수와 수집 건수가 다릅니다.');
   // Emit one month-only summary even on success, preferring a cross-month card.
   const monthOf=value=>{const d=String(value||'').replace(/[.\s/-]/g,'');return /^20\d{6}$/.test(d)?d.slice(0,4)+'-'+d.slice(4,6):undefined;};
   const dated=rows.find(r=>kind==='card'&&r['매입일자']&&monthOf(r['승인일자']||r['거래일자'])!==monthOf(r['매입일자']))||rows[0];
   if(dated){
     const approvalMonth=monthOf(dated['승인일자']||dated['거래일자']),purchaseMonth=monthOf(dated['매입일자']);
     await onDiagnostic(kind,{...(queryMode?{queryMode}:{}),resultMonth:month,dateBasis:kind==='card'?(purchaseMonth?'purchase':'approval'):'written',...(kind==='card'?{approvalMonth,...(purchaseMonth?{purchaseMonth}:{})}:{})});
   }
   result[kind]=rows;
 }
 // The homepage and invoice search may omit the selected business. Recheck it
 // on the card inquiry that explicitly names the current taxpayer.
 await onStage('verifyBusiness');await navigateMenu('card');
 await waitFor(async()=>(await selected())===business,'수집 중 사업장이 달라졌습니다.');
 return {registration:business,groups:result};
}
// Use the same attempt ID for the tray's read progress and the server's save result.
export function cardCollectionTrace({request,business,month,clientVersion,platform}) {
 const attempt=randomUUID();
 const endpoint='/api/gaon/vat?'+new URLSearchParams({hometax:'trace',month});
 let stage='automatic',seq=0;
 function report(next,diagnostic={},reason){
   stage=next;
   const {queryMode,resultMonth,dateBasis,approvalMonth,purchaseMonth}=diagnostic;
   const body=JSON.stringify({attempt,seq:++seq,stage,business,clientVersion,platform,
     queryMode,resultMonth,dateBasis,approvalMonth,purchaseMonth,reason});
   // Diagnostics must never hold up the tax portal or a ledger save.
   void Promise.resolve().then(()=>request({path:endpoint,method:'POST',headers:{'Content-Type':'application/json'},body})).catch(()=>{});
 }
 report(stage);
 return {
   attempt,
   onStage:next=>report(next),
   onDiagnostic:(next,diagnostic)=>report(next,diagnostic),
   fail(error){
     const code={HT_AUTH:'auth',HT_BUSINESS:'business',HT_PERMISSION:'permission',HT_BUSY:'busy',HT_MONTH_UNAVAILABLE:'month_unavailable'}[error?.code];
     const message=error?.message||'';
     const reason=code||[
       [/선택한 달과 다른 날짜/,'result_month_mismatch'], [/조회 월이나 매입·매출 선택/,'period_controls'],
       [/페이지/,'pagination'], [/건수/,'total'], [/창이 닫혔/,'closed']
     ].find(([pattern])=>pattern.test(message))?.[1]||'other';
     report(stage,{},reason);
   }
 };
}
let busy=false;
export async function openHomeTax({BrowserWindow,session,parent,registration,month,onStage,onDiagnostic,onBusiness,guideCardMonth,profile,background=false,cardOnly=background}){
 if(busy)throw Object.assign(Error('홈택스 가져오기가 진행 중입니다.'),{code:'HT_BUSY'});
 if(background&&!profile)throw Error('자동 수집에는 등록된 사업장이 필요합니다.');
 busy=true;let win,isolated,deadline;
 try{
   isolated=profile?.session||session.fromPartition('gaon-hometax-'+randomUUID());
   if(profile&&!profile.valid())throw Error('직원 로그인이 변경됐습니다.');
   isolated.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));

   const options={parent,show:!profile,width:1130,height:820,autoHideMenuBar:true,title:'국세청 홈택스',webPreferences:{session:isolated,backgroundThrottling:false,sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true}};
   win=new BrowserWindow(options);
   profile?.bind(win);
   if(background)deadline=setTimeout(()=>{if(!win.isDestroyed())win.destroy();},5*60000);
   const denyDownload=e=>e.preventDefault();isolated.on('will-download',denyDownload);
   win.once('closed',()=>isolated.removeListener('will-download',denyDownload));
   const secure=(wc,popups)=>{
     const guard=(event,url)=>{if(!official(event.url||url))event.preventDefault();};
     wc.on('will-navigate',guard);wc.on('will-redirect',guard);wc.on('will-attach-webview',e=>e.preventDefault());
     wc.setWindowOpenHandler(({url})=>!background&&popups&&official(url)?{action:'allow',overrideBrowserWindowOptions:{...options,show:true,parent:win}}:{action:'deny'});
     wc.on('did-create-window',child=>{secure(child.webContents,false);win.once('closed',()=>{if(!child.isDestroyed())child.destroy();});});
   };
   secure(win.webContents,true);
   let lastReady=false,openedForAuth=false,loginChecks=0;
   const entryLinks=[];let entryStarted=0;
   let queryFrame;
   const step=async(op,kind,page)=>{
     if(profile&&!profile.valid())throw Error('직원 로그인이 변경됐습니다.');
     if(win.isDestroyed())throw Error('홈택스 창이 닫혔습니다.');
     const out=[];
     for(const frame of win.webContents.mainFrame.framesInSubtree){
       if(!official(frame.url))continue;
       const frameKey=frame.frameTreeNodeId??frame;
       if(['rows','next','armCardSearch'].includes(op)&&frameKey!==queryFrame)continue;
       const args=JSON.stringify({op,kind,page,registration,month});
       const code='('+official.toString()+')(location.href)?('+homeTaxStep.toString()+')('+args+'):{}';
       const contents=win.webContents;
       const run=frame===contents.mainFrame?contents.executeJavaScriptInIsolatedWorld(301,[{code}]):frame.executeJavaScript(code);
       const r=await run.catch(()=>null);
       if(r?.ready&&op==='query')queryFrame=frameKey;
       if(r)out.push(r);
       if(r?.ready&&op!=='login')break;
     }
     if(background&&op==='login'){
       if(out.some(r=>r.ready)){lastReady=true;loginChecks=0;}
       else if(out.some(r=>r.needsAuth))throw Object.assign(Error('홈택스에서 직접 로그인해 주세요.'),{code:'HT_AUTH'});
       else if(++loginChecks>=12)throw Error('홈택스 응답이 지연되고 있습니다.');
     }
     if(!background&&profile&&op==='login'){
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
       throw Object.assign(Error('홈택스 재인증이 필요합니다.'),{reauth:!background,code:'HT_AUTH'});
     }
     return out;
   };
   let confirmedBusiness=registration;
   for(let attempt=0;;attempt++){
     try{return await collectPortal({visit:()=>win.loadURL(home),step,registration:confirmedBusiness,month,cardOnly,onStage,onDiagnostic,
       onCardSearch:!background&&guideCardMonth?async target=>{win.show();win.focus();await guideCardMonth(win,target);}:undefined,
       onChooseBusiness:()=>{if(background)throw Object.assign(Error('홈택스 사업장을 확인하세요.'),{code:'HT_BUSINESS'});win.show();win.focus();},onBusiness:n=>{confirmedBusiness=n;onBusiness?.(n);if(profile)win.hide();}});}
     catch(error){if(!error.reauth||attempt>=2)throw error;lastReady=false;openedForAuth=false;loginChecks=0;entryLinks.length=0;entryStarted=0;}
   }
 }finally{clearTimeout(deadline);busy=false;if(win&&!win.isDestroyed())win.destroy();profile?.release();if(isolated&&!profile)await isolated.clearStorageData();}
}
