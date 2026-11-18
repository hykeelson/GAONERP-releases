const {contextBridge,ipcRenderer}=require('electron');

contextBridge.exposeInMainWorld('gaonDesktop',Object.freeze({
 clientInfo:()=>ipcRenderer.invoke('gaon-client:info'),
 homeTax:async(registration,month,attempt,onProgress)=>{
  const listener=(_event,progress)=>{
   if(progress.attempt!==attempt||typeof onProgress!=='function')return;
   const {clientVersion,platform,queryMode,resultMonth,approvalMonth,purchaseMonth,dateBasis}=progress;
   onProgress(progress.stage,progress.business,{clientVersion,platform,queryMode,resultMonth,approvalMonth,purchaseMonth,dateBasis});
  };
  ipcRenderer.on('gaon-client:hometax-progress',listener);
  try{return await ipcRenderer.invoke('gaon-client:hometax',{registration,month,attempt});}
  finally{ipcRenderer.removeListener('gaon-client:hometax-progress',listener);}
 },
 state:()=>ipcRenderer.invoke('gaon-client:state'),
 reconnect:()=>ipcRenderer.invoke('gaon-client:reconnect'),
 login:()=>ipcRenderer.invoke('gaon-client:login'),
 openApp:()=>ipcRenderer.invoke('gaon-client:open-app'),
 openManual:()=>ipcRenderer.invoke('gaon-client:manual')
}));

contextBridge.exposeInMainWorld('gaonNotifications',Object.freeze({status:()=>ipcRenderer.invoke('gaon-notifications:status'),configure:value=>ipcRenderer.invoke('gaon-notifications:configure',value),test:()=>ipcRenderer.invoke('gaon-notifications:test'),testStatus:()=>ipcRenderer.invoke('gaon-notifications:test-status'),openSettings:()=>ipcRenderer.invoke('gaon-notifications:open-settings')}));

contextBridge.exposeInMainWorld('gaonDesktopCloud',Object.freeze({version:1,request:input=>ipcRenderer.invoke('gaon-cloud:request',input),login:returnTo=>ipcRenderer.invoke('gaon-cloud:login',returnTo)}));
