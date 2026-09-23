/* ============================================================
   store.js  —  서버와 이야기하는 부분 (모든 화면이 함께 쓴다)
   ============================================================

   [예전과 달라진 점]
   전에는 데이터를 브라우저 안(localStorage)에 넣어뒀다.
   그래서 같은 브라우저의 탭끼리만 연결되고, 휴대폰과 노트북은 따로 놀았다.

   지금은 모든 데이터가 서버의 PostgreSQL 에 있다.
   화면은 서버에 물어보고, 서버가 알려주는 대로 그린다.
   그래서 어떤 기기에서 접속해도 같은 게임에 참여한다.

   브라우저에 남는 것은 딱 하나, 내 번호표(참가자 토큰)뿐이다.

   [실시간은 어떻게 오나]
   EventSource 라는 브라우저 내장 기능을 쓴다.
   서버에 한 번 연결해두면, 상태가 바뀔 때마다 서버가 알아서 보내준다.
   끊기면 브라우저가 스스로 다시 연결한다. 우리가 할 일이 없다.
   ============================================================ */


/* ------------------------------------------------------------
   1) 서버에 요청 보내기
   ------------------------------------------------------------ */

/* fetch 는 서버에 요청을 보내는 브라우저 내장 함수다.
   await 는 "답이 올 때까지 기다려라"는 뜻이다.

   서버가 오류를 돌려주면 여기서 예외를 던진다.
   그래야 부르는 쪽에서 try/catch 로 한 번에 처리할 수 있다. */
async function 요청(길, 본문) {
  const 설정 = { method: 본문 ? 'POST' : 'GET' };

  if (본문) {
    설정.headers = { 'Content-Type': 'application/json' };
    설정.body = JSON.stringify(본문);       // 객체를 글자로 바꿔서 보낸다
  }

  const 응답 = await fetch(길, 설정);
  const 결과 = await 응답.json().catch(() => ({}));

  if (!응답.ok) {
    throw new Error(결과.error || '서버와 통신하지 못했습니다.');
  }
  return 결과;
}


/* ------------------------------------------------------------
   2) 내 번호표 (이 브라우저가 누구인지)
   ------------------------------------------------------------
   참가자는 아이디/비밀번호로 로그인하지 않는다.
   참가할 때 무작위 번호표를 하나 만들어 브라우저에 저장하고,
   이후 모든 요청에 이것을 같이 보낸다.

   서버에는 이 번호표를 변환한 값만 저장되므로,
   DB가 유출돼도 남의 번호표를 흉내 낼 수 없다.
   ------------------------------------------------------------ */

const 번호표_KEY = 'goldenbell-번호표';

/* 아무도 못 맞히는 무작위 글자를 만든다.
   crypto.getRandomValues 는 브라우저가 제공하는 진짜 난수다.
   Math.random 보다 훨씬 예측하기 어렵다. */
function 번호표_만들기() {
  const 바이트 = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(바이트, (b) => b.toString(16).padStart(2, '0')).join('');
}

function 번호표_읽기() {
  try { return localStorage.getItem(번호표_KEY); } catch { return null; }
}

function 번호표_저장(값) {
  try { localStorage.setItem(번호표_KEY, 값); } catch {}
}

function 번호표_지우기() {
  try { localStorage.removeItem(번호표_KEY); } catch {}
}


/* ------------------------------------------------------------
   3) 실시간 연결 (SSE)
   ------------------------------------------------------------ */

/* 서버와 내 시계의 차이(밀리초).
   휴대폰 시계는 제각각 몇 초씩 틀려 있다.
   서버가 보내준 시각과 비교해서 그 차이를 기억해두고,
   남은 시간을 계산할 때 보정한다. */
let 시차 = 0;

/* 마지막으로 받은 상태의 버전 번호.
   이보다 낮거나 같은 것이 오면 낡은 소식이므로 버린다.
   네트워크 사정으로 순서가 뒤바뀌어 도착해도 화면이 거꾸로 가지 않는다. */
let 마지막버전 = 0;

/* 서버에 연결하고, 새 상태가 올 때마다 받은함수를 실행한다. */
function 실시간_연결(받은함수) {
  const 통로 = new EventSource('/api/events');

  통로.onmessage = (사건) => {
    let 상태;
    try { 상태 = JSON.parse(사건.data); } catch { return; }

    /* ★ 낡은 소식 버리기 */
    if (상태.state_version <= 마지막버전) return;
    마지막버전 = 상태.state_version;

    시차_맞추기(상태);
    받은함수(상태);
  };

  /* 끊겨도 브라우저가 알아서 다시 연결한다.
     여기서는 화면에 표시만 해준다. */
  통로.onerror = () => {
    const 표시 = document.querySelector('#연결표시');
    if (표시) 표시.textContent = '연결 끊김 · 다시 연결 중';
  };

  통로.onopen = () => {
    const 표시 = document.querySelector('#연결표시');
    if (표시) 표시.textContent = '';
  };

  return 통로;
}

function 시차_맞추기(상태) {
  if (상태.server_now) {
    시차 = new Date(상태.server_now).getTime() - Date.now();
  }
}

/* 남은 시간을 초로 계산한다. 진행 중이 아니면 null 을 준다.

   ★ 내 시계가 아니라 "내 시계 + 시차" 를 쓴다.
     그래서 참가자 휴대폰 시계가 틀려 있어도 모두 같은 숫자를 본다. */
function 남은초(상태) {
  if (!상태 || 상태.phase !== 'running' || !상태.deadline) return null;

  const 마감 = new Date(상태.deadline).getTime();
  const 지금 = Date.now() + 시차;
  const 초 = Math.ceil((마감 - 지금) / 1000);
  return 초 > 0 ? 초 : 0;
}


/* ------------------------------------------------------------
   4) 참가자용 기능
   ------------------------------------------------------------ */

const 상태_가져오기 = () => 요청('/api/state');
const 팀목록_가져오기 = () => 요청('/api/teams');

/* 참가 등록 (진행측 노트북에서 부른다).

   ★ 여기서는 번호표를 만들지도 저장하지도 않는다.
   노트북 한 대로 80명을 등록하는데 노트북에 번호표를 저장하면
   그 노트북이 마지막 참가자 본인이 되어버린다.
   번호표는 참가자 휴대폰이 로그인할 때(아래 참가자_로그인) 받는다. */
function 참가하기(팀번호, 이름, PIN, PIN확인) {
  return 요청('/api/join', {
    teamId: 팀번호,
    name: 이름,
    pin: PIN,
    pinConfirm: PIN확인
  });
}

/* 참가자 로그인 (참가자 휴대폰에서 부른다).
   팀 + 이름 + PIN 이 맞으면 이 휴대폰의 번호표가 서버에 등록된다. */
async function 참가자_로그인(팀번호, 이름, PIN) {
  const 번호표 = 번호표_읽기() || 번호표_만들기();
  const 나 = await 요청('/api/login', {
    teamId: 팀번호,
    name: 이름,
    pin: PIN,
    sessionToken: 번호표
  });
  번호표_저장(번호표);     // 서버가 받아준 뒤에 저장한다
  return 나;
}

/* 내 정보 + 이번 문제에 낸 답을 가져온다. (새로고침 복구용) */
function 내정보_가져오기() {
  const 번호표 = 번호표_읽기();
  if (!번호표) return Promise.resolve(null);

  return 요청('/api/me', { sessionToken: 번호표 })
    .catch(() => null);      // 참가 기록이 없으면 null
}

/* 빙고판 제출. cells 는 왼쪽 위부터 읽어 나간 25칸이다. */
function 빙고판_제출하기(칸들) {
  return 요청('/api/bingo/board', { sessionToken: 번호표_읽기(), cells: 칸들 });
}

/* 답안 제출 */
function 답_제출하기(답) {
  return 요청('/api/answers', { sessionToken: 번호표_읽기(), answer: 답 });
}

/* 화면 이탈을 서버에 알린다 (부정행위 방지).

   fetch 대신 sendBeacon 을 쓰는 이유:
   다른 앱으로 넘어가는 순간 휴대폰은 이 페이지를 멈춘다.
   fetch 는 그때 중간에 끊길 수 있지만, sendBeacon 은 페이지가 멈춰도 끝까지 보내준다.
   Blob 에 type 을 적어야 서버가 JSON 으로 읽는다. */
function 이탈_알리기(이탈함) {
  const 글 = JSON.stringify({ sessionToken: 번호표_읽기(), away: 이탈함 });
  navigator.sendBeacon('/api/away', new Blob([글], { type: 'application/json' }));
}


/* ------------------------------------------------------------
   5) 진행자용 기능
   ------------------------------------------------------------
   로그인하면 서버가 쿠키를 심어준다.
   그 뒤로는 브라우저가 알아서 쿠키를 붙여 보내므로
   여기서 따로 챙길 게 없다.
   ------------------------------------------------------------ */

const 관리자_로그인 = (아이디, 비밀번호) =>
  요청('/api/admin/login', { loginId: 아이디, password: 비밀번호 });

const 관리자_로그아웃 = () => 요청('/api/admin/logout', {});

/* 콘솔에 필요한 것 전부 (상태 + 참가자 표 + 남은 문제) */
const 관리자_상태 = () => 요청('/api/admin/state');

/* 진행 버튼 누르기.

   게임종류는 '게임선택' 버튼에서만 쓴다 ('quiz' 또는 'bingo').
   나머지 버튼은 그 자리를 비워두고 보낸다. */
const 관리자_진행 = (작업, 문제번호, 게임종류, 초) =>
  요청('/api/admin/action', { action: 작업, questionId: 문제번호, gameType: 게임종류, seconds: 초 });

/* 수동 판정 */
const 관리자_판정 = (답번호, 판정) =>
  요청('/api/admin/grade', { answerId: 답번호, grade: 판정 });

/* PIN 초기화. 서버가 기본 PIN(1234)을 돌려주므로 진행자가 바로 알려줄 수 있다. */
const 관리자_PIN초기화 = (참가자번호) =>
  요청('/api/admin/reset-pin', { participantId: 참가자번호 });
