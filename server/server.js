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

app.use(express.static(뿌리, { index: 'index.html' }));   // 정적 파일 제공


/* ============================================================
   공통 도구
   ============================================================ */

/* 참가자 번호표(토큰)를 그대로 저장하지 않고 변환해서 저장한다.
   DB가 유출돼도 남의 번호표를 흉내 낼 수 없다. */
function 해시(값) {
  return crypto.createHash('sha256').update(String(값)).digest('hex');
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

/* 참가 등록 */
app.post('/api/join', 감싸기(async (req, res) => {
  const { teamId, name, sessionToken } = req.body ?? {};

  /* 들어온 값을 먼저 검사한다. 바깥에서 오는 값은 전부 의심한다. */
  const 이름 = String(name ?? '').trim();
  if (이름.length < 1 || 이름.length > 20) throw 사용자오류(400, '이름을 1~20자로 입력해주세요.');
  if (!Number.isInteger(teamId)) throw 사용자오류(400, '팀을 선택해주세요.');
  if (!sessionToken || String(sessionToken).length < 10) throw 사용자오류(400, '잘못된 요청입니다.');

  const 토큰해시 = 해시(sessionToken);

  const 참가자 = await 트랜잭션(async (연결) => {
    /* 이미 등록된 번호표면 그 사람을 그대로 돌려준다. (새로고침 복구) */
    const 기존 = await 연결.query(
      `SELECT id, team_id, name, status FROM "goldenbell-participants"
       WHERE session_token_hash = $1`, [토큰해시]);
    if (기존.rows[0]) {
      await 연결.query(
        `UPDATE "goldenbell-participants" SET last_seen_at = now() WHERE id = $1`,
        [기존.rows[0].id]);
      return { ...기존.rows[0], 복구됨: true };
    }

    const 상태 = await 연결.query(`SELECT join_open FROM "goldenbell-game" WHERE id = 1`);
    if (!상태.rows[0].join_open) throw 사용자오류(409, '참가 접수가 마감되었습니다.');

    /* ★ 팀 정원 검사 — 줄을 잠그고(FOR UPDATE) 센다.
       잠그지 않으면 두 사람이 동시에 "9명이네, 들어가도 되겠다" 하고
       둘 다 들어와서 11명이 된다. */
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
        `INSERT INTO "goldenbell-participants" (team_id, name, session_token_hash)
         VALUES ($1, $2, $3) RETURNING id, team_id, name, status`,
        [teamId, 이름, 토큰해시]);
      return { ...새참가자.rows[0], 복구됨: false };
    } catch (오류) {
      /* 23505 = UNIQUE 위반. 같은 팀에 같은 이름이 이미 있다는 뜻이다. */
      if (오류.code === '23505') throw 사용자오류(409, '같은 팀에 이미 같은 이름이 있습니다.');
      throw 오류;
    }
  });

  await 전체알림();      // 참가 인원이 바뀌었으니 프로젝터 화면도 갱신
  res.status(201).json(참가자);
}));

/* 내 정보 + 이번 문제에 낸 답 (새로고침 복구용) */
app.post('/api/me', 감싸기(async (req, res) => {
  const 토큰해시 = 해시(req.body?.sessionToken ?? '');

  const { rows } = await 질의(`
    SELECT p.id, p.name, p.status, t.name AS team_name
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

  res.json({ me: 나, myAnswer: 내답.rows[0] ?? null });
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
      `SELECT phase, current_question_id, deadline FROM "goldenbell-game"
       WHERE id = 1 FOR UPDATE`);
    const g = 상태.rows[0];

    if (g.phase !== 'running') throw 사용자오류(409, '지금은 제출할 수 없습니다.');
    if (!g.deadline || new Date(g.deadline) < new Date()) {
      throw 사용자오류(409, '제출이 마감되었습니다.');
    }

    const 나 = await 연결.query(
      `SELECT id, status FROM "goldenbell-participants" WHERE session_token_hash = $1`,
      [해시(sessionToken ?? '')]);
    if (!나.rows[0]) throw 사용자오류(401, '참가자 정보를 확인할 수 없습니다.');
    if (나.rows[0].status !== 'active') throw 사용자오류(409, '탈락한 참가자는 제출할 수 없습니다.');

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
  const 상태 = await 공개상태();

  const 참가자 = await 질의(`
    SELECT p.id, p.name, p.status, p.team_id, t.name AS team_name,
           a.id AS answer_id, a.answer, a.grade
    FROM "goldenbell-participants" p
    JOIN "goldenbell-teams" t ON t.id = p.team_id
    LEFT JOIN "goldenbell-answers" a
           ON a.participant_id = p.id
          AND a.question_id = (SELECT current_question_id FROM "goldenbell-game" WHERE id = 1)
    ORDER BY t.sort_order, p.name
  `);

  /* 아직 안 낸 문제만 (used_at 이 비어 있는 것) */
  const 남은문제 = await 질의(`
    SELECT id, question_order, question_text
    FROM "goldenbell-quizz" WHERE used_at IS NULL ORDER BY question_order
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
    dashboard: 대시보드.rows[0],
    teams: 팀별.rows,
    admin: req.진행자
  });
}));

/* 한 차례에 한 번만 누를 수 있는 버튼들 */
const 한번만_누를_버튼 = ['선택및공개', '타이머시작', '마감', '확정', '정답공개'];

app.post('/api/admin/action', 진행자확인, 감싸기(async (req, res) => {
  const { action, questionId } = req.body ?? {};

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
        `SELECT id FROM "goldenbell-quizz" WHERE id = $1 AND used_at IS NULL`, [questionId]);
      if (!문제.rows[0]) throw 사용자오류(400, '고를 수 없는 문제입니다.');

      /* 낸 문제로 표시해두면 목록에서 저절로 사라진다. */
      await 연결.query(`UPDATE "goldenbell-quizz" SET used_at = now() WHERE id = $1`, [questionId]);
      await 연결.query(
        `UPDATE "goldenbell-game"
         SET phase = 'published', current_question_id = $1, deadline = NULL,
             used_actions = used_actions || $2::text
         WHERE id = 1`, [questionId, action]);

    } else if (action === '타이머시작') {
      if (g.phase !== 'published') throw 사용자오류(409, '문제를 먼저 공개해주세요.');

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

    } else if (action === '초기화') {
      /* 참가자와 답안을 지우고 처음 상태로 되돌린다. 문제와 계정은 남긴다. */
      await 연결.query(`DELETE FROM "goldenbell-answers"`);
      await 연결.query(`DELETE FROM "goldenbell-participants"`);
      await 연결.query(`UPDATE "goldenbell-quizz" SET used_at = NULL`);
      await 연결.query(`
        UPDATE "goldenbell-game"
        SET phase = 'waiting', current_question_id = NULL, deadline = NULL,
            used_actions = '{}', join_open = TRUE
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
