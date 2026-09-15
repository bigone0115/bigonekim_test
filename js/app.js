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


/* ============================================================
   1) 참가 등록 화면  (html/join.html)
   ============================================================ */
async function 참가화면_시작() {
  /* 이미 참가한 적이 있으면 게임 화면으로 바로 보낸다. (새로고침 복구) */
  const 내정보 = await 내정보_가져오기();
  if (내정보) {
    location.href = 'play.html';
    return;
  }

  /* 팀 목록을 서버에서 받아 고르는 칸을 채운다.
     현재 인원 / 정원 을 같이 보여주고, 꽉 찬 팀은 고를 수 없게 막는다. */
  const 팀선택 = 찾기('#팀선택');
  const 팀들 = await 팀목록_가져오기();

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

  const 참가버튼 = 찾기('#참가버튼');

  참가버튼.onclick = async () => {
    const 이름 = 찾기('#이름입력').value.trim();
    알리기('#알림', '');

    /* 보내기 전에 여기서도 한 번 확인한다.
       서버도 똑같이 확인하지만, 미리 걸러주면 기다림 없이 바로 알려줄 수 있다.
       ★ 화면 검사는 편의일 뿐이고, 진짜 방어는 서버와 DB가 한다. */
    if (이름.length < 1 || 이름.length > 20) {
      알리기('#알림', '이름을 1~20자로 입력해주세요.');
      return;
    }

    /* 버튼을 잠가서 두 번 눌리는 것을 막는다.
       느린 네트워크에서 조급해진 사람이 연타하는 일이 흔하다. */
    참가버튼.disabled = true;
    참가버튼.textContent = '등록 중…';

    try {
      await 참가하기(Number(팀선택.value), 이름);
      location.href = 'play.html';
    } catch (오류) {
      알리기('#알림', 오류.message);        // 예: 같은 팀에 이미 같은 이름이 있습니다
      참가버튼.disabled = false;
      참가버튼.textContent = '참가하기';
    }
  };
}


/* ============================================================
   2) 참가자 게임 화면  (html/play.html)
   ============================================================ */
async function 게임화면_시작() {
  let 상태 = null;      // 서버가 알려준 게임 상태
  let 나 = null;        // 내 정보 (이름, 팀, 생존 여부)
  let 내답 = null;      // 이번 문제에 내가 낸 답
  let 고른답 = null;    // 아직 제출 전, 화면에서 고르기만 한 답

  /* 참가 기록이 없으면 등록 화면으로 돌려보낸다. */
  const 처음 = await 내정보_가져오기();
  if (!처음) {
    번호표_지우기();
    location.href = 'join.html';
    return;
  }
  나 = 처음.me;
  내답 = 처음.myAnswer;

  /* --- 화면 그리기 ---
     상태가 바뀔 때마다 통째로 다시 그린다.
     조금씩 고치는 것보다 전부 다시 그리는 쪽이 훨씬 덜 헷갈린다. */
  function 그리기() {
    if (!상태) return;

    const 본문 = 찾기('#본문');
    찾기('#내이름').textContent = `${나.team_name} ${나.name}`;
    찾기('#단계표시').textContent = 단계이름[상태.phase] ?? '-';

    /* 정답을 봐도 되는 때인가? 진행자가 '정답 공개'를 누른 뒤부터다.
       서버가 그 전에는 정답 자리를 비워서 보내므로,
       화면에서 실수로 보여주려 해도 보여줄 내용 자체가 없다. */
    const 정답있음 = !!상태.correct_answers;

    /* --- 탈락한 경우 (정답은 알려준다) --- */
    if (나.status === 'eliminated') {
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
          '<span class="성공">생존하셨습니다</span>';
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
    if (!새정보) {          // 진행자가 전체 초기화를 한 경우
      번호표_지우기();
      location.href = 'join.html';
      return;
    }
    나 = 새정보.me;
    내답 = 새정보.myAnswer;
  }

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

  /* 참가 주소를 만든다.
     location.origin 은 'http://192.168.0.5:3000' 처럼 지금 주소의 앞부분이다. */
  찾기('#참가주소').textContent = location.origin + '/html/join.html';

  function 그리기() {
    if (!상태) return;

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

  /* --- 화면 그리기 --- */
  function 그리기() {
    const 상태 = 자료.state;

    찾기('#단계표시').textContent = 단계이름[상태.phase] ?? '-';
    찾기('#생존수').textContent = 상태.alive_count;
    찾기('#전체수').textContent = 상태.total_count;
    찾기('#제출수').textContent = 상태.submitted_count;
    찾기('#현재문제').textContent = 상태.question_id
      ? `${상태.question_order}번 · ${상태.question_text}`
      : '선택된 문제 없음';

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
          칸.textContent = `${q.question_order}번 · ${q.question_text.slice(0, 20)}`;
          문제선택.appendChild(칸);
        });
      }
      문제선택.dataset.서명 = 서명;
    }

    찾기('label[for="문제선택"]').textContent =
      `문제 고르기 (남은 문제 ${남은문제.length}개)`;

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
        '<th>이름</th><th>상태</th><th>제출한 답</th><th>채점</th>' +
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

      const 살았나 = 사람.status === 'active';
      표 += '<tr>' +
        `<td>${사람.team_name}</td>` +
        `<td>${사람.name}</td>` +
        `<td class="${살았나 ? '생존' : '탈락'}">${살았나 ? '생존' : '탈락'}</td>` +
        `<td>${사람.answer ?? '<span class="안내">미제출</span>'}</td>` +
        `<td>${채점칸}</td>` +
        '</tr>';
    });

    if (보여줄사람.length === 0) {
      표 += '<tr><td colspan="5" class="안내">' +
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
      if (작업 === '초기화' && !confirm('참가자와 답안을 모두 지웁니다. 계속할까요?')) return;
      if (작업 === '퀴즈종료' && !confirm('게임을 끝내고 우승자를 발표합니다. 계속할까요?')) return;

      버튼.disabled = true;
      try {
        await 관리자_진행(작업, Number(찾기('#문제선택').value) || null);
      } catch (오류) {
        /* 순서가 틀렸거나 이미 누른 버튼이면 서버가 이유를 알려준다. */
        알리기('#진행알림', 오류.message);
      }
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
