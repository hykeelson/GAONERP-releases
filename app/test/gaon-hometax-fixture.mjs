// Synthetic official-menu and ledger controls shared by the two isolated browser tests.
export function portal({wrongMonth,additionalCard=false}){
 const menus=document.getElementById('menus'),html=document.getElementById('body');
 menus.innerHTML='<a id="menuAtag_4608020100">매입세액 공제 확인/변경</a><a id="menuAtag_4609050300">월/분기별 목록조회</a>';
 for(const [idx,a] of Array.from(menus.children).entries())a.onclick=()=>{
  html.innerHTML='<h2>'+a.textContent+'</h2><label>조회 월<input type="month"></label><label><input type="radio" name="dir">매입</label><label><input type="radio" name="dir">매출</label><button>조회하기</button><div id="grid"></div>';
  html.querySelector('button').onclick=()=>{
   const month=html.querySelector('[type=month]').value;
   if(!['2026-09','2026-10'].includes(month))throw Error('기간 오류');
   const buy=html.querySelector('input[type=radio]').checked;
   const cols=idx?['작성일자','승인번호','상호','공급가액','세액','합계금액']:['승인일자','가맹점명','카드사','카드번호','공급가액','세액','합계'];
   const d=wrongMonth&&idx&&!buy?'2026-10-12':month+'-01';
   const row=idx?[d,buy?'202609121234567890a2Bc51':'202609121234567890123452',buy?'TEST 공급자':'TEST 매출처',buy?200:-100,buy?20:-10,buy?220:-110]:[d,'TEST 같은 가맹점','TEST카드','****-0001',100,10,110];
   const more=!idx&&additionalCard&&month==='2026-10';
   const paint=page=>{document.getElementById('grid').innerHTML='<span>총 '+(idx?1:more?3:2)+'건</span><table><thead><tr>'+cols.map(v=>'<th>'+v+'</th>').join('')+'</tr></thead><tbody><tr>'+(page===3?[d,'TEST 신규 가맹점','TEST카드','****-0002',200,20,220]:row).map(v=>'<td>'+v+'</td>').join('')+'</tr></tbody></table><nav><b aria-current="page">'+page+'</b><a>2</a><a>3</a></nav>';document.querySelector('nav a').onclick=()=>paint(2);document.querySelectorAll('nav a')[1].onclick=()=>paint(3);};paint(1);
  };
 };
}
