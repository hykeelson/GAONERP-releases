const {contextBridge,ipcRenderer}=require('electron');

contextBridge.exposeInMainWorld('gaonDesktop',Object.freeze({
 state:()=>ipcRenderer.invoke('gaon-client:state'),
 reconnect:()=>ipcRenderer.invoke('gaon-client:reconnect'),
 login:()=>ipcRenderer.invoke('gaon-client:login'),
 openApp:()=>ipcRenderer.invoke('gaon-client:open-app'),
 openManual:()=>ipcRenderer.invoke('gaon-client:manual')
}));

contextBridge.exposeInMainWorld('gaonNotifications',Object.freeze({status:()=>ipcRenderer.invoke('gaon-notifications:status'),configure:value=>ipcRenderer.invoke('gaon-notifications:configure',value),test:()=>ipcRenderer.invoke('gaon-notifications:test'),testStatus:()=>ipcRenderer.invoke('gaon-notifications:test-status'),openSettings:()=>ipcRenderer.invoke('gaon-notifications:open-settings')}));

contextBridge.exposeInMainWorld('gaonDesktopCloud',Object.freeze({version:1,request:input=>ipcRenderer.invoke('gaon-cloud:request',input),login:returnTo=>ipcRenderer.invoke('gaon-cloud:login',returnTo)}));
