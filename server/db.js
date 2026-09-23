/* ============================================================
   db.js  —  PostgreSQL 연결을 담당하는 단 하나의 파일
   ============================================================

   [왜 파일을 따로 두나]
   접속 정보가 여기 한 곳에만 있으면, 로컬에서 EC2로 옮길 때
   이 파일도 서버 코드도 한 글자도 안 고쳐도 된다.
   바뀌는 건 .env 파일 한 줄뿐이다.

   [.env 파일]
   비밀번호가 들어가므로 깃에 올리지 않는다 (.gitignore 에 넣어뒀다).
   .env.example 을 복사해서 .env 를 만들고 값을 채우면 된다.

   Node 22 부터는 dotenv 같은 라이브러리 없이
   node --env-file=.env 로 실행하면 .env 를 알아서 읽는다.
   ============================================================ */

import pg from 'pg';

const { Pool } = pg;

/* ★ BIGINT 를 숫자로 받게 고친다.

   Postgres 의 BIGINT 는 자바스크립트 숫자가 담을 수 있는 범위보다 커서,
   pg 라이브러리는 기본적으로 글자로 돌려준다. count(*) 결과도 BIGINT 다.

   글자로 오면 비교가 엉뚱해진다.
       '9' > '14'  →  true   (글자는 앞자리부터 비교하므로 9가 더 크다)
        9  >  14   →  false  (숫자로는 당연히 14가 크다)

   버전 번호와 인원수를 이렇게 비교하면 화면이 갱신되다 말거나
   숫자가 거꾸로 표시된다. 그래서 시작할 때 아예 숫자로 받도록 바꾼다.

   20 은 BIGINT 의 자료형 번호다.
   참가자 80명·문제 40개 규모에서는 자릿수가 넘칠 일이 없다. */
pg.types.setTypeParser(20, (값) => Number(값));

/* 접속 주소가 없으면 여기서 바로 멈춘다.
   주소가 없는 채로 서버를 띄우면 첫 요청이 올 때까지 문제를 모른다.
   시작할 때 터지는 편이 훨씬 낫다. */
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL 이 없습니다. .env.example 을 복사해 .env 를 만들어주세요.');
  process.exit(1);
}

/* 풀(Pool) = 미리 만들어둔 DB 연결 묶음.
   요청마다 새로 연결하면 느리므로, 만들어둔 것을 빌려 쓰고 돌려준다.

   max: 20 인 이유
   기본값은 10 인데, 80명이 같은 순간에 답을 내면 모자랄 수 있다.
   Postgres 쪽 기본 상한(100)에는 여유가 있으므로 이쪽만 올리면 된다. */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000
});

/* 질의 한 번을 짧게 쓰기 위한 도우미.

   ★ 반드시 이 형태로 값을 넘긴다
       질의('SELECT * FROM t WHERE id = $1', [번호])    ← 맞다
       질의('SELECT * FROM t WHERE id = ' + 번호)       ← 절대 금지

   아래쪽처럼 글자를 이어 붙이면 SQL 주입(injection) 공격이 가능해진다.
   $1, $2 로 넘기면 Postgres 가 값으로만 취급해서 안전하다. */
export function 질의(문장, 값들 = []) {
  return pool.query(문장, 값들);
}

/* 여러 작업을 "전부 성공하거나 전부 취소" 로 묶는다.

   예: 판정 확정은 '답안 채점'과 '참가자 탈락 처리'를 같이 해야 한다.
   중간에 실패했는데 앞부분만 저장되면 데이터가 어긋난다.
   트랜잭션으로 묶으면 그런 반쪽 상태가 생기지 않는다. */
export async function 트랜잭션(할일) {
  const 연결 = await pool.connect();
  try {
    await 연결.query('BEGIN');
    const 결과 = await 할일(연결);
    await 연결.query('COMMIT');
    return 결과;
  } catch (오류) {
    await 연결.query('ROLLBACK');    // 하나라도 실패하면 전부 되돌린다
    throw 오류;
  } finally {
    연결.release();                   // 성공하든 실패하든 반드시 반납한다
  }
}

/* 참가자·프로젝터에게 보낼 안전한 상태 한 덩어리.
   정답 차단은 이 뷰(SQL) 안에서 처리되므로 여기서 따로 거를 필요가 없다. */
/* ★ 진행자용 = true 면 가리지 않고 그대로 준다 (진행자 콘솔 전용).

   문제를 고르기만 한 단계(published)에서는 참가자·프로젝터에게 문제를 숨긴다.
   진행자가 [타이머 시작]을 누르는 순간(running) 비로소 공개된다.
   문제 칸을 전부 비우면 참가자·프로젝터 화면은 "문제가 없다"고 보고
   원래 있던 대기 화면(다음 문제가 곧 공개됩니다)을 그대로 띄운다. */
export async function 공개상태(진행자용 = false) {
  const { rows } = await 질의('SELECT * FROM "goldenbell-public-state"');

  const 상태 = rows[0];
  if (!진행자용 && 상태.phase === 'published') {
    for (const 칸 of ['question_id', 'question_order', 'question_type',
                      'question_text', 'choices', 'time_limit']) {
      상태[칸] = null;
    }
  }
  return 상태;
}
