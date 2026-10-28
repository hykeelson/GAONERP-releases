export const clientWebPreferences={
 nodeIntegration:false,
 contextIsolation:true,
 sandbox:true,
 webSecurity:true,
 allowRunningInsecureContent:false,
 webviewTag:false
};

export function normalizeServerURL(raw){
 if(typeof raw!=='string')throw Error('서버 주소를 입력해 주세요.');
 let url;
 try{url=new URL(raw.trim());}catch{throw Error('https://로 시작하는 서버 주소를 입력해 주세요.');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)throw Error('경로 없이 https:// 서버 주소만 입력해 주세요.');
 if(!url.hostname.includes('.')||url.hostname==='localhost'||url.hostname.endsWith('.local'))throw Error('관리자가 안내한 HTTPS 서버 주소를 입력해 주세요.');
 return url.origin;
}

export function clientURLAction(raw,serverOrigin){
 try{
  const url=new URL(raw);
  if(url.username||url.password)return 'deny';
  if(serverOrigin&&url.origin===serverOrigin){
   if(url.pathname==='/api/gaon/auth/login')return 'login';
   if(url.pathname==='/api/gaon/drive/connect')return 'drive';
   if(url.pathname.startsWith('/erp/'))return 'internal';
   return 'deny';
  }
  return url.protocol==='https:'?'external':'deny';
 }catch{return 'deny';}
}

export function trustedClientHealth(value){
 return value?.status==='ok'&&value?.service==='gaon-erp'&&value?.desktopProtocol===1;
}

export function trustedClientStatus(value){
 return value?.signedIn===true&&typeof value.role==='string'&&value.role.length>0;
}

export function trustedClientDownload(raw,serverOrigin){
 try{const url=new URL(raw);return !url.username&&!url.password&&((url.protocol==='blob:'&&url.origin===serverOrigin)||(url.protocol==='https:'&&url.origin===serverOrigin));}catch{return false;}
}

// 2026-10-28 사용자: 「윈도우 프로그램 안에서 카카오지도가 안 틀어져」 — 지도 SDK·지도 그림은 카카오·다음 서버에서 받는다.
// 지도와 글꼴을 받는 정해진 주소만 더 연다. 그 밖의 바깥 주소는 그대로 막는다.
const mapHosts=new Set(['dapi.kakao.com']),mapHostSuffix='.daumcdn.net',fontHosts=new Set(['fonts.googleapis.com','fonts.gstatic.com']);
export function cloudRendererNetworkAllowed(raw,origin){
 try{const url=new URL(raw);if(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&(mapHosts.has(url.hostname)||url.hostname.endsWith(mapHostSuffix)||fontHosts.has(url.hostname)||url.hostname==='cdn.jsdelivr.net'&&url.pathname.startsWith('/gh/orioncactus/pretendard@')))return true;if(url.protocol==='https:')return url.origin===origin;if(url.protocol==='blob:')return url.origin===origin;return url.protocol==='data:';}catch{return false;}
}

// Review changes only the signed-in ERP renderer URL; it cannot select a host or bypass login.
export function clientDeviceReviewURL(raw,serverOrigin,enabled){
 const url=new URL(raw);
 if(clientURLAction(raw,serverOrigin)!=='internal'||url.pathname!=='/erp/home.html')throw Error('업무 화면을 연 뒤 검수를 시작해 주세요.');
 if(enabled)url.searchParams.set('deviceClassifier','1');else url.searchParams.delete('deviceClassifier');
 return url.href;
}
