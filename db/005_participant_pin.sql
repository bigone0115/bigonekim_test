-- ============================================================
--  참가자 PIN 칸 추가
-- ============================================================
--  실행: npm run migrate
--
--  [왜 필요한가]
--  지금까지는 팀과 이름만 알면 누구나 남의 신원으로 들어올 수 있었다.
--  이제 참가 등록은 진행측 노트북에서 하고,
--  참가자는 자기 휴대폰에서 팀 + 이름 + PIN 을 맞춰야 들어온다.
--
--  [바꾸는 것 두 가지]
--  1. pin_hash 칸을 새로 만든다
--  2. session_token_hash 를 비워둘 수 있게 한다
--
--  2번이 필요한 이유:
--  예전에는 참가자 휴대폰이 직접 등록하면서 번호표를 같이 만들었다.
--  이제는 노트북이 먼저 등록하고, 번호표는 나중에 휴대폰이 로그인할 때 받는다.
--  그래서 등록 직후에는 번호표가 없는 상태로 잠시 머문다.
--  NOT NULL 을 그대로 두면 이 상태를 저장할 수가 없다.
--
--  UNIQUE 는 건드리지 않는다.
--  PostgreSQL 은 NULL 을 서로 다른 값으로 치기 때문에,
--  번호표가 없는 참가자가 여러 명 있어도 UNIQUE 에 걸리지 않는다.
--
--  [ALTER TABLE 을 쓴 이유]
--  004 와 같다. 001 을 고치면 표를 지웠다 새로 만들어서
--  진행 중인 참가자와 답안이 전부 날아간다.
--
--  IF NOT EXISTS = 이미 있으면 그냥 넘어간다 (여러 번 실행해도 안전)
-- ============================================================

ALTER TABLE "goldenbell-participants"
  ADD COLUMN IF NOT EXISTS pin_hash TEXT;

ALTER TABLE "goldenbell-participants"
  ALTER COLUMN session_token_hash DROP NOT NULL;

COMMENT ON COLUMN "goldenbell-participants".pin_hash IS
  'scrypt 로 변환한 값만 넣는다 ("소금:변환값" 형태).
   진행자 비밀번호와 똑같은 방식이다. PIN 원문은 어디에도 저장하지 않는다.
   진행자가 콘솔에서 초기화하면 기본값 1234 로 되돌아간다.';


-- 확인
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'goldenbell-participants'
ORDER BY ordinal_position;
