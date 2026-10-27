// 윈도우 설치본 자동 업데이트 (2026-10-27 사용자 요청).
// 업데이트 파일은 공개 저장소 hykeelson/GAONERP-releases 의 GitHub Releases 에서만 받는다(주소는 설치본의 app-update.yml 에 고정).
// 맥은 애플 서명·공증이 준비되면 켠다. 개발 실행에서는 동작하지 않는다.
import {createRequire} from 'node:module';

export const updateFeed=Object.freeze({provider:'github',owner:'hykeelson',repo:'GAONERP-releases'});
export const UPDATE_FIRST_CHECK_MS=10_000;
export const UPDATE_INTERVAL_MS=4*60*60*1000;

export function updaterEnabled({isPackaged,platform,env={}}){
 return !!isPackaged&&platform==='win32'&&env.GAON_DISABLE_UPDATES!=='1';
}

function loadUpdater(){return createRequire(import.meta.url)('electron-updater').autoUpdater;}

export function startDesktopUpdater({app,dialog,getWindow,platform=process.platform,env=process.env,updater,timers=globalThis,log=console}={}){
 if(!updaterEnabled({isPackaged:app?.isPackaged,platform,env}))return {enabled:false,stop(){},check:async()=>null};
 const autoUpdater=updater||loadUpdater();
 autoUpdater.autoDownload=true;
 autoUpdater.autoInstallOnAppQuit=true;
 autoUpdater.allowPrerelease=false;
 autoUpdater.allowDowngrade=false;
 autoUpdater.logger=null;
 let asked='',stopped=false;
 const check=()=>stopped?Promise.resolve(null):Promise.resolve().then(()=>autoUpdater.checkForUpdates()).catch(error=>{log.warn?.('GAON 업데이트 확인 실패:',error?.message||error);return null;});
 // 인터넷이 끊겼거나 GitHub 이 응답하지 않는 건 흔한 일이라 창을 띄우지 않고 다음 확인을 기다린다.
 autoUpdater.on('error',error=>log.warn?.('GAON 업데이트 오류:',error?.message||error));
 autoUpdater.on('update-downloaded',async info=>{
  const version=String(info?.version||'');
  if(stopped||asked===version)return;
  asked=version;
  const window=getWindow?.();
  const options={type:'info',title:'GAON ERP 업데이트',message:`새 버전이 준비됐어요${version?` (${version})`:''}.`,detail:'지금 다시 시작하면 바로 바뀝니다. 나중에 하면 앱을 끌 때 자동으로 바뀝니다.',buttons:['지금 다시 시작','나중에'],defaultId:0,cancelId:1,noLink:true};
  const {response}=await (window&&!window.isDestroyed?.()?dialog.showMessageBox(window,options):dialog.showMessageBox(options));
  if(response===0&&!stopped)timers.setTimeout(()=>autoUpdater.quitAndInstall(false,true),0);
 });
 const first=timers.setTimeout(check,UPDATE_FIRST_CHECK_MS),every=timers.setInterval(check,UPDATE_INTERVAL_MS);
 return {enabled:true,check,stop(){stopped=true;timers.clearTimeout(first);timers.clearInterval(every);}};
}
