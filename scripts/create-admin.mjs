/* ============================================================
   create-admin.mjs  —  진행자 계정 만들기
   ============================================================
   실행:  npm run create-admin

   비밀번호를 물어본 뒤 변환(scrypt)해서 저장한다.
   원문은 화면에도 파일에도 DB에도 남지 않는다.

   [왜 변환해서 저장하나]
   DB가 통째로 유출돼도 원문 비밀번호를 알아낼 수 없게 하기 위해서다.
   scrypt 는 Node 에 기본으로 들어 있어 라이브러리를 깔 필요가 없다.
   ============================================================ */

import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL 이 없습니다. .env 를 확인해주세요.');
  process.exit(1);
}

/* 값을 받는 방법이 두 가지다.

   1) 그냥 실행하면 하나씩 물어본다 (사람이 직접 만들 때)
        npm run create-admin

   2) 명령줄에 붙여서 한 번에 넘길 수도 있다 (설치 자동화용)
        node --env-file=.env scripts/create-admin.mjs 아이디 비밀번호 이름

      단, 2번은 비밀번호가 명령 기록에 남는다.
      평소에는 1번을 쓰고, 2번은 설치 스크립트에서만 쓴다. */
let [아이디, 비밀번호, 이름] = process.argv.slice(2);

if (!아이디 || !비밀번호) {
  const 입력 = readline.createInterface({ input: stdin, output: stdout });
  아이디 = (await 입력.question('진행자 아이디: ')).trim();
  비밀번호 = (await 입력.question('비밀번호 (8자 이상): ')).trim();
  이름 = (await 입력.question('표시 이름 (그냥 엔터 치면 "진행자"): ')).trim();
  입력.close();
}

아이디 = String(아이디).trim();
비밀번호 = String(비밀번호).trim();
이름 = String(이름 ?? '').trim() || '진행자';

if (아이디.length < 2) { console.error('아이디가 너무 짧습니다.'); process.exit(1); }
if (비밀번호.length < 8) { console.error('비밀번호를 8자 이상으로 해주세요.'); process.exit(1); }

/* 소금(salt) = 계정마다 다른 무작위 값.
   이걸 섞어야 같은 비밀번호를 쓴 두 사람의 저장값이 달라진다.
   저장 형태는 "소금:변환값" 이다. */
const 소금 = crypto.randomBytes(16).toString('hex');
const 변환값 = crypto.scryptSync(비밀번호, 소금, 64).toString('hex');

const 연결 = new pg.Client({ connectionString: process.env.DATABASE_URL });
await 연결.connect();

try {
  /* ON CONFLICT ... DO UPDATE = 같은 아이디가 이미 있으면 비밀번호를 바꾼다.
     비밀번호를 잊었을 때 이 명령을 다시 실행하면 재설정된다. */
  await 연결.query(`
    INSERT INTO "goldenbell-admin" (login_id, password_hash, display_name)
    VALUES ($1, $2, $3)
    ON CONFLICT (login_id) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          display_name  = EXCLUDED.display_name`,
    [아이디, `${소금}:${변환값}`, 이름]);

  console.log(`\n진행자 계정 '${아이디}' 준비 완료. 로그인 화면에서 사용하세요.`);
} catch (오류) {
  console.error('계정을 만들지 못했습니다:', 오류.message);
  process.exitCode = 1;
} finally {
  await 연결.end();
}
