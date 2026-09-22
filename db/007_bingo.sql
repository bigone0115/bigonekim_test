-- ============================================================
--  게임 고르기(퀴즈 / 빙고) + 빙고 게임
-- ============================================================
--  실행: npm run migrate
--
--  [무엇을 넣나]
--  1. 지금 어떤 게임을 하는지 담는 칸 (current_game)
--  2. 빙고 진행 상태 칸 (단계, 부른 번호, 목표 줄 수)
--  3. 참가자별 빙고판 표
--  4. 빙고 줄 수를 세는 함수
--  5. 참가자에게 내보낼 뷰를 빙고 칸까지 포함해 다시 만든다
--
--  [빙고 규칙]
--  5x5 스물다섯 칸에 1~25 를 참가자가 직접 배치한다.
--  진행자가 번호를 부르면 모든 판에서 그 번호가 저절로 칠해진다.
--  가로·세로·대각선으로 다섯 칸이 다 칠해지면 한 줄이고,
--  목표 줄 수(기본 3줄)에 닿으면 빙고다.
--
--  [퀴즈와 따로 둔 이유]
--  퀴즈의 phase 를 같이 쓰면 "빙고 중인데 문제 단계가 running" 같은
--  말이 안 되는 상태가 생긴다. 칸을 나눠두면 게임을 오가도 서로 안 건드린다.
--  퀴즈 하다가 빙고로 갔다 돌아와도 퀴즈는 있던 자리 그대로다.
-- ============================================================


-- ------------------------------------------------------------
-- 1) 게임 종류 + 빙고 상태 칸
-- ------------------------------------------------------------
-- 한 ALTER 문에 여러 칸을 쉼표로 이어 붙일 수 있다.
ALTER TABLE "goldenbell-game"
  ADD COLUMN IF NOT EXISTS current_game TEXT      NOT NULL DEFAULT 'quiz',
  ADD COLUMN IF NOT EXISTS bingo_phase  TEXT      NOT NULL DEFAULT 'setup',
  ADD COLUMN IF NOT EXISTS bingo_called INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS bingo_goal   INTEGER   NOT NULL DEFAULT 3;

-- CHECK 에는 IF NOT EXISTS 를 쓸 수 없다.
-- 그래서 있으면 지우고 다시 만든다 (여러 번 실행해도 안전하게).
ALTER TABLE "goldenbell-game" DROP CONSTRAINT IF EXISTS 게임종류_확인;
ALTER TABLE "goldenbell-game" ADD  CONSTRAINT 게임종류_확인
  CHECK (current_game IN ('quiz', 'bingo'));

ALTER TABLE "goldenbell-game" DROP CONSTRAINT IF EXISTS 빙고단계_확인;
ALTER TABLE "goldenbell-game" ADD  CONSTRAINT 빙고단계_확인
  CHECK (bingo_phase IN (
    'setup',     -- 참가자가 판을 채우는 중
    'running',   -- 진행자가 번호를 부르는 중
    'finished'   -- 끝
  ));

ALTER TABLE "goldenbell-game" DROP CONSTRAINT IF EXISTS 빙고목표_확인;
ALTER TABLE "goldenbell-game" ADD  CONSTRAINT 빙고목표_확인
  CHECK (bingo_goal BETWEEN 1 AND 12);   -- 5x5 에서 나올 수 있는 줄은 최대 12개

COMMENT ON COLUMN "goldenbell-game".current_game IS
  '참가자 휴대폰에 무엇을 띄울지. 진행자 콘솔의 게임 고르기 버튼이 바꾼다.';
COMMENT ON COLUMN "goldenbell-game".bingo_called IS
  '지금까지 부른 번호. INTEGER[] 는 숫자 여러 개를 담는 배열이다.
   부른 순서가 그대로 남으므로 프로젝터가 마지막 번호를 크게 띄울 수 있다.';


-- ------------------------------------------------------------
-- 2) 참가자별 빙고판
-- ------------------------------------------------------------
-- cells 는 왼쪽 위부터 오른쪽으로 읽어 나간 25칸이다.
--   cells[1]  cells[2]  cells[3]  cells[4]  cells[5]
--   cells[6]  cells[7]  ...
-- (SQL 배열은 1번부터 센다. 0번이 아니다.)
--
-- 한 사람당 판은 하나뿐이라 participant_id 를 그대로 기본키로 쓴다.
-- 따로 id 칸을 만들 이유가 없다.
CREATE TABLE IF NOT EXISTS "goldenbell-bingo-boards" (
  participant_id INTEGER PRIMARY KEY
                 REFERENCES "goldenbell-participants"(id) ON DELETE CASCADE,
  cells          INTEGER[] NOT NULL,
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ★ 1~25 가 한 번씩만 들어갔는지 DB가 직접 확인한다.
  --
  --   @> 는 "왼쪽 배열이 오른쪽 배열의 값을 전부 담고 있나"를 묻는다.
  --   1~25 를 전부 담았는데 길이도 25 라면 중복이 있을 수가 없다.
  --   (하나라도 겹치면 25칸에 24종류만 들어가 @> 가 거짓이 된다)
  --
  --   화면에서도 막지만, 조작된 요청은 화면을 거치지 않는다.
  --   마지막 방어선은 언제나 DB다.
  CONSTRAINT 빙고판은_1부터25까지_한번씩 CHECK (
    array_length(cells, 1) = 25
    AND cells @> ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,
                       13,14,15,16,17,18,19,20,21,22,23,24,25]
  )
);


-- ------------------------------------------------------------
-- 3) 줄 수 세는 함수
-- ------------------------------------------------------------
-- 판(cells)과 부른 번호(called)를 주면 완성된 줄이 몇 개인지 돌려준다.
--
-- [왜 DB가 세나]
-- 참가자 휴대폰, 진행자 콘솔, 프로젝터가 각자 세면 언젠가 숫자가 어긋난다.
-- 한 곳에서만 세면 어긋날 자리가 없다.
--
-- [IMMUTABLE 이란]
-- "같은 값을 넣으면 언제나 같은 답이 나온다"는 표시다.
-- 이걸 붙여두면 Postgres 가 결과를 재활용할 수 있어 빨라진다.
--
-- [STRICT 를 꼭 붙여야 하는 이유]  ★ 안 붙였다가 한 번 크게 틀렸다
-- 판을 안 낸 참가자는 cells 가 NULL 로 들어온다.
-- STRICT 가 없으면 NULL 인 채로 아래 계산이 돌아가는데,
--     NULL = ANY(called)  →  참도 거짓도 아닌 NULL
--     NOT (NULL)          →  역시 NULL
--     WHERE NOT (NULL)    →  걸러지는 줄이 하나도 없음
-- 이 되어서 "12줄 전부 완성"으로 세어버린다.
-- 판도 안 낸 사람이 빙고 달성자로 뜨게 된다.
--
-- STRICT 를 붙이면 인자 중 하나라도 NULL 일 때 계산을 아예 하지 않고
-- NULL 을 돌려준다. 화면은 NULL 을 '판 없음'으로 보여주면 된다.
CREATE OR REPLACE FUNCTION 빙고_줄수(cells INTEGER[], called INTEGER[])
RETURNS INTEGER AS $함수$
  -- 5x5 에서 나올 수 있는 줄 12개를 칸 번호로 적어둔 것이다.
  -- 가로 5줄, 세로 5줄, 대각선 2줄.
  SELECT count(*)::INTEGER
  FROM (VALUES
    (ARRAY[ 1, 2, 3, 4, 5]), (ARRAY[ 6, 7, 8, 9,10]),   -- 가로
    (ARRAY[11,12,13,14,15]), (ARRAY[16,17,18,19,20]),
    (ARRAY[21,22,23,24,25]),
    (ARRAY[ 1, 6,11,16,21]), (ARRAY[ 2, 7,12,17,22]),   -- 세로
    (ARRAY[ 3, 8,13,18,23]), (ARRAY[ 4, 9,14,19,24]),
    (ARRAY[ 5,10,15,20,25]),
    (ARRAY[ 1, 7,13,19,25]), (ARRAY[ 5, 9,13,17,21])    -- 대각선
  ) AS 줄(칸번호)
  -- 그 줄의 다섯 칸 중에 "아직 안 불린 번호"가 하나도 없으면 완성된 줄이다.
  WHERE NOT EXISTS (
    SELECT 1 FROM unnest(줄.칸번호) AS i
    WHERE NOT (cells[i] = ANY(called))
  );
$함수$ LANGUAGE sql IMMUTABLE STRICT;


-- ------------------------------------------------------------
-- 4) 빙고판이 바뀌면 화면을 흔든다
-- ------------------------------------------------------------
-- 001 에 있는 게임상태_흔들기() 를 그대로 쓴다.
-- 누가 판을 제출하면 진행자 콘솔의 "판 제출 인원"이 바로 올라가야 한다.
DROP TRIGGER IF EXISTS 빙고판_변경시 ON "goldenbell-bingo-boards";
CREATE TRIGGER 빙고판_변경시
  AFTER INSERT OR UPDATE OR DELETE ON "goldenbell-bingo-boards"
  FOR EACH STATEMENT
  EXECUTE FUNCTION 게임상태_흔들기();


-- ------------------------------------------------------------
-- 5) 참가자에게 내보낼 뷰를 다시 만든다
-- ------------------------------------------------------------
-- ★ 003_state_view.sql 의 뷰에 빙고 칸을 더한 것이다.
--   003 이 먼저 실행되어 뷰를 만들고, 여기서 다시 만들어 덮어쓴다.
--   (003 시점에는 빙고 칸이 아직 없어서 003 에 적을 수가 없다)
--   앞으로 뷰를 고칠 일이 있으면 003 이 아니라 이 파일을 고쳐야 한다.
--
-- 빙고판은 사람마다 다르므로 여기 넣지 않는다.
-- 이 뷰는 "전원에게 똑같이 나가는 것"만 담는다.
-- 내 판은 /api/me 가 나에게만 따로 보내준다.
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

  -- ★ 지금 하는 게임. 참가자 화면은 이 값을 보고 퀴즈/빙고를 갈아 끼운다.
  g.current_game,
  g.bingo_phase,
  g.bingo_called,
  g.bingo_goal,

  -- 마지막으로 부른 번호. 배열의 맨 끝이다.
  -- 아직 아무것도 안 불렀으면 NULL 이 된다.
  g.bingo_called[array_length(g.bingo_called, 1)] AS bingo_last,

  -- 판을 낸 사람 수 / 빙고를 달성한 사람 수.
  -- 프로젝터와 진행자가 같은 숫자를 보게 DB가 세어서 내보낸다.
  (SELECT count(*) FROM "goldenbell-bingo-boards")                   AS bingo_boards,
  (SELECT count(*) FROM "goldenbell-bingo-boards" b
    WHERE 빙고_줄수(b.cells, g.bingo_called) >= g.bingo_goal)         AS bingo_winners,

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

  (SELECT count(*) FROM "goldenbell-quizz" WHERE used_at IS NULL)          AS remaining_questions,
  (SELECT count(*) FROM "goldenbell-quizz")                                AS total_questions,

  CASE WHEN g.phase = 'finished' THEN (
    SELECT coalesce(json_agg(t.name || ' ' || p.name ORDER BY p.id), '[]'::json)
    FROM "goldenbell-participants" p
    JOIN "goldenbell-teams" t ON t.id = p.team_id
    WHERE p.status = 'active'
  ) END AS winners

FROM "goldenbell-game" g
LEFT JOIN "goldenbell-quizz"       q ON q.id = g.current_question_id
LEFT JOIN "goldenbell-answer-keys" k ON k.question_id = g.current_question_id;


-- ------------------------------------------------------------
-- 확인
-- ------------------------------------------------------------
-- 줄수 함수가 제대로 세는지 여기서 바로 확인한다.
-- 1~5 를 부르면 첫 가로줄이 완성되므로 1, 아무것도 안 부르면 0 이 나와야 한다.
SELECT
  빙고_줄수(ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25],
            ARRAY[1,2,3,4,5])   AS 한줄이면_1,
  빙고_줄수(ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25],
            ARRAY[]::INTEGER[]) AS 아무것도_안부르면_0,
  -- 판을 안 낸 사람(cells 가 NULL)은 NULL 이 나와야 한다. 0 이나 12 가 나오면 STRICT 가 빠진 것이다.
  빙고_줄수(NULL, ARRAY[1,2,3,4,5])                         AS 판없으면_NULL,
  (SELECT current_game FROM "goldenbell-game" WHERE id = 1) AS 지금게임;
