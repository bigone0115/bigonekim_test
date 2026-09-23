/* ============================================================
   server.js  —  Express 웹 서버 + API + 실시간(SSE)
   ============================================================

   [이 서버가 하는 일 세 가지]
   1. index.html, css, js 같은 파일을 브라우저에 내려준다
   2. /api/... 주소로 오는 요청을 처리해 DB를 읽고 쓴다
   3. 상태가 바뀌면 접속 중인 모든 브라우저에 알린다 (SSE)

   [SSE 가 무엇인가]
   Server-Sent Events. 브라우저가 서버에 한 번 연결해두면
   서버가 원할 때마다 글을 내려보낼 수 있는 통로다.
   브라우저에 기본으로 들어 있어서 라이브러리가 필요 없고,
   끊기면 알아서 다시 연결한다. 행사장 와이파이에서 이 점이 크다.

   [실행]
   npm start           (내부적으로 node --env-file=.env server/server.js)
   ============================================================ */

import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 질의, 트랜잭션, 공개상태, pool } from './db.js';

/* ES 모듈에는 __dirname 이 없어서 직접 만든다.
   이 파일 위치(server/)의 한 단계 위가 프로젝트 뿌리다. */
const 이파일 = fileURLToPath(import.meta.url);
const 뿌리 = path.join(path.dirname(이파일), '..');

const app = express();
const 포트 = process.env.PORT || 3000;

/* Express 가 응답마다 붙이는 ETag 를 아예 끈다.
   ETag 는 "내용이 안 바뀌었으면 다시 안 보내도 된다"는 표시인데,
   게임 현황은 매 순간 바뀌므로 도움이 되지 않고 오히려 옛 내용을 쓰게 만든다. */
app.set('etag', false);

app.use(express.json());                       // 요청 본문의 JSON 을 자동 해석

/* ★ /api 로 시작하는 응답은 절대 캐시하지 않게 한다.

   브라우저는 GET 요청의 답을 저장해뒀다가 같은 주소를 또 부르면
   서버에 묻지 않고 저장해둔 것을 그대로 돌려준다.
   보통은 빠르라고 있는 기능이지만, 게임 현황처럼 매 순간 바뀌는 값에는 치명적이다.
   실제로 진행자 콘솔의 참가자 목록이 갱신되지 않는 일이 있었다.
   (참가자·프로젝터 화면은 실시간으로 받은 내용을 바로 그려서 영향이 없었다)

   no-store = 저장하지 마라
   ETag 도 지운다. 남겨두면 브라우저가 "안 바뀌었죠?" 하고 물어보고
   서버가 304 를 주면 결국 저장해둔 옛 내용을 쓰게 된다. */
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.removeHeader('ETag');
  next();
});

/* 화면 파일(html·css·js)도 저장해두지 않게 한다.

   [왜 이렇게까지 하나]
   브라우저는 한 번 받은 파일을 저장해뒀다가 다시 쓴다.
   보통은 빠르라고 있는 기능이지만, 이 프로젝트에서는 두 번 발목을 잡았다.
     · 프로젝터는 한 번 열어두고 행사 내내 그대로 둔다
     · 진행자 노트북도 콘솔을 띄워놓고 닫지 않는다
   그 사이에 화면 파일을 고치면, 열려 있던 쪽은 옛 화면을 계속 쓴다.
   "고쳤는데 왜 그대로지"의 정체가 이것이다.

   참가자 80명 규모에 파일도 몇 개 안 되므로 매번 새로 받아도 부담이 없다.
   빠른 것보다 "지금 보고 있는 게 최신"인 쪽이 훨씬 중요하다.

   ponytail: 행사 규모가 커지면 파일 이름에 번호를 붙이는 방식으로 바꾼다
             (app.js?v=3 처럼). 지금은 이게 가장 단순하고 확실하다. */
/* 주소만 치고 들어오면 참가자 화면(play.html)으로 보낸다.
   참가자는 대부분 이 주소들로 들어오므로, 외울 주소를 하나로 줄여준다.
     http://서버:3000/        → 원래는 홈(index.html)이 떴다
     http://서버:3000/html/   → 원래는 "Cannot GET /html/" 오류가 났다
   (Express 는 끝의 / 를 구분하지 않아서 '/html' 하나로 /html/ 도 같이 잡힌다)
   홈 화면은 /index.html 로 직접 치면 여전히 열린다. */
app.get(['/', '/html'], (req, res) => res.redirect('/html/play.html'));

/* ★ 참가 등록 화면(join.html)은 진행자만 연다.

   진행자 쿠키가 없으면 파일을 내주지 않고 진행자 로그인 화면으로 돌려보낸다.
   화면만 막으면 주소를 직접 불러 우회할 수 있으므로,
   진짜 자물쇠는 아래 /api/join 에 붙인 진행자확인 이다. 이건 길 안내용이다.

   주소를 %6Aoin.html 처럼 바꿔 쓰거나 대문자로 써도 같은 파일이 열리므로
   글자를 풀고(decodeURIComponent) 소문자로 바꾼 파일 이름으로 비교한다. */
app.use((req, res, next) => {
  /* %ZZ 처럼 깨진 주소는 글자를 풀다가 오류가 난다 (그대로 두면 500).
     정상 브라우저는 이런 주소를 보내지 않으므로 참가자 화면으로 보낸다. */
  let 파일;
  try { 파일 = path.basename(decodeURIComponent(req.path)).toLowerCase(); }
  catch { return res.redirect('/html/play.html'); }
  if (파일 !== 'join.html') return next();
  if (진행자세션.has(쿠키읽기(req, 'gb_admin'))) return next();
  res.redirect('/html/login.html');
});

const 저장안함 = {
  index: false,
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.set('Cache-Control', 'no-store')
};

/* ★ 공개할 폴더만 하나씩 지정한다. 프로젝트 뿌리를 통째로 열면 안 된다.

   예전에는 express.static(뿌리) 로 프로젝트 폴더 전체를 내보냈다.
   그러면 http://서버:3000/db/ 안의 문제 파일로 정답이,
   /server/server.js 로 서버 코드가 그대로 다운로드됐다 (실제로 200 이 나왔다).
   깃에서 정답 파일을 뺀 것도 소용이 없어진다.

   화면이 쓰는 파일은 index.html 과 아래 세 폴더뿐이다.
   db · server · scripts · node_modules 는 여기 없으므로 주소로 불러도 404 가 난다.
   ★ 화면용 폴더를 새로 만들면 여기에 이름을 더해야 열린다. */
for (const 폴더 of ['html', 'css', 'js']) {
  app.use('/' + 폴더, express.static(path.join(뿌리, 폴더), 저장안함));
}
app.get('/index.html', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(뿌리, 'index.html'));
});


/* ============================================================
   공통 도구
   ============================================================ */

/* 참가자 번호표(토큰)를 그대로 저장하지 않고 변환해서 저장한다.
   DB가 유출돼도 남의 번호표를 흉내 낼 수 없다. */
function 해시(값) {
  return crypto.createHash('sha256').update(String(값)).digest('hex');
}

/* 비밀번호(진행자 비번 · 참가자 PIN)를 저장할 수 있는 형태로 바꾼다.

   소금 = 매번 달라지는 무작위 글자.
   이걸 섞어야 같은 PIN 을 쓴 두 사람의 저장값이 서로 달라진다.
   소금이 없으면 "1234 를 변환한 값"이 모두 같아서, 한 명만 뚫리면 전부 뚫린다.

   저장 형태는 "소금:변환값" 이다. 진행자 계정(create-admin.mjs)과 같은 방식이다. */
function 비밀번호_만들기(원문) {
  const 소금 = crypto.randomBytes(16).toString('hex');
  return 소금 + ':' + crypto.scryptSync(원문, 소금, 64).toString('hex');
}

/* PIN 초기화 때 쓸 무작위 4자리를 만든다 (0000 ~ 9999).

   ★ 예전에는 항상 1234 로 되돌렸다.
   그런데 1234 는 모두가 아는 값이라, 남의 PIN 을 악용하던 사람이
   초기화 직후 본인보다 먼저 1234 로 들어가 버릴 수 있었다.
   무작위로 만들고 진행자 화면에만 띄우면 본인만 알게 된다.

   crypto.randomInt = 예측할 수 없는 난수 (Math.random 은 예측될 수 있다)
   padStart(4, '0') = 7 → '0007' 처럼 앞을 0으로 채워 항상 네 자리로 */
function 무작위PIN() {
  return String(crypto.randomInt(10000)).padStart(4, '0');
}

/* 빙고에서 쓰는 번호의 끝.
   판 25칸에는 이 범위에서 고른 서로 다른 25개가 들어가고,
   프로젝터에서 뽑는 볼도 이 개수만큼 놓인다.

   ★ 이 숫자를 바꾸면 화면과 DB 규칙도 같이 바꿔야 한다.
     화면: js/app.js 의 빙고최대번호
     DB:   db/008 의 빙고판_올바른가() 안의 BETWEEN 1 AND 50 */
const 빙고최대번호 = 50;

/* PIN 형식 검사. 4자리 숫자만 받는다.
   화면에서도 막지만, 바깥에서 오는 값은 전부 의심하므로 서버가 다시 본다. */
function PIN_검사(값) {
  const pin = String(값 ?? '');
  if (!/^\d{4}$/.test(pin)) throw 사용자오류(400, 'PIN 은 숫자 4자리로 입력해주세요.');
  return pin;
}

/* 비밀번호 확인용. Node 에 내장된 scrypt 를 쓰므로 라이브러리가 필요 없다.
   저장 형태는 "소금:변환값" 이다. */
function 비밀번호_맞나(입력, 저장된값) {
  const [소금, 저장된해시] = String(저장된값).split(':');
  if (!소금 || !저장된해시) return false;

  const 계산 = crypto.scryptSync(입력, 소금, 64).toString('hex');

  /* 글자를 === 로 비교하면 "몇 글자까지 맞았는지"가 시간 차이로 새어나간다.
     timingSafeEqual 은 항상 같은 시간이 걸려서 그 틈을 막는다. */
  const a = Buffer.from(계산, 'hex');
  const b = Buffer.from(저장된해시, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ★ 서버를 켤 때 만들기 → 맞나 가 한 바퀴 도는지 확인한다.
   이 둘이 어긋나면 아무도 로그인할 수 없게 되는데,
   행사 당일 현장에서 알게 되면 손쓸 방법이 없다. 켤 때 바로 터지는 게 낫다. */
if (!비밀번호_맞나('1234', 비밀번호_만들기('1234'))
    || 비밀번호_맞나('9999', 비밀번호_만들기('1234'))) {
  console.error('비밀번호 변환이 고장났습니다. 서버를 시작하지 않습니다.');
  process.exit(1);
}

/* 오류를 한 곳에서 처리한다.
   라우트마다 try/catch 를 쓰면 코드가 두 배가 되므로 감싸는 함수를 만든다. */
const 감싸기 = (할일) => (req, res) =>
  Promise.resolve(할일(req, res)).catch((오류) => {
    console.error(오류);
    res.status(오류.상태 || 500).json({ error: 오류.메시지 || '서버 오류가 발생했습니다.' });
  });

/* 사용자에게 보여줄 오류를 만든다. */
function 사용자오류(상태, 메시지) {
  const e = new Error(메시지);
  e.상태 = 상태;
  e.메시지 = 메시지;
  return e;
}


/* ============================================================
   실시간 (SSE)
   ============================================================ */

/* 지금 연결돼 있는 브라우저들의 통로를 모아둔다.
   Set 은 중복 없는 목록이다. 연결이 끊기면 목록에서 뺀다. */
const 연결목록 = new Set();

app.get('/api/events', 감싸기(async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'      // Nginx 가 내용을 모아두지 않고 바로 흘려보내게
  });

  연결목록.add(res);

  /* 연결하자마자 현재 상태를 한 번 보내준다.
     그래야 새로 들어온 사람이 빈 화면을 보지 않는다. */
  res.write(`data: ${JSON.stringify(await 공개상태())}\n\n`);

  /* 30초마다 주석 한 줄을 보낸다.
     아무것도 안 보내면 중간의 공유기나 Nginx 가 "죽은 연결"로 보고 끊어버린다. */
  const 심장박동 = setInterval(() => res.write(': ping\n\n'), 30000);

  req.on('close', () => {
    clearInterval(심장박동);
    연결목록.delete(res);
  });
}));

/* 상태가 바뀔 때마다 부른다. 연결된 전원에게 한 번에 보낸다. */
async function 전체알림() {
  const 상태 = await 공개상태();
  const 글 = `data: ${JSON.stringify(상태)}\n\n`;
  for (const 통로 of 연결목록) {
    try { 통로.write(글); } catch { 연결목록.delete(통로); }
  }
  return 상태;
}


/* ============================================================
   참가자용 API
   ============================================================ */

/* 현재 상태 한 번 조회. SSE 가 막힌 환경을 위한 대비책이다. */
app.get('/api/state', 감싸기(async (req, res) => {
  res.json(await 공개상태());
}));

/* 팀 목록 (현재 인원과 정원 포함) */
app.get('/api/teams', 감싸기(async (req, res) => {
  const { rows } = await 질의(`
    SELECT t.id, t.name, t.max_members,
           (SELECT count(*) FROM "goldenbell-participants" p WHERE p.team_id = t.id) AS members
    FROM "goldenbell-teams" t
    ORDER BY t.sort_order, t.id
  `);
  res.json(rows);
}));

/* 참가 등록  ★ 진행측 노트북에서 한다 (참가자 휴대폰이 아니다)
   ★ 진행자확인 을 붙였다 — 진행자 로그인 없이는 아무도 등록할 수 없다.

   흐름
     1. 참가자가 입장하면 진행측이 이 화면에서 팀과 이름을 적는다
     2. PIN 4자리는 참가자 본인이 직접 눌러 넣는다 (두 번 입력해 오타를 거른다)
     3. 등록만 하고 끝. 번호표(session_token)는 여기서 만들지 않는다
     4. 참가자가 자기 휴대폰에서 팀+이름+PIN 으로 로그인할 때 번호표가 발급된다 */
app.post('/api/join', 진행자확인, 감싸기(async (req, res) => {
  const { teamId, name, pin, pinConfirm } = req.body ?? {};

  /* 들어온 값을 먼저 검사한다. 바깥에서 오는 값은 전부 의심한다. */
  const 이름 = String(name ?? '').trim();
  if (이름.length < 1 || 이름.length > 20) throw 사용자오류(400, '이름을 1~20자로 입력해주세요.');
  if (!Number.isInteger(teamId)) throw 사용자오류(400, '팀을 선택해주세요.');

  const PIN = PIN_검사(pin);
  /* 두 칸이 다르면 참가자가 누르다 틀린 것이다. 여기서 막지 않으면
     본인이 기억하는 PIN 과 저장된 PIN 이 달라져 아예 못 들어온다. */
  if (PIN !== String(pinConfirm ?? '')) throw 사용자오류(400, 'PIN 두 칸이 서로 다릅니다.');

  const 참가자 = await 트랜잭션(async (연결) => {
    const 상태 = await 연결.query(`SELECT join_open FROM "goldenbell-game" WHERE id = 1`);
    if (!상태.rows[0].join_open) throw 사용자오류(409, '참가 접수가 마감되었습니다.');

    /* ★ 팀 정원 검사 — 줄을 잠그고(FOR UPDATE) 센다.
       잠그지 않으면 노트북 두 대에서 동시에 "9명이네, 들어가도 되겠다" 하고
       둘 다 넣어서 11명이 된다. */
    const 팀 = await 연결.query(
      `SELECT id, name, max_members FROM "goldenbell-teams" WHERE id = $1 FOR UPDATE`,
      [teamId]);
    if (!팀.rows[0]) throw 사용자오류(400, '없는 팀입니다.');

    const 인원 = await 연결.query(
      `SELECT count(*)::int AS n FROM "goldenbell-participants" WHERE team_id = $1`, [teamId]);
    if (인원.rows[0].n >= 팀.rows[0].max_members) {
      throw 사용자오류(409, '해당 팀은 정원이 찼습니다. 다른 팀을 선택해주세요.');
    }

    try {
      const 새참가자 = await 연결.query(
        `INSERT INTO "goldenbell-participants" (team_id, name, pin_hash)
         VALUES ($1, $2, $3) RETURNING id, team_id, name, status`,
        [teamId, 이름, 비밀번호_만들기(PIN)]);
      return { ...새참가자.rows[0], team_name: 팀.rows[0].name };
    } catch (오류) {
      /* 23505 = UNIQUE 위반. 같은 팀에 같은 이름이 이미 있다는 뜻이다. */
      if (오류.code === '23505') throw 사용자오류(409, '같은 팀에 이미 같은 이름이 있습니다.');
      throw 오류;
    }
  });

  await 전체알림();      // 참가 인원이 바뀌었으니 프로젝터 화면도 갱신
  res.status(201).json(참가자);
}));

/* 참가자 로그인  ★ 참가자 휴대폰에서 한다

   팀 + 이름 + PIN 이 모두 맞아야 번호표를 받는다.
   (이름만으로 찾지 않는 이유: 팀이 다르면 같은 이름이 있을 수 있다.
    DB의 UNIQUE 도 팀+이름 묶음으로 걸려 있다.)

   번호표를 여기서 처음 발급한다. 한 번 받으면 그 휴대폰에 저장되므로
   새로고침해도 다시 로그인할 필요가 없다. */
app.post('/api/login', 감싸기(async (req, res) => {
  const { teamId, name, pin, sessionToken } = req.body ?? {};

  const 이름 = String(name ?? '').trim();
  if (!Number.isInteger(teamId) || 이름.length < 1) throw 사용자오류(400, '팀과 이름을 입력해주세요.');
  if (!sessionToken || String(sessionToken).length < 10) throw 사용자오류(400, '잘못된 요청입니다.');

  const 나 = await 트랜잭션(async (연결) => {
    /* 줄을 잠그는 이유: 확인과 번호표 발급 사이에 끼어들 틈을 없앤다. */
    const { rows } = await 연결.query(
      `SELECT id, name, pin_hash, session_token_hash FROM "goldenbell-participants"
       WHERE team_id = $1 AND name = $2 FOR UPDATE`, [teamId, 이름]);
    const 사람 = rows[0];

    /* 어느 쪽이 틀렸는지 알려주지 않는다.
       구분해주면 "이 사람은 등록돼 있다"는 정보를 흘리게 된다. */
    if (!사람 || !사람.pin_hash || !비밀번호_맞나(String(pin ?? ''), 사람.pin_hash)) {
      throw 사용자오류(401, '팀 · 이름 · PIN 을 확인해주세요.');
    }

    /* ★ 이미 다른 기기에서 접속 중이면 막는다.

       예전에는 나중에 로그인한 쪽이 이겨서 먼저 들어와 있던 사람이 튕겨났다.
       PIN 을 엿본 사람이 로그인하면 본인이 쫓겨나는 셈이라, 이제는 먼저 들어온 쪽을 지킨다.

       같은 기기(같은 번호표)로 다시 로그인하는 건 막지 않는다.
       PIN 이 맞을 때만 이 검사를 하므로, PIN 을 모르는 사람은
       "그 사람이 접속 중인지"조차 알 수 없다.

       본인이 휴대폰을 바꿨거나 브라우저 기록을 지웠다면
       진행자가 콘솔에서 [PIN 초기화]를 눌러 접속을 풀어주면 된다. */
    if (사람.session_token_hash && 사람.session_token_hash !== 해시(sessionToken)) {
      throw 사용자오류(409, '이미 다른 기기에서 접속 중입니다. 본인이라면 진행측에 PIN 초기화를 요청해주세요.');
    }

    /* 번호표를 발급한다. */
    await 연결.query(
      `UPDATE "goldenbell-participants"
       SET session_token_hash = $1, last_seen_at = now() WHERE id = $2`,
      [해시(sessionToken), 사람.id]);

    return { id: 사람.id, name: 사람.name };
  });

  res.json(나);
}));

/* 내 정보 + 이번 문제에 낸 답 (새로고침 복구용) */
app.post('/api/me', 감싸기(async (req, res) => {
  const 토큰해시 = 해시(req.body?.sessionToken ?? '');

  const { rows } = await 질의(`
    SELECT p.id, p.name, p.status, p.revival_status, t.name AS team_name
    FROM "goldenbell-participants" p
    JOIN "goldenbell-teams" t ON t.id = p.team_id
    WHERE p.session_token_hash = $1`, [토큰해시]);

  const 나 = rows[0];
  if (!나) throw 사용자오류(404, '참가 기록이 없습니다.');

  await 질의(`UPDATE "goldenbell-participants" SET last_seen_at = now() WHERE id = $1`, [나.id]);

  const 내답 = await 질의(`
    SELECT a.answer, a.grade
    FROM "goldenbell-answers" a
    JOIN "goldenbell-game" g ON g.current_question_id = a.question_id
    WHERE a.participant_id = $1 AND g.id = 1`, [나.id]);

  /* 내 빙고판과 내가 만든 줄 수.

     빙고판은 사람마다 다르므로 전체 공개 상태(뷰)에 실을 수 없다.
     여기서 나에게만 따로 보내준다.
     줄 수도 DB가 센다 — 휴대폰이 세면 진행자 화면 숫자와 어긋날 수 있다. */
  const 내판 = await 질의(`
    SELECT b.cells, 빙고_줄수(b.cells, g.bingo_called) AS lines
    FROM "goldenbell-bingo-boards" b, "goldenbell-game" g
    WHERE b.participant_id = $1 AND g.id = 1`, [나.id]);

  res.json({ me: 나, myAnswer: 내답.rows[0] ?? null, myBoard: 내판.rows[0] ?? null });
}));

/* 빙고판 제출 (참가자가 1~25 를 직접 배치한 결과)

   판을 낼 수 있는 때는 '배치 중(setup)' 단계뿐이다.
   번호를 부르기 시작한 뒤에 판을 바꿀 수 있으면 아무 의미가 없다. */
app.post('/api/bingo/board', 감싸기(async (req, res) => {
  const { sessionToken, cells } = req.body ?? {};

  /* 들어온 값 검사. 바깥에서 오는 값은 전부 의심한다.
     DB에도 같은 검사(CHECK)가 걸려 있지만, 여기서 걸러야 사람이 읽을 수 있는
     오류 메시지를 돌려줄 수 있다. */
  if (!Array.isArray(cells) || cells.length !== 25) {
    throw 사용자오류(400, '빙고판은 25칸이어야 합니다.');
  }
  const 정리된칸 = cells.map(Number);
  const 종류 = new Set(정리된칸);
  if (종류.size !== 25
      || 정리된칸.some((n) => !Number.isInteger(n) || n < 1 || n > 빙고최대번호)) {
    throw 사용자오류(400, `1부터 ${빙고최대번호} 중에서 겹치지 않는 25개를 넣어주세요.`);
  }

  await 트랜잭션(async (연결) => {
    const 상태 = await 연결.query(
      `SELECT current_game, bingo_phase FROM "goldenbell-game" WHERE id = 1 FOR UPDATE`);
    const g = 상태.rows[0];

    if (g.current_game !== 'bingo') throw 사용자오류(409, '지금은 빙고 시간이 아닙니다.');
    if (g.bingo_phase !== 'setup') throw 사용자오류(409, '이미 번호를 부르기 시작해서 판을 낼 수 없습니다.');

    const 나 = await 연결.query(
      `SELECT id FROM "goldenbell-participants" WHERE session_token_hash = $1`,
      [해시(sessionToken ?? '')]);
    if (!나.rows[0]) throw 사용자오류(401, '참가자 정보를 확인할 수 없습니다.');

    /* ON CONFLICT ... DO UPDATE = 이미 판을 냈으면 덮어쓴다.
       배치 중에는 몇 번이고 고쳐도 되게 한다. */
    await 연결.query(`
      INSERT INTO "goldenbell-bingo-boards" (participant_id, cells)
      VALUES ($1, $2)
      ON CONFLICT (participant_id)
      DO UPDATE SET cells = EXCLUDED.cells, submitted_at = now()`,
      [나.rows[0].id, 정리된칸]);
  });

  await 전체알림();      // 판 제출 인원이 바뀌었으니 진행자 화면도 갱신
  res.status(201).json({ ok: true });
}));

/* 답안 제출 */
app.post('/api/answers', 감싸기(async (req, res) => {
  const { sessionToken, answer } = req.body ?? {};
  const 답 = String(answer ?? '').trim();
  if (답.length < 1 || 답.length > 500) throw 사용자오류(400, '답안을 1~500자로 입력해주세요.');

  await 트랜잭션(async (연결) => {
    /* ★ 마감 판정은 서버 시계로만 한다. 화면의 타이머 숫자는 믿지 않는다.
       게임 줄을 잠근 채로 확인해야 마감 직전 동시 제출이 새지 않는다. */
    const 상태 = await 연결.query(
      `SELECT phase, current_question_id, deadline, revival FROM "goldenbell-game"
       WHERE id = 1 FOR UPDATE`);
    const g = 상태.rows[0];

    if (g.phase !== 'running') throw 사용자오류(409, '지금은 제출할 수 없습니다.');
    if (!g.deadline || new Date(g.deadline) < new Date()) {
      throw 사용자오류(409, '제출이 마감되었습니다.');
    }

    const 나 = await 연결.query(
      `SELECT id, status, revival_status FROM "goldenbell-participants" WHERE session_token_hash = $1`,
      [해시(sessionToken ?? '')]);
    if (!나.rows[0]) throw 사용자오류(401, '참가자 정보를 확인할 수 없습니다.');

    /* ★ 누가 답을 낼 수 있나
       평소       = 생존자
       패자부활전 = 도전 중인 사람(revival_status = 'in')만. 생존자는 이번엔 쉰다. */
    if (g.revival) {
      if (나.rows[0].revival_status !== 'in') throw 사용자오류(409, '패자부활전 도전자만 제출할 수 있습니다.');
    } else if (나.rows[0].status !== 'active') {
      throw 사용자오류(409, '탈락한 참가자는 제출할 수 없습니다.');
    }

    try {
      await 연결.query(
        `INSERT INTO "goldenbell-answers" (question_id, participant_id, answer)
         VALUES ($1, $2, $3)`,
        [g.current_question_id, 나.rows[0].id, 답]);
    } catch (오류) {
      /* UNIQUE (question_id, participant_id) 가 중복 제출을 막아준다. */
      if (오류.code === '23505') throw 사용자오류(409, '이미 제출했습니다.');
      throw 오류;
    }
  });

  await 전체알림();      // 제출 인원 숫자가 바뀌었으니 전원에게 알린다
  res.status(201).json({ ok: true });
}));


/* 화면 이탈 기록  ★ 부정행위 방지

   참가자 휴대폰이 다른 앱·탭으로 나가면 away: true, 돌아오면 away: false 를 보낸다.

   기록하는 때는 퀴즈 문제가 떠 있는 동안(published · running)뿐이고,
   생존자만 센다 (탈락자가 나가는 건 상관없다).
   돌아왔다는 알림(false)은 언제 와도 받는다. 마감 뒤에 돌아와도 '이탈 중'이 풀려야 한다.

   away_now 가 이미 TRUE 면 횟수를 또 올리지 않는다 (같은 이탈을 두 번 세지 않게). */
app.post('/api/away', 감싸기(async (req, res) => {
  const 이탈함 = req.body?.away === true;

  const 결과 = await 질의(`
    UPDATE "goldenbell-participants" p
    SET away_now   = $2,
        away_count = p.away_count + CASE WHEN $2 AND NOT p.away_now THEN 1 ELSE 0 END
    FROM "goldenbell-game" g
    WHERE g.id = 1
      AND p.session_token_hash = $1
      AND p.away_now <> $2
      AND ($2 = FALSE OR (g.current_game = 'quiz'
                          AND g.phase = 'running'     -- 문제는 타이머 시작 때 공개된다
                          -- 지금 문제를 푸는 사람만 센다 (패자부활전이면 도전자, 아니면 생존자)
                          AND CASE WHEN g.revival THEN p.revival_status = 'in'
                                   ELSE p.status = 'active' END))`,
    [해시(req.body?.sessionToken ?? ''), 이탈함]);

  /* 바뀐 게 있을 때만 알린다. 진행자 콘솔이 이 알림을 받고 표를 다시 불러온다. */
  if (결과.rowCount > 0) await 전체알림();
  res.json({ ok: true });
}));


/* ============================================================
   진행자 로그인
   ============================================================ */

/* 로그인한 진행자를 기억해두는 곳. 서버를 끄면 사라진다(= 다시 로그인).
   ponytail: 한 대짜리 서버라 메모리로 충분하다.
   서버를 여러 대로 늘릴 때는 세션 표를 DB에 만들어야 한다. */
const 진행자세션 = new Map();

function 쿠키읽기(req, 이름) {
  const 전체 = req.headers.cookie ?? '';
  const 찾은 = 전체.split(';').map((s) => s.trim()).find((s) => s.startsWith(이름 + '='));
  return 찾은 ? decodeURIComponent(찾은.slice(이름.length + 1)) : null;
}

/* 진행자 전용 주소에 붙이는 문지기.
   이걸 빼먹으면 누구나 게임을 조작할 수 있게 되므로 반드시 붙인다. */
function 진행자확인(req, res, next) {
  const 표 = 쿠키읽기(req, 'gb_admin');
  if (!표 || !진행자세션.has(표)) {
    return res.status(401).json({ error: '진행자 로그인이 필요합니다.' });
  }
  req.진행자 = 진행자세션.get(표);
  next();
}

app.post('/api/admin/login', 감싸기(async (req, res) => {
  const { loginId, password } = req.body ?? {};

  const { rows } = await 질의(
    `SELECT id, login_id, display_name, password_hash FROM "goldenbell-admin"
     WHERE login_id = $1`, [String(loginId ?? '')]);

  const 계정 = rows[0];

  /* 아이디가 틀렸는지 비밀번호가 틀렸는지 구분해서 알려주지 않는다.
     구분해주면 "이 아이디는 존재한다"는 정보를 흘리게 된다. */
  if (!계정 || !비밀번호_맞나(String(password ?? ''), 계정.password_hash)) {
    throw 사용자오류(401, '아이디 또는 비밀번호를 확인해주세요.');
  }

  const 표 = crypto.randomBytes(32).toString('hex');
  진행자세션.set(표, { id: 계정.id, name: 계정.display_name });

  /* HttpOnly = 자바스크립트가 이 쿠키를 읽을 수 없다 (탈취 방지)
     SameSite=Strict = 다른 사이트에서 온 요청에는 쿠키를 안 보낸다 */
  res.setHeader('Set-Cookie',
    `gb_admin=${표}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
  res.json({ name: 계정.display_name });
}));

app.post('/api/admin/logout', 감싸기(async (req, res) => {
  진행자세션.delete(쿠키읽기(req, 'gb_admin'));
  res.setHeader('Set-Cookie', 'gb_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
}));


/* ============================================================
   진행자용 API
   ============================================================ */

/* 콘솔 화면에 필요한 모든 것 (참가자 표, 남은 문제, 현재 상태) */
app.get('/api/admin/state', 진행자확인, 감싸기(async (req, res) => {
  const 상태 = await 공개상태(true);     // 진행자는 공개 전 문제도 봐야 한다

  /* 참가자 한 줄에 퀴즈 답안과 빙고 현황을 같이 싣는다.
     표가 하나뿐이라 진행자가 볼 곳도 하나다.

     board_lines = 이 사람이 만든 줄 수 (판을 안 냈으면 NULL) */
  const 참가자 = await 질의(`
    SELECT p.id, p.name, p.status, p.team_id, t.name AS team_name,
           a.id AS answer_id, a.answer, a.grade,
           빙고_줄수(b.cells, g.bingo_called) AS board_lines,
           p.away_now, p.away_count, p.revival_status
    FROM "goldenbell-participants" p
    JOIN "goldenbell-teams" t ON t.id = p.team_id
    CROSS JOIN "goldenbell-game" g
    LEFT JOIN "goldenbell-answers" a
           ON a.participant_id = p.id
          AND a.question_id = g.current_question_id
    LEFT JOIN "goldenbell-bingo-boards" b ON b.participant_id = p.id
    WHERE g.id = 1
    ORDER BY t.sort_order, p.name
  `);

  /* ★ 지금 진행 중인 문제가 주관식이면 정답을 진행자에게만 알려준다.
     주관식은 답이 제각각이라("마이야르", "마이야르반응") 진행자가 직접 판정하는데,
     정답을 모르면 판정할 수가 없다.
     이 주소는 진행자확인 을 통과해야만 열리므로 참가자에게는 가지 않는다.
     (참가자에게 가는 공개상태에는 정답 공개 전까지 정답이 비어 있다)
     O/X · 객관식은 자동 채점이라 보여주지 않는다. */
  const 주관식정답 = await 질의(`
    SELECT k.correct_answers
    FROM "goldenbell-game" g
    JOIN "goldenbell-quizz" q ON q.id = g.current_question_id
    JOIN "goldenbell-answer-keys" k ON k.question_id = q.id
    WHERE g.id = 1 AND q.type = 'text'
  `);

  /* 아직 안 낸 문제만 (used_at 이 비어 있는 것) */
  const 남은문제 = await 질의(`
    SELECT id, code, question_order, question_text, type
    FROM "goldenbell-quizz"
    WHERE used_at IS NULL
      -- ★ 패자부활전 중엔 패자부활 문제(R01, R02)만, 평소엔 그것만 빼고 보여준다.
      --   (code LIKE 'R%') 는 참/거짓이 되고, 그걸 지금 패자부활전인지와 비교한다.
      AND (COALESCE(code, '') LIKE 'R%') = (SELECT revival FROM "goldenbell-game" WHERE id = 1)
    ORDER BY question_order
  `);

  /* 콘솔 대시보드용 숫자.
     화면에서 세지 않고 DB가 세서 보낸다. 사람마다 다른 숫자가 나올 여지가 없다.

     count(DISTINCT team_id) = 생존자가 한 명이라도 있는 팀의 수
     (전멸한 팀은 자동으로 빠진다) */
  const 대시보드 = await 질의(`
    SELECT
      (SELECT count(DISTINCT team_id) FROM "goldenbell-participants"
        WHERE status = 'active')                                   AS alive_teams,
      (SELECT count(*) FROM "goldenbell-participants"
        WHERE status = 'active')                                   AS alive_members,
      (SELECT count(*) FROM "goldenbell-participants"
        WHERE status = 'eliminated')                               AS eliminated_total,
      (SELECT count(*) FROM "goldenbell-participants"
        WHERE eliminated_question_id =
              (SELECT current_question_id FROM "goldenbell-game" WHERE id = 1))
                                                                   AS eliminated_this,
      (SELECT count(*) FROM "goldenbell-teams")                    AS total_teams
  `);

  /* 팀별 현황.
     LEFT JOIN 이라 참가자가 한 명도 없는 팀도 0명으로 나온다.

     count(...) FILTER (WHERE 조건) 은
     "조건에 맞는 것만 세라"는 Postgres 문법이다.
     같은 묶음에서 전체 인원과 생존 인원을 한 번에 셀 수 있다. */
  const 팀별 = await 질의(`
    SELECT t.id, t.name, t.max_members,
           count(p.id)                                  AS joined,
           count(p.id) FILTER (WHERE p.status = 'active') AS alive
    FROM "goldenbell-teams" t
    LEFT JOIN "goldenbell-participants" p ON p.team_id = t.id
    GROUP BY t.id, t.name, t.max_members, t.sort_order
    ORDER BY t.sort_order, t.id
  `);

  res.json({
    state: 상태,
    participants: 참가자.rows,
    remainingQuestions: 남은문제.rows,
    textAnswers: 주관식정답.rows[0]?.correct_answers ?? null,   // 주관식이 아니면 null
    dashboard: 대시보드.rows[0],
    teams: 팀별.rows,
    admin: req.진행자
  });
}));

/* 한 차례에 한 번만 누를 수 있는 버튼들 */
const 한번만_누를_버튼 = ['선택및공개', '타이머시작', '마감', '확정', '정답공개'];

app.post('/api/admin/action', 진행자확인, 감싸기(async (req, res) => {
  const { action, questionId, gameType, seconds } = req.body ?? {};

  await 트랜잭션(async (연결) => {
    /* 게임 줄을 잠근다. 진행자가 두 곳에서 동시에 눌러도 하나씩 처리된다. */
    const 상태 = await 연결.query(`SELECT * FROM "goldenbell-game" WHERE id = 1 FOR UPDATE`);
    const g = 상태.rows[0];

    /* ★ 이번 차례에 이미 누른 버튼이면 아무 일도 하지 않는다. */
    if (한번만_누를_버튼.includes(action) && g.used_actions.includes(action)) {
      throw 사용자오류(409, '이번 차례에 이미 누른 버튼입니다. 다음 ▶ 을 눌러주세요.');
    }

    if (action === '선택및공개') {
      if (g.phase !== 'waiting') throw 사용자오류(409, '진행 중인 문제를 끝내고 다음 ▶ 을 먼저 눌러주세요.');

      const 문제 = await 연결.query(
        `SELECT id FROM "goldenbell-quizz"
         WHERE id = $1 AND used_at IS NULL
           AND (COALESCE(code, '') LIKE 'R%') = $2`,     // 패자부활 문제는 패자부활전에만
        [questionId, g.revival]);
      if (!문제.rows[0]) throw 사용자오류(400, '고를 수 없는 문제입니다.');

      /* 낸 문제로 표시해두면 목록에서 저절로 사라진다. */
      await 연결.query(`UPDATE "goldenbell-quizz" SET used_at = now() WHERE id = $1`, [questionId]);
      await 연결.query(
        `UPDATE "goldenbell-game"
         SET phase = 'published', current_question_id = $1, deadline = NULL,
             used_actions = used_actions || $2::text
         WHERE id = 1`, [questionId, action]);

    } else if (action === '타이머시작') {
      if (g.phase !== 'published') throw 사용자오류(409, '문제를 먼저 선택해주세요.');

      /* 진행자가 콘솔에서 정한 제한 시간(초). 비어 있으면 문제에 원래 적힌 시간을 쓴다.
         문제 칸에 저장해두는 이유: 참가자·프로젝터 화면도 time_limit 을 읽으므로
         한 곳만 고치면 모든 화면이 같은 초를 본다. (DB 규칙상 5~300초) */
      if (seconds !== null && seconds !== undefined) {
        if (!Number.isInteger(seconds) || seconds < 5 || seconds > 300) {
          throw 사용자오류(400, '제한 시간은 5~300초 사이로 입력해주세요.');
        }
        await 연결.query(
          `UPDATE "goldenbell-quizz" SET time_limit = $1 WHERE id = $2`,
          [seconds, g.current_question_id]);
      }

      /* ★ 마감 시각을 DB가 계산한다.
         서버의 now() 에 제한 시간을 더하므로 어느 참가자에게나 같은 값이다. */
      await 연결.query(`
        UPDATE "goldenbell-game" g
        SET phase = 'running',
            deadline = now() + (q.time_limit || ' seconds')::interval,
            used_actions = g.used_actions || $1::text
        FROM "goldenbell-quizz" q
        WHERE g.id = 1 AND q.id = g.current_question_id`, [action]);

    } else if (action === '마감') {
      if (g.phase !== 'running') throw 사용자오류(409, '진행 중인 문제가 없습니다.');

      /* ★ 자동 채점을 SQL 한 번으로 끝낸다.
         correct_answers ? a.answer 는 "이 배열에 이 값이 있나"를 묻는다.
         주관식은 못 맞히면 pending(보류) 으로 남겨 진행자가 판단한다. */
      await 연결.query(`
        UPDATE "goldenbell-answers" a
        SET grade = CASE
              WHEN k.correct_answers ? a.answer THEN 'correct'
              WHEN q.type = 'text'              THEN 'pending'
              ELSE 'wrong'
            END
        FROM "goldenbell-quizz" q
        JOIN "goldenbell-answer-keys" k ON k.question_id = q.id
        WHERE a.question_id = q.id AND q.id = $1`, [g.current_question_id]);

      await 연결.query(
        `UPDATE "goldenbell-game" SET phase = 'closed', deadline = NULL,
                used_actions = used_actions || $1::text WHERE id = 1`, [action]);

    } else if (action === '확정') {
      if (g.phase !== 'closed') throw 사용자오류(409, '답변을 먼저 마감해주세요.');

      const 보류 = await 연결.query(
        `SELECT 1 FROM "goldenbell-answers"
         WHERE question_id = $1 AND grade = 'pending' LIMIT 1`, [g.current_question_id]);
      if (보류.rows[0]) throw 사용자오류(409, '보류된 주관식 답안을 먼저 판정해주세요.');

      /* ★ 패자부활전이면 생존자는 건드리지 않는다.
         정답을 못 낸(틀렸거나 안 낸) 도전자만 '부활 실패'로 바꾼다.
         두 문제를 끝까지 버틴 도전자('in')가 [패자부활전 종료] 때 살아난다. */
      if (g.revival) {
        await 연결.query(`
          UPDATE "goldenbell-participants" p
          SET revival_status = 'out'
          WHERE p.revival_status = 'in'
            AND NOT EXISTS (
              SELECT 1 FROM "goldenbell-answers" a
              WHERE a.participant_id = p.id
                AND a.question_id = $1
                AND a.grade = 'correct'
            )`, [g.current_question_id]);
      } else

      /* ★ 여기서 처음으로 탈락이 반영된다.
         오답을 냈거나, 아예 답을 내지 않은 생존자가 탈락한다. */
      await 연결.query(`
        UPDATE "goldenbell-participants" p
        SET status = 'eliminated',
            eliminated_question_id = $1     -- 어느 문제에서 떨어졌는지 남긴다
        WHERE p.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM "goldenbell-answers" a
            WHERE a.participant_id = p.id
              AND a.question_id = $1
              AND a.grade = 'correct'
          )`, [g.current_question_id]);

      await 연결.query(
        `UPDATE "goldenbell-game" SET phase = 'finalized',
                used_actions = used_actions || $1::text WHERE id = 1`, [action]);

    } else if (action === '정답공개') {
      if (g.phase !== 'finalized') throw 사용자오류(409, '판정 확정을 먼저 해주세요.');
      await 연결.query(
        `UPDATE "goldenbell-game" SET phase = 'revealed',
                used_actions = used_actions || $1::text WHERE id = 1`, [action]);

    } else if (action === '다음') {
      if (g.phase !== 'revealed') throw 사용자오류(409, '정답 공개까지 마친 뒤에 눌러주세요.');
      /* 버튼 잠금을 전부 풀고 문제를 고를 수 있는 상태로 되돌린다. */
      await 연결.query(`
        UPDATE "goldenbell-game"
        SET phase = 'waiting', current_question_id = NULL,
            deadline = NULL, used_actions = '{}'
        WHERE id = 1`);

    } else if (action === '퀴즈종료') {
      if (g.phase === 'finished') throw 사용자오류(409, '이미 종료된 게임입니다.');
      await 연결.query(
        `UPDATE "goldenbell-game" SET phase = 'finished', deadline = NULL WHERE id = 1`);

    } else if (action === '부활전시작') {
      /* 문제와 문제 사이(대기)에서만 시작한다. 문제 도중에 바꾸면 채점이 꼬인다. */
      if (g.revival) throw 사용자오류(409, '이미 패자부활전 중입니다.');
      if (g.phase !== 'waiting') throw 사용자오류(409, '지금 문제를 끝내고(다음 ▶) 대기 상태에서 시작해주세요.');

      /* 지금 탈락해 있는 사람 전원이 도전자가 된다. */
      const 도전자 = await 연결.query(`
        UPDATE "goldenbell-participants" SET revival_status = 'in'
        WHERE status = 'eliminated'`);
      if (도전자.rowCount === 0) throw 사용자오류(409, '탈락자가 없어서 패자부활전을 열 수 없습니다.');

      await 연결.query(`UPDATE "goldenbell-game" SET revival = TRUE WHERE id = 1`);

    } else if (action === '부활전종료') {
      if (!g.revival) throw 사용자오류(409, '패자부활전 중이 아닙니다.');
      if (g.phase !== 'waiting') throw 사용자오류(409, '지금 문제를 끝내고(다음 ▶) 대기 상태에서 종료해주세요.');

      /* 끝까지 버틴 도전자('in')를 생존자로 되돌리고, 도전 표시는 전부 지운다. */
      await 연결.query(`
        UPDATE "goldenbell-participants"
        SET status = 'active', eliminated_question_id = NULL
        WHERE revival_status = 'in'`);
      await 연결.query(`UPDATE "goldenbell-participants" SET revival_status = NULL`);
      await 연결.query(`UPDATE "goldenbell-game" SET revival = FALSE WHERE id = 1`);

    } else if (action === '게임선택') {
      /* ★ 참가자 휴대폰에 무엇을 띄울지 고른다 (퀴즈 / 빙고).
         퀴즈 진행 상태는 건드리지 않는다. 빙고 하다 돌아와도 있던 자리 그대로다. */
      if (!['quiz', 'bingo'].includes(gameType)) throw 사용자오류(400, '없는 게임입니다.');
      await 연결.query(`UPDATE "goldenbell-game" SET current_game = $1 WHERE id = 1`, [gameType]);

    } else if (action === '빙고시작') {
      if (g.bingo_phase !== 'setup') throw 사용자오류(409, '이미 시작했습니다. 다시 하려면 빙고 초기화를 눌러주세요.');

      const 판수 = await 연결.query(`SELECT count(*)::int AS n FROM "goldenbell-bingo-boards"`);
      if (판수.rows[0].n === 0) throw 사용자오류(409, '아직 판을 낸 참가자가 없습니다.');

      await 연결.query(`UPDATE "goldenbell-game" SET bingo_phase = 'running' WHERE id = 1`);

    } else if (action === '빙고번호') {
      if (g.bingo_phase !== 'running') throw 사용자오류(409, '빙고를 먼저 시작해주세요.');

      /* 아직 안 부른 번호 중에서 하나를 뽑는다.
         SQL 한 줄로도 되지만, 다 불렀을 때를 여기서 걸러야 해서 나눠 적었다.
         (배열에 NULL 을 이어 붙이면 칸 전체가 NULL 이 되어버린다) */
      const 남은번호 = [];
      for (let n = 1; n <= 빙고최대번호; n++) if (!g.bingo_called.includes(n)) 남은번호.push(n);
      if (남은번호.length === 0) throw 사용자오류(409, `${빙고최대번호}개 번호를 모두 불렀습니다.`);

      const 뽑은번호 = 남은번호[crypto.randomInt(남은번호.length)];
      await 연결.query(
        `UPDATE "goldenbell-game" SET bingo_called = bingo_called || $1::int WHERE id = 1`,
        [뽑은번호]);

    } else if (action === '빙고목표') {
      /* 몇 줄이면 빙고로 볼지. 인원과 남은 시간에 따라 현장에서 바꾼다. */
      const 목표 = Number(questionId);          // 콘솔이 숫자를 이 칸에 실어 보낸다
      if (!Number.isInteger(목표) || 목표 < 1 || 목표 > 12) {
        throw 사용자오류(400, '목표 줄 수는 1~12 사이여야 합니다.');
      }
      await 연결.query(`UPDATE "goldenbell-game" SET bingo_goal = $1 WHERE id = 1`, [목표]);

    } else if (action === '빙고종료') {
      await 연결.query(`UPDATE "goldenbell-game" SET bingo_phase = 'finished' WHERE id = 1`);

    } else if (action === '빙고초기화') {
      /* 판과 부른 번호를 전부 지우고 배치 단계로 되돌린다.
         참가자 계정은 그대로라 다시 판만 채우면 된다. */
      await 연결.query(`DELETE FROM "goldenbell-bingo-boards"`);
      await 연결.query(`
        UPDATE "goldenbell-game"
        SET bingo_phase = 'setup', bingo_called = '{}'
        WHERE id = 1`);

    } else if (action === '초기화') {
      /* 참가자와 답안을 지우고 처음 상태로 되돌린다. 문제와 계정은 남긴다.
         참가자를 지우면 빙고판도 같이 지워진다 (007 의 ON DELETE CASCADE). */
      await 연결.query(`DELETE FROM "goldenbell-answers"`);
      await 연결.query(`DELETE FROM "goldenbell-participants"`);
      await 연결.query(`UPDATE "goldenbell-quizz" SET used_at = NULL`);
      await 연결.query(`
        UPDATE "goldenbell-game"
        SET phase = 'waiting', current_question_id = NULL, deadline = NULL,
            used_actions = '{}', join_open = TRUE,
            current_game = 'quiz', bingo_phase = 'setup', bingo_called = '{}',
            revival = FALSE
        WHERE id = 1`);

    } else {
      throw 사용자오류(400, '지원하지 않는 작업입니다.');
    }
  });

  res.json(await 전체알림());
}));

/* 수동 판정 (정답/오답 직접 지정) */
app.post('/api/admin/grade', 진행자확인, 감싸기(async (req, res) => {
  const { answerId, grade } = req.body ?? {};
  if (!['correct', 'wrong'].includes(grade)) throw 사용자오류(400, '잘못된 판정입니다.');

  const 결과 = await 질의(`
    UPDATE "goldenbell-answers" a
    SET grade = $1, graded_by = $2
    FROM "goldenbell-game" g
    WHERE a.id = $3 AND g.id = 1
      AND a.question_id = g.current_question_id
      AND g.phase = 'closed'          -- 확정 뒤에는 못 고친다
    RETURNING a.id`, [grade, req.진행자.id, answerId]);

  if (!결과.rows[0]) throw 사용자오류(409, '지금은 판정을 바꿀 수 없습니다.');

  await 전체알림();
  res.json({ ok: true });
}));

/* PIN 초기화  ★ 참가자가 자기 PIN 을 잊었을 때 진행자가 눌러준다

   무작위 4자리로 바꾸고, 번호표도 같이 지운다.
   새 PIN 은 진행자 콘솔에만 한 번 뜬다 (서버에는 변환된 값만 남는다).

   번호표까지 지우는 이유:
   PIN 을 잊었다는 건 남이 먼저 들어가 있을 수도 있다는 뜻이다.
   번호표를 남겨두면 그 기기는 계속 접속된 채로 남는다.
   지우면 새 PIN 으로 다시 로그인한 사람만 들어올 수 있다. */
app.post('/api/admin/reset-pin', 진행자확인, 감싸기(async (req, res) => {
  const { participantId } = req.body ?? {};
  if (!Number.isInteger(participantId)) throw 사용자오류(400, '참가자를 선택해주세요.');

  const 새PIN = 무작위PIN();
  const { rows } = await 질의(
    `UPDATE "goldenbell-participants"
     SET pin_hash = $1, session_token_hash = NULL
     WHERE id = $2 RETURNING name`,
    [비밀번호_만들기(새PIN), participantId]);

  if (!rows[0]) throw 사용자오류(404, '없는 참가자입니다.');

  res.json({ name: rows[0].name, pin: 새PIN });
}));


/* ★ 위에서 아무도 처리하지 않은 주소는 참가자 화면으로 보낸다.

   /db, /server, /scripts 처럼 공개하지 않는 폴더나 잘못 친 주소가 여기로 온다.
   "Cannot GET /db" 오류를 띄우면 그 폴더가 있다는 힌트가 되고,
   참가자는 어디로 가야 할지 모른다. 그냥 참가자 화면으로 보내는 게 낫다.

   /api 로 시작하는 주소는 보내지 않는다.
   화면의 자바스크립트가 부르는 주소라 이동이 아니라 오류(404)를 받아야 한다.
   ★ 이 줄은 반드시 모든 주소 규칙의 맨 뒤에 있어야 한다.
     앞에 두면 정상 화면까지 전부 play.html 로 튕긴다. */
app.use((req, res) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.redirect('/html/play.html');
  }
  res.status(404).json({ error: '없는 주소입니다.' });
});


/* ============================================================
   서버 시작
   ============================================================ */

/* DB에 실제로 붙는지 먼저 확인하고 시작한다.
   못 붙으면 여기서 멈춰야 원인을 바로 알 수 있다. */
try {
  await 질의('SELECT 1');
  console.log('DB 연결 확인');
} catch (오류) {
  console.error('DB에 연결하지 못했습니다:', 오류.message);
  console.error('PostgreSQL 이 켜져 있는지, .env 의 DATABASE_URL 이 맞는지 확인해주세요.');
  process.exit(1);
}

app.listen(포트, () => {
  console.log(`골든벨 서버 실행 중 → http://localhost:${포트}`);
});

/* Ctrl+C 로 껐을 때 DB 연결을 깔끔히 닫는다. */
process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});
