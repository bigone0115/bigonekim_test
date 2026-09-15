/* ============================================================
   migrate.mjs  —  db 폴더의 SQL 파일을 번호 순서대로 실행한다
   ============================================================
   실행:  npm run migrate

   psql 명령을 외우지 않아도 되고, 로컬이든 EC2든 같은 명령을 쓴다.
   파일을 번호순(001, 002, ...)으로 실행하므로 순서가 보장된다.
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const 뿌리 = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const db폴더 = path.join(뿌리, 'db');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL 이 없습니다. .env.example 을 복사해 .env 를 만들어주세요.');
  process.exit(1);
}

/* 번호로 시작하는 .sql 파일만 골라 이름순으로 정렬한다.
   .bak 같은 다른 파일은 자동으로 걸러진다. */
const 파일들 = fs.readdirSync(db폴더)
  .filter((이름) => /^\d+.*\.sql$/.test(이름))
  .sort();

if (파일들.length === 0) {
  console.error('db 폴더에 실행할 .sql 파일이 없습니다.');
  process.exit(1);
}

const 연결 = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await 연결.connect();
} catch (오류) {
  console.error('DB에 연결하지 못했습니다:', 오류.message);
  console.error('PostgreSQL 이 켜져 있는지, .env 의 DATABASE_URL 이 맞는지 확인해주세요.');
  process.exit(1);
}

for (const 이름 of 파일들) {
  const 내용 = fs.readFileSync(path.join(db폴더, 이름), 'utf8');
  process.stdout.write(`${이름} ... `);
  try {
    await 연결.query(내용);
    console.log('완료');
  } catch (오류) {
    console.log('실패');
    console.error(`\n${이름} 에서 오류가 났습니다:\n  ${오류.message}`);
    if (오류.position) console.error(`  (${오류.position}번째 글자 근처)`);
    await 연결.end();
    process.exit(1);
  }
}

console.log('\n모든 SQL 파일을 적용했습니다.');
console.log('다음: npm run create-admin  으로 진행자 계정을 만드세요.');
await 연결.end();
