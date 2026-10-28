import {mountLoginMotion} from './desktop-login-motion.mjs';
// 2026-10-28: 직원은 「Google 직원 계정으로 로그인」만 누른다. 회사 서버 주소는 앱에 정해져 있어 화면에서 묻지 않는다.
// 연결이 끊겼으면 정해진 회사 서버로 다시 연결한다.
const $=id=>document.getElementById(id);
const login=$('login'),openApp=$('open-app'),retry=$('retry'),status=$('status');
let busy=false,connected=false,signedIn=false;
function message(text,error=false){status.textContent=text||'';status.classList.toggle('is-error',error);}
function render(){login.disabled=busy||!connected;login.hidden=signedIn;openApp.hidden=!signedIn;openApp.disabled=busy;retry.hidden=busy||connected;}
function apply(state){connected=!!state.connected;signedIn=state.signedIn===true;render();}
async function connect(){
 busy=true;render();message('회사 서버에 연결하고 있습니다.');
 try{
  let state=await window.gaonDesktop.state();
  if(!state.connected)state=await window.gaonDesktop.reconnect();
  apply(state);
  message(state.signedIn?'로그인되어 있어요. 업무 화면을 열어 주세요.':state.connected?'등록된 직원 계정으로 로그인해 주세요.':(state.message||'회사 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.'),!state.connected);
 }catch(error){connected=false;message(error.message||'회사 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.',true);}
 finally{busy=false;render();}
}
login.addEventListener('click',async()=>{if(busy||!connected)return;busy=true;render();message('기본 브라우저에서 Google 로그인을 마쳐 주세요.');try{const result=await window.gaonDesktop.login();message(result.message);}catch(error){message(error.message,true);}finally{busy=false;render();}});
openApp.addEventListener('click',async()=>{if(busy)return;try{await window.gaonDesktop.openApp();}catch(error){message(error.message,true);}});
retry.addEventListener('click',()=>{if(!busy)connect();});
$('manual').addEventListener('click',()=>window.gaonDesktop.openManual().catch(error=>message(error.message,true)));
mountLoginMotion($('gaon-login'));
connect();
