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
 let downloaded='',stopped=false,asking=false,manual=false,installing=false;
 function show(options){
  const window=getWindow?.();
  return window&&!window.isDestroyed?.()?dialog.showMessageBox(window,options):dialog.showMessageBox(options);
 }
 const check=()=>stopped?Promise.resolve(null):Promise.resolve().then(()=>autoUpdater.checkForUpdates()).catch(error=>{log.warn?.('GAON 업데이트 확인 실패:',error?.message||error);return null;});
 async function offerRestart(){
  if(!downloaded||asking||stopped||installing)return;
  asking=true;
  try{
   const {response}=await show({type:'info',title:'GAON ERP 업데이트',message:`새 버전이 준비됐어요 (${downloaded}).`,detail:'열어 둔 작업을 저장한 뒤 다시 시작하세요. 나중에 설치하려면 파일 → 종료를 선택하세요.',buttons:['지금 다시 시작','나중에'],defaultId:0,cancelId:1,noLink:true});
   if(response===0&&!stopped){
    installing=true;
    timers.setTimeout(()=>autoUpdater.quitAndInstall(false,true),0);
   }
  }finally{asking=false;}
 }
 autoUpdater.on('error',error=>log.warn?.('GAON 업데이트 오류:',error?.message||error));
 autoUpdater.on('update-downloaded',async info=>{
  if(stopped||!info?.version||downloaded===info.version)return;
  downloaded=info.version;
  await offerRestart();
 });
 async function checkManually(){
  if(stopped||manual||installing)return;
  manual=true;
  try{
   if(downloaded)return await offerRestart();
   const result=await check();
   if(stopped||downloaded)return;
   if(!result)throw Error('check failed');
   if(result.downloadPromise){
    await result.downloadPromise;
   }else if(result.isUpdateAvailable===false){
    await show({type:'info',title:'GAON ERP 업데이트',message:`현재 버전 ${app.getVersion()}이 최신입니다.`});
   }else throw Error('missing update status');
  }catch{
   if(!stopped)await show({type:'warning',title:'GAON ERP 업데이트',message:'업데이트를 완료하지 못했습니다.',detail:'인터넷 연결을 확인하고 도움말 → 업데이트 확인을 다시 눌러 주세요.'});
  }finally{manual=false;}
 }
 const first=timers.setTimeout(check,UPDATE_FIRST_CHECK_MS),every=timers.setInterval(check,UPDATE_INTERVAL_MS);
 return {enabled:true,check,checkManually,stop(){stopped=true;timers.clearTimeout(first);timers.clearInterval(every);}};
}
