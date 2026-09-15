-- ============================================================
--  탈락 시점 기록 칸 추가
-- ============================================================
--  실행: npm run migrate
--
--  [왜 필요한가]
--  진행자 콘솔에 "이번 문제에서 몇 명이 탈락했는지"를 보여주려면
--  누가 어느 문제에서 떨어졌는지를 알아야 한다.
--  지금은 status 가 'eliminated' 인 것만 알 수 있어서
--  1번 문제에서 떨어진 사람과 3번 문제에서 떨어진 사람을 구분할 수 없다.
--
--  [ALTER TABLE 을 쓴 이유]
--  001_schema.sql 을 고쳐서 다시 실행하면 표를 지웠다 새로 만들기 때문에
--  진행 중인 참가자와 답안이 전부 날아간다.
--  ALTER TABLE 은 있는 표에 칸만 덧붙이므로 데이터가 그대로 남는다.
--  마이그레이션 파일을 번호순으로 쌓아가는 이유가 바로 이것이다.
--
--  IF NOT EXISTS = 이미 있으면 그냥 넘어간다 (여러 번 실행해도 안전)
-- ============================================================

ALTER TABLE "goldenbell-participants"
  ADD COLUMN IF NOT EXISTS eliminated_question_id INTEGER
    REFERENCES "goldenbell-quizz"(id) ON DELETE SET NULL;

COMMENT ON COLUMN "goldenbell-participants".eliminated_question_id IS
  '어느 문제에서 탈락했는지. NULL 이면 아직 생존 중이다.
   나중에 "왜 떨어졌느냐"는 이의제기가 들어올 때 근거가 된다.';


-- 확인
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'goldenbell-participants'
ORDER BY ordinal_position;
