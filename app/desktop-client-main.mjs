import {desktopCloudOrigin,createDesktopCredentialStore,createDesktopCloudSession,desktopCloudReply} from './desktop-cloud-session.mjs';
import {app,BrowserWindow,Menu,dialog,ipcMain,shell,session,Notification,safeStorage} from 'electron';
import {readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createDesktopNotifications,openDesktopNotificationSystemSettings,prepareWindowsNotificationShortcut,createNativeNotifier,createNotificationPreferenceStore,installDesktopNotificationIPC} from './desktop-notifications.mjs';
import {startDesktopUpdater} from './desktop-updater.mjs';
import {clientWebPreferences,clientURLAction,trustedClientStatus,trustedClientDownload,cloudRendererNetworkAllowed,clientDeviceReviewURL} from './desktop-client-policy.mjs';

app.setName('GAON ERP');
if(process.platform==='win32')app.setAppUserModelId('studio.keelson.gaon.erp');
const here=path.dirname(fileURLToPath(import.meta.url)),setupFile=path.join(here,'desktop-client-setup.html'),setupURL=pathToFileURL(setupFile).href;
const partition='persist:gaon-erp-client';
// 첫 화면이 읽어도 되는 앱 안 파일. 여기에 없는 파일은 막힌다 — 2026-10-28 빛줄기·로고·글꼴이 빠져 첫 화면이 멈췄던 일 (desktop-release-package.test.mjs 가 대조).
const setupAssets=['desktop-client-setup.html','desktop-client-setup.css','desktop-client-setup.mjs','desktop-login-motion.mjs','desktop-gaon-symbol.svg','desktop-fonts/Pretendard-Regular.otf','desktop-fonts/Pretendard-Medium.otf','desktop-fonts/Pretendard-Bold.ttf'];
const setupAssetURLs=new Set(setupAssets.map(file=>pathToFileURL(path.join(here,file)).href));
let updater,window,manualWindow,serverOrigin='',connected=false,signedIn=false,loginBusy=false,quitting=false,statusMessage='',locationGranted=false,notifications,connectionBusy=false,cloud,cloudLogin=null,cloudReturn='/erp/home.html#today';
if(!app.isPackaged&&process.env.GAON_DESKTOP_TEST_USER_DATA)app.setPath('userData',path.resolve(process.env.GAON_DESKTOP_TEST_USER_DATA));
if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',(_event,args)=>{focus();receiveCloudCallback(args);});
 app.on('open-url',(event,url)=>{event.preventDefault();receiveCloudCallback([url]);});
 app.on('activate',()=>window?focus():start().catch(fail));
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',()=>{quitting=true;updater?.stop();cloud?.cancel();cloudLogin?.reject(Error('앱을 종료했습니다.'));notifications?.stop();});
 app.whenReady().then(start).catch(fail);
}
const ses=()=>session.fromPartition(partition);
function focus(){if(!window||window.isDestroyed())return;if(window.isMinimized())window.restore();window.show();window.focus();}
async function fail(error){await dialog.showMessageBox({type:'error',title:'GAON ERP',message:'앱을 열지 못했습니다.',detail:error.message});app.quit();}
async function start(){
 // 2026-10-28 사용자 결정: 서버 주소를 고르는 기능은 없앴다. 항상 회사 서버에 붙고 Google 직원 로그인만 쓴다 (맥·윈도우 같은 코드).
 serverOrigin=desktopCloudOrigin;
 cloud=createDesktopCloudSession({store:createDesktopCredentialStore({file:path.join(app.getPath('userData'),'cloud-session.bin'),safeStorage}),fetcher:(...args)=>ses().fetch(...args),onUnauthorized:()=>{signedIn=false;locationGranted=false;notifications?.reset();}});
 if(app.isPackaged&&process.platform==='win32')app.setAsDefaultProtocolClient('studio.keelson.gaon');
 configureSession();configureNotifications();configureIPC();setMenu();createWindow();
 updater=startDesktopUpdater({app,dialog,getWindow:()=>window});
 if(!app.isPackaged&&process.env.GAON_DESKTOP_SMOKE==='1')return showSetup('검수용 첫 실행');
 try{await verifyServer();signedIn=await verifySession();if(signedIn)return openERP();return showSetup('등록된 직원 계정으로 로그인해 주세요.');}
 catch(error){return showSetup(error.message);}
}
function createWindow(){
 window=new BrowserWindow({title:'GAON ERP',width:1180,height:820,minWidth:880,minHeight:600,show:false,backgroundColor:'#eef3f7',webPreferences:{...clientWebPreferences,partition,preload:path.join(here,'desktop-client-preload.cjs')}});
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
 ipcMain.handle('gaon-cloud:request',async(event,input)=>{cloudSender(event);try{const response=await cloud.request(input);if(input?.path==='/api/gaon/auth/logout'&&response.ok){notifications?.reset();await ses().clearStorageData({origin:desktopCloudOrigin});}return await desktopCloudReply(response);}catch(error){return desktopCloudReply(Response.json({error:error.status?error.message:'업무 연결을 확인하지 못했습니다.'},{status:[400,401,403,405,413].includes(error.status)?error.status:503}));}});
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
  if(permission!=='geolocation'||webContents!==window?.webContents||!signedIn||!serverOrigin||requestingOrigin!==serverOrigin)return callback(false);
  const result=await dialog.showMessageBox(window,{type:'question',title:'GAON ERP · 위치 사용',message:'출퇴근 위치 확인을 위해 현재 위치 사용을 허용할까요?',detail:'위치 정보는 연결한 GAON ERP 서버의 출퇴근 기능에서만 사용합니다.',buttons:['허용','허용 안 함'],defaultId:1,cancelId:1});
  locationGranted=result.response===0;callback(locationGranted);
 });
 current.setPermissionCheckHandler((webContents,permission,requestingOrigin)=>webContents===window?.webContents&&permission==='geolocation'&&signedIn&&locationGranted&&requestingOrigin===serverOrigin);
 current.on('will-download',(event,item,contents)=>{if(!contents||!trustedClientDownload(item.getURL(),serverOrigin)){event.preventDefault();return;}item.setSaveDialogOptions({title:'GAON ERP · 파일 저장',defaultPath:path.join(app.getPath('downloads'),path.basename(item.getFilename()))});});
}
function configureNotifications(){
 notifications=createDesktopNotifications({fetcher:async(input,options={})=>serverOrigin===desktopCloudOrigin?cloud.request({path:new URL(input).pathname+new URL(input).search,method:options.method||'GET',headers:options.headers,body:options.body}):ses().fetch(input,options),getOrigin:()=>serverOrigin,isInternal:url=>clientURLAction(url,serverOrigin)==='internal',supported:()=>Notification.isSupported(),prepare:()=>prepareWindowsNotificationShortcut({app,shell}),createNotification:createNativeNotifier(Notification),preferences:createNotificationPreferenceStore(path.join(app.getPath('userData'),'notifications.json')),onTestOpen:async()=>focus(),openSettings:()=>openDesktopNotificationSystemSettings({shell}),onUnauthorized:()=>{signedIn=false;locationGranted=false;},onOpen:async url=>{if(!window||window.isDestroyed()||!signedIn||clientURLAction(url,serverOrigin)!=='internal')return;await window.loadURL(url);focus();}});
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
function routeURL(url,action=clientURLAction(url,serverOrigin)){if(action==='login'||action==='drive')beginLogin(action==='drive'?'drive':'login').catch(error=>dialog.showMessageBox({type:'warning',title:'직원 로그인',message:error.message}));else if(action==='external')openExternalLink(url).catch(()=>{});else if(action==='internal'&&signedIn)window?.loadURL(url);}
async function openExternalLink(url){const target=new URL(url);const answer=await dialog.showMessageBox(window,{type:'question',title:'외부 페이지 열기',message:target.hostname+'에서 페이지를 열까요?',detail:'GAON 프로그램 밖의 기본 브라우저에서 열립니다.\n'+url,buttons:['열기','취소'],defaultId:1,cancelId:1});if(answer.response===0)await shell.openExternal(url);}
async function openManual(){
 const file=path.join(app.getAppPath(),'app/desktop-client-manual.html');if(!await access(file).then(()=>true,()=>false)){await dialog.showMessageBox(window,{title:'빠른 사용 안내',message:'1. 기본 GAON 서버 주소를 확인합니다.\n2. 직원 로그인을 누르고 기본 브라우저에서 로그인합니다.\n3. 로그인 완료 후 앱으로 돌아오면 ERP가 열립니다.',detail:'서버 주소 변경이 필요하면 도움말 메뉴에서 연결 설정을 여세요.'});return;}
 if(manualWindow&&!manualWindow.isDestroyed()){manualWindow.focus();return;}manualWindow=new BrowserWindow({title:'GAON ERP 빠른 사용 안내',width:820,height:720,parent:window,webPreferences:clientWebPreferences});await manualWindow.loadFile(file);
}
function setMenu(){Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'파일',submenu:[{label:'직원 로그인',click:()=>beginLogin().catch(error=>dialog.showMessageBox({type:'warning',message:error.message}))},{label:'로그인 화면',click:()=>showSetup()},{type:'separator'},{role:'quit',label:'종료'}]},{label:'보기',submenu:[{role:'reload',label:'새로고침'},{role:'resetZoom',label:'실제 크기'},{role:'zoomIn',label:'확대'},{role:'zoomOut',label:'축소'},{role:'togglefullscreen',label:'전체 화면'}]},{label:'도움말',submenu:[{label:'가온봇 경량 분류 검수',type:'checkbox',click:toggleDeviceReview},{type:'separator'},{label:'빠른 사용 안내',click:openManual},{label:'브라우저에서 열기',click:()=>{if(serverOrigin&&signedIn)shell.openExternal(serverOrigin+'/erp/home.html#today');}}]}]));}

async function toggleDeviceReview(item){
 const desired=item.checked;
 if(!signedIn||serverOrigin!==desktopCloudOrigin){item.checked=false;await dialog.showMessageBox(window,{type:'info',message:'직원 로그인 후 업무 화면에서 사용할 수 있습니다.'});return;}
 let target;
 try{target=clientDeviceReviewURL(window.webContents.getURL(),serverOrigin,desired);}catch(error){item.checked=!desired;await dialog.showMessageBox(window,{type:'info',message:error.message});return;}
 const answer=await dialog.showMessageBox(window,{type:'question',title:'가온봇 경량 분류 검수',message:desired?'경량 문장 분류 검수를 켤까요?':'경량 문장 분류 검수를 끌까요?',detail:'화면을 새로고침합니다. 입력 중인 업무를 먼저 저장해 주세요. 켠 뒤 가온봇에 문장을 입력하면 이 기기에서 업무 종류를 제안합니다. 선택만으로 업무를 저장하거나 발송하지 않습니다.',buttons:['새로고침하고 적용','취소'],defaultId:1,cancelId:1});
 if(answer.response!==0){item.checked=!desired;return;}
 try{await window.loadURL(target);}catch{item.checked=!desired;await dialog.showMessageBox(window,{type:'warning',message:'검수 화면을 열지 못했습니다. 연결 상태를 확인해 주세요.'});}
}
