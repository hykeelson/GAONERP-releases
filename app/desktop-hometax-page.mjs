// Runs in an isolated world on the official portal. Only named, read-only controls are used.
export function homeTaxStep({op,kind,month,registration,page=1}) {
 const trim=v=>String(v??'').replace(/\s+/g,' ').trim();
 const compact=v=>trim(v).replace(/\s/g,'');
 const visible=e=>e?.getClientRects().length && getComputedStyle(e).visibility!=='hidden';
 const all=s=>Array.from(document.querySelectorAll(s)).filter(visible);
 const title=e=>trim(e.innerText || e.getAttribute('aria-label') || e.getAttribute('title') || (e.type==='button'||e.type==='submit'?e.value:''));
 const controls=()=>all('a,button,input[type=button],input[type=submit],[role=button]');
 const named=(names)=>controls().find(e=>names.some(n=>compact(title(e))===compact(n)));
 const click=names=>{const e=named(names);if(!e || e.disabled || e.getAttribute('aria-disabled')==='true')return false;e.click();return true;};
 const card=kind==='card';
 const menus=card?['사업용 신용카드 매입세액 공제 확인/변경','매입세액 공제 확인/변경']:['전자(세금)계산서 월/분기별 목록조회','월/분기별 목록조회'];
 const labels=e=>compact([e.getAttribute('title'),e.getAttribute('aria-label'),...(Array.from(e.labels||[]).map(l=>l.textContent))].filter(Boolean).join(' '));
 const signal=e=>{e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
 const choice=(s,value)=>{const option=Array.from(s.options).find(o=>value(compact(o.textContent),o.value));if(!option)return false;if(s.value!==option.value){s.value=option.value;signal(s);}return true;};
 const selectedBusiness=()=>{
   const ids=new Set();
   for(const e of all('select, [title*="사업자"], [aria-label*="사업자"], [id*="bsno" i],#mf_txppWframe_bmanTxprNo,header,.header,[id*="wfHeader"]')){
     if(e.type==='password'||(e.tagName==='SELECT'&&!/사업자|사업장/.test(labels(e))&&!e.closest('header,.header')))continue;
     if(e.tagName!=='SELECT'&&e.querySelector('select'))continue;
     const value=e.tagName==='SELECT'?e.selectedOptions[0]?.textContent:e.tagName==='INPUT'?e.value:e.innerText;
     const numbers=(String(value||'').match(/\b\d{3}-?\d{2}-?\d{5}\b/g)||[]).map(n=>n.replaceAll('-',''));
     for(const n of numbers)ids.add(n);
   }
   return ids.size===1?[...ids][0]:'';
 };
 const signedIn=controls().some(e=>[title(e),e.title,e.getAttribute('aria-label'),e.querySelector('img[alt]')?.alt].some(v=>compact(v)==='로그아웃'));
 const expired=all('[role=alert],[role=dialog],.w2window').some(e=>/로그인(정보가없습니다|시간이만료|이필요합니다)|자동로그아웃되었습니다/.test(compact(e.innerText)));
 const needsAuth=expired||(!signedIn&&!!named(['로그인','공동·금융인증','아이디 로그인','간편인증 로그인']));
 if(op==='login')return {ready:signedIn&&!expired,needsAuth,business:signedIn&&!expired?selectedBusiness():''};
 if(op==='certificateEntry'){
   if(signedIn||expired)return {};
   const link=document.getElementById('mf_txppWframe_anchor22');
   const section=document.getElementById('mf_txppWframe_anchor13');
   const entry=document.getElementById('mf_wfHeader_group1503');
   // Open only the portal's login choices. Its own certificate provider handles signing.
   const target=visible(section)&&compact(title(section))==='공동·금융인증'
     ? (visible(link)&&compact(title(link))==='공동·금융인증서'?link:section)
     : (visible(entry)&&entry.closest('header')&&compact(title(entry))==='로그인'?entry:null);
   if(target?.tagName!=='A'||page.includes(target.id)||target.getAttribute('aria-disabled')==='true')return {};
   target.click();return {ready:true,id:target.id};
 }
 if(needsAuth)return {needsAuth:true};
 if(op==='menu'){
   // The freight welfare card screen has the exact same short Korean title.
   const id=card?'menuAtag_4608020100':'menuAtag_4609050300';
   const link=document.getElementById(id);
   if(link?.tagName==='A'&&menus.some(name=>compact(name)===compact(title(link)||link.textContent))){link.click();return {ready:true};}
   const matches=controls().filter(e=>menus.some(name=>compact(name)===compact(title(e))));
   if(matches.length===1&&(!card||compact(matches[0].parentElement.parentElement.textContent).includes('사업용신용카드'))){matches[0].click();return {ready:true};}
   return {};
 }
 if(op==='expand')return {ready:click(['전체메뉴','전체 메뉴 열기','전체메뉴 보기'])};
 if(op==='query'){
   if(!named(['조회하기','조회']))return {};
   // Only act on the intended inquiry screen; unrelated "조회" controls are common in the portal.
   const heads=all('h1,h2,h3,h4,caption,.pageTitle,.page-title,[class*="tit"]').map(e=>compact(e.textContent)).filter(s=>s.length<90);
   if(!heads.some(s=>card?/매입세액공제확인/.test(s):/월.?분기별목록조회|전자.*계산서.*목록조회/.test(s)))return {};
   const radio=name=>{const e=all('input[type=radio]').find(r=>(compact(r.title)===name||Array.from(r.labels||[]).some(l=>compact(l.textContent)===name)));if(!e)return false;if(!e.checked)e.click();return e.checked;};
   if(!card&&!radio(kind==='purchase'?'매입':'매출'))return {};
   radio('월별');
   const [y,m]=month.split('-'), sels=all('select');
   const year=sels.find(e=>/년|연도/.test(labels(e))&&Array.from(e.options).some(o=>compact(o.textContent)===y+'년'||o.value===y));
   const mo=sels.find(e=>/월/.test(labels(e))&&Array.from(e.options).some(o=>/^0?1월?$/.test(compact(o.textContent))));
   const ym=all('input').find(e=>e.type==='month'||(e.type==='text'&&/조회년월|조회연월|조회월|거래년월/.test(labels(e))));
   const combined=sels.find(e=>/년월|연월/.test(labels(e))&&Array.from(e.options).some(o=>o.textContent.replace(/\D/g,'')===y+m));
   if(combined){if(!choice(combined,t=>t.replace(/\D/g,'')===y+m))return {};}
   else if(year&&mo){if(!choice(year,(t,v)=>v===y||t===y+'년')||!choice(mo,(t,v)=>Number(v)===Number(m)||t===Number(m)+'월'||t===m+'월'))return {};}
   else if(ym){const sep=ym.type==='month'||ym.value.includes('-')?'-':ym.value.includes('.')?'.':'';ym.value=y+sep+m;signal(ym);if(ym.value.replace(/\D/g,'')!==y+m)return {};}
   else {
     const dates=all('input').filter(e=>['date','text'].includes(e.type));
     const from=dates.find(e=>/시작일|조회기간시작|조회시작/.test(labels(e))),to=dates.find(e=>/종료일|조회기간종료|조회종료/.test(labels(e)));
     if(!from||!to)return {};
     const setDate=(input,d)=>{const sep=input.type==='date'||input.value.includes('-')?'-':input.value.includes('.')?'.':'';
       input.value=[y,m,d].join(sep);signal(input);return input.value.replace(/\D/g,'')===y+m+d;};
     if(!setDate(from,'01')||!setDate(to,String(new Date(Number(y),Number(m),0).getDate())))return {};
   }
   const watch=Symbol.for('gaon.hometax.watch');globalThis[watch]?.disconnect();
   const state={changed:false,started:Date.now()};
   const observer=new MutationObserver(entries=>{if(entries.some(ent=>[ent.target,...ent.addedNodes].some(n=>(n.parentElement?.closest('tbody,[role=rowgroup]')||n.nodeType===1&&(n.closest('tbody,[role=rowgroup]')||n.matches('tbody,table,[role=grid]')||n.querySelector('tbody'))))))state.changed=true;});
   observer.observe(document.body,{childList:true,characterData:true,subtree:true});
   globalThis[watch]=observer;globalThis[Symbol.for('gaon.hometax.result')]=state;
   return {ready:click(['조회하기','조회'])};
 }
 if(op==='next'){
   const link=named([String(page),page+' 페이지',page+'페이지','다음 페이지']);
   if(!link||!link.closest('nav,[class*="pag" i],[class*="paging" i],[role=navigation]'))return {};
   globalThis[Symbol.for('gaon.hometax.result')].changed=false;link.click();return {ready:true};
 }
 if(op==='rows'&&page>1&&!all('[aria-current=page],.w2pageList_selected,.w2page_link.active,[class*="paging"] .active').some(e=>parseInt(e.textContent,10)===page))return {};
 if(op!=='rows'||!globalThis[Symbol.for('gaon.hometax.result')]?.changed)return {};
 const readCounts=table=>{
   // The official invoice pager has a numeric span, separate from the invoice grid.
   const totalLabel=document.getElementById('mf_txppWframe_txtTotal');
   const pager=document.getElementById('mf_txppWframe_grpNavi');
   if((card&&totalLabel)||(table===liveGrid&&pager)){
     if(!visible(totalLabel)||(!card&&!pager.contains(totalLabel)))return [];
     const raw=trim(totalLabel.textContent);
     return /^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(raw)?[Number(raw.replaceAll(',',''))]:[];
   }
   const format=/^(?:총\s*(?:조회\s*)?(?:건수)?|조회\s*건수|전체\s*건수)\s*[:：]?\s*([\d,]+)\s*건(?:\s|$)/;
   for(let box=table.parentElement;box;box=box.parentElement){
     const counts=[];
     for(const label of box.querySelectorAll('span,strong,p,div')){
       if(!visible(label)||label.closest('table'))continue;
       const value=trim(label.textContent);if(value.length>=44)continue;
       const match=value.match(format);if(match)counts.push(Number(match[1].replaceAll(',','')));
     }
     if(counts.length)return counts;
   }
   return [];
 };
 const liveGrid=document.getElementById(card?'mf_txppWframe_grdCshpt_body_table':'mf_txppWframe_resultGrid_body_table');
 const tables=visible(liveGrid)?[liveGrid]:all('table');
 for(const table of tables){
   let headers=Array.from(table.querySelectorAll('thead tr:last-child th')).map(e=>compact(e.innerText||e.textContent).replace(/\(종사업장번호\)$/,''));
   if(!headers.length)headers=Array.from(table.querySelectorAll('tr:first-child th')).map(e=>compact(e.textContent));
   if(!(card?headers.some(h=>h==='승인일자'||h==='거래일자'):headers.includes('승인번호')))continue;
   const records=[];
   for(const tr of table.querySelectorAll('tbody tr')){
     const cells=Array.from(tr.cells);
     if(!cells.length||cells.every(c=>c.tagName==='TH')||(!trim(tr.textContent)&&tr.getAttribute('aria-hidden')==='true')||/조회된.*없|조회.*없습니다/.test(tr.textContent))continue;
     if(cells.length!==headers.length)return {problem:'표의 열을 확인할 수 없습니다.'};
     const record={};
     let side='';
     headers.forEach((h,i)=>{
       if(!card&&/^공급(자|받는자)(사업자)?등록번호$/.test(h))side=h.startsWith('공급받는자')?'공급받는자':'공급자';
       const key=(!card&&side&&headers.filter(v=>/^상호/.test(v)).length>1&&/^상호(\(법인명\))?$/.test(h))?side+h:h;
       if(!/^(승인일자|거래일자|작성일자?|승인번호|거래내역일련번호|카드사명?|카드번호|가맹점명|가맹점사업자(등록)?번호|(공급자|공급받는자)?상호(\(법인명\))?|(공급자|공급받는자)(사업자)?등록번호|공급가액|세액|부가세|부가가치세|합계금액|합계|총금액|사용금액)$/.test(key))return;
       const input=cells[i].querySelector(':scope > nobr');
       const val=input?trim(Array.from(input.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join('')||input.innerText):trim(cells[i].innerText);record[key]=key==='카드번호'?val.replace(/[^0-9*]/g,'').slice(-4):val;
     });
     const day=String(record[card?'승인일자':'작성일자']||record[card?'거래일자':'작성일']||'').replace(/[.\s/-]/g,'');
     if(/^\d{8}$/.test(day)&&day.slice(0,6)!==month.replace('-','')&&Date.now()-globalThis[Symbol.for('gaon.hometax.result')].started>2500)return {outsideMonth:true};
     if(!/^\d{8}$/.test(day)||day.slice(0,6)!==month.replace('-','')||!(/^-?[\d,]+$/.test(record['합계금액']||record['합계']||record['사용금액']||record['총금액']||'')))return {};
     records.push(record);
   }
   const counts=readCounts(table);
   if(!counts.length)return {problem:'조회 결과의 전체 건수를 확인할 수 없습니다.'};
   const distinct=new Set(counts);if(distinct.size!==1)return {problem:'조회 건수가 여러 개여서 범위를 확인할 수 없습니다.'};
   const total=[...distinct][0];
   if(liveGrid&&(!total||!records.length)){
     const explicitEmpty=all('[id*="noresult" i],[class*="noresult" i],[class*="noResult"],td,[role="status"],.w2window').some(e=>/조회(된|한|할)?(자료|데이터|결과|내역)(가|이)?없/.test(compact(e.innerText)));
     if(total!==0||records.length||!explicitEmpty||Date.now()-globalThis[Symbol.for('gaon.hometax.result')].started<2000)return {};
   }
   return {ready:true,records,total};
 }
 return {};
}
