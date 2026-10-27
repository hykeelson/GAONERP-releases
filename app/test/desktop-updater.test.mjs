import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {startDesktopUpdater,updaterEnabled,updateFeed,UPDATE_FIRST_CHECK_MS,UPDATE_INTERVAL_MS} from '../desktop-updater.mjs';

function fakeUpdater(){
 const handlers={},calls={check:0,install:[]};
 return {calls,handlers,on(name,fn){handlers[name]=fn;},checkForUpdates(){calls.check++;return Promise.resolve({});},quitAndInstall(...args){calls.install.push(args);}};
}
function fakeTimers(){
 const queue=[];
 return {queue,setTimeout(fn,ms){queue.push({fn,ms,kind:'timeout'});return queue.length;},setInterval(fn,ms){queue.push({fn,ms,kind:'interval'});return queue.length;},clearTimeout(){},clearInterval(){}};
}
const quiet={warn(){}};

test('업데이트는 윈도우 설치본에서만 켜진다',()=>{
 assert.equal(updaterEnabled({isPackaged:true,platform:'win32'}),true);
 assert.equal(updaterEnabled({isPackaged:false,platform:'win32'}),false,'개발 실행은 끔');
 assert.equal(updaterEnabled({isPackaged:true,platform:'darwin'}),false,'맥은 서명 준비 후');
 assert.equal(updaterEnabled({isPackaged:true,platform:'win32',env:{GAON_DISABLE_UPDATES:'1'}}),false,'관리자가 끌 수 있음');
 const off=startDesktopUpdater({app:{isPackaged:false},platform:'win32',updater:fakeUpdater(),timers:fakeTimers()});
 assert.equal(off.enabled,false);
});

test('시작 10초 뒤와 4시간마다 확인하고, 받은 뒤에는 한 번만 묻는다',async()=>{
 const updater=fakeUpdater(),timers=fakeTimers(),asked=[];
 const dialog={showMessageBox:async(...args)=>{asked.push(args.at(-1));return {response:0};}};
 const handle=startDesktopUpdater({app:{isPackaged:true},platform:'win32',env:{},updater,timers,dialog,getWindow:()=>null,log:quiet});
 assert.equal(handle.enabled,true);
 assert.equal(updater.autoDownload,true);assert.equal(updater.autoInstallOnAppQuit,true);assert.equal(updater.allowPrerelease,false);assert.equal(updater.allowDowngrade,false);
 assert.deepEqual(timers.queue.map(t=>[t.kind,t.ms]),[['timeout',UPDATE_FIRST_CHECK_MS],['interval',UPDATE_INTERVAL_MS]]);
 await timers.queue[0].fn();assert.equal(updater.calls.check,1);
 await updater.handlers['update-downloaded']({version:'0.3.1'});
 await updater.handlers['update-downloaded']({version:'0.3.1'});
 assert.equal(asked.length,1,'같은 버전은 다시 묻지 않음');
 assert.match(asked[0].message,/새 버전이 준비됐어요 \(0\.3\.1\)/);
 assert.deepEqual(asked[0].buttons,['지금 다시 시작','나중에']);
 timers.queue.at(-1).fn();
 assert.deepEqual(updater.calls.install,[[false,true]],'지금 다시 시작 → 설치 후 재실행');
});

test('「나중에」를 고르면 바로 설치하지 않고 앱을 끌 때 바뀐다',async()=>{
 const updater=fakeUpdater(),timers=fakeTimers();
 startDesktopUpdater({app:{isPackaged:true},platform:'win32',env:{},updater,timers,dialog:{showMessageBox:async()=>({response:1})},getWindow:()=>null,log:quiet});
 await updater.handlers['update-downloaded']({version:'0.3.2'});
 assert.equal(updater.calls.install.length,0);assert.equal(updater.autoInstallOnAppQuit,true);
});

test('확인 실패(인터넷 끊김 등)는 창을 띄우지 않는다',async()=>{
 const updater=fakeUpdater(),timers=fakeTimers(),warned=[];let dialogs=0;
 updater.checkForUpdates=()=>Promise.reject(Error('offline'));
 const handle=startDesktopUpdater({app:{isPackaged:true},platform:'win32',env:{},updater,timers,dialog:{showMessageBox:async()=>{dialogs++;return {response:1};}},log:{warn:(...a)=>warned.push(a)}});
 assert.equal(await handle.check(),null);updater.handlers.error(Error('net'));
 assert.equal(dialogs,0);assert.equal(warned.length,2);
});

test('업데이트 주소는 공개 릴리즈 저장소 하나로 고정되고, 업데이트 코드는 이 파일에만 있다',async()=>{
 assert.deepEqual({...updateFeed},{provider:'github',owner:'hykeelson',repo:'GAONERP-releases'});
 // 로컬 ERP 저장소는 docs/ 견본, 공개 릴리즈 저장소는 맨 위 package.json
 const root=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));
 const pkg=root.name==='gaon-erp-windows'?root:JSON.parse(await readFile(new URL('../../docs/windows-release.package.json',import.meta.url),'utf8'));
 assert.deepEqual(pkg.build.publish,[{provider:'github',owner:'hykeelson',repo:'GAONERP-releases',releaseType:'release'}]);
 assert.equal(pkg.dependencies['electron-updater'],'6.8.11');
 for(const file of ['../desktop-client-main.mjs','../desktop-client-policy.mjs']){
  const source=await readFile(new URL(file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:autoUpdater|checkForUpdates|setFeedURL)\b/,file+' 에는 업데이트 코드를 두지 않음');
 }
 assert.doesNotMatch(await readFile(new URL('../desktop-updater.mjs',import.meta.url),'utf8'),/setFeedURL/,'설치본 밖 주소로 바꾸지 않음');
});
