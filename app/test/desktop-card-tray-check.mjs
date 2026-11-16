// Run the real desktop main process in an isolated profile with a synthetic portal and file-backed ledger.
import assert from 'node:assert/strict';
import {app,BrowserWindow,session,safeStorage,Menu} from 'electron';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {homeTaxProfileStore,homeTaxDailyImport} from '../desktop-hometax-session.mjs';
import {desktopCloudOrigin,desktopCloudAPI,createDesktopCredentialStore} from '../desktop-cloud-session.mjs';
import {portal} from './gaon-hometax-fixture.mjs';

const dir=await mkdtemp(join(tmpdir(),'gaon-tray-test-'));
app.setPath('userData',dir);
const clock=Date.now,base=clock();
let simulated=Date.parse('2026-10-04T12:00:00+09:00');
Date.now=()=>simulated+clock()-base;
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
async function until(predicate,timeout){
 const end=clock()+timeout;
 while(clock()<end){const value=await predicate();if(value)return value;await delay(200);}
 throw Error('Windows tray check timed out');
}
const business='0000000000',identity={actor:'test-employee',org:'test-org'};
const file=join(dir,'hometax-daily.json');
const stub=homeTaxDailyImport({file});stub.manual(identity,business);stub.enable(identity,business);
let db,main,shown=0,reads=0;
const results=[];
let additionalCard=false;
// Let Electron finish loading its ES module entry point before waiting for ready.
app.whenReady().then(async()=>{
 console.log('Electron ready: loading the temporary card ledger');
 const watchdog=setTimeout(()=>{console.error('Windows tray fixture deadline');app.exit(1);},260000);
 try{
 db=new DatabaseSync(join(dir,'temporary-ledger.sqlite'));
 db.exec('create table cards(month text, row_id text, primary key(month,row_id))');
 const profile=homeTaxProfileStore(session,join(dir,'hometax-profile.json')).acquire(identity.org,identity.actor);
 profile.session.protocol.handle('https',req=>{
   assert.equal(new URL(req.url).hostname,'www.hometax.go.kr');
   reads++;console.log('Synthetic portal opened',reads,'late transaction',additionalCard);
   const html='<header title="사업자">000-00-00000 <button>로그아웃</button></header><div id="menus"></div><div id="body"></div><script>('+portal.toString()+')('+JSON.stringify({wrongMonth:false,additionalCard})+')</script>';
   return new Response(html,{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store'}});
 });
 const cloud=session.fromPartition('persist:gaon-erp-client');
 const store=createDesktopCredentialStore({safeStorage,file:join(dir,'cloud-session.bin')});
 await store.write('synthetic-tray-session');
 // Only fixture responses. The isolated profile cannot contact GAON or the tax service.
 cloud.protocol.handle('https',async req=>{
   const u=new URL(req.url);
   if(u.origin===desktopCloudOrigin)return new Response('<html><title>GAON ERP</title>TEST</html>',{headers:{'content-type':'text/html'}});
   if(!req.url.startsWith(desktopCloudAPI+'/api/gaon/'))return new Response(null,{status:404});
   if(u.pathname.endsWith('/auth/status'))return Response.json(req.headers.has('Authorization')?{signedIn:true,role:'admin',actor:{id:identity.actor}}:{signedIn:false,googleEnabled:true});
   if(u.pathname.endsWith('/auth/refresh'))return Response.json({accessToken:'synthetic-access',refreshToken:'synthetic-refresh',expiresAt:Date.now()+3*86400000});
   if(u.searchParams.get('hometax')==='access')return Response.json(identity);
   if(u.searchParams.get('hometax')!=='cards')return new Response(null,{status:404});
   const data=await req.json(),month=u.searchParams.get('month');
   console.log('Synthetic card submission',month,data.groups.card.length);
   assert.ok(['2026-09','2026-10'].includes(month));assert.equal(data.org,identity.org);assert.equal(data.actor,identity.actor);
   assert.deepEqual(Object.keys(data.groups),['card']);assert.equal(data.groups.card.length,additionalCard&&month==='2026-10'?3:2);
   assert.ok(main&&!main.isVisible()&&!main.isDestroyed());
   assert.ok(BrowserWindow.getAllWindows().every(w=>!w.isVisible()));
   const occurrences=new Map();let added=0;
   for(const row of data.groups.card){
     const value=JSON.stringify(row),ordinal=1+(occurrences.get(value)||0);
     occurrences.set(value,ordinal);
     added+=Number(db.prepare('insert or ignore into cards values(?,?)').run(month,value+'#'+ordinal).changes);
   }
   const result={added,duplicate:data.groups.card.length-added};results.push({month,...result});return Response.json(result);
 });
 app.on('browser-window-created',(_event,win)=>{
   if(!main)main=win;
   else win.on('show',()=>shown++);
 });
 await import('../desktop-client-main.mjs');
 console.log('GAON main process loaded');
 await until(()=>main?.webContents.getURL().startsWith(desktopCloudOrigin)&&main.isVisible(),30000);
 assert.ok(Menu.getApplicationMenu().items[0].submenu.items.some(i=>i.label.includes('카드 자동 수집')));
 main.close();assert.ok(!main.isVisible()&&!main.isDestroyed());
 console.log('Windows main window closed to tray');
 async function completed(day){
   return until(async()=>{const prefs=JSON.parse(await readFile(file));return prefs.day===day&&prefs.last;},120000).catch(async error=>{
     const {day:storedDay,months,paused}=JSON.parse(await readFile(file));
     console.error('Unfinished synthetic day',day,{storedDay,months,paused,results,shown,reads});throw error;
   });
 }
 const first=await completed('2026-10-04');assert.equal(first.added,2);
 const monthRows=month=>db.prepare('select row_id from cards where month=? order by row_id').all(month).map(row=>row.row_id);
 const initial=monthRows('2026-10'),previous=monthRows('2026-09');
 assert.equal(initial.length,2);assert.equal(previous.length,2);
 additionalCard=true;
 simulated+=86400000;
 const second=await completed('2026-10-05');assert.equal(second.added,1);
 const current=monthRows('2026-10'),delta=current.filter(row=>!initial.includes(row));
 assert.equal(current.length,3);assert.equal(delta.length,1);assert.match(delta[0],/TEST 신규 가맹점/);
 simulated+=86400000;
 const third=await completed('2026-10-06');assert.equal(third.added,0);
 assert.deepEqual(monthRows('2026-09'),previous);assert.deepEqual(monthRows('2026-10'),current);
 assert.deepEqual(results.map(row=>[row.month,row.added,row.duplicate]),[
   ['2026-09',2,0],['2026-10',2,0],['2026-09',0,2],['2026-10',1,2],['2026-09',0,2],['2026-10',0,3]
 ]);
 assert.equal(shown,0);assert.ok(reads>=3);
 console.log(JSON.stringify({platform:process.platform,trayHidden:!main.isVisible(),authenticationWindows:shown,first:results[1],late:results[3],recheck:results[5],stored:current.length+previous.length}));
 db.close();app.exit(0);
 }catch(e){console.error(e.stack);app.exit(1);}finally{clearTimeout(watchdog);}
});
