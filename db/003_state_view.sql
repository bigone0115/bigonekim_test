-- ============================================================
--  참가자·프로젝터에게 내보낼 안전한 뷰
-- ============================================================
--  실행: npm run migrate  (번호순으로 001 → 002 → 003 실행된다)
--
--  [왜 파일을 따로 뒀나]
--  뷰는 화면을 고칠 때마다 같이 바뀐다. 표는 좀처럼 안 바뀐다.
--  뷰만 이 파일에 모아두면, 화면에 칸을 하나 더 보내고 싶을 때
--  이 파일만 고쳐서 다시 실행하면 된다.
--  표를 지웠다 새로 만들 필요가 없으니 진행 중인 데이터가 안 날아간다.
--
--  뷰(VIEW)는 "미리 저장해둔 SELECT 문"이다. 실제 데이터를 복사하지 않는다.
--
--  [이 뷰가 지키는 것]
--  서버는 실시간 전송(SSE)에서 이 뷰만 조회한다. 그래서
--    - 정답은 phase 가 revealed / finished 일 때만 나온다 (그 전엔 무조건 NULL)
--    - 어떤 값이 나가는지 한 곳에서만 관리된다
--  서버 코드가 실수해도 DB가 막아준다.
-- ============================================================

DROP VIEW IF EXISTS "goldenbell-public-state";

CREATE VIEW "goldenbell-public-state" AS
SELECT
  g.state_version,
  g.phase,
  g.deadline,
  g.join_open,
  g.used_actions,

  -- ★ 서버의 현재 시각. 휴대폰 시계가 틀린 만큼을 참가자가 보정한다.
  now() AS server_now,

  q.id             AS question_id,
  q.question_order,
  q.type           AS question_type,
  q.question_text,
  q.choices,
  q.time_limit,

  -- ★ 정답 공개 전에는 CASE 가 NULL 을 돌려준다.
  CASE WHEN g.phase IN ('revealed', 'finished')
       THEN k.correct_answers END AS correct_answers,

  (SELECT count(*) FROM "goldenbell-participants" WHERE status = 'active') AS alive_count,
  (SELECT count(*) FROM "goldenbell-participants")                         AS total_count,
  (SELECT count(*) FROM "goldenbell-answers" a
    WHERE a.question_id = g.current_question_id)                           AS submitted_count,

  -- 아직 안 낸 문제 수와 전체 문제 수.
  -- 프로젝터는 이 둘이 같으면 "아직 한 문제도 안 냈다 = 게임 시작 전"으로 보고
  -- 참가 안내 화면을 띄운다.
  (SELECT count(*) FROM "goldenbell-quizz" WHERE used_at IS NULL)          AS remaining_questions,
  (SELECT count(*) FROM "goldenbell-quizz")                                AS total_questions,

  -- 게임이 끝났을 때만 생존자(=우승자) 이름을 내보낸다.
  CASE WHEN g.phase = 'finished' THEN (
    SELECT coalesce(json_agg(t.name || ' ' || p.name ORDER BY p.id), '[]'::json)
    FROM "goldenbell-participants" p
    JOIN "goldenbell-teams" t ON t.id = p.team_id
    WHERE p.status = 'active'
  ) END AS winners

FROM "goldenbell-game" g
-- LEFT JOIN = 짝이 없어도 왼쪽 행은 남긴다 (문제 선택 전에도 상태를 보여줘야 하므로)
LEFT JOIN "goldenbell-quizz"       q ON q.id = g.current_question_id
LEFT JOIN "goldenbell-answer-keys" k ON k.question_id = g.current_question_id;


-- 확인
SELECT state_version, phase, remaining_questions, total_questions
FROM "goldenbell-public-state";
