import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const exists=file=>access(file).then(()=>true,()=>false);
const normalize=file=>file.split(path.sep).join('/');

async function releasePackage(){
 const local=path.join(root,'package.json'),template=path.join(root,'docs/windows-release.package.json');
 const localValue=JSON.parse(await readFile(local,'utf8'));
 const file=localValue.name==='gaon-erp-windows'?local:template;
 return {file,value:JSON.parse(await readFile(file,'utf8'))};
}

function localReferences(source,extension){
 const references=[];
 if(['.mjs','.js','.cjs'].includes(extension)){
  const imports=/\b(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  for(const match of source.matchAll(imports))if((match[1]||match[2]).startsWith('.'))references.push(match[1]||match[2]);
  for(const match of source.matchAll(/path\.join\(\s*here\s*,\s*['"]([^'"]+)['"]\s*\)/g))references.push('./'+match[1]);
  for(const match of source.matchAll(/path\.join\(\s*app\.getAppPath\(\)\s*,\s*['"](app\/[^'"]+)['"]\s*\)/g))references.push('../'+match[1]);
 }
 if(extension==='.html')for(const match of source.matchAll(/\b(?:src|href)=['"]([^'"]+)['"]/g))if(match[1].startsWith('.'))references.push(match[1]);
 // 2026-10-28: 첫 화면 CSS가 담은 글꼴도 설치본에 들어가야 한다. 글꼴을 함께 배포할 때는 OFL 라이선스 파일도 같이 둔다.
 if(extension==='.css'){for(const match of source.matchAll(/url\(\s*['"]?(\.[^'")]+)['"]?\s*\)/g))references.push(match[1]);if(/desktop-fonts\//.test(source))references.push('./desktop-fonts/Pretendard-LICENSE.txt');}
 return references;
}

async function runtimeClosure(entry){
 const pending=[entry],seen=new Set();
 while(pending.length){
  const relative=normalize(pending.pop());
  if(seen.has(relative))continue;
  const absolute=path.join(root,relative);
  assert.equal(await exists(absolute),true,`Runtime dependency does not exist: ${relative}`);
  seen.add(relative);
  const source=await readFile(absolute,'utf8');
  for(const reference of localReferences(source,path.extname(relative))){
   const resolved=normalize(path.relative(root,path.resolve(path.dirname(absolute),reference)));
   assert.equal(resolved.startsWith('../'),false,`Runtime dependency escapes package root: ${reference}`);
   pending.push(resolved);
  }
 }
 return seen;
}

test('Windows release files exactly cover the desktop runtime dependency closure',async()=>{
 const {file,value}=await releasePackage();
 assert.equal(value.main,'app/desktop-client-main.mjs');
 assert.ok(Array.isArray(value.build?.files),'Windows release build.files is required');
 const packaged=new Set(value.build.files.map(normalize));
 assert.equal(packaged.has('package.json'),true,'package.json must be packaged');
 const runtime=await runtimeClosure(value.main);
 const packagedRuntime=new Set([...packaged].filter(item=>item.startsWith('app/')));
 assert.deepEqual([...packagedRuntime].sort(),[...runtime].sort(),`${path.relative(root,file)} build.files must match the desktop runtime dependency closure`);
});

test('cloud wrapper uses only the company server with Google login and registers the callback',async()=>{
 const {value}=await releasePackage(),main=await readFile(path.join(root,'app/desktop-client-main.mjs'),'utf8'),policy=await readFile(path.join(root,'app/desktop-client-policy.mjs'),'utf8');
 // 2026-10-27: 자동 업데이트는 app/desktop-updater.mjs 한 곳에서만, 공개 릴리즈 저장소에서만 (desktop-updater.test.mjs)
 assert.equal(value.dependencies?.['electron-updater'],'6.8.11');
 assert.doesNotMatch(main+policy,/\b(?:autoUpdater|checkForUpdates|setFeedURL)\b/);
 // 2026-10-28 사용자 결정: 서버 주소 고르기와 자체 서버 로그인은 없앴다. 회사 서버 + Google 로그인만 (맥·윈도우 공통)
 assert.match(main,/serverOrigin=desktopCloudOrigin;/);assert.doesNotMatch(main,/postAuth|\/healthz|gaon-client:save-server|gaon-client:forget-server|server\.json/);
 const preload=await readFile(path.join(root,'app/desktop-client-preload.cjs'),'utf8');assert.doesNotMatch(preload,/saveServer|forgetServer/);assert.match(preload,/reconnect/);
 assert.deepEqual(value.build.protocols,[{name:'GAON 직원 로그인',schemes:['studio.keelson.gaon']}]);
 assert.match(main,/desktopCloudOrigin/);assert.equal(value.build.files.includes('app/desktop-cloud-session.mjs'),true);
 assert.equal(value.build.nsis.deleteAppDataOnUninstall,false);
 assert.equal(value.build.files.includes('desktop-client-config.json'),false);
});

test('데스크톱 첫 화면 빛줄기는 웹 로그인과 같은 코드를 쓴다',async()=>{
 const web=await readFile(path.join(root,'app/js/gaon-login-motion.mjs'),'utf8').catch(()=>null);
 if(web===null)return; // 공개 릴리즈 저장소에는 웹 파일이 없다
 const desktop=await readFile(path.join(root,'app/desktop-login-motion.mjs'),'utf8');
 const body=text=>text.slice(text.indexOf('const VERT='));
 assert.equal(body(desktop),body(web),'app/js/gaon-login-motion.mjs 를 고쳤으면 app/desktop-login-motion.mjs 도 같이 고친다');
 const html=await readFile(path.join(root,'app/desktop-client-setup.html'),'utf8');
 assert.doesNotMatch(html,/서버 주소|server-form|FOR WINDOWS/,'첫 화면에서 서버 주소를 묻지 않고 운영체제 이름을 박지 않는다');
});

test('첫 화면이 읽는 앱 안 파일은 모두 앱의 허용 목록에 있다 (빠지면 화면이 멈춘다)',async()=>{
 const main=await readFile(path.join(root,'app/desktop-client-main.mjs'),'utf8');
 const listed=JSON.parse(main.match(/const setupAssets=(\[[^\]]*\]);/)[1].replace(/'/g,'"'));
 const pending=['app/desktop-client-setup.html'],seen=new Set();
 while(pending.length){
  const relative=normalize(pending.pop());if(seen.has(relative))continue;seen.add(relative);
  const ext=path.extname(relative);if(!['.html','.css','.mjs'].includes(ext))continue;
  const source=await readFile(path.join(root,relative),'utf8');
  const refs=ext==='.html'?[...source.matchAll(/\b(?:src|href)=['"](\.[^'"]+)['"]/g)].map(m=>m[1]):ext==='.css'?[...source.matchAll(/url\(\s*['"]?(\.[^'")]+)['"]?\s*\)/g)].map(m=>m[1]):[...source.matchAll(/\bimport\s+(?:[^'";]*?\sfrom\s*)?['"](\.[^'"]+)['"]/g)].map(m=>m[1]);
  for(const ref of refs)pending.push(path.relative(root,path.resolve(path.dirname(path.join(root,relative)),ref)));
 }
 const loaded=[...seen].map(file=>file.replace(/^app\//,'')).sort();
 assert.deepEqual([...listed].sort(),loaded);
});
