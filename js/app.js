/* ============================================================
   app.js  —  화면을 그리고 버튼을 동작시키는 파일
   ============================================================

   [구조]
   페이지마다 <body data-page="join"> 처럼 이름표를 붙여놨다.
   이 파일 맨 아래에서 그 이름표를 읽고, 해당 페이지 담당 함수를 실행한다.
   그래서 js 파일을 페이지마다 따로 만들지 않아도 된다.

   [데이터는 어디서 오나]
   전부 서버에서 온다. 이 파일은 저장을 하지 않는다.
       화면 그리기  ← 이 파일 (app.js)
       서버 통신    ← store.js
   둘을 나눠두면 한쪽을 바꿔도 다른 쪽을 안 건드려도 된다.

   [자주 나오는 것들]
   document.querySelector('#이름')  → id가 '이름'인 요소 하나를 찾아온다
   요소.textContent = '글자'        → 그 요소 안의 글자를 바꾼다
   요소.innerHTML   = '<b>글자</b>' → HTML 태그째로 집어넣는다
   요소.onclick     = 함수          → 클릭했을 때 실행할 일을 정한다
   location.href    = '주소'        → 다른 페이지로 이동한다
   async / await                    → 서버 답이 올 때까지 기다린다
   ============================================================ */


/* 매번 document.querySelector 라고 쓰기 길어서 짧은 이름을 붙였다. */
function 찾기(선택자) {
  return document.querySelector(선택자);
}

/* 단계(phase) 영어 이름을 사람이 읽을 한글로 바꾼다. */
const 단계이름 = {
  waiting:   '대기 중',
  published: '문제 공개',
  running:   '진행 중',
  closed:    '답변 마감',
  finalized: '판정 확정',
  revealed:  '정답 공개',
  finished:  '게임 종료'
};

/* 빙고 단계 영어 이름을 한글로 바꾼다. */
const 빙고단계이름 = {
  setup:    '배치 중',
  running:  '번호 부르는 중',
  finished: '종료'
};

/* 지금 문제가 "몇 번째로 낸 문제"인가.

   ★ 문제에 매겨진 번호(question_order)를 쓰지 않는 이유
   진행자는 목록에서 아무 문제나 골라서 낼 수 있다.
   3번 문제를 맨 처음 냈다면 참가자에게는 그게 '1번째 문제'다.

   낸 문제 수 = 전체 문제 수 - 아직 안 낸 문제 수
   지금 내고 있는 문제도 '낸 문제'에 들어가므로 그대로 쓰면 된다.

   프로젝터와 참가자 화면이 같은 숫자를 보여줘야 하므로
   계산을 한 곳에 모아두고 둘 다 이 함수를 쓴다. */
function 진행순번(상태) {
  return 상태.total_questions - 상태.remaining_questions;
}

/* 정답 배열을 보기 좋은 글자로 바꾼다.
   인정 정답이 여러 개면 가운뎃점으로 이어 붙인다. */
function 정답글자(상태) {
  if (!상태.correct_answers) return '';
  return 상태.correct_answers.join(' · ');
}

/* 빙고에서 쓰는 번호의 끝. server/server.js 의 빙고최대번호 와 같아야 한다. */
const 빙고최대번호 = 50;

/* 숫자를 열 개씩 묶은 목록. 배치 화면의 묶음 버튼이 이걸 쓴다.
   1~50 을 한 화면에 다 깔면 칸이 너무 작아져서 손가락으로 집을 수가 없다.
   열 개씩 보여주면 칸이 커지고, 원하는 묶음만 열어 쓰면 된다. */
const 빙고묶음 = [];
for (let 시작 = 1; 시작 <= 빙고최대번호; 시작 += 10) {
  빙고묶음.push({ 시작, 끝: Math.min(시작 + 9, 빙고최대번호) });
}

/* 빙고판 25칸을 5x5 격자로 그린다.
   부른 번호에 들어 있는 칸은 '맞음' 표시가 붙어 색이 바뀐다.
   값이 null 인 칸은 아직 안 채운 빈 칸이다. */
function 빙고판HTML(칸들, 부른번호) {
  return '<div class="빙고판">' +
    칸들.map((값, 자리) => {
      const 칠함 = 값 !== null && 부른번호.includes(값);
      return `<span class="빙고칸${칠함 ? ' 맞음' : ''}" data-자리="${자리}">${값 ?? ''}</span>`;
    }).join('') +
    '</div>';
}

/* 화면에서 튕겨난 이유를 새로고침 뒤에도 알려주려고 잠깐 적어둔다.

   [왜 필요한가]
   진행자가 초기화를 누르면 참가자 기록이 사라진다.
   그러면 참가자 화면은 로그인 칸으로 되돌아가는데,
   아무 말이 없으면 본인은 "왜 갑자기 로그아웃됐지" 하고
   같은 이름을 계속 넣어본다. 이미 지워진 사람이라 영원히 안 들어가진다.

   sessionStorage 는 탭을 닫으면 사라지는 저장소다.
   새로고침은 견디고 다음 사람에게는 안 남으므로 이런 쪽지에 딱 맞다. */
const 튕긴이유_KEY = 'goldenbell-튕긴이유';

function 튕긴이유_적기(글) {
  try { sessionStorage.setItem(튕긴이유_KEY, 글); } catch {}
}

/* 꺼내면서 지운다. 한 번만 보여주고 말아야 하는 글이기 때문이다. */
function 튕긴이유_꺼내기() {
  try {
    const 글 = sessionStorage.getItem(튕긴이유_KEY);
    sessionStorage.removeItem(튕긴이유_KEY);
    return 글;
  } catch { return null; }
}

/* 오류 메시지를 화면에 띄운다. */
function 알리기(선택자, 글) {
  const 칸 = 찾기(선택자);
  if (칸) 칸.textContent = 글 || '';
}

/* 타이머 칸을 1초마다 새로 그린다.
   상태를 직접 들고 있지 않고 "가져오는 함수"를 받는 이유는,
   실시간으로 상태가 바뀌어도 항상 최신 값을 보게 하기 위해서다. */
function 타이머_돌리기(상태가져오기) {
  setInterval(() => {
    const 칸 = 찾기('#타이머');
    if (!칸) return;

    const 초 = 남은초(상태가져오기());

    if (초 === null) {
      칸.textContent = '-';
      칸.classList.remove('위급');
      return;
    }

    칸.textContent = 초;

    /* 5초 이하로 남으면 빨갛게 두근거리게 만든다. (css 의 .위급) */
    if (초 <= 5) 칸.classList.add('위급');
    else 칸.classList.remove('위급');
  }, 1000);
}


/* PIN 은 숫자 4자리만 받는다.
   등록 화면과 로그인 화면이 같은 규칙을 써야 하므로 한 곳에 모아둔다. */
const PIN규칙 = /^\d{4}$/;


/* ============================================================
   1) 참가 등록 화면  (html/join.html)  ★ 진행측 노트북에서 연다
   ============================================================
   한 번 등록하면 다른 화면으로 넘어가지 않는다.
   칸만 비우고 그 자리에서 다음 사람을 계속 받는다. */
async function 참가화면_시작() {
  const 팀선택 = 찾기('#팀선택');
  const 이름칸 = 찾기('#이름입력');
  const PIN칸 = 찾기('#PIN입력');
  const PIN확인칸 = 찾기('#PIN확인');
  const 참가버튼 = 찾기('#참가버튼');

  /* 팀 목록을 서버에서 받아 고르는 칸을 채운다.
     현재 인원 / 정원 을 같이 보여주고, 꽉 찬 팀은 고를 수 없게 막는다.

     한 명 등록할 때마다 인원이 바뀌므로 다시 부를 수 있게 함수로 만들었다.
     고른 팀은 유지한다 — 같은 팀이 여러 명 줄 서서 들어오기 때문이다. */
  async function 팀칸_채우기() {
    const 고른팀 = 팀선택.value;
    const 팀들 = await 팀목록_가져오기();

    팀선택.innerHTML = '';
    팀들.forEach((팀) => {
      const 칸 = document.createElement('option');
      칸.value = 팀.id;
      칸.textContent = `${팀.name} (${팀.members}/${팀.max_members})`;
      if (팀.members >= 팀.max_members) {
        칸.disabled = true;                   // 정원 초과 → 선택 불가
        칸.textContent += ' 정원 마감';
      }
      팀선택.appendChild(칸);
    });

    if (고른팀) 팀선택.value = 고른팀;

    /* 왼쪽 팀 현황도 같이 채운다.
       접수대에서 "몇 팀이 아직 비었나"를 눈으로 보고 안내할 수 있다.
       좁은 화면에서는 이 자리가 없으므로 있을 때만 그린다. */
    const 팀현황 = 찾기('#팀현황');
    if (팀현황) {
      팀현황.innerHTML = 팀들.map((팀) => {
        const 찼나 = 팀.members >= 팀.max_members;
        return `<div class="팀칸${찼나 ? ' 마감' : ''}">` +
          `<b>${팀.name}</b>` +
          `<span>${팀.members} / ${팀.max_members}</span>` +
          `<small>${찼나 ? '정원 마감' : `${팀.max_members - 팀.members}자리 남음`}</small>` +
          '</div>';
      }).join('');
    }
  }

  await 팀칸_채우기();

  참가버튼.onclick = async () => {
    const 이름 = 이름칸.value.trim();
    const PIN = PIN칸.value;
    알리기('#알림', '');
    알리기('#등록완료', '');

    /* 보내기 전에 여기서도 한 번 확인한다.
       서버도 똑같이 확인하지만, 미리 걸러주면 기다림 없이 바로 알려줄 수 있다.
       ★ 화면 검사는 편의일 뿐이고, 진짜 방어는 서버와 DB가 한다. */
    if (이름.length < 1 || 이름.length > 20) {
      알리기('#알림', '이름을 1~20자로 입력해주세요.');
      return;
    }
    if (!PIN규칙.test(PIN)) {
      알리기('#알림', 'PIN 은 숫자 4자리로 입력해주세요.');
      return;
    }
    if (PIN !== PIN확인칸.value) {
      알리기('#알림', 'PIN 두 칸이 서로 다릅니다. 다시 눌러주세요.');
      PIN칸.value = '';
      PIN확인칸.value = '';
      PIN칸.focus();
      return;
    }

    /* 버튼을 잠가서 두 번 눌리는 것을 막는다.
       느린 네트워크에서 조급해진 사람이 연타하는 일이 흔하다. */
    참가버튼.disabled = true;
    참가버튼.textContent = '등록 중…';

    try {
      const 참가자 = await 참가하기(Number(팀선택.value), 이름, PIN, PIN확인칸.value);

      /* 다음 사람을 받을 준비.
         팀은 그대로 두고 이름과 PIN 만 비운다. */
      이름칸.value = '';
      PIN칸.value = '';
      PIN확인칸.value = '';
      알리기('#등록완료', `${참가자.team_name} · ${참가자.name} 등록 완료`);
      await 팀칸_채우기();
      이름칸.focus();
    } catch (오류) {
      알리기('#알림', 오류.message);        // 예: 같은 팀에 이미 같은 이름이 있습니다
    }

    참가버튼.disabled = false;
    참가버튼.textContent = '등록하기';
  };

  /* PIN 확인 칸에서 엔터를 치면 바로 등록되게 한다.
     현장에서 마우스로 버튼을 찾는 시간이 아깝다. */
  PIN확인칸.onkeydown = (e) => { if (e.key === 'Enter') 참가버튼.click(); };
}


/* ============================================================
   2-0) 참가자 로그인  (play.html 안에서 그린다)
   ============================================================
   참가자는 등록을 하지 않는다. 등록은 입구의 진행측 노트북이 이미 해뒀다.
   여기서는 "그게 나다"를 증명하기만 한다 — 팀 + 이름 + PIN.

   ★ 새 html 파일을 만들지 않고 게임 화면 안에 넣었다.
   참가자가 외울 주소가 하나(play.html)면 현장에서 안내가 훨씬 쉽다.

   [반환값이 Promise 인 이유]
   "사람이 PIN 을 맞게 넣을 때까지"는 언제 끝날지 모르는 일이다.
   Promise 는 그런 일을 담아두는 상자이고,
   끝내기() 를 부르는 순간 await 로 기다리던 쪽이 다시 움직인다. */
async function 로그인_받기() {
  const 팀들 = await 팀목록_가져오기();

  찾기('#내이름').textContent = '참가자 로그인';
  찾기('#단계표시').textContent = '로그인';

  찾기('#본문').innerHTML =
    '<section class="카드">' +
      '<p class="눈썹">LOGIN</p>' +
      '<h2 style="margin:0 0 6px">접속하기</h2>' +
      '<p class="안내">입구에서 등록할 때 직접 누른 PIN 네 자리를 입력해주세요.</p>' +
      '<div class="입력묶음" style="margin-top:18px">' +
        '<label for="로그인팀">팀</label>' +
        '<select id="로그인팀">' +
          팀들.map((팀) => `<option value="${팀.id}">${팀.name}</option>`).join('') +
        '</select>' +
        '<label for="로그인이름">이름</label>' +
        '<input id="로그인이름" maxlength="20" placeholder="예) 김철수" autocomplete="off">' +
        '<label for="로그인PIN">PIN 4자리</label>' +
        '<input id="로그인PIN" type="password" inputmode="numeric" maxlength="4" ' +
               'placeholder="숫자 4자리" autocomplete="off">' +
        /* 접속 버튼은 바로 위 PIN 칸과 같은 크기로 맞춘다.
           높이는 입력칸과 같은 52px, 폭은 css/style.css 의 #로그인시작 규칙이 맞춘다. */
        '<button class="주요버튼" id="로그인시작" style="min-height:52px">접속</button>' +
        '<p class="오류" id="로그인알림"></p>' +
      '</div>' +

      /* 등록 화면(join.html)으로 가는 길은 두지 않는다.
         등록은 진행자 콘솔에서만 연다 (참가자가 스스로 등록하면 안 된다).
         등록 안 된 사람은 무엇을 넣어도 못 들어오므로, 진행측을 찾으라고만 알려준다. */
      '<p class="안내" style="margin:16px 0 0;text-align:center">' +
        '아직 등록 전이라면 입구의 진행측에 먼저 등록해주세요.' +
      '</p>' +
    '</section>';

  const 버튼 = 찾기('#로그인시작');
  const PIN칸 = 찾기('#로그인PIN');

  /* 초기화로 튕겨나서 여기 온 것이면 그 사정을 먼저 알려준다. */
  const 튕긴이유 = 튕긴이유_꺼내기();
  if (튕긴이유) 알리기('#로그인알림', 튕긴이유);

  return new Promise((끝내기) => {
    버튼.onclick = async () => {
      알리기('#로그인알림', '');

      const PIN = PIN칸.value;
      if (!PIN규칙.test(PIN)) {
        알리기('#로그인알림', 'PIN 은 숫자 4자리입니다.');
        return;
      }

      버튼.disabled = true;
      버튼.textContent = '확인 중…';

      try {
        await 참가자_로그인(
          Number(찾기('#로그인팀').value),
          찾기('#로그인이름').value.trim(),
          PIN
        );
        끝내기();                       // 성공 → 기다리던 게임 화면이 이어서 그려진다
      } catch (오류) {
        /* 어디가 틀렸는지 서버는 구분해서 알려주지 않는다.
           "이 사람은 등록돼 있다"는 정보가 새면 안 되기 때문이다.

           대신 화면에서 "등록이 안 돼 있을 수도 있다"는 가능성을 같이 알려준다.
           서버가 흘리는 정보는 없으면서, 막힌 사람이 다음에 뭘 해야 할지는 보인다. */
        알리기('#로그인알림',
          오류.message + ' (등록이 안 돼 있으면 진행측에 말씀해주세요)');
        PIN칸.value = '';
        버튼.disabled = false;
        버튼.textContent = '접속';
      }
    };

    PIN칸.onkeydown = (e) => { if (e.key === 'Enter') 버튼.click(); };
  });
}


/* ============================================================
   2) 참가자 게임 화면  (html/play.html)
   ============================================================ */
async function 게임화면_시작() {
  let 상태 = null;      // 서버가 알려준 게임 상태
  let 나 = null;        // 내 정보 (이름, 팀, 생존 여부)
  let 내답 = null;      // 이번 문제에 내가 낸 답
  let 고른답 = null;    // 아직 제출 전, 화면에서 고르기만 한 답
  let 내판 = null;      // 내 빙고판 (없으면 null)

  /* 빙고판을 채우는 중인 상태.
     25칸짜리 배열이고, 아직 안 채운 칸은 null 이다.
     제출하기 전까지는 서버에 보내지 않는다. */
  let 채우는판 = Array(25).fill(null);

  let 고른묶음 = 0;         // 지금 열어둔 숫자 묶음 (0 = 1~10)
  /* Esc 키를 누르면 dialog 는 원래 닫히는데(cancel 사건), 그걸 막는다.
     빙고 팝업은 진행자가 끝낼 때까지 떠 있어야 한다. */
  찾기('#빙고팝업').addEventListener('cancel', (사건) => 사건.preventDefault());

  let 끄는중 = false;       // 숫자를 끌고 있는 중인가
  let 끌어서옮김 = false;   // 방금 끌어서 놓았나 (놓자마자 지워지는 걸 막는다)

  /* 숫자를 손가락(또는 마우스)으로 끌어다 판에 놓는다.

     [왜 pointer 사건을 쓰나]
     HTML 에는 draggable 이라는 기능이 원래 있지만 휴대폰 터치에서는 동작하지 않는다.
     pointerdown / pointermove / pointerup 은 손가락과 마우스를 똑같이 처리해서
     코드 한 벌로 둘 다 된다.

     값      = 끌고 있는 숫자
     출처자리 = 판에서 집어 온 경우 그 칸 번호. 숫자 목록에서 집었으면 null */
  function 빙고_끌기시작(사건, 값, 출처자리) {
    사건.preventDefault();          // 끄는 동안 화면이 같이 스크롤되지 않게
    끄는중 = true;
    끌어서옮김 = false;

    /* 손가락을 따라다니는 숫자를 하나 만든다.
       원래 숫자를 직접 움직이면 자리가 무너지므로 따로 띄운다. */
    const 유령 = document.createElement('div');
    유령.className = '빙고유령';
    유령.textContent = 값;
    document.body.appendChild(유령);

    const 따라가기 = (e) => {
      유령.style.left = e.clientX + 'px';
      유령.style.top = e.clientY + 'px';
    };
    따라가기(사건);

    const 놓기 = (e) => {
      document.removeEventListener('pointermove', 따라가기);
      document.removeEventListener('pointerup', 놓기);
      document.removeEventListener('pointercancel', 놓기);
      유령.remove();
      끄는중 = false;

      /* elementFromPoint = 그 좌표에 실제로 있는 요소를 알려준다.
         유령은 pointer-events: none 이라 여기에 안 잡힌다 (css 참고). */
      const 아래 = document.elementFromPoint(e.clientX, e.clientY);
      const 칸 = 아래 && 아래.closest('.빙고칸');

      if (칸) {
        const 놓을자리 = Number(칸.dataset.자리);
        const 있던값 = 채우는판[놓을자리];
        채우는판[놓을자리] = 값;

        /* 판 안에서 옮긴 경우, 원래 자리에는 밀려난 값을 넣는다.
           둘 다 숫자면 서로 자리가 바뀌고, 빈 칸으로 옮겼으면 원래 자리가 빈다. */
        if (출처자리 !== null) 채우는판[출처자리] = 있던값;
        끌어서옮김 = true;
      }

      그리기();
      /* 놓자마자 click 사건이 이어서 오므로, 한 박자 뒤에 표시를 내린다. */
      setTimeout(() => { 끌어서옮김 = false; }, 0);
    };

    document.addEventListener('pointermove', 따라가기);
    document.addEventListener('pointerup', 놓기);
    document.addEventListener('pointercancel', 놓기);
  }

  /* 이 휴대폰의 번호표가 아직 없거나 쓸모없어졌으면 로그인부터 받는다.

     ★ 예전에는 등록 화면(join.html)으로 보냈지만,
     이제 등록은 진행측 노트북에서만 한다. 참가자는 로그인만 한다.
     PIN 이 초기화되면 서버가 번호표를 지우므로 여기로 다시 떨어진다. */
  let 처음 = await 내정보_가져오기();
  if (!처음) {
    번호표_지우기();
    await 로그인_받기();                  // 로그인에 성공할 때까지 여기서 멈춘다
    처음 = await 내정보_가져오기();

    /* 로그인 직후에 진행자가 초기화를 눌렀다면 여기서 또 비어 있을 수 있다.
       그대로 두면 아래에서 터지므로 화면을 다시 연다. */
    if (!처음) { location.reload(); return; }
  }
  나 = 처음.me;
  내답 = 처음.myAnswer;
  내판 = 처음.myBoard;

  /* --- 빙고 화면 ---
     진행자가 빙고를 고르면 이 화면이 퀴즈 화면 대신 그려진다.

     세 가지 경우뿐이다.
       1. 배치 중인데 내 판이 없다   → 1~25 를 직접 놓는 화면
       2. 배치 중인데 내 판이 있다   → 다 냈으니 기다리는 화면 (고칠 수도 있다)
       3. 번호를 부르는 중 / 끝났다  → 칠해지는 내 판 */
  function 빙고화면_그리기(본문) {
    const 부른번호 = 상태.bingo_called ?? [];

    /* --- 1) 판 놓기 --- */
    if (상태.bingo_phase === 'setup' && !내판) {
      const 채운칸 = 채우는판.filter((값) =>값 !== null).length;
      const 묶음 = 빙고묶음[고른묶음];

      /* 지금 열어둔 묶음에서 아직 판에 안 올린 숫자만 보여준다. */
      const 쓸수있는숫자 = [];
      for (let n = 묶음.시작; n <= 묶음.끝; n++) {
        if (!채우는판.includes(n)) 쓸수있는숫자.push(n);
      }

      본문.innerHTML =
        '<section class="카드">' +
          '<p class="눈썹">BINGO</p>' +
          '<h2 style="margin:0 0 6px">내 빙고판 만들기</h2>' +
          `<p class="안내">1~${빙고최대번호} 중에서 <b>25개</b>를 골라 끌어다 놓으세요. ` +
            '올려둔 숫자는 다른 칸으로 옮길 수 있고, 칸을 짧게 누르면 지워집니다.</p>' +

          빙고판HTML(채우는판, []) +
          `<p class="안내" style="text-align:center">${채운칸} / 25 칸</p>` +

          /* 숫자 묶음 고르기. 지금 열어둔 묶음만 초록으로 표시한다. */
          '<div class="빙고묶음">' +
            빙고묶음.map((묶, i) =>
              `<button class="빙고묶음버튼${i === 고른묶음 ? ' 고름' : ''}" data-묶음="${i}">` +
              `${묶.시작}~${묶.끝}</button>`).join('') +
          '</div>' +

          '<div class="빙고숫자">' +
            (쓸수있는숫자.length === 0
              ? '<p class="안내" style="grid-column:1/-1;text-align:center">이 묶음은 다 올렸습니다</p>'
              : 쓸수있는숫자.map((n) =>
                  `<span class="빙고숫자칩" data-숫자="${n}">${n}</span>`).join('')) +
          '</div>' +

          '<div class="진행버튼" style="margin-top:16px">' +
            '<button class="보조버튼" id="빙고섞기">무작위로 채우기 🎲</button>' +
            '<button class="보조버튼" id="빙고지우기">전부 지우기</button>' +
          '</div>' +
          `<button class="주요버튼" id="빙고제출" style="margin-top:12px;width:100%"${채운칸 < 25 ? ' disabled' : ''}>` +
            (채운칸 < 25 ? `${25 - 채운칸}칸 더 채워주세요` : '이 판으로 제출하기') +
          '</button>' +
          '<p class="오류" id="빙고알림"></p>' +
        '</section>';

      /* 묶음 버튼 → 보여줄 숫자 묶음을 바꾼다 */
      본문.querySelectorAll('.빙고묶음버튼').forEach((버튼) => {
        버튼.onclick = () => {
          고른묶음 = Number(버튼.dataset.묶음);
          그리기();
        };
      });

      /* 숫자 칩 → 끌어다 판에 놓는다 */
      본문.querySelectorAll('.빙고숫자칩').forEach((칩) => {
        칩.onpointerdown = (e) => 빙고_끌기시작(e, Number(칩.dataset.숫자), null);
      });

      /* 판의 칸
           끌면  → 다른 칸으로 옮긴다 (그 칸에 숫자가 있으면 서로 자리를 바꾼다)
           짧게 누르면 → 그 자리를 비운다 */
      본문.querySelectorAll('.빙고칸').forEach((칸) => {
        const 자리 = Number(칸.dataset.자리);
        칸.onpointerdown = (e) => {
          if (채우는판[자리] === null) return;          // 빈 칸은 끌 게 없다
          빙고_끌기시작(e, 채우는판[자리], 자리);
        };
        칸.onclick = () => {
          if (끌어서옮김) return;      // 방금 끌어다 놓은 것이면 지우지 않는다
          채우는판[자리] = null;
          그리기();
        };
      });

      찾기('#빙고섞기').onclick = () => {
        /* 1~50 을 만들어 뒤에서부터 무작위로 자리를 바꾼 뒤(피셔-예이츠 섞기)
           앞에서 25개만 잘라 쓴다.
           그냥 sort(() => Math.random() - 0.5) 로 섞으면 고르게 안 섞인다. */
        const 숫자들 = Array.from({ length: 빙고최대번호 }, (_, i) => i + 1);
        for (let i = 숫자들.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [숫자들[i], 숫자들[j]] = [숫자들[j], 숫자들[i]];
        }
        채우는판 = 숫자들.slice(0, 25);
        그리기();
      };

      찾기('#빙고지우기').onclick = () => {
        채우는판 = Array(25).fill(null);
        그리기();
      };

      찾기('#빙고제출').onclick = async () => {
        const 버튼 = 찾기('#빙고제출');
        버튼.disabled = true;
        버튼.textContent = '보내는 중…';
        try {
          await 빙고판_제출하기(채우는판);
          await 내정보_새로고침();
          그리기();
        } catch (오류) {
          알리기('#빙고알림', 오류.message);
          버튼.disabled = false;
          버튼.textContent = '이 판으로 제출하기';
        }
      };
      return;
    }

    /* --- 2) 판을 냈고, 아직 시작 전 --- */
    if (상태.bingo_phase === 'setup') {
      본문.innerHTML =
        '<section class="카드">' +
          '<p class="눈썹">BINGO</p>' +
          '<h2 style="margin:0 0 6px">판을 냈습니다</h2>' +
          '<p class="안내">진행자가 번호를 부르기 시작하면 자동으로 칠해집니다. ' +
            '시작 전까지는 다시 만들 수 있습니다.</p>' +
          빙고판HTML(내판.cells, []) +
          `<p class="안내" style="text-align:center">${상태.bingo_boards}명이 판을 냈습니다</p>` +
          '<button class="보조버튼" id="빙고다시" style="margin-top:12px;width:100%">판 다시 만들기</button>' +
        '</section>';

      찾기('#빙고다시').onclick = () => {
        채우는판 = Array(25).fill(null);
        내판 = null;               // 화면만 되돌린다. 서버의 판은 제출할 때 덮어쓴다
        그리기();
      };
      return;
    }

    /* --- 3) 번호를 부르는 중이거나 끝났다 --- */
    if (!내판) {
      본문.innerHTML =
        '<section class="카드">' +
          '<p class="눈썹">BINGO</p>' +
          '<h2 style="margin:0 0 6px">이번 판은 구경만</h2>' +
          '<p class="안내">배치 시간에 판을 내지 않아 이번 빙고에는 참여할 수 없습니다. ' +
            '다음 판을 기다려주세요.</p>' +
        '</section>';
      return;
    }

    const 줄수 = 내판.lines ?? 0;
    const 빙고달성 = 줄수 >= 상태.bingo_goal;

    본문.innerHTML =
      '<section class="카드">' +
        (빙고달성
          ? '<p class="눈썹">BINGO!</p><h2 style="margin:0 0 6px">빙고입니다! 🎉</h2>'
          : `<p class="눈썹">BINGO</p><h2 style="margin:0 0 6px">${상태.bingo_goal}줄을 만들어주세요</h2>`) +
        '<div class="결과상자" style="margin:0 0 16px">' +
          `<strong>방금 부른 번호 · ${상태.bingo_last ?? '-'}</strong>` +
          `<span>내 줄 ${줄수} / ${상태.bingo_goal} · 부른 번호 ${부른번호.length}개</span>` +
        '</div>' +
        빙고판HTML(내판.cells, 부른번호) +
        (상태.bingo_phase === 'finished'
          ? '<p class="안내" style="text-align:center">빙고가 끝났습니다.</p>'
          : `<p class="안내" style="text-align:center">지금까지 ${상태.bingo_winners}명이 빙고를 만들었습니다.</p>`) +
      '</section>';
  }

  /* --- 화면 그리기 ---
     상태가 바뀔 때마다 통째로 다시 그린다.
     조금씩 고치는 것보다 전부 다시 그리는 쪽이 훨씬 덜 헷갈린다. */
  function 그리기() {
    if (!상태) return;

    /* 숫자를 끌고 있는 동안에는 다시 그리지 않는다.
       배치 시간에는 다른 참가자가 판을 낼 때마다 새 소식이 오는데,
       그때마다 화면을 다시 만들면 끌고 있던 숫자가 손에서 사라진다. */
    if (끄는중) return;

    const 본문 = 찾기('#본문');
    찾기('#내이름').textContent = `${나.team_name} ${나.name}`;

    /* 문제가 떠 있는 동안만 글자 선택을 막는다 (css 의 .복사금지).
       classList.toggle(이름, 참거짓) = 참이면 붙이고 거짓이면 뗀다. */
    document.body.classList.toggle('복사금지', 감시중인가());

    /* ★ 빙고 달성 팝업은 진행자가 빙고를 끝낼 때까지 띄워둔다.
       조건: 지금 게임이 빙고 + 번호 부르는 중(running) + 내 줄 수가 목표 이상.
       진행자가 '빙고 종료'(finished)·초기화(setup)·퀴즈 전환을 누르면
       조건이 깨지므로 그때 닫힌다. 팝업.open = 지금 열려 있나 */
    const 팝업 = 찾기('#빙고팝업');
    const 팝업띄울까 = 상태.current_game === 'bingo' && 상태.bingo_phase === 'running' &&
      !!내판 && (내판.lines ?? 0) >= 상태.bingo_goal;
    if (팝업띄울까 && !팝업.open) 팝업.showModal();
    if (!팝업띄울까 && 팝업.open) 팝업.close();

    /* ★ 진행자가 고른 게임에 따라 화면을 통째로 갈아 끼운다.
       이 값은 실시간(SSE)으로 오므로 진행자가 누르는 순간 바뀐다. */
    if (상태.current_game === 'bingo') {
      찾기('#단계표시').textContent = 빙고단계이름[상태.bingo_phase] ?? '-';
      빙고화면_그리기(본문);
      return;
    }

    찾기('#단계표시').textContent = 단계이름[상태.phase] ?? '-';

    /* 정답을 봐도 되는 때인가? 진행자가 '정답 공개'를 누른 뒤부터다.
       서버가 그 전에는 정답 자리를 비워서 보내므로,
       화면에서 실수로 보여주려 해도 보여줄 내용 자체가 없다. */
    const 정답있음 = !!상태.correct_answers;

    /* --- ★ 패자부활전 중인데 이 사람은 도전자가 아닌 경우 ---
       생존자는 쉬는 차례, 이번 부활전에서 틀린 사람은 부활 실패.
       도전자('in')는 이 칸을 지나 아래의 평소 문제 화면을 그대로 쓴다. */
    if (상태.revival && 나.revival_status !== 'in') {
      const 생존자 = 나.status === 'active';
      본문.innerHTML =
        '<section class="카드">' +
        '<p class="눈썹">REVIVAL</p>' +
        (생존자
          ? '<h1>패자부활전 진행 중</h1>' +
            '<p class="안내">탈락자들이 부활에 도전하고 있습니다. 생존자는 쉬는 차례예요. 잠시 기다려주세요.</p>'
          : '<h1>아쉽게 부활하지 못했습니다</h1>' +
            '<p class="안내">화면은 계속 볼 수 있습니다.</p>') +
        '</section>';
      return;
    }

    /* --- 탈락한 경우 (정답은 알려준다) ---
       패자부활전 도전자는 탈락 상태지만 문제를 풀어야 하므로 여기서 빼준다. */
    if (나.status === 'eliminated' && !상태.revival) {
      본문.innerHTML =
        '<section class="카드">' +
        '<p class="눈썹">ELIMINATED</p>' +
        '<h1>아쉽게 탈락했습니다</h1>' +
        '<p class="안내">부활전을 기다려주세요. 화면은 계속 볼 수 있습니다.</p>' +
        (정답있음
          ? '<div class="결과상자" style="margin-top:18px">' +
            `<strong>${진행순번(상태)}번째 문제 정답 · ${정답글자(상태)}</strong>` +
            `<span>${내답 ? '내가 낸 답 · ' + 내답.answer : '답을 내지 않았습니다'}</span>` +
            '</div>'
          : '') +
        '</section>';
      return;
    }

    /* --- 게임이 끝난 경우 (진행자가 '퀴즈 종료'를 눌렀을 때) --- */
    if (상태.phase === 'finished') {
      const 우승자수 = 상태.winners ? 상태.winners.length : 0;
      본문.innerHTML =
        '<section class="카드">' +
        '<p class="눈썹">FINISHED</p>' +
        `<h1>${우승자수 === 1 ? '🏆 우승했습니다!' : '게임 종료'}</h1>` +
        '<p class="안내">' +
        (우승자수 === 1
          ? '마지막까지 살아남았습니다.'
          : `끝까지 생존한 ${우승자수}명 중 한 명입니다.`) +
        '</p></section>';
      return;
    }

    /* --- 아직 문제가 안 나온 경우 --- */
    if (!상태.question_id || 상태.phase === 'waiting') {
      본문.innerHTML =
        '<section class="카드">' +
        '<p class="눈썹">WAITING</p>' +
        '<h1>대기 중</h1>' +
        '<p class="안내">진행자가 문제를 낼 때까지 기다려주세요.</p>' +
        '</section>';
      return;
    }

    const 제출가능 = (상태.phase === 'running' && !내답);

    /* 문제 머리(번호 + 타이머)와 문제 내용 */
    let html =
      '<section class="카드">' +
      '<div class="문제머리">' +
      `<span>${진행순번(상태)}번째 문제</span>` +
      '<div class="타이머" id="타이머">-</div>' +
      '</div>' +
      `<h1 class="문제문구">${상태.question_text}</h1>`;

    /* 답 고르는 부분은 문제 종류에 따라 다르게 만든다. */
    if (내답) {
      html += '<div class="결과상자">' +
        `<strong>제출 완료 · ${내답.answer}</strong>`;

      if (정답있음) {
        /* 이 화면에 오는 사람은 아직 탈락하지 않은 생존자다.
           우승자 발표는 '퀴즈 종료' 때 하므로 여기서는 생존 사실만 알린다. */
        html += `<span style="color:#17332e;font-weight:800">정답 · ${정답글자(상태)}</span>` +
          (상태.revival
            ? '<span class="성공">통과! 끝까지 맞히면 부활합니다</span>'
            : '<span class="성공">생존하셨습니다</span>');
      } else {
        html += '<span>채점 결과를 기다리는 중입니다.</span>';
      }
      html += '</div>';

    } else if (!제출가능) {
      html += '<div class="결과상자"><span>' +
        (상태.phase === 'published'
          ? '진행자가 타이머를 시작하면 제출할 수 있습니다.'
          : '제출이 마감되었습니다.') +
        '</span></div>';

    } else if (상태.question_type === 'ox') {
      html += '<div class="보기목록 오엑스">' +
        '<button class="보기" data-값="O">O</button>' +
        '<button class="보기" data-값="X">X</button>' +
        '</div>';

    } else if (상태.question_type === 'choice') {
      html += '<div class="보기목록">';
      상태.choices.forEach((보기, 순번) => {
        html += `<button class="보기" data-값="${보기}"><span>${순번 + 1}</span>${보기}</button>`;
      });
      html += '</div>';

    } else {
      html += '<div class="입력묶음">' +
        '<label for="주관식">답을 입력하세요</label>' +
        '<input id="주관식" maxlength="100" autocomplete="off">' +
        '</div>';
    }

    if (제출가능) {
      html += '<button class="주요버튼 제출버튼" id="제출버튼">제출하기</button>' +
        '<p class="오류" id="제출알림" style="margin-top:12px"></p>';
    }
    html += '</section>';

    본문.innerHTML = html;

    /* innerHTML 로 버튼을 새로 만들었으니, 동작도 새로 연결해줘야 한다. */
    if (제출가능) {
      본문.querySelectorAll('.보기').forEach((버튼) => {
        버튼.onclick = () => {
          /* 다른 버튼의 선택 표시를 지우고 이 버튼만 표시한다. */
          본문.querySelectorAll('.보기').forEach((b) => b.classList.remove('선택됨'));
          버튼.classList.add('선택됨');
          고른답 = 버튼.dataset.값;       // data-값="..." 의 값을 읽는다
        };
      });
      찾기('#제출버튼').onclick = 제출하기;
    }
  }

  /* 제출 버튼을 눌렀을 때 */
  async function 제출하기() {
    const 주관식칸 = 찾기('#주관식');
    const 값 = 주관식칸 ? 주관식칸.value.trim() : 고른답;

    if (!값) {
      알리기('#제출알림', '답을 선택하거나 입력해주세요.');
      return;
    }

    const 버튼 = 찾기('#제출버튼');
    버튼.disabled = true;
    버튼.textContent = '제출 중…';

    try {
      await 답_제출하기(값);
      고른답 = null;
      await 내정보_새로고침();      // 방금 낸 답을 화면에 반영
      그리기();
    } catch (오류) {
      /* 마감 여부는 서버가 판단한다.
         화면의 타이머 숫자가 아직 남아 있어도 서버가 아니라면 아니다. */
      알리기('#제출알림', 오류.message);
      버튼.disabled = false;
      버튼.textContent = '제출하기';
    }
  }

  /* 내 정보를 다시 가져온다.
     공개 상태에는 "내가 살았는지"가 들어 있지 않아서 따로 물어봐야 한다.

     ponytail: 상태가 바뀔 때마다 한 번씩 더 물어보는 구조다.
     80명 규모에서는 부담이 없다. 참가자가 수백 명이 되면
     서버가 사람별 정보를 실시간에 함께 실어 보내도록 바꾸면 된다. */
  async function 내정보_새로고침() {
    const 새정보 = await 내정보_가져오기();
    if (!새정보) {
      /* 여기 오는 경우 두 가지
           · 진행자가 전체 초기화를 했다  → 참가 기록 자체가 사라졌다
           · 진행자가 내 PIN 을 초기화했다 → 기록은 남아 있고 PIN 이 새 번호로 바뀌었다

         화면만 봐서는 둘을 구분할 수 없으므로 두 경우를 다 적어준다.
         이 쪽지를 안 남기면 로그인 칸만 덩그러니 떠서,
         본인은 왜 안 들어가지는지 모른 채 같은 값을 계속 넣게 된다. */
      /* 새 PIN 은 여기에 적지 않는다 (이 화면은 알 수도 없다).
         진행자 콘솔에만 뜨고, 진행자가 본인에게 직접 알려준다. */
      튕긴이유_적기(
        '진행자가 초기화해서 접속이 풀렸습니다. ' +
        '진행측에 말씀해주세요 — PIN 이 초기화됐는지, 다시 등록해야 하는지 ' +
        '확인하고 안내해드립니다.');
      번호표_지우기();
      location.reload();
      return;
    }
    나 = 새정보.me;
    내답 = 새정보.myAnswer;
    내판 = 새정보.myBoard;      // 줄 수도 서버가 다시 세어 보내준다
  }

  /* 지금 이 사람이 문제를 푸는 차례인가.
     평소       = 생존자
     패자부활전 = 도전 중인 탈락자(revival_status = 'in'). 생존자는 쉰다. */
  function 문제푸는중() {
    return 상태.revival ? 나.revival_status === 'in' : 나.status === 'active';
  }

  /* --- ★ 부정행위 방지 ---
     퀴즈 문제가 떠 있는 동안(문제 공개 ~ 답변 마감)에만 작동한다.
     빙고, 대기, 채점, 정답 공개 때나 탈락한 뒤에는 아무것도 막지 않는다. */
  function 감시중인가() {
    return !!상태 && !!나 && 문제푸는중() &&
      상태.current_game === 'quiz' && 상태.phase === 'running';   // 문제는 타이머 시작 때 공개된다
  }

  /* 1) 화면 이탈 감지 — 사건 두 가지를 같이 본다.

     visibilitychange = 탭이 안 보이게 될 때 (다른 탭, 다른 앱, 화면 끄기, 창 최소화)
     blur / focus     = 이 창에서 손이 떠날 때 / 돌아올 때

     ★ blur 가 필요한 이유: 데스크탑에서 Alt+Tab 으로 다른 프로그램 창에 가면
       탭은 여전히 '보이는' 상태라 visibilitychange 가 일어나지 않는다.
       document.hasFocus() = 지금 이 창을 쓰고 있나

     나갔다고 보냈으면 돌아올 때 반드시 '돌아옴'도 보낸다 (콘솔의 '이탈 중' 표시를 풀려고).
     사건 두 개가 겹쳐 와도 이탈보냄 표시 덕분에 한 번씩만 보낸다. */
  let 이탈보냄 = false;
  function 이탈_확인() {
    const 나가있음 = document.hidden || !document.hasFocus();
    if (나가있음 && !이탈보냄 && 감시중인가()) {
      이탈_알리기(true);
      이탈보냄 = true;
    } else if (!나가있음 && 이탈보냄) {
      이탈_알리기(false);
      이탈보냄 = false;
    }
  }
  document.addEventListener('visibilitychange', 이탈_확인);
  window.addEventListener('blur', 이탈_확인);
  window.addEventListener('focus', 이탈_확인);

  /* 2) 복사 · 잘라내기 · 붙여넣기 · 길게 눌러 뜨는 메뉴 막기
     preventDefault() = 브라우저가 원래 하려던 일을 하지 마라.
     글자 선택 자체는 css 의 .복사금지 규칙이 막는다 (그리기() 에서 켜고 끈다). */
  ['copy', 'cut', 'paste', 'contextmenu'].forEach((종류) => {
    document.addEventListener(종류, (사건) => {
      if (감시중인가()) 사건.preventDefault();
    });
  });

  /* --- 시작 --- */
  상태 = await 상태_가져오기();
  그리기();

  타이머_돌리기(() => 상태);

  실시간_연결(async (새상태) => {
    상태 = 새상태;
    await 내정보_새로고침();
    그리기();
  });
}


/* ============================================================
   3) 프로젝터 화면  (html/screen.html)
   ============================================================ */
async function 프로젝터_시작() {
  let 상태 = null;

  /* 참가자가 휴대폰으로 들어올 주소를 만든다.
     location.origin 은 'http://192.168.0.5:3000' 처럼 지금 주소의 앞부분이다.

     ★ 등록 화면(join.html)이 아니라 접속 화면(play.html)을 띄운다.
     등록은 입구의 진행측 노트북에서만 하므로 그 주소가 프로젝터에 뜨면 안 된다. */
  찾기('#참가주소').textContent = location.origin + '/html/play.html';

  /* --- 빙고 볼 뽑기 ---

     현장에서 참가자가 직접 프로젝터 화면의 볼을 눌러 번호를 뽑는다.
     볼에는 숫자가 적혀 있지 않다. 누르고 나서야 숫자가 정해진다.

     ★ 숫자는 화면이 아니라 서버가 고른다.
       화면에서 뽑으면 두 사람이 동시에 눌렀을 때 같은 번호가 두 번 나올 수 있고,
       새로고침만 해도 뽑기를 다시 할 수 있게 된다.
       서버가 줄을 잠그고(FOR UPDATE) 안 나온 번호 중에서 고르므로
       같은 숫자가 두 번 나오는 일이 구조적으로 없다.

     ★ 이 화면은 진행자 콘솔의 '프로젝터 열기'로 여는 것을 전제로 한다.
       같은 브라우저라 진행자 쿠키가 같이 가므로 뽑기 요청이 통과된다.
       주소를 직접 쳐서 연 경우에는 서버가 막고 안내를 띄운다. */

  let 볼자리 = [];          // 볼들의 화면 위치 (남은 개수가 바뀔 때만 다시 만든다)
  let 볼서명 = '';          // 지금 그려둔 볼 배치가 어떤 상태의 것인지
  let 연출중 = false;       // 뽑기 연출이 도는 동안에는 화면을 다시 그리지 않는다

  /* 볼을 흩어 놓을 자리를 만든다.

     완전한 무작위로 뿌리면 볼이 한곳에 겹쳐 쌓인다.
     그래서 화면을 격자로 나눠 한 칸에 하나씩 넣되,
     칸 안에서 조금씩 흔들어 놓는다. 눈에는 무작위로 흩어진 것처럼 보인다. */
  function 볼자리_만들기(개수) {
    const 가로칸 = Math.ceil(Math.sqrt(개수 * 1.8));      // 화면이 가로로 길어서 1.8배
    const 세로칸 = Math.ceil(개수 / 가로칸);
    const 자리들 = [];

    for (let i = 0; i < 개수; i++) {
      const x = i % 가로칸;
      const y = Math.floor(i / 가로칸);
      자리들.push({
        왼쪽: (x + 0.5) / 가로칸 * 100 + (Math.random() - 0.5) * (60 / 가로칸),
        위:   (y + 0.5) / 세로칸 * 100 + (Math.random() - 0.5) * (60 / 세로칸),
        색:   Math.floor(Math.random() * 5),               // css 에 색 다섯 가지
        지연: (Math.random() * 2).toFixed(2)               // 둥둥 뜨는 시작 시점
      });
    }
    return 자리들;
  }

  function 빙고화면_그리기() {
    if (연출중) return;

    const 부른번호 = 상태.bingo_called ?? [];
    const 남은개수 = 빙고최대번호 - 부른번호.length;

    /* --- 배치 중 --- */
    if (상태.bingo_phase === 'setup') {
      볼서명 = '';                                   // 시작하면 볼을 새로 깔도록
      찾기('#문제영역').innerHTML =
        '<p class="화면머리말">BINGO</p>' +
        '<h1 class="문제문구">빙고판을 만들어주세요</h1>' +
        `<p class="부연설명">휴대폰에서 1~${빙고최대번호} 중 25개를 골라 끌어다 놓으세요 · ` +
        `${상태.bingo_boards}명 제출</p>`;
      return;
    }

    /* --- 끝났다 --- */
    if (상태.bingo_phase === 'finished') {
      볼서명 = '';
      찾기('#문제영역').innerHTML =
        '<p class="화면머리말">BINGO</p>' +
        '<h1 class="문제문구">빙고 종료</h1>' +
        `<p class="부연설명">${부른번호.length}개를 불렀고 ${상태.bingo_winners}명이 빙고를 만들었습니다</p>` +
        지나간번호HTML(부른번호);
      return;
    }

    /* --- 번호 부르는 중 ---

       화면 순서: BINGO → 현황 한 줄 → 볼판 → 지금까지 부른 번호
       뽑힌 번호를 크게 띄우던 자리를 없앴다. 그 자리를 볼판이 가져가서
       볼이 화면 위쪽까지 올라온다. 번호는 팝업으로 보여준다.

       ★ 부른 개수가 그대로면 화면을 다시 만들지 않는다.
         다시 만들면 볼 요소가 새로 생겨서, 자리를 옮기는 애니메이션이
         "옮겨가는 것"이 아니라 "갑자기 그 자리에 나타나는 것"이 된다. */
    const 이번서명 = `running:${부른번호.length}`;
    if (볼서명 !== 이번서명) {
      볼자리 = 볼자리_만들기(남은개수);
      볼서명 = 이번서명;

      찾기('#문제영역').innerHTML =
        '<p class="화면머리말">BINGO</p>' +
        '<p class="부연설명" id="빙고현황"></p>' +
        '<div class="볼판" id="볼판">' +
          볼자리.map((자리, i) =>
            `<button class="볼 색${자리.색}" data-볼="${i}" ` +
            `style="left:${자리.왼쪽}%;top:${자리.위}%;animation-delay:${자리.지연}s">` +
            '</button>').join('') +
        '</div>' +
        '<p class="부연설명 볼안내" id="볼안내">공을 하나 골라 눌러주세요</p>' +
        `<div id="지나간자리">${지나간번호HTML(부른번호)}</div>`;

      볼_누르기_연결();
    }

    /* 숫자만 갱신한다. 볼은 건드리지 않는다. */
    찾기('#빙고현황').textContent =
      `${부른번호.length} / ${빙고최대번호} 번째 · ` +
      `${상태.bingo_goal}줄이면 빙고 · 달성 ${상태.bingo_winners}명`;
  }

  /* 볼을 누르면 서버에 번호를 하나 달라고 한다. */
  function 볼_누르기_연결() {
    document.querySelectorAll('.볼').forEach((볼) => {
      볼.onclick = async () => {
        if (연출중) return;
        연출중 = true;

        볼.classList.add('뽑는중');
        팝업_열기(볼.className.match(/색\d/)?.[0] ?? '색0');

        try {
          /* 서버가 뽑은 번호를 돌려준다 (새 공개 상태가 통째로 온다).
             숫자를 고르는 건 서버다. 화면에서 고르면 같은 번호가 두 번 나올 수 있다. */
          const 새상태 = await 관리자_진행('빙고번호');
          상태 = 새상태;

          팝업_번호보이기(새상태.bingo_last);

          /* 2.6초 보여준 뒤 팝업을 닫고, 뽑힌 볼을 빼고, 남은 볼을 섞는다. */
          setTimeout(() => {
            팝업_닫기();
            볼.remove();

            볼_섞기();
            찾기('#지나간자리').innerHTML = 지나간번호HTML(상태.bingo_called ?? []);
            찾기('#빙고현황').textContent =
              `${(상태.bingo_called ?? []).length} / ${빙고최대번호} 번째 · ` +
              `${상태.bingo_goal}줄이면 빙고 · 달성 ${상태.bingo_winners}명`;

            /* 화면을 이미 새 상태에 맞춰뒀다고 표시해둔다.
               이걸 안 하면 다음 소식이 올 때 화면을 통째로 다시 만들어
               방금 섞어놓은 자리가 날아간다. */
            볼서명 = `running:${(상태.bingo_called ?? []).length}`;
            연출중 = false;
          }, 2600);

        } catch (오류) {
          /* 진행자 로그인이 없거나 번호를 다 부른 경우 */
          팝업_닫기();
          볼.classList.remove('뽑는중');
          연출중 = false;
          찾기('#볼안내').textContent = 오류.message;
        }
      };
    });
  }

  /* 남아 있는 볼들을 새 자리로 옮긴다.

     요소를 새로 만들지 않고 style 의 left/top 만 바꾼다.
     css 에 transition 이 걸려 있어서 브라우저가 알아서 미끄러지듯 옮겨준다.
     (애니메이션을 직접 한 프레임씩 그릴 필요가 없다) */
  function 볼_섞기() {
    const 볼들 = [...document.querySelectorAll('.볼')];
    if (볼들.length === 0) return;

    볼자리 = 볼자리_만들기(볼들.length);
    볼들.forEach((볼, i) => {
      볼.style.left = 볼자리[i].왼쪽 + '%';
      볼.style.top = 볼자리[i].위 + '%';
      볼.style.animationDelay = 볼자리[i].지연 + 's';
    });
  }

  /* --- 뽑힌 번호 팝업 --- */

  function 팝업_열기(색) {
    const 팝업 = 찾기('#볼팝업');
    const 공 = 찾기('#볼팝업공');
    공.className = '볼팝업공 ' + 색;      // 누른 볼과 같은 색으로 맞춘다
    공.textContent = '?';
    찾기('#볼팝업꼬리').textContent = '뽑는 중…';
    팝업.hidden = false;
  }

  function 팝업_번호보이기(번호) {
    const 공 = 찾기('#볼팝업공');
    공.textContent = 번호;
    공.classList.add('공개');            // 튀어나오는 애니메이션

    /* 번호가 나오면 꼬리말을 비운다.
       참가자 휴대폰은 이 번호를 받아 판을 알아서 칠하므로,
       "판에서 지우세요" 같은 안내를 띄울 이유가 없다.
       큰 화면에는 숫자 하나만 남는 쪽이 뒷자리에서 보기에도 낫다. */
    찾기('#볼팝업꼬리').textContent = '';
  }

  function 팝업_닫기() {
    찾기('#볼팝업').hidden = true;
    찾기('#볼팝업공').classList.remove('공개');
  }

  /* 지금까지 부른 번호를 작게 깔아준다. 방금 부른 것만 금색이다.

     ★ 숫자 순서로 줄 세우지 않는다. 뽑은 순서 그대로 둔다.
       bingo_called 배열은 뽑을 때마다 뒤에 붙으므로 이미 뽑은 순서다.
       숫자 순으로 정렬하면 "몇 번째로 나온 번호인지"를 알 수 없어서,
       늦게 온 사람이 놓친 번호를 따라잡을 수가 없다. */
  function 지나간번호HTML(부른번호) {
    if (부른번호.length === 0) return '';
    return '<div class="빙고지나간번호">' +
      부른번호
        .map((n) => `<span${n === 상태.bingo_last ? ' class="맞음"' : ''}>${n}</span>`)
        .join('') +
      '</div>';
  }

  function 그리기() {
    if (!상태) return;

    /* --- 빙고 중이면 빙고 화면을 띄운다 --- */
    if (상태.current_game === 'bingo') {
      찾기('#단계표시').textContent = 빙고단계이름[상태.bingo_phase] ?? '-';
      찾기('#주소안내').hidden = true;

      /* 빙고에는 '생존 인원'과 '남은 문제'가 없다.
         남는 것은 참여 인원 하나뿐이라, 아래 현황 칸을 통째로 접고
         머리글의 제목 옆으로 올린다. 그래야 공판이 화면을 넓게 쓴다. */
      찾기('#현황').hidden = true;

      /* 머리글의 참여 인원 자리.

         ★ 있는지 확인하고 쓴다.
         프로젝터는 행사 내내 한 번 열어두고 그대로 두는 화면이다.
         그 사이에 화면 파일이 바뀌면, 열려 있던 탭은 옛 화면인 채로
         새 코드를 돌리게 된다. 확인 없이 쓰면 거기서 멈춰버리고
         그 아래 줄(공판 그리기)이 통째로 실행되지 않는다. */
      const 머리참여수 = 찾기('#머리참여수');
      if (머리참여수) {
        머리참여수.hidden = false;
        머리참여수.querySelector('b').textContent = 상태.total_count;
      }

      빙고화면_그리기();
      return;
    }

    /* 퀴즈로 돌아오면 현황 칸을 원래대로 되돌린다. */
    if (찾기('#머리참여수')) 찾기('#머리참여수').hidden = true;
    찾기('#생존칸').hidden = false;
    찾기('#남은문제칸').hidden = false;

    찾기('#단계표시').textContent = 단계이름[상태.phase] ?? '-';

    /* ★ 아직 한 문제도 안 냈으면 '게임 시작 전' 이다.
       남은 문제 수와 전체 문제 수가 같다는 것이 그 뜻이다.
       (초기화를 누르면 다시 이 상태로 돌아온다) */
    const 시작전 = 상태.remaining_questions === 상태.total_questions;

    /* 시작 전에는 숫자 현황을 감추고 참가 주소만 크게 보여준다.
       시작한 뒤에는 반대로 한다.

       hidden 은 "감춰라"는 HTML 기본 속성이라 css 를 따로 쓸 필요가 없다. */
    찾기('#현황').hidden = 시작전;
    찾기('#주소안내').hidden = !시작전;

    /* 참여 인원 = 지금까지 등록한 사람 전부 (탈락자 포함)
       생존 인원 = 아직 안 죽은 사람
       남은 문제 = 전체 문제에서 이미 낸 문제를 뺀 수

       세 값 모두 서버가 세어서 보내준다.
       화면에서 계산하지 않으므로 어느 기기에서 봐도 숫자가 같다. */
    찾기('#참여수').textContent = 상태.total_count;
    찾기('#생존수').textContent = 상태.alive_count;
    찾기('#남은문제수').textContent = 상태.remaining_questions;

    /* --- 게임 종료 화면 ---
       우승자 이름이 나오는 곳은 이 화면뿐이다. */
    if (상태.phase === 'finished') {
      const 이름들 = 상태.winners ?? [];
      let html = '<p class="화면머리말">GOLDEN BELL</p>';

      if (이름들.length === 1) {
        html += '<h1 class="문제문구">🏆 우승자</h1>' +
          `<p class="정답공개">${이름들[0]}</p>`;
      } else if (이름들.length === 0) {
        html += '<h1 class="문제문구">게임 종료</h1>' +
          '<p class="부연설명">끝까지 생존한 참가자가 없습니다.</p>';
      } else {
        html += `<h1 class="문제문구">🏆 공동 우승 ${이름들.length}명</h1>` +
          `<p class="정답공개">${이름들.join(' · ')}</p>`;
      }

      찾기('#문제영역').innerHTML = html;
      return;
    }

    /* --- 문제가 없을 때 ---
       같은 '대기 중' 이라도 두 경우가 전혀 다르다.

         게임 시작 전   → 참가를 받아야 하니 주소를 크게 안내한다
         문제와 문제 사이 → 이미 다 들어와 있으니 다음 문제만 예고한다 */
    if (!상태.question_id) {
      찾기('#문제영역').innerHTML = 시작전
        ? '<p class="화면머리말">WELCOME</p>' +
          '<h1 class="문제문구">잠시 후 시작합니다</h1>' +
          '<p class="부연설명">휴대폰으로 아래 주소에 접속해 참가해주세요.</p>'
        : '<h1 class="문제문구">다음 문제가 곧 공개됩니다</h1>';
      return;
    }

    /* --- 문제 표시 ---
       머리말에 "몇 번째로 낸 문제인가"를 보여준다.
       참가자 휴대폰 화면과 같은 함수를 쓰므로 두 화면의 숫자가 항상 같다. */
    let html = `<p class="화면머리말">${진행순번(상태)}번째 문제</p>` +
      `<h1 class="문제문구">${상태.question_text}</h1>`;

    /* 객관식 보기는 프로젝터에 띄우지 않는다.
       참가자 휴대폰에 이미 보기가 뜨므로 대형 화면에서는 중복이고,
       문제 문장을 크게 보여주는 데 자리를 쓰는 편이 낫다. */

    /* 타이머는 진행 중일 때만 만든다.
       시작 전이나 마감 뒤에 '-' 만 덩그러니 떠 있으면 보기 나쁘다.
       아예 안 만들면 자리도 차지하지 않는다.

       처음부터 남은 초를 넣어두는 이유:
       1초마다 도는 함수가 채워주기를 기다리면 그 사이 잠깐 빈칸이 보인다. */
    const 남은 = 남은초(상태);
    if (남은 !== null) {
      html += `<div class="타이머" id="타이머">${남은}</div>`;
    }

    /* 정답은 서버가 공개 단계에서만 실어 보낸다.
       그 전에는 상태.correct_answers 자체가 비어 있어서 띄울 수가 없다. */
    if (상태.correct_answers) {
      html += `<p class="정답공개">정답 · ${정답글자(상태)}</p>`;
    }

    찾기('#문제영역').innerHTML = html;
  }

  상태 = await 상태_가져오기();
  그리기();

  타이머_돌리기(() => 상태);

  실시간_연결((새상태) => {
    상태 = 새상태;
    그리기();
  });
}


/* ============================================================
   4) 관리자 로그인 화면  (html/login.html)
   ============================================================ */
function 로그인화면_시작() {
  const 비밀번호칸 = 찾기('#비밀번호');
  const 아이디칸 = 찾기('#아이디');
  const 버튼 = 찾기('#로그인버튼');

  async function 로그인시도() {
    알리기('#로그인알림', '');
    버튼.disabled = true;
    버튼.textContent = '확인 중…';

    try {
      await 관리자_로그인(아이디칸.value.trim(), 비밀번호칸.value);
      location.href = 'admin.html';
    } catch (오류) {
      알리기('#로그인알림', 오류.message);
      비밀번호칸.value = '';
      버튼.disabled = false;
      버튼.textContent = '관리자 로그인';
    }
  }

  버튼.onclick = 로그인시도;

  /* 아이디·비밀번호 칸에서 엔터를 쳐도 로그인되게 한다.
     e.key 는 방금 누른 키 이름이다. */
  [아이디칸, 비밀번호칸].forEach((칸) => {
    칸.onkeydown = (e) => { if (e.key === 'Enter') 로그인시도(); };
  });
}


/* ============================================================
   5) 관리자 콘솔  (html/admin.html)
   ============================================================ */

/* 한 차례에 한 번만 누를 수 있는 버튼 목록.
   '다음', '퀴즈종료', '초기화' 는 여기 없으므로 언제든 누를 수 있다.
   ★ 진짜 차단은 서버가 한다. 여기서는 회색으로 보여주기만 한다. */
const 한번만_누를_버튼 = ['선택및공개', '타이머시작', '마감', '확정', '정답공개'];

async function 관리자화면_시작() {
  let 자료 = null;      // 서버가 준 콘솔용 자료 한 덩어리

  /* 표에서 어느 팀만 볼지. 빈 글자면 '전체 팀' 이다.
     그리기() 바깥에 두는 이유: 화면을 다시 그려도 고른 값이 남아 있어야 한다. */
  let 팀필터 = '';

  /* 로그인하지 않았으면 서버가 401 을 돌려준다. 그때 로그인 화면으로 보낸다. */
  try {
    자료 = await 관리자_상태();
  } catch {
    location.href = 'login.html';
    return;
  }

  찾기('#로그아웃버튼').onclick = async () => {
    await 관리자_로그아웃().catch(() => {});
    location.href = 'login.html';
  };

  /* 이미 알려준 빙고 달성자들.
     같은 사람 때문에 소리가 계속 울리면 진행자가 화면을 안 보게 된다.
     새로 달성한 사람이 생겼을 때만 한 번 알린다. */
  const 알린달성자 = new Set();

  /* 소리로 한 번 알린다.

     [왜 소리 파일을 안 쓰나]
     음원 파일을 넣으면 파일이 늘고, 행사장 네트워크에서 못 받아올 수도 있다.
     브라우저에 들어 있는 AudioContext 로 "삐" 소리를 그 자리에서 만들면
     파일도 라이브러리도 필요 없다.

     소리는 막혀 있을 수 있으므로(브라우저 정책) 실패해도 그냥 넘어간다.
     화면의 초록 알림이 본체이고 소리는 거들 뿐이다. */
  function 빙고소리() {
    try {
      const 소리판 = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.16, 0.32].forEach((늦게, i) => {
        const 음 = 소리판.createOscillator();
        const 크기 = 소리판.createGain();
        음.frequency.value = [784, 988, 1319][i];   // 솔 · 시 · 미 (올라가는 세 음)
        음.connect(크기);
        크기.connect(소리판.destination);
        크기.gain.setValueAtTime(0.0001, 소리판.currentTime + 늦게);
        크기.gain.exponentialRampToValueAtTime(0.25, 소리판.currentTime + 늦게 + 0.02);
        크기.gain.exponentialRampToValueAtTime(0.0001, 소리판.currentTime + 늦게 + 0.22);
        음.start(소리판.currentTime + 늦게);
        음.stop(소리판.currentTime + 늦게 + 0.24);
      });
    } catch {}
  }

  /* --- 빙고 진행 칸 그리기 --- */
  function 빙고칸_그리기(상태) {
    const 부른번호 = 상태.bingo_called ?? [];

    /* --- 빙고 달성자 알림 ---
       줄 수는 서버가 세어서 참가자마다 board_lines 로 보내준다.
       여기서는 목표 줄 수에 닿은 사람만 골라내면 된다. */
    const 달성자 = 자료.participants.filter(
      (사람) => 사람.board_lines !== null && 사람.board_lines >= 상태.bingo_goal);

    찾기('#빙고알림').hidden = 달성자.length === 0;
    찾기('#빙고달성자').textContent = 달성자
      .map((사람) => `${사람.team_name} ${사람.name} (${사람.board_lines}줄)`)
      .join(' · ');

    /* 이번에 새로 올라온 사람이 있으면 그때만 소리를 낸다. */
    const 새달성자 = 달성자.filter((사람) => !알린달성자.has(사람.id));
    if (새달성자.length > 0) {
      새달성자.forEach((사람) => 알린달성자.add(사람.id));
      빙고소리();
    }

    /* 빙고를 초기화하면(부른 번호가 없어지면) 알린 기록도 비운다.
       안 비우면 다시 돌렸을 때 첫 빙고에 소리가 안 난다. */
    if (부른번호.length === 0) 알린달성자.clear();

    찾기('#빙고판수').textContent = 상태.bingo_boards;
    찾기('#빙고단계').textContent = 빙고단계이름[상태.bingo_phase] ?? '-';
    찾기('#빙고부른수').textContent = 부른번호.length;
    찾기('#빙고달성수').textContent = 상태.bingo_winners;
    찾기('#빙고목표표시').textContent = `${상태.bingo_goal}줄 기준`;
    찾기('#빙고마지막').textContent = 상태.bingo_last ?? '-';

    찾기('#빙고부른목록').textContent = 부른번호.length === 0
      ? '아직 부른 번호가 없습니다.'
      : `부른 번호: ${[...부른번호].sort((a, b) => a - b).join(' · ')}`;

    /* 목표 줄 수 고르는 칸.
       문제 목록과 같은 이유로, 이미 만들어 뒀으면 다시 만들지 않는다.
       (실시간 갱신 때마다 다시 만들면 고르는 도중에 닫혀버린다) */
    const 목표칸 = 찾기('#빙고목표');
    if (목표칸.children.length === 0) {
      목표칸.innerHTML = [1, 2, 3, 4, 5]
        .map((n) => `<option value="${n}">${n}줄</option>`).join('');

      목표칸.onchange = async () => {
        try {
          await 관리자_진행('빙고목표', Number(목표칸.value));
        } catch (오류) {
          알리기('#진행알림', 오류.message);
        }
        await 새로고침();
      };
    }
    목표칸.value = String(상태.bingo_goal);
  }

  /* --- 화면 그리기 --- */
  function 그리기() {
    const 상태 = 자료.state;

    /* --- 게임 고르기 ---
       지금 고른 게임의 버튼만 초록(주요버튼)으로 바꾼다.
       classList.toggle(이름, 참/거짓) 은 참이면 붙이고 거짓이면 뗀다. */
    const 지금게임 = 상태.current_game ?? 'quiz';
    document.querySelectorAll('[data-게임]').forEach((버튼) => {
      const 고름 = 버튼.dataset.게임 === 지금게임;
      버튼.classList.toggle('주요버튼', 고름);
      버튼.classList.toggle('보조버튼', !고름);
    });

    /* 고른 게임의 진행 패널만 보여준다.
       hidden 은 "이 요소를 아예 감춰라"는 HTML 기본 속성이다. */
    찾기('#퀴즈패널').hidden = 지금게임 !== 'quiz';
    찾기('#빙고패널').hidden = 지금게임 !== 'bingo';

    if (지금게임 === 'bingo') 빙고칸_그리기(상태);

    찾기('#단계표시').textContent = 지금게임 === 'bingo'
      ? `빙고 · ${빙고단계이름[상태.bingo_phase] ?? '-'}`
      : (단계이름[상태.phase] ?? '-');
    찾기('#생존수').textContent = 상태.alive_count;
    찾기('#전체수').textContent = 상태.total_count;
    찾기('#제출수').textContent = 상태.submitted_count;
    /* 주관식이면 앞에 [주관식] 을 붙인다.
       주관식은 자동 채점이 안 되고 진행자가 직접 판정해야 하므로 미리 알아야 한다.
       type 값: ox = O/X, choice = 객관식, text = 주관식 */
    const 주관식표 = (유형) => (유형 === 'text' ? '[주관식] ' : '');

    찾기('#현재문제').textContent = 상태.question_id
      ? `${주관식표(상태.question_type)}${상태.question_order}번 · ${상태.question_text}`
      : '선택된 문제 없음';

    /* 제한 시간 칸. 새 문제가 골라졌을 때만 그 문제의 시간으로 채운다.
       매번 채우면 진행자가 고치던 숫자가 실시간 갱신 때마다 되돌아간다. */
    const 시간칸 = 찾기('#제한시간');
    if (시간칸.dataset.문제 !== String(상태.question_id)) {
      시간칸.dataset.문제 = String(상태.question_id);
      시간칸.value = 상태.question_id ? 상태.time_limit : '';
    }

    /* 주관식 정답 (진행자 판정용). 서버가 주관식일 때만 채워 보낸다.
       정답이 여러 개면 (책놀이방 / 꿈나무책놀이방) 모두 보여준다. */
    const 정답칸 = 찾기('#주관식정답');
    정답칸.hidden = !자료.textAnswers;
    정답칸.textContent = 자료.textAnswers ? `정답: ${자료.textAnswers.join(' / ')}` : '';

    /* --- 문제 고르는 칸 (아직 안 낸 문제만) ---

       주의: 참가자가 답을 낼 때마다 이 함수가 다시 실행된다.
       그때마다 목록을 새로 만들면 진행자가 골라둔 문제가 매번 풀려버린다.
       그래서 "목록이 실제로 바뀌었을 때만" 다시 만든다.
       서명(signature)은 남은 문제 번호를 이어 붙인 글자다. 예: "2,3,5" */
    const 문제선택 = 찾기('#문제선택');
    const 남은문제 = 자료.remainingQuestions;
    const 서명 = 남은문제.map((q) => q.id).join(',');

    if (문제선택.dataset.서명 !== 서명) {
      문제선택.innerHTML = '';

      if (남은문제.length === 0) {
        const 빈칸 = document.createElement('option');
        빈칸.value = '';
        빈칸.textContent = '남은 문제가 없습니다';
        문제선택.appendChild(빈칸);
      } else {
        남은문제.forEach((q) => {
          const 칸 = document.createElement('option');
          칸.value = q.id;
          /* code(M01 / E01)가 있으면 그걸 앞에 붙인다.
             M = 본 문제, E = 예비 라서 목록에서 바로 구분된다.
             ?? 는 "왼쪽이 비어 있으면 오른쪽을 쓴다"는 뜻이다.

             ★ 문제 글을 자르지 않는다.
               예전에는 24자에서 잘랐는데, 그러면 비슷하게 시작하는 문제를
               목록에서 구분할 수가 없다. 어떤 문제를 내는지 모르고 누르게 된다. */
          const 표 = q.code ?? `${q.question_order}번`;
          칸.textContent = `${주관식표(q.type)}${표} · ${q.question_text}`;
          문제선택.appendChild(칸);
        });
      }
      문제선택.dataset.서명 = 서명;
    }

    찾기('label[for="문제선택"]').textContent = 상태.revival
      ? `🔥 패자부활 문제 고르기 (남은 문제 ${남은문제.length}개)`
      : `문제 고르기 (남은 문제 ${남은문제.length}개)`;

    /* --- 패자부활전 버튼 ---
       진행 중이면 [종료]만, 아니면 [시작]만 보인다.
       진행 중에는 도전자가 몇 명 남았는지 적어준다. */
    찾기('#부활전시작').hidden = 상태.revival;
    찾기('#부활전종료').hidden = !상태.revival;
    const 도전중 = 자료.participants.filter((사람) => 사람.revival_status === 'in').length;
    찾기('#부활전안내').hidden = !상태.revival;
    찾기('#부활전안내').textContent =
      `패자부활전 진행 중 · 남은 도전자 ${도전중}명 (생존자는 이번엔 답을 내지 않습니다)`;

    /* 고른 문제의 글을 select 아래에 통째로 적어준다.
       한 번 연결해두면 진행자가 고를 때마다 알아서 바뀐다. */
    function 고른문제_보이기() {
      const 고른것 = 남은문제.find((q) => String(q.id) === 문제선택.value);
      찾기('#고른문제').textContent = 고른것
        ? `${주관식표(고른것.type)}${고른것.code ?? 고른것.question_order + '번'} · ${고른것.question_text}`
        : '';
    }
    문제선택.onchange = 고른문제_보이기;
    고른문제_보이기();

    /* --- 이미 누른 버튼을 회색으로 잠근다 ---
       disabled = true 로 두면 눌러도 클릭이 아예 일어나지 않고,
       css 가 반투명하게 만들어 눈으로도 구분된다. */
    const 쓴버튼 = 상태.used_actions ?? [];
    document.querySelectorAll('[data-작업]').forEach((버튼) => {
      const 작업 = 버튼.dataset.작업;
      버튼.disabled = 한번만_누를_버튼.includes(작업) && 쓴버튼.includes(작업);
    });

    찾기('#잠금안내').textContent = 쓴버튼.length === 0
      ? '이번 차례에 아직 누른 버튼이 없습니다.'
      : `이번 차례에 사용함: ${쓴버튼.join(', ')} — 다음 ▶ 을 누르면 다시 누를 수 있습니다.`;

    /* --- 대시보드 ---
       서버가 세어 보낸 숫자를 그대로 넣기만 한다. */
    const d = 자료.dashboard;
    찾기('#생존인원').textContent = `${d.alive_members}명`;
    찾기('#생존팀').textContent = `${d.total_teams}팀 중 ${d.alive_teams}팀 생존`;
    찾기('#이번탈락').textContent = `${d.eliminated_this}명`;
    찾기('#이번문제표시').textContent = 상태.question_id
      ? `${진행순번(상태)}번째 문제`
      : '문제 선택 전';
    찾기('#누적탈락').textContent = `${d.eliminated_total}명`;

    /* 0으로 나누면 NaN 이 나오므로 참가자가 없을 때를 먼저 걸러낸다. */
    const 전체 = d.alive_members + d.eliminated_total;
    찾기('#탈락비율').textContent = 전체 === 0
      ? '참가자 없음'
      : `전체 ${전체}명 중 ${Math.round((d.eliminated_total / 전체) * 100)}%`;

    /* --- 팀별 생존 현황 ---
       한 팀이 전멸했는지, 어느 팀이 강한지 한눈에 본다. */
    찾기('#팀별현황').innerHTML = 자료.teams.map((팀) => {
      const 전멸 = Number(팀.joined) > 0 && Number(팀.alive) === 0;
      const 빈팀 = Number(팀.joined) === 0;

      return '<div class="팀칸' + (전멸 ? ' 전멸' : '') + (빈팀 ? ' 빈팀' : '') + '">' +
        `<span>${팀.name}</span>` +
        `<strong>${팀.alive}</strong>` +
        `<small>${빈팀 ? '참가자 없음' : `${팀.joined}명 중`}</small>` +
        '</div>';
    }).join('');

    /* --- 표 머리 (팀 고르는 칸 포함) ---
       팀 목록은 게임 중에 바뀌지 않으므로 한 번만 만든다.
       매번 다시 만들면 고르는 도중에 목록이 닫혀버린다. */
    const 표머리 = 찾기('#참가자표머리');
    if (표머리.children.length === 0) {
      표머리.innerHTML =
        '<tr>' +
        '<th><select id="팀필터">' +
        '<option value="">전체 팀</option>' +
        자료.teams.map((팀) => `<option value="${팀.id}">${팀.name}</option>`).join('') +
        '</select></th>' +
        '<th>이름</th><th>상태</th><th>화면 이탈</th><th>제출한 답</th><th>채점</th><th>빙고</th><th>PIN</th>' +
        '</tr>';

      /* 고른 값을 바깥 변수에 기억해두고 표를 다시 그린다.
         화면이 실시간으로 갱신돼도 고른 팀이 유지된다. */
      찾기('#팀필터').onchange = (사건) => {
        팀필터 = 사건.target.value;
        그리기();
      };
    }

    /* 화면에 남아 있는 선택값을 변수와 다시 맞춘다.
       (다른 탭에서 새로고침돼도 어긋나지 않게) */
    찾기('#팀필터').value = 팀필터;

    /* --- 참가자 표 ---
       채점 버튼은 '답변 마감' 과 '판정 확정' 사이에서만 나온다. */
    const 채점가능 = (상태.phase === 'closed');

    /* 팀필터가 비어 있으면('전체 팀') 전부, 아니면 그 팀만 보여준다. */
    const 보여줄사람 = 팀필터
      ? 자료.participants.filter((사람) => String(사람.team_id) === 팀필터)
      : 자료.participants;

    let 표 = '';

    보여줄사람.forEach((사람) => {
      let 채점칸 = '-';

      if (사람.answer_id) {
        if (채점가능) {
          /* 지금 정해져 있는 판단을 버튼 색으로 표시한다.
             정답이면 초록(주요버튼), 오답이면 빨강(위험버튼),
             아직 안 정해졌으면(보류) 둘 다 회색(보조버튼). */
          const 정답색 = 사람.grade === 'correct' ? '주요버튼' : '보조버튼';
          const 오답색 = 사람.grade === 'wrong' ? '위험버튼' : '보조버튼';

          채점칸 =
            `<button class="판정 ${정답색}" data-답="${사람.answer_id}" data-판정="correct">정답</button> ` +
            `<button class="판정 ${오답색}" data-답="${사람.answer_id}" data-판정="wrong">오답</button>` +
            (사람.grade === 'pending' ? ' <span class="안내">보류</span>' : '');

        } else if (상태.phase === 'published' || 상태.phase === 'running') {
          채점칸 = '<span class="안내">마감 후 채점</span>';
        } else if (사람.grade === 'correct') {
          채점칸 = '<span class="생존">정답</span>';
        } else if (사람.grade === 'wrong') {
          채점칸 = '<span class="탈락">오답</span>';
        } else {
          채점칸 = '<span class="안내">보류</span>';
        }
      }

      /* 빙고 칸.
         board_lines 는 서버가 세어 보낸 줄 수다. 판을 안 냈으면 null 이 온다.
         목표 줄 수에 닿았으면 초록으로 강조한다. */
      let 빙고칸 = '<span class="안내">판 없음</span>';
      if (사람.board_lines !== null && 사람.board_lines !== undefined) {
        const 달성 = 사람.board_lines >= 상태.bingo_goal;
        빙고칸 = `<span class="${달성 ? '생존' : ''}">${사람.board_lines}줄${달성 ? ' 빙고!' : ''}</span>`;
      }

      /* 화면 이탈 칸 (부정행위 방지).
         지금 나가 있으면 빨갛게 '이탈 중', 아니면 지금까지 나간 횟수만 적는다. */
      const 이탈칸 = 사람.away_now
        ? `<span class="탈락">🚨 이탈 중 (${사람.away_count}회)</span>`
        : (사람.away_count > 0 ? `${사람.away_count}회` : '<span class="안내">-</span>');

      const 살았나 = 사람.status === 'active';

      /* 상태 칸. 패자부활전 중이면 도전 상태를 먼저 보여준다. */
      let 상태칸 = `<td class="${살았나 ? '생존' : '탈락'}">${살았나 ? '생존' : '탈락'}</td>`;
      if (사람.revival_status === 'in')  상태칸 = '<td class="생존">🔥 부활 도전</td>';
      if (사람.revival_status === 'out') 상태칸 = '<td class="탈락">부활 실패</td>';

      표 += '<tr>' +
        `<td>${사람.team_name}</td>` +
        `<td>${사람.name}</td>` +
        상태칸 +
        `<td>${이탈칸}</td>` +
        `<td>${사람.answer ?? '<span class="안내">미제출</span>'}</td>` +
        `<td>${채점칸}</td>` +
        `<td>${빙고칸}</td>` +
        `<td><button class="PIN초기화 보조버튼" data-사람="${사람.id}">초기화</button></td>` +
        '</tr>';
    });

    if (보여줄사람.length === 0) {
      표 += '<tr><td colspan="8" class="안내">' +
        (자료.participants.length === 0
          ? '아직 참가자가 없습니다.'
          : '이 팀에는 참가자가 없습니다.') +
        '</td></tr>';
    }
    찾기('#참가자표').innerHTML = 표;

    /* 방금 만든 판정 버튼들에 동작을 연결한다. */
    document.querySelectorAll('.판정').forEach((버튼) => {
      버튼.onclick = async () => {
        try {
          await 관리자_판정(Number(버튼.dataset.답), 버튼.dataset.판정);
          await 새로고침();
        } catch (오류) {
          알리기('#진행알림', 오류.message);
        }
      };
    });

    /* PIN 초기화 버튼.
       참가자가 PIN 을 잊었을 때 진행자가 눌러준다.
       기본값으로 되돌아가고, 그 사람의 접속도 같이 끊긴다
       (다른 사람이 먼저 들어가 있었을 수 있으므로 끊는 게 맞다). */
    document.querySelectorAll('.PIN초기화').forEach((버튼) => {
      버튼.onclick = async () => {
        알리기('#진행알림', '');
        if (!confirm('이 참가자의 PIN 을 새 무작위 네 자리로 바꾸고 접속을 끊습니다. 계속할까요?')) return;

        버튼.disabled = true;
        try {
          const 결과 = await 관리자_PIN초기화(Number(버튼.dataset.사람));
          /* 새 PIN 은 이 창에서 한 번만 보인다. 서버에는 원문이 남지 않는다. */
          alert(`${결과.name} 님의 새 PIN : ${결과.pin}\n\n` +
                '본인에게만 직접 알려주고, 본인 휴대폰에서 다시 접속하라고 안내해주세요.\n' +
                '(이 번호는 다시 볼 수 없습니다. 잊으면 한 번 더 초기화하면 됩니다)');
        } catch (오류) {
          알리기('#진행알림', 오류.message);
        }
        await 새로고침();
      };
    });
  }

  /* 서버에서 최신 자료를 다시 받아 화면을 그린다. */
  async function 새로고침() {
    try {
      자료 = await 관리자_상태();
      그리기();
    } catch {
      location.href = 'login.html';      // 로그인이 풀린 경우
    }
  }

  /* 진행 버튼 */
  document.querySelectorAll('[data-작업]').forEach((버튼) => {
    버튼.onclick = async () => {
      const 작업 = 버튼.dataset.작업;
      알리기('#진행알림', '');

      /* 되돌릴 수 없는 작업은 한 번 더 묻는다. */
      /* ★ 전체 초기화는 참가자를 지운다 = 전원이 다시 등록해야 한다.
         게임만 다시 하고 싶은 것이라면 '빙고 초기화' 쪽이다.
         이 둘을 헷갈리면 행사 중에 80명을 다시 등록해야 한다. */
      if (작업 === '초기화' && !confirm(
        '참가자·답안·빙고판을 모두 지우고 퀴즈 대기 상태로 되돌립니다.\n' +
        '참가자 전원이 입구에서 다시 등록해야 합니다.\n\n' +
        '빙고만 다시 하려는 것이라면 빙고 진행 칸의 [빙고 초기화]를 눌러주세요.\n\n' +
        '그래도 전체 초기화를 할까요?')) return;
      if (작업 === '퀴즈종료' && !confirm('게임을 끝내고 우승자를 발표합니다. 계속할까요?')) return;
      if (작업 === '빙고초기화' && !confirm('모든 빙고판과 부른 번호를 지웁니다. 계속할까요?')) return;
      if (작업 === '부활전시작' && !confirm(
        '지금 탈락해 있는 사람 전원이 패자부활전에 도전합니다.\n' +
        '문제 목록에는 패자부활 문제 2개만 보입니다. 시작할까요?')) return;
      if (작업 === '부활전종료' && !confirm(
        '끝까지 맞힌 도전자를 생존자로 되돌리고 패자부활전을 끝냅니다. 계속할까요?')) return;

      버튼.disabled = true;
      try {
        /* 타이머 시작일 때만 제한 시간(초)을 같이 보낸다. */
        const 초 = 작업 === '타이머시작' ? (Number(찾기('#제한시간').value) || null) : null;
        await 관리자_진행(작업, Number(찾기('#문제선택').value) || null, undefined, 초);
      } catch (오류) {
        /* 순서가 틀렸거나 이미 누른 버튼이면 서버가 이유를 알려준다. */
        알리기('#진행알림', 오류.message);
      }
      await 새로고침();
    };
  });

  /* 게임 고르기 버튼 (퀴즈 / 빙고).
     누르는 순간 참가자 전원의 화면이 바뀌므로 진행 버튼과 따로 뒀다. */
  document.querySelectorAll('[data-게임]').forEach((버튼) => {
    버튼.onclick = async () => {
      알리기('#진행알림', '');
      버튼.disabled = true;
      try {
        await 관리자_진행('게임선택', null, 버튼.dataset.게임);
      } catch (오류) {
        알리기('#진행알림', 오류.message);
      }
      버튼.disabled = false;
      await 새로고침();
    };
  });

  그리기();
  타이머_돌리기(() => 자료.state);

  /* 상태가 바뀌면 (참가자 제출 포함) 콘솔도 자동으로 갱신된다. */
  실시간_연결(() => 새로고침());
}


/* ============================================================
   6) 어느 페이지인지 보고 알맞은 함수를 실행한다
   ============================================================ */
const 페이지 = document.body.dataset.page;

if (페이지 === 'join')        참가화면_시작();
else if (페이지 === 'play')   게임화면_시작();
else if (페이지 === 'screen') 프로젝터_시작();
else if (페이지 === 'login')  로그인화면_시작();
else if (페이지 === 'admin')  관리자화면_시작();
