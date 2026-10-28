// 데스크톱 앱 첫 화면 빛줄기 (2026-10-28). app/js/gaon-login-motion.mjs 를 그대로 옮긴 사본이다 — 설치본에는 app/desktop-* 파일만 들어가므로 따로 둔다.
// 두 파일의 본문이 같은지는 app/test/desktop-release-package.test.mjs 가 확인한다. 웹 쪽을 고치면 이 파일도 같이 고친다.
const VERT='attribute vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}';
const FRAG=`precision highp float;
uniform vec2 u_res;uniform float u_time;uniform vec2 u_focus;uniform vec2 u_mouse;uniform float u_intro;
const float TAU=6.28318530718;const float LOOP=12.0;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float v=0.0,a=0.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<4;i++){v+=a*noise(p);p=m*p;a*=0.5;}return v;}
void main(){
 vec2 px=gl_FragCoord.xy;vec2 p=(px-0.5*u_res)/u_res.y;vec2 f=(u_focus-0.5*u_res)/u_res.y;
 float ang=TAU*mod(u_time,LOOP)/LOOP;vec2 orbit=vec2(cos(ang),sin(ang));vec2 par=(u_mouse-0.5)*0.05;
 vec3 ink=vec3(0.010,0.016,0.038);vec3 navy=vec3(0.024,0.052,0.140);
 float fog=fbm(p*1.3+orbit*0.5+par);vec3 col=mix(ink,navy,smoothstep(-0.7,0.9,p.y*0.8+fog*0.9));
 vec2 q=p-f;float ca=cos(-0.34),sa=sin(-0.34);vec2 r=vec2(ca*q.x-sa*q.y,sa*q.x+ca*q.y)+par*0.5;
 vec3 blue=vec3(0.19,0.51,0.96);vec3 ice=vec3(0.62,0.82,1.0);vec3 sky=vec3(0.39,0.66,1.0);
 float ax=abs(r.x);float grow=smoothstep(0.0,1.0,u_intro*2.4-ax*0.9);float fade=0.25+0.75*exp(-ax*0.55);
 for(int k=0;k<5;k++){float fk=float(k);float side=fk-2.0;float freq=1.4+fk*0.33;float amp=(0.05+0.025*fk)*ax;
  float y=side*0.085*ax*(1.0+0.35*sin(ang+fk))+amp*sin(r.x*freq*2.2-ang*(1.0+mod(fk,2.0))+fk*1.7);
  float d=abs(r.y-y);float w=0.003+0.016*ax;float core=exp(-(d*d)/(w*w));
  float strands=0.55+0.45*cos((r.y-y)/(w+0.002)*3.2+fk);float glow=exp(-d/(0.03+0.07*ax))*0.22;
  vec3 c=k==0?sky:(k==2?ice:(k==4?mix(ice,vec3(1.0),0.5):blue));
  col+=c*(core*strands*0.9+glow)*fade*grow;}
 float lr=length(q);float breath=0.85+0.15*sin(ang*3.0);float flash=1.0+2.5*exp(-u_intro*4.0)*step(0.001,u_intro);
 col+=vec3(0.86,0.93,1.0)*exp(-lr*34.0)*1.1*breath*flash;col+=blue*exp(-lr*5.5)*0.45*breath;
 col+=ice*exp(-abs(q.y)*120.0)*exp(-abs(q.x)*2.2)*0.55*breath*flash;col+=ice*exp(-abs(q.x)*160.0)*exp(-abs(q.y)*7.0)*0.18*breath;
 vec2 dp=p*26.0+orbit*1.2;vec2 id=floor(dp);vec2 lc=fract(dp)-0.5;float h=hash(id);vec2 off=vec2(hash(id+3.1),hash(id+7.7))-0.5;
 float star=step(0.93,h)*exp(-length(lc-off*0.6)*28.0)*(0.5+0.5*sin(u_time*2.0+h*40.0));col+=mix(ice,sky,step(0.985,h))*star*0.7;
 float vig=smoothstep(1.3,0.2,length(p*vec2(0.85,1.1)));col*=0.4+0.6*vig;col=col/(1.0+col*0.35);
 col+=(hash(px+fract(u_time))-0.5)/255.0*2.0;gl_FragColor=vec4(col,1.0);}`;

export function mountLoginMotion(portal,{win=globalThis.window}={}){
 const canvas=portal?.querySelector('.gaon-login-motion');if(!canvas||canvas.dataset.mounted)return ()=>{};canvas.dataset.mounted='1';
 const gl=canvas.getContext('webgl',{antialias:false,premultipliedAlpha:false,powerPreference:'low-power'});
 if(!gl){canvas.dataset.fallback='1';return ()=>{};}
 const sh=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);return s;};
 const prog=gl.createProgram();gl.attachShader(prog,sh(gl.VERTEX_SHADER,VERT));gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FRAG));gl.linkProgram(prog);
 if(!gl.getProgramParameter(prog,gl.LINK_STATUS)){canvas.dataset.fallback='1';return ()=>{};}
 gl.useProgram(prog);const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const loc=gl.getAttribLocation(prog,'a');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
 const U=n=>gl.getUniformLocation(prog,n),uRes=U('u_res'),uTime=U('u_time'),uFocus=U('u_focus'),uMouse=U('u_mouse'),uIntro=U('u_intro');
 const mouse={x:.5,y:.5,tx:.5,ty:.5},focusEl=portal.querySelector('[data-login-focus]');let dpr=1,raf=0,stopped=false;
 const size=()=>{dpr=Math.min(win.devicePixelRatio||1,1.5);canvas.width=Math.round(canvas.clientWidth*dpr);canvas.height=Math.round(canvas.clientHeight*dpr);gl.viewport(0,0,canvas.width,canvas.height);};size();
 const reduce=win.matchMedia?.('(prefers-reduced-motion: reduce)').matches,start=performance.now();
 const draw=now=>{
  if(stopped)return;
  if(portal.hidden){stop();return;}
  mouse.x+=(mouse.tx-mouse.x)*.04;mouse.y+=(mouse.ty-mouse.y)*.04;
  const el=(now-start)/1000,t=reduce?2.4:el+1.2,intro=reduce?1:Math.min(1,Math.max(0,(el-.5)/2.2));
  const fr=focusEl?.getBoundingClientRect(),cr=canvas.getBoundingClientRect();
  const fx=fr&&fr.width?(fr.left-cr.left+fr.width/2)*dpr:canvas.width*.3,fy=fr&&fr.width?canvas.height-(fr.top-cr.top+fr.height/2)*dpr:canvas.height*.55;
  gl.uniform2f(uRes,canvas.width,canvas.height);gl.uniform1f(uTime,t);gl.uniform2f(uFocus,fx,fy);gl.uniform2f(uMouse,mouse.x,mouse.y);gl.uniform1f(uIntro,intro);
  gl.drawArrays(gl.TRIANGLES,0,3);
  if(!reduce&&!win.document.hidden)raf=win.requestAnimationFrame(draw);
 };
 const ro=new ResizeObserver(()=>{size();if(reduce)win.requestAnimationFrame(draw);});ro.observe(canvas);
 const onMove=e=>{mouse.tx=e.clientX/win.innerWidth;mouse.ty=1-e.clientY/win.innerHeight;};
 const onVis=()=>{win.cancelAnimationFrame(raf);if(!win.document.hidden&&!stopped)raf=win.requestAnimationFrame(draw);};
 win.addEventListener('pointermove',onMove);win.document.addEventListener('visibilitychange',onVis);
 // 로그인해서 포털이 숨겨지면 바로 멈춘다
 const mo=new MutationObserver(()=>{if(portal.hidden)stop();else if(stopped){stopped=false;raf=win.requestAnimationFrame(draw);}});mo.observe(portal,{attributes:true,attributeFilter:['hidden']});
 function stop(){stopped=true;win.cancelAnimationFrame(raf);}
 raf=win.requestAnimationFrame(draw);
 return ()=>{stop();ro.disconnect();mo.disconnect();win.removeEventListener('pointermove',onMove);win.document.removeEventListener('visibilitychange',onVis);gl.deleteBuffer(buf);gl.deleteProgram(prog);};
}
