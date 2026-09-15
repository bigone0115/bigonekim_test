-- ============================================================
--  기본 데이터 넣기 (팀 8개, 문제 5개, 정답, 진행자 계정)
-- ============================================================
--  실행: npm run migrate  (001 다음에 자동으로 이어서 실행된다)
--
--  ON CONFLICT DO NOTHING = 이미 같은 값이 있으면 조용히 건너뛴다.
--  여러 번 실행해도 데이터가 두 배로 늘지 않는다.
-- ============================================================


-- ------------------------------------------------------------
-- 팀 8개 (각 정원 10명)
-- ------------------------------------------------------------
-- generate_series(1, 8) 은 1부터 8까지 숫자를 한 줄씩 만들어준다.
-- 여덟 줄을 손으로 쓰는 대신 이 한 줄로 끝낸다.
INSERT INTO "goldenbell-teams" (name, max_members, sort_order)
SELECT n || '팀', 10, n
FROM generate_series(1, 8) AS n
ON CONFLICT (name) DO NOTHING;


-- ------------------------------------------------------------
-- 문제 5개
-- ------------------------------------------------------------
INSERT INTO "goldenbell-quizz" (question_order, type, question_text, choices, time_limit)
VALUES
  (1, 'ox',     '추석은 음력 8월 15일이다.',              NULL, 20),
  (2, 'choice', '추석을 대표하는 음식은 무엇일까요?',
                '["송편","떡국","팥죽","냉면"]'::jsonb,         25),
  (3, 'text',   '조선 시대 거북선을 이끈 장군의 이름은?',   NULL, 30),
  (4, 'ox',     '한글을 만든 임금은 세종대왕이다.',        NULL, 20),
  (5, 'choice', '우리나라의 수도는 어디일까요?',
                '["부산","서울","대구","인천"]'::jsonb,         20)
ON CONFLICT (question_order) DO NOTHING;


-- ------------------------------------------------------------
-- 정답 (문제와 다른 표에 넣는다)
-- ------------------------------------------------------------
-- 배열로 넣으므로 인정 정답을 여러 개 둘 수 있다.
-- 주관식 3번은 '이순신' 과 '충무공 이순신' 을 모두 정답으로 인정한다.
--
-- question_order 로 문제를 찾아 id 를 가져온다.
-- 문제를 지웠다 다시 넣어도 id 가 바뀔 뿐 순번은 그대로라 안전하다.
INSERT INTO "goldenbell-answer-keys" (question_id, correct_answers)
SELECT q.id, v.answers
FROM (VALUES
  (1, '["O"]'::jsonb),
  (2, '["송편"]'::jsonb),
  (3, '["이순신","충무공 이순신"]'::jsonb),
  (4, '["O"]'::jsonb),
  (5, '["서울"]'::jsonb)
) AS v(question_order, answers)
JOIN "goldenbell-quizz" q ON q.question_order = v.question_order
ON CONFLICT (question_id) DO NOTHING;


-- ------------------------------------------------------------
-- 진행자 계정
-- ------------------------------------------------------------
-- 비밀번호는 여기에 넣지 않는다. 원문이 파일에 남으면 그대로 유출된다.
-- 계정 만들기는 아래 명령으로 한다. 비밀번호를 물어보고 변환해서 저장한다.
--
--     npm run create-admin
--
-- (scripts/create-admin.mjs 가 Node 내장 scrypt 로 변환해서 넣는다)


-- ------------------------------------------------------------
-- 확인
-- ------------------------------------------------------------
SELECT
  (SELECT count(*) FROM "goldenbell-teams")       AS 팀,
  (SELECT count(*) FROM "goldenbell-quizz")       AS 문제,
  (SELECT count(*) FROM "goldenbell-answer-keys") AS 정답,
  (SELECT count(*) FROM "goldenbell-admin")       AS 진행자;
