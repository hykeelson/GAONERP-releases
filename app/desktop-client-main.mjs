import {homeTaxDailyImport,homeTaxProfileStore} from './desktop-hometax-session.mjs';
import {openHomeTax} from './desktop-hometax.mjs';
import {desktopCloudOrigin,createDesktopCredentialStore,createDesktopCloudSession,desktopCloudReply} from './desktop-cloud-session.mjs';
import {app,BrowserWindow,Menu,Tray,dialog,ipcMain,shell,session,Notification,safeStorage} from 'electron';
import {readFile,access,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {desktopAppUserModelId,createDesktopNotifications,openDesktopNotificationSystemSettings,prepareWindowsNotificationShortcut,createNativeNotifier,createNotificationPreferenceStore,installDesktopNotificationIPC} from './desktop-notifications.mjs';
import {startDesktopUpdater} from './desktop-updater.mjs';
import {clientWebPreferences,clientURLAction,trustedClientStatus,trustedClientDownload,cloudRendererNetworkAllowed,clientDeviceReviewURL,clientPermissionAllowed,clientExternalProtocol} from './desktop-client-policy.mjs';

app.setName('GAON ERP');
async function guideCardMonth(win,month){
 const {response}=await dialog.showMessageBox(win,{type:'info',title:'사업용 카드 조회기간 확인',
  message:`홈택스에서 ${month.replace('-','년 ')}월을 다시 조회해 주세요.`,
  detail:'조회 화면에서 회사 사업장과 월별 기간을 확인하고, 다른 조건은 그대로 둔 채 조회를 눌러 주세요. 가온이 결과를 다시 읽습니다.',
  buttons:['조회 화면 열기','취소'],defaultId:0,cancelId:1});
 if(response!==0)throw Error('카드 재조회를 취소했습니다. 이번 조회는 저장하지 않았습니다.');
}
// 창이 뜨기 전에 앱 ID 를 정해야 윈도우 알림이 이 앱 이름으로 뜬다.
if(process.platform==='win32')app.setAppUserModelId(desktopAppUserModelId);
const here=path.dirname(fileURLToPath(import.meta.url)),setupFile=path.join(here,'desktop-client-setup.html'),setupURL=pathToFileURL(setupFile).href;
const partition='persist:gaon-erp-client';
// 첫 화면이 읽어도 되는 앱 안 파일. 여기에 없는 파일은 막힌다 — 2026-10-28 빛줄기·로고·글꼴이 빠져 첫 화면이 멈췄던 일 (desktop-release-package.test.mjs 가 대조).
const setupAssets=['desktop-client-setup.html','desktop-client-setup.css','desktop-client-setup.mjs','desktop-login-motion.mjs','desktop-gaon-symbol.svg','desktop-fonts/Pretendard-Regular.otf','desktop-fonts/Pretendard-Medium.otf','desktop-fonts/Pretendard-Bold.ttf'];
const setupAssetURLs=new Set(setupAssets.map(file=>pathToFileURL(path.join(here,file)).href));
let taxProfiles,taxDaily,taxTimer,updater,window,manualWindow,serverOrigin='',connected=false,signedIn=false,loginBusy=false,quitting=false,statusMessage='',locationGranted=false,notifications,connectionBusy=false,cloud,cloudLogin=null,cloudReturn='/erp/home.html#today';
if(!app.isPackaged&&process.env.GAON_DESKTOP_TEST_USER_DATA)app.setPath('userData',path.resolve(process.env.GAON_DESKTOP_TEST_USER_DATA));
if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',(_event,args)=>{focus();receiveCloudCallback(args);});
 app.on('open-url',(event,url)=>{event.preventDefault();receiveCloudCallback([url]);});
 app.on('activate',()=>window?focus():start().catch(fail));
 // 2026-11-04 창을 닫아도 작업표시줄 알림 영역(트레이)에 남아 알림을 받는다. 트레이의 「종료」로만 끈다.
 app.on('window-all-closed',()=>{if(quitting)app.quit();});
 app.on('before-quit',()=>{quitting=true;clearInterval(taxTimer);updater?.stop();cloud?.cancel();cloudLogin?.reject(Error('앱을 종료했습니다.'));notifications?.stop();});
 app.whenReady().then(start).catch(fail);
}
const ses=()=>session.fromPartition(partition);
// 트레이 아이콘은 실행 파일 아이콘을 쓴다(따로 그림 파일을 넣지 않아도 됨). 처음 한 번만 「컴퓨터 켤 때 자동 실행」을 켠다.
let tray=null,trayHinted=false;
async function setupTray(){
 if(tray||process.platform==='linux')return;
 const icon=await app.getFileIcon(process.execPath,{size:'small'});
 tray=new Tray(icon);tray.setToolTip('GAON ERP · 알림 받는 중');
 tray.setContextMenu(Menu.buildFromTemplate([{label:'GAON ERP 열기',click:()=>focus()},{type:'separator'},{label:'종료',click:()=>{quitting=true;app.quit();}}]));
 tray.on('click',()=>focus());
 if(app.isPackaged){const marker=path.join(app.getPath('userData'),'login-item-set');try{await access(marker);}catch{app.setLoginItemSettings({openAtLogin:true});await writeFile(marker,new Date().toISOString()).catch(()=>{});}}
}
function trayHint(){if(trayHinted||!tray||process.platform!=='win32')return;trayHinted=true;try{tray.displayBalloon({title:'GAON ERP는 계속 켜져 있어요',content:'알림을 받으려고 오른쪽 아래 알림 영역에 남아 있어요. 끄려면 아이콘을 오른쪽 클릭해 「종료」를 누르세요.'});}catch{}}
function focus(){if(!window||window.isDestroyed())return;if(window.isMinimized())window.restore();window.show();window.focus();window.flashFrame(false);}
async function fail(error){await dialog.showMessageBox({type:'error',title:'GAON ERP',message:'앱을 열지 못했습니다.',detail:error.message});app.quit();}
async function start(){
 // 2026-10-28 사용자 결정: 서버 주소를 고르는 기능은 없앴다. 항상 회사 서버에 붙고 Google 직원 로그인만 쓴다 (맥·윈도우 같은 코드).
 serverOrigin=desktopCloudOrigin;
 taxProfiles=homeTaxProfileStore(session,path.join(app.getPath('userData'),'hometax-profile.json'));
 cloud=createDesktopCloudSession({store:createDesktopCredentialStore({file:path.join(app.getPath('userData'),'cloud-session.bin'),safeStorage}),fetcher:(...args)=>ses().fetch(...args),onUnauthorized:()=>{signedIn=false;locationGranted=false;notifications?.reset();taxDaily?.clear();taxProfiles.clear().catch(()=>{});}});
 if(app.isPackaged&&process.platform==='win32')app.setAsDefaultProtocolClient('studio.keelson.gaon');
 if(process.platform==='win32')startTaxDaily();
 configureSession();configureNotifications();configureIPC();
 updater=startDesktopUpdater({app,dialog,getWindow:()=>window});
 setMenu();createWindow();
 if(!app.isPackaged&&process.env.GAON_DESKTOP_SMOKE==='1')return showSetup('검수용 첫 실행');
 try{await verifyServer();signedIn=await verifySession();if(signedIn)return openERP();return showSetup('등록된 직원 계정으로 로그인해 주세요.');}
 catch(error){return showSetup(error.message);}
}
async function taxAccess(){
 const response=await cloud.request({path:'/api/gaon/vat?hometax=access'});
 if(!response.ok)throw Object.assign(Error(response.status===403?'전사 재무 권한을 확인하세요.':'가온 재무 서버 연결을 확인하세요.'),{code:response.status===403?'HT_PERMISSION':''});
 const {actor,org}=await response.json();
 if(typeof actor!=='string'||!actor||typeof org!=='string'||!org)throw Error('재무 권한 확인에 실패했습니다.');
 return {actor,org};
}
function startTaxDaily(){
 taxDaily=homeTaxDailyImport({
  file:path.join(app.getPath('userData'),'hometax-daily.json'),access:taxAccess,
  collect:({org,actor},registration,month)=>openHomeTax({BrowserWindow,session,parent:window,registration,month,profile:taxProfiles.acquire(org,actor),background:true}),
  async commit({actor,org},month,data){
   const query=new URLSearchParams({hometax:'cards',business:data.registration,month});
   const reply=await cloud.request({path:'/api/gaon/vat?'+query,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actor,org,...data})});
   if(!reply.ok)throw Object.assign(Error('홈택스 자료 저장을 확인하세요.'),{code:reply.status===403?'HT_PERMISSION':reply.status===409?'HT_CONFLICT':''});
   return reply.json();
  },
  onPause:reason=>{if(Notification.isSupported())new Notification({title:'가온 홈택스 카드 자동 수집',body:reason+' 후 홈택스 자료를 한 번 직접 가져오세요.'}).show();}
 });
 taxTimer=setInterval(()=>{if(signedIn&&!quitting)taxDaily.tick().catch(()=>{});},60000);
}
async function showTaxDailySettings(){
 if(!signedIn)throw Error('가온 직원 계정으로 로그인하세요.');
 const identity=await taxAccess(),state=taxDaily.settings(identity);
 const last=state.last;
 const detail=state.enabled?[
   state.paused?'확인 필요 · '+state.paused:state.retryAt?'일시 지연 · 자동으로 다시 시도합니다.':'이 PC에서 매일 지난달과 이번 달 사업용 카드를 확인합니다.',
   ...(state.months.length?state.months.map(m=>m.unavailable?m.month+' · 홈택스 조회 월 미제공':m.retryAt?m.month+' · 조회 재시도 예정':m.month+' · '+m.day+' 확인 · 신규 '+m.added+'건, 중복 '+m.duplicate+'건'):[last?last.day+' 수집 · '+last.month+' 신규 '+last.added+'건, 중복 '+last.duplicate+'건':'아직 완료된 자동 수집이 없습니다.'])
 ].join('\n'):'가온이 실행 중이면 지난달과 이번 달 사업용 카드 내역을 매일 확인합니다. 처음 한 번 홈택스에서 회사 사업장을 확인하세요.';
 const buttons=state.enabled?['닫기','자동 수집 끄기',...(state.paused?['다시 연결']:[])]:['닫기','카드 연결'];
 const choice=await dialog.showMessageBox(window,{type:'info',message:'홈택스 카드 자동 수집 '+(state.enabled?'켜짐':'꺼짐'),detail,buttons,defaultId:0,cancelId:0});
 if(!choice.response)return;
 async function sameEmployee(){
   const current=await taxAccess();
   if(current.actor!==identity.actor||current.org!==identity.org)throw Error('직원 로그인이 변경됐습니다.');
 }
 await sameEmployee();
 if(state.enabled&&choice.response===1){taxDaily.disable();return;}
 const today=new Date(Date.now()+9*3600000);
 const month=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()-1,1)).toISOString().slice(0,7);
 const data=await openHomeTax({BrowserWindow,session,parent:window,registration:state.enabled?state.registration:'',month,cardOnly:true,guideCardMonth,profile:taxProfiles.acquire(identity.org,identity.actor)});
 const confirm=await dialog.showMessageBox(window,{type:'question',message:'이 사업장의 카드 자동 수집을 켤까요?',detail:'사업자등록번호 '+data.registration+' · '+month+' 카드 '+data.groups.card.length+'건',buttons:['취소','자동 수집 켜기'],defaultId:0,cancelId:0});
 if(confirm.response!==1)return;
 await sameEmployee();
 taxDaily.manual(identity,data.registration);taxDaily.enable(identity,data.registration);await taxDaily.tick();

}
function createWindow(){
 window=new BrowserWindow({title:'GAON ERP',width:1180,height:820,minWidth:880,minHeight:600,show:false,backgroundColor:'#eef3f7',webPreferences:{...clientWebPreferences,partition,preload:path.join(here,'desktop-client-preload.cjs')}});
 window.on('close',event=>{if(quitting)return;event.preventDefault();window.hide();trayHint();});
 setupTray().catch(()=>{});
 const wc=window.webContents;
 wc.on('did-finish-load',()=>{if(clientURLAction(wc.getURL(),serverOrigin)==='internal'&&signedIn)notifications?.resume();else notifications?.reset();});
 window.on('closed',()=>notifications?.stop());
 const navigate=(event,legacy)=>{const url=event.url||legacy;if(url===setupURL)return;const action=clientURLAction(url,serverOrigin);if(action==='internal'&&signedIn)return;event.preventDefault();routeURL(url,action);};
 wc.on('will-navigate',navigate);wc.on('will-redirect',navigate);wc.on('will-attach-webview',event=>event.preventDefault());
 wc.setWindowOpenHandler(({url})=>{routeURL(url,clientURLAction(url,serverOrigin));return {action:'deny'};});
 wc.on('page-title-updated',event=>{event.preventDefault();window?.setTitle('GAON ERP');});
 wc.on('render-process-gone',()=>{if(!quitting)showSetup('화면 연결이 종료됐습니다. 다시 열어 주세요.');});
 window.once('ready-to-show',focus);
}
function setupSender(event){if(event.sender!==window?.webContents||event.senderFrame?.url!==setupURL)throw Error('허용되지 않은 화면입니다.');}
function configureIPC(){
 const cloudSender=event=>{let url;try{url=new URL(event.senderFrame?.url);}catch{}if(event.sender!==window?.webContents||event.senderFrame!==window.webContents.mainFrame||serverOrigin!==desktopCloudOrigin||url?.origin!==desktopCloudOrigin||url.pathname!=='/erp/home.html')throw Error('허용되지 않은 업무 화면입니다.');};
 ipcMain.handle('gaon-client:hometax',async(event,{registration,month,attempt})=>{
  cloudSender(event);
  const onStage=(stage,business)=>{
   if(typeof attempt==='string'&&/^[a-f0-9-]{36}$/i.test(attempt)){
    try{cloudSender(event);event.senderFrame.send('gaon-client:hometax-progress',{attempt,stage,business});}catch{/* The initiating view closed or navigated. */}
   }
  };
  onStage('access');
  const {actor,org}=await taxAccess();
  const collected=await openHomeTax({BrowserWindow,session,parent:window,registration,month,guideCardMonth,onStage,onBusiness:n=>onStage('businessConfirmed',n),profile:taxProfiles.acquire(org,actor)});
  onStage('verifyAccess');cloudSender(event);const current=await taxAccess();if(actor!==current.actor||org!==current.org)throw Error('로그인한 직원이 변경됐습니다.');
  taxDaily?.manual(current,collected.registration);
  return {actor,...collected};
 });
 ipcMain.handle('gaon-cloud:request',async(event,input)=>{cloudSender(event);try{if(input?.path==='/api/gaon/auth/logout'){taxDaily?.clear();await taxProfiles.clear();}const response=await cloud.request(input);if(input?.path==='/api/gaon/auth/logout'&&response.ok){notifications?.reset();await ses().clearStorageData({origin:desktopCloudOrigin});}return await desktopCloudReply(response);}catch(error){return desktopCloudReply(Response.json({error:error.status?error.message:'업무 연결을 확인하지 못했습니다.'},{status:[400,401,403,405,413].includes(error.status)?error.status:503}));}});
 ipcMain.handle('gaon-cloud:login',async(event,returnTo)=>{cloudSender(event);cloudReturn=safeCloudDesktopReturn(returnTo);await beginLogin();return {signedIn:true};});
 ipcMain.handle('gaon-client:state',event=>{setupSender(event);return {serverOrigin,connected,signedIn,message:statusMessage||(connected?(signedIn?'직원 로그인이 확인됐습니다.':'등록된 직원 계정으로 로그인해 주세요.'):'회사 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.')};});
 ipcMain.handle('gaon-client:reconnect',async event=>{setupSender(event);return updateConnection(async()=>{await verifyServer();signedIn=await sessionVerified(serverOrigin);statusMessage=signedIn?'직원 로그인이 확인됐습니다.':'등록된 직원 계정으로 로그인해 주세요.';return {serverOrigin,connected,signedIn,message:statusMessage};});});
 ipcMain.handle('gaon-client:login',async event=>{setupSender(event);await beginLogin();return {message:'직원 로그인이 완료됐습니다.'};});
 ipcMain.handle('gaon-client:open-app',async event=>{setupSender(event);if(loginBusy||connectionBusy)throw Error('로그인 또는 연결 설정을 처리 중입니다.');if(!await verifySession())throw Error('직원 로그인이 필요합니다.');await openERP();return {opened:true};});
 ipcMain.handle('gaon-client:manual',async event=>{setupSender(event);await openManual();return {opened:true};});
}
function configureSession(){
 const current=ses();
 current.webRequest.onBeforeRequest((details,callback)=>{if(serverOrigin===desktopCloudOrigin&&details.webContentsId===window?.webContents.id)callback({cancel:!setupAssetURLs.has(details.url)&&!cloudRendererNetworkAllowed(details.url,desktopCloudOrigin)});else callback({cancel:false});});
 current.setPermissionRequestHandler(async(webContents,permission,callback,details)=>{
  const requestingOrigin=(()=>{try{return new URL(details?.requestingUrl||webContents.getURL()).origin;}catch{return '';}})();
  if(permission!=='geolocation')return callback(webContents===window?.webContents&&signedIn&&clientPermissionAllowed(permission,requestingOrigin,serverOrigin));
  if(permission!=='geolocation'||webContents!==window?.webContents||!signedIn||!serverOrigin||requestingOrigin!==serverOrigin)return callback(false);
  const result=await dialog.showMessageBox(window,{type:'question',title:'GAON ERP · 위치 사용',message:'출퇴근 위치 확인을 위해 현재 위치 사용을 허용할까요?',detail:'위치 정보는 연결한 GAON ERP 서버의 출퇴근 기능에서만 사용합니다.',buttons:['허용','허용 안 함'],defaultId:1,cancelId:1});
  locationGranted=result.response===0;callback(locationGranted);
 });
 current.setPermissionCheckHandler((webContents,permission,requestingOrigin)=>webContents===window?.webContents&&signedIn&&(permission==='geolocation'?locationGranted&&requestingOrigin===serverOrigin:clientPermissionAllowed(permission,requestingOrigin,serverOrigin)));
 current.on('will-download',(event,item,contents)=>{if(!contents||!trustedClientDownload(item.getURL(),serverOrigin)){event.preventDefault();return;}item.setSaveDialogOptions({title:'GAON ERP · 파일 저장',defaultPath:path.join(app.getPath('downloads'),path.basename(item.getFilename()))});});
}
function configureNotifications(){
 notifications=createDesktopNotifications({fetcher:async(input,options={})=>serverOrigin===desktopCloudOrigin?cloud.request({path:new URL(input).pathname+new URL(input).search,method:options.method||'GET',headers:options.headers,body:options.body}):ses().fetch(input,options),getOrigin:()=>serverOrigin,isInternal:url=>clientURLAction(url,serverOrigin)==='internal',supported:()=>Notification.isSupported(),prepare:()=>prepareWindowsNotificationShortcut({app,shell}),createNotification:createNativeNotifier(Notification),preferences:createNotificationPreferenceStore(path.join(app.getPath('userData'),'notifications.json')),onTestOpen:async()=>focus(),onShown:()=>{if(window&&!window.isDestroyed()&&!window.isFocused())window.flashFrame(true);},openSettings:()=>openDesktopNotificationSystemSettings({shell}),onUnauthorized:()=>{signedIn=false;locationGranted=false;},onOpen:async url=>{if(!window||window.isDestroyed()||!signedIn||clientURLAction(url,serverOrigin)!=='internal')return;await window.loadURL(url);focus();}});
 installDesktopNotificationIPC(ipcMain,{controller:notifications,getWindow:()=>window,isInternal:url=>clientURLAction(url,serverOrigin)==='internal'});
}
async function verifyServer(){await cloud.health();connected=true;return true;}
async function updateConnection(action){if(loginBusy||connectionBusy)throw Error('연결 설정을 처리 중입니다. 잠시 후 다시 시도해 주세요.');connectionBusy=true;try{return await action();}finally{connectionBusy=false;}}
async function sessionVerified(){try{return trustedClientStatus(await cloud.status());}catch(error){if(error.status===401||error.status===403)return false;throw error;}}
async function verifySession(){signedIn=await sessionVerified(serverOrigin);if(!signedIn)notifications?.reset();return signedIn;}
async function beginLogin(purpose='login'){
 if(loginBusy||connectionBusy)throw Error('로그인 또는 연결 설정을 처리 중입니다.');
 if(purpose!=='login')throw Error('문서 보관은 앱의 설정에서 확인해 주세요.');
 loginBusy=true;window?.setProgressBar(2);
 try{await verifyServer();return await beginCloudLogin();}
 finally{loginBusy=false;if(window&&!window.isDestroyed())window.setProgressBar(-1);}
}
function safeCloudDesktopReturn(value){try{const url=new URL(value||'/erp/home.html#today',desktopCloudOrigin);if(url.origin!==desktopCloudOrigin||url.pathname!=='/erp/home.html')return '/erp/home.html#today';const view=['mobile','desktop'].includes(url.searchParams.get('view'))?'?view='+url.searchParams.get('view'):'';return url.pathname+view+url.hash;}catch{return '/erp/home.html#today';}}
async function beginCloudLogin(){
 signedIn=false;notifications?.reset();await window.loadFile(setupFile);
 const loginURL=await cloud.begin();
 try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('로그인 시간이 초과됐습니다. 다시 시도해 주세요.')),300000);cloudLogin={resolve,reject,timer};shell.openExternal(loginURL).catch(()=>reject(Error('기본 브라우저에서 로그인을 열지 못했습니다.')));});signedIn=true;await openERP();}
 catch(error){await showSetup(error.message);throw error;}
 finally{if(cloudLogin){clearTimeout(cloudLogin.timer);cloudLogin=null;}cloud.cancel();}
}
async function receiveCloudCallback(args){
 const raw=args?.find(value=>typeof value==='string'&&value.startsWith('studio.keelson.gaon:'));if(!raw||!cloudLogin||serverOrigin!==desktopCloudOrigin)return;
 const waiting=cloudLogin;if(waiting.processing)return;waiting.processing=true;try{await cloud.complete(raw);waiting.resolve();}catch{waiting.reject(Error('Google 로그인을 완료하지 못했습니다. 직원 등록과 로그인 복귀 설정을 확인해 주세요.'));}
}
async function showSetup(message=''){
 statusMessage=message;await window.loadFile(setupFile);focus();
 if(!app.isPackaged&&process.env.GAON_DESKTOP_SMOKE==='1'){
  const state=await window.webContents.executeJavaScript('window.gaonDesktop.state()'),bridge=await window.webContents.executeJavaScript("(async()=>({version:window.gaonDesktopCloud?.version,denied:await window.gaonDesktopCloud.request({path:'/api/gaon/home'}).then(()=>false,()=>true)}))()"),preferences=window.webContents.getLastWebPreferences();
  let protectedStorage=null;if(process.platform==='win32'){const fixtureStore=createDesktopCredentialStore({file:path.join(app.getPath('userData'),'smoke-protected.bin'),safeStorage});const marker='GAON_TEST_ONLY_NOT_A_REAL_CREDENTIAL';await fixtureStore.write(marker);const raw=await readFile(path.join(app.getPath('userData'),'smoke-protected.bin'));protectedStorage={roundTrip:await fixtureStore.read()===marker,encrypted:!raw.includes(Buffer.from(marker))};await fixtureStore.remove();if(!protectedStorage.roundTrip||!protectedStorage.encrypted)throw Error('Windows protected storage check failed');}
  console.log('__GAON_DESKTOP_SMOKE__'+JSON.stringify({state,bridge,protectedStorage,security:{nodeIntegration:preferences.nodeIntegration,contextIsolation:preferences.contextIsolation,sandbox:preferences.sandbox,webSecurity:preferences.webSecurity}}));
  setImmediate(()=>app.quit());
 }
}
async function openERP(){if(!serverOrigin||!signedIn)throw Error('직원 로그인이 필요합니다.');await window.loadURL(serverOrigin+(serverOrigin===desktopCloudOrigin?cloudReturn:'/erp/home.html#today'));focus();}
function routeURL(url,action=clientURLAction(url,serverOrigin)){if(clientExternalProtocol(url)){shell.openExternal(url).catch(()=>dialog.showMessageBox(window,{type:'info',title:'GAON ERP',message:'이 컴퓨터에 전화·메일을 열 앱이 없습니다.',detail:decodeURIComponent(url.replace(/^[a-z]+:/,''))}));return;}if(action==='login'||action==='drive')beginLogin(action==='drive'?'drive':'login').catch(error=>dialog.showMessageBox({type:'warning',title:'직원 로그인',message:error.message}));else if(action==='external')openExternalLink(url).catch(()=>{});else if(action==='internal'&&signedIn)window?.loadURL(url);}
async function openExternalLink(url){const target=new URL(url);const answer=await dialog.showMessageBox(window,{type:'question',title:'외부 페이지 열기',message:target.hostname+'에서 페이지를 열까요?',detail:'GAON 프로그램 밖의 기본 브라우저에서 열립니다.\n'+url,buttons:['열기','취소'],defaultId:1,cancelId:1});if(answer.response===0)await shell.openExternal(url);}
async function openManual(){
 const file=path.join(app.getAppPath(),'app/desktop-client-manual.html');if(!await access(file).then(()=>true,()=>false)){await dialog.showMessageBox(window,{title:'빠른 사용 안내',message:'1. 기본 GAON 서버 주소를 확인합니다.\n2. 직원 로그인을 누르고 기본 브라우저에서 로그인합니다.\n3. 로그인 완료 후 앱으로 돌아오면 ERP가 열립니다.',detail:'서버 주소 변경이 필요하면 도움말 메뉴에서 연결 설정을 여세요.'});return;}
 if(manualWindow&&!manualWindow.isDestroyed()){manualWindow.focus();return;}manualWindow=new BrowserWindow({title:'GAON ERP 빠른 사용 안내',width:820,height:720,parent:window,webPreferences:clientWebPreferences});await manualWindow.loadFile(file);
}
async function checkDesktopUpdate(item){
 item.enabled=false;
 item.label='업데이트 확인 중…';
 try{await updater.checkManually();}
 finally{item.label='업데이트 확인';item.enabled=true;}
}
function setMenu(){Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'파일',submenu:[...(taxDaily?[{label:'홈택스 카드 자동 수집 설정…',click:()=>showTaxDailySettings().catch(e=>dialog.showMessageBox({type:'warning',message:e.message}))}]:[]),{label:'직원 로그인',click:()=>beginLogin().catch(error=>dialog.showMessageBox({type:'warning',message:error.message}))},{label:'로그인 화면',click:()=>showSetup()},{type:'separator'},{role:'quit',label:'종료'}]},{label:'보기',submenu:[{role:'reload',label:'새로고침'},{role:'resetZoom',label:'실제 크기'},{role:'zoomIn',label:'확대'},{role:'zoomOut',label:'축소'},{role:'togglefullscreen',label:'전체 화면'}]},{label:'도움말',submenu:[{label:'현재 버전 '+app.getVersion(),enabled:false},...(updater?.enabled?[{label:'업데이트 확인',click:checkDesktopUpdate}]:[]),{type:'separator'},{label:'가온봇 경량 분류 검수',type:'checkbox',click:toggleDeviceReview},{type:'separator'},{label:'빠른 사용 안내',click:openManual},{label:'브라우저에서 열기',click:()=>{if(serverOrigin&&signedIn)shell.openExternal(serverOrigin+'/erp/home.html#today');}}]}]));}

async function toggleDeviceReview(item){
 const desired=item.checked;
 if(!signedIn||serverOrigin!==desktopCloudOrigin){item.checked=false;await dialog.showMessageBox(window,{type:'info',message:'직원 로그인 후 업무 화면에서 사용할 수 있습니다.'});return;}
 let target;
 try{target=clientDeviceReviewURL(window.webContents.getURL(),serverOrigin,desired);}catch(error){item.checked=!desired;await dialog.showMessageBox(window,{type:'info',message:error.message});return;}
 const answer=await dialog.showMessageBox(window,{type:'question',title:'가온봇 경량 분류 검수',message:desired?'경량 문장 분류 검수를 켤까요?':'경량 문장 분류 검수를 끌까요?',detail:'화면을 새로고침합니다. 입력 중인 업무를 먼저 저장해 주세요. 켠 뒤 가온봇에 문장을 입력하면 이 기기에서 업무 종류를 제안합니다. 선택만으로 업무를 저장하거나 발송하지 않습니다.',buttons:['새로고침하고 적용','취소'],defaultId:1,cancelId:1});
 if(answer.response!==0){item.checked=!desired;return;}
 try{await window.loadURL(target);}catch{item.checked=!desired;await dialog.showMessageBox(window,{type:'warning',message:'검수 화면을 열지 못했습니다. 연결 상태를 확인해 주세요.'});}
}
