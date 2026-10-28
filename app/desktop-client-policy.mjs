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
// 2026-10-29 전수 검사: 주소 검색(photon.komoot.io)·위치 지도 타일(tile.openstreetmap.org)도 웹과 같이 연다.
// PDF 미리보기는 Electron 내장 PDF 보기(아래 확장 ID)를 써야 해서 그 주소도 연다 — 막혀 있어 계약서·증빙 PDF가 빈 화면이었다.
const mapHosts=new Set(['dapi.kakao.com','photon.komoot.io','tile.openstreetmap.org']),mapHostSuffix='.daumcdn.net',fontHosts=new Set(['fonts.googleapis.com','fonts.gstatic.com']);
const pdfViewer='chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/';
export function cloudRendererNetworkAllowed(raw,origin){
 try{const url=new URL(raw);if(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&(mapHosts.has(url.hostname)||url.hostname.endsWith(mapHostSuffix)||fontHosts.has(url.hostname)||url.hostname==='cdn.jsdelivr.net'&&url.pathname.startsWith('/gh/orioncactus/pretendard@')))return true;if(url.protocol==='https:')return url.origin===origin;if(url.protocol==='blob:')return url.origin===origin;if(raw.startsWith(pdfViewer)||raw.startsWith('chrome://resources/'))return true;return url.protocol==='data:';}catch{return false;}
}

// Review changes only the signed-in ERP renderer URL; it cannot select a host or bypass login.
export function clientDeviceReviewURL(raw,serverOrigin,enabled){
 const url=new URL(raw);
 if(clientURLAction(raw,serverOrigin)!=='internal'||url.pathname!=='/erp/home.html')throw Error('업무 화면을 연 뒤 검수를 시작해 주세요.');
 if(enabled)url.searchParams.set('deviceClassifier','1');else url.searchParams.delete('deviceClassifier');
 return url.href;
}

// 2026-10-29 전수 검사: 업무 화면의 「복사」 버튼(문구·계좌 복사)이 설치 앱에서만 막혔다. 회사 서버 화면만 클립보드를 쓰게 한다.
// Electron 은 writeText 에도 'clipboard-read' 권한을 묻는다(시험으로 확인) — 그래서 둘 다 회사 서버 화면에만 허용한다.
export function clientPermissionAllowed(permission,requestingOrigin,serverOrigin){
 return !!serverOrigin&&requestingOrigin===serverOrigin&&['clipboard-sanitized-write','clipboard-read'].includes(permission);
}
// 전화·메일·문자 링크는 웹에서는 휴대폰·메일 앱이 열리는데 설치 앱에서는 아무 반응이 없었다. 기본 앱으로 넘긴다(Windows는 휴대폰과 연결·메일 앱).
export function clientExternalProtocol(raw){
 try{const url=new URL(raw);if(url.protocol==='tel:'||url.protocol==='sms:')return /^\+?[0-9-]{3,20}$/.test(decodeURIComponent(url.pathname));if(url.protocol==='mailto:')return /^[^\s@,;]+@[^\s@,;]+$/.test(decodeURIComponent(url.pathname));return false;}catch{return false;}
}
