-- ============================================================
--  골든벨 데이터베이스 전체 (PostgreSQL 17)
-- ============================================================
--  실행 방법
--     npm run migrate          (scripts/migrate.mjs 가 db 폴더를 번호순으로 실행한다)
--
--  ★ 이 파일은 "처음부터 새로 짓기"다.
--     맨 앞에서 표를 전부 지우고 다시 만든다.
--     참가자 · 답안 · 빙고판 · 진행자 계정이 전부 사라지므로 행사 도중에는 돌리지 않는다.
--     돌린 뒤에는 npm run create-admin 으로 진행자 계정을 다시 만든다.
--
--  [파일이 두 개뿐인 이유]
--  예전에는 기능을 더할 때마다 "칸 덧붙이기" 파일(ALTER TABLE)을 따로 쌓았다 (11개).
--  그런데 migrate 는 매번 이 파일부터 전부 다시 돌리고, 이 파일이 표를 지우고 새로 만든다.
--  덧붙이기가 아무 의미가 없었으므로 최종 모습을 이 파일 하나에 적었다.
--      001_schema.sql     표 · 함수 · 트리거 · 뷰 · 팀 (이 파일)
--      002_questions.sql  문제와 정답 ★ 깃에 올리지 않는다 (.gitignore)
--  앞으로 칸을 더할 때도 새 파일을 만들지 말고 여기 표 정의에 바로 적는다.
--
--  [이름 규칙]
--  표 이름에 하이픈(-)이 들어가므로 항상 큰따옴표로 감싼다.
--  안 감싸면 goldenbell 빼기 teams 로 잘못 읽힌다.
--
--      SELECT * FROM "goldenbell-teams";   -- 맞다
--      SELECT * FROM goldenbell-teams;     -- 오류
--
--  [설계 핵심]
--  1. 현재 상태는 "goldenbell-game" 표의 딱 한 줄에만 있다
--  2. 그 줄이 바뀔 때마다 state_version 이 자동으로 1씩 오른다
--  3. 시간은 전부 서버 시각(TIMESTAMPTZ)으로만 다룬다
--  4. 우승자는 저장하지 않는다. status='active' 인 사람이 곧 생존자다
-- ============================================================

-- 이 파일을 여러 번 실행해도 되도록 기존 것을 먼저 지운다.
-- CASCADE = 이 표에 딸린 것들(뷰, 외래키, 트리거)도 같이 지운다.
--
-- ★ 빙고판 표도 반드시 여기서 지운다.
--   예전에는 빠져 있어서, 다시 돌리면 빙고판 표가 참가자 표와의 연결(외래키)이
--   끊긴 채로 남았다 (참가자를 지워도 빙고판이 안 지워지는 상태).
DROP VIEW  IF EXISTS "goldenbell-public-state";
DROP TABLE IF EXISTS "goldenbell-bingo-boards" CASCADE;
DROP TABLE IF EXISTS "goldenbell-answers"      CASCADE;
DROP TABLE IF EXISTS "goldenbell-answer-keys"  CASCADE;
DROP TABLE IF EXISTS "goldenbell-participants" CASCADE;
DROP TABLE IF EXISTS "goldenbell-game"         CASCADE;
DROP TABLE IF EXISTS "goldenbell-quizz"        CASCADE;
DROP TABLE IF EXISTS "goldenbell-teams"        CASCADE;
DROP TABLE IF EXISTS "goldenbell-admin"        CASCADE;
DROP FUNCTION IF EXISTS 게임상태_버전올리기() CASCADE;
DROP FUNCTION IF EXISTS 게임상태_흔들기() CASCADE;
DROP FUNCTION IF EXISTS 빙고_줄수(INTEGER[], INTEGER[]) CASCADE;
DROP FUNCTION IF EXISTS 빙고판_올바른가(INTEGER[]) CASCADE;


-- ------------------------------------------------------------
-- 1) 진행자 계정
-- ------------------------------------------------------------
CREATE TABLE "goldenbell-admin" (
  id            SERIAL PRIMARY KEY,          -- SERIAL = 1,2,3... 자동 증가
  login_id      TEXT NOT NULL UNIQUE,        -- UNIQUE = 같은 값이 두 번 못 들어감
  password_hash TEXT NOT NULL,               -- 비밀번호 원문은 절대 저장하지 않는다
  display_name  TEXT NOT NULL DEFAULT '진행자',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN "goldenbell-admin".password_hash IS
  'scrypt 로 변환한 값만 넣는다. 원문 비밀번호를 넣으면 유출 시 그대로 털린다.';


-- ------------------------------------------------------------
-- 2) 팀
-- ------------------------------------------------------------
CREATE TABLE "goldenbell-teams" (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  max_members INTEGER NOT NULL DEFAULT 10
              CHECK (max_members > 0),       -- CHECK = 조건에 안 맞으면 저장 거부
  sort_order  INTEGER NOT NULL DEFAULT 0     -- 화면에 보여줄 순서
);


-- ------------------------------------------------------------
-- 3) 문제
-- ------------------------------------------------------------
CREATE TABLE "goldenbell-quizz" (
  id             SERIAL PRIMARY KEY,
  question_order INTEGER NOT NULL UNIQUE,    -- 몇 번째 문제인가 (1,2,3...)
  type           TEXT NOT NULL
                 CHECK (type IN ('ox', 'choice', 'text')),
  question_text  TEXT NOT NULL,
  choices        JSONB,                      -- 객관식 보기: ["송편","떡국",...]
  time_limit     INTEGER NOT NULL DEFAULT 20
                 CHECK (time_limit BETWEEN 5 AND 300),

  -- ★ 이미 낸 문제 표시. NULL 이면 아직 안 낸 문제다.
  --   진행자의 '문제 고르기' 목록은 used_at IS NULL 인 것만 보여준다.
  --   따로 목록을 만들지 않고 이 한 칸으로 해결한다.
  used_at        TIMESTAMPTZ,

  -- 문제 구분 기호. 진행자 화면의 문제 목록에 같이 뜬다.
  --   M01~ = 본 문제, E01~ = 예비, R01~ = 패자부활 (패자부활전 중에만 목록에 보인다)
  -- 번호만으로는 "이게 본 문제인지 예비인지"를 외워야 하는데,
  -- 앞글자 한 자로 바로 보이는 쪽이 현장에서 실수가 적다.
  code           TEXT,

  -- 객관식인데 보기가 없으면 화면이 깨진다. 아예 저장을 막는다.
  --
  -- choices IS NOT NULL 을 반드시 같이 써야 한다.
  -- CHECK 는 결과가 NULL 이면 "통과"로 친다. jsonb_array_length(NULL) 은 NULL 이라
  -- 이 조건이 없으면 보기가 비어 있는 객관식이 그냥 저장된다.
  CONSTRAINT 객관식은_보기가_2개_이상
    CHECK (
      type <> 'choice'
      OR (choices IS NOT NULL AND jsonb_array_length(choices) >= 2)
    )
);


-- ------------------------------------------------------------
-- 4) 정답  ★ 문제와 일부러 분리했다
-- ------------------------------------------------------------
-- 참가자에게 문제를 보낼 때 SELECT * 를 한 번만 잘못 써도 정답이 새어나간다.
-- 표를 나눠두면 실수해도 구조적으로 샐 수가 없다.
--
-- correct_answers 를 배열로 둔 이유는 인정 정답이 여러 개일 수 있어서다.
--   O/X      → ["O"]
--   객관식   → ["송편"]            (보기 번호가 아니라 보기 글자)
--   주관식   → ["이순신", "충무공 이순신"]
CREATE TABLE "goldenbell-answer-keys" (
  question_id     INTEGER PRIMARY KEY
                  REFERENCES "goldenbell-quizz"(id) ON DELETE CASCADE,
  correct_answers JSONB NOT NULL
                  CHECK (jsonb_array_length(correct_answers) >= 1)
);

-- REFERENCES = 다른 표의 값만 들어올 수 있다 (없는 문제 번호 차단)
-- ON DELETE CASCADE = 문제가 지워지면 정답도 같이 지워진다


-- ------------------------------------------------------------
-- 5) 참가자
-- ------------------------------------------------------------
CREATE TABLE "goldenbell-participants" (
  id                 SERIAL PRIMARY KEY,
  team_id            INTEGER NOT NULL REFERENCES "goldenbell-teams"(id),
  name               TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 20),
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'eliminated')),

  -- 참가자 휴대폰의 번호표를 변환한 값. 원문은 저장하지 않는다.
  --
  -- ★ 비어 있을 수 있다 (NOT NULL 이 아니다).
  --   등록은 진행측 노트북에서 하고, 번호표는 나중에 본인 휴대폰이 로그인할 때 받는다.
  --   그래서 등록 직후에는 번호표가 없는 상태로 잠시 머문다.
  --   PIN 초기화를 누르면 다시 비워서 그 기기의 접속을 끊는다.
  --   UNIQUE 여도 괜찮다. PostgreSQL 은 NULL 끼리는 서로 다른 값으로 친다.
  session_token_hash TEXT UNIQUE,

  -- PIN 4자리를 scrypt 로 변환한 값 ("소금:변환값"). PIN 원문은 어디에도 없다.
  pin_hash           TEXT,

  -- 어느 문제에서 탈락했는지. NULL 이면 아직 생존 중이다.
  -- 진행자 콘솔의 "이번 문제 탈락 인원"과 이의제기 근거로 쓴다.
  -- 문제가 지워지면 기록만 비운다 (ON DELETE SET NULL).
  eliminated_question_id INTEGER
                     REFERENCES "goldenbell-quizz"(id) ON DELETE SET NULL,

  -- ★ 부정행위 방지 — 화면 이탈 기록
  --   문제가 떠 있는 동안 다른 앱·탭으로 나가면 휴대폰이 서버에 알린다.
  --   away_now   = 지금 화면을 벗어나 있나 (돌아오면 FALSE)
  --   away_count = 지금까지 문제 도중에 벗어난 횟수
  --   탈락시킬지는 진행자가 판단한다 (전화·알림으로 잠깐 나간 사람도 있으므로).
  away_now           BOOLEAN NOT NULL DEFAULT FALSE,
  away_count         INTEGER NOT NULL DEFAULT 0,

  -- 패자부활전 도전 상태
  --   NULL = 해당 없음, 'in' = 도전 중, 'out' = 이번 부활전에서 틀림
  revival_status     TEXT CHECK (revival_status IN ('in', 'out')),

  joined_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 팀+이름이 신원 수단이므로 같은 팀에 동명이인을 허용하지 않는다.
  -- 화면에서 막는 것만으로는 동시 접속 때 뚫린다. DB에서 막아야 확실하다.
  UNIQUE (team_id, name)
);


-- ------------------------------------------------------------
-- 6) 제출된 답안
-- ------------------------------------------------------------
CREATE TABLE "goldenbell-answers" (
  id             BIGSERIAL PRIMARY KEY,
  question_id    INTEGER NOT NULL
                 REFERENCES "goldenbell-quizz"(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL
                 REFERENCES "goldenbell-participants"(id) ON DELETE CASCADE,
  answer         TEXT NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 500),
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  grade          TEXT NOT NULL DEFAULT 'pending'
                 CHECK (grade IN ('pending', 'correct', 'wrong')),
  graded_by      INTEGER REFERENCES "goldenbell-admin"(id),

  -- ★ 중복 제출 차단. 80명이 동시에 눌러도 한 사람당 한 번만 들어간다.
  --   애플리케이션에서 "이미 냈나?" 확인하는 방식은 동시 요청에서 뚫린다.
  UNIQUE (question_id, participant_id)
);

-- 위 UNIQUE 가 (question_id, participant_id) 색인을 자동으로 만들어준다.
-- "이번 문제 제출 인원 세기"도 그 색인을 쓰므로 따로 만들 필요가 없다.


-- ------------------------------------------------------------
-- 7) 게임 상태  ★ 실시간의 중심. 행이 딱 하나만 존재한다
-- ------------------------------------------------------------
CREATE TABLE "goldenbell-game" (
  -- id 를 1 로만 제한해서 행이 두 개 생기는 사고를 원천 차단한다.
  id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  phase               TEXT NOT NULL DEFAULT 'waiting'
                      CHECK (phase IN (
                        'waiting',    -- 대기 중 (문제 미선택)
                        'published',  -- 문제 선택됨 (진행자만 봄, 참가자에겐 아직 숨김)
                        'running',    -- 진행 중 (문제 공개 + 타이머 작동, 제출 가능)
                        'closed',     -- 답변 마감 (자동 채점 완료, 진행자 수정 가능)
                        'finalized',  -- 판정 확정 (탈락 반영됨)
                        'revealed',   -- 정답 공개
                        'finished'    -- 게임 종료 (우승자 발표)
                      )),

  current_question_id INTEGER REFERENCES "goldenbell-quizz"(id),

  -- ★ "20초 남음"이 아니라 "몇 시 몇 분에 마감"으로 저장한다.
  --   남은 초를 저장하면 서버가 매초 값을 고쳐야 하고, 참가자마다 어긋난다.
  deadline            TIMESTAMPTZ,

  -- ★ 이번 차례에 이미 누른 진행 버튼 이름들.
  --   '다음' 을 누르면 빈 배열로 되돌아가 다시 누를 수 있게 된다.
  --   TEXT[] 는 글자 여러 개를 담는 배열 자료형이다.
  used_actions        TEXT[] NOT NULL DEFAULT '{}',

  join_open           BOOLEAN NOT NULL DEFAULT TRUE,

  -- ★ 실시간의 핵심. 바뀔 때마다 1씩 오른다 (아래 트리거가 자동 처리).
  --   참가자 쪽 코드: 받은 버전이 내 버전보다 크지 않으면 버린다.
  state_version       BIGINT NOT NULL DEFAULT 1,

  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 참가자 휴대폰에 무엇을 띄울지 (진행자 콘솔의 게임 고르기 버튼이 바꾼다).
  --
  -- 빙고 진행 상태를 퀴즈의 phase 와 따로 둔 이유:
  -- 같이 쓰면 "빙고 중인데 문제 단계가 running" 같은 말이 안 되는 상태가 생긴다.
  -- 칸을 나눠두면 퀴즈 하다 빙고로 갔다 돌아와도 퀴즈는 있던 자리 그대로다.
  current_game        TEXT NOT NULL DEFAULT 'quiz',
  bingo_phase         TEXT NOT NULL DEFAULT 'setup',

  -- 지금까지 부른 빙고 번호. 부른 순서가 그대로 남으므로
  -- 프로젝터가 마지막 번호를 크게 띄우고, 뽑은 순서대로 목록을 보여줄 수 있다.
  bingo_called        INTEGER[] NOT NULL DEFAULT '{}',

  -- 몇 줄이면 빙고로 볼지. 현장에서 바꿀 수 있다.
  bingo_goal          INTEGER NOT NULL DEFAULT 3,

  -- 지금 패자부활전 중인가
  --   켜져 있으면 문제 목록엔 패자부활 문제(R..)만 보이고, 답은 도전자만 낸다.
  revival             BOOLEAN NOT NULL DEFAULT FALSE,

  CONSTRAINT 게임종류_확인 CHECK (current_game IN ('quiz', 'bingo')),
  CONSTRAINT 빙고단계_확인 CHECK (bingo_phase IN (
    'setup',     -- 참가자가 판을 채우는 중
    'running',   -- 번호를 부르는 중
    'finished'   -- 끝
  )),
  CONSTRAINT 빙고목표_확인 CHECK (bingo_goal BETWEEN 1 AND 12)   -- 5x5 에서 나올 수 있는 줄은 최대 12개
);

-- 시작 상태 한 줄을 넣어둔다.
INSERT INTO "goldenbell-game" (id) VALUES (1);


-- ------------------------------------------------------------
-- 8) 빙고판
-- ------------------------------------------------------------
-- 판이 올바른지 보는 함수. 세 가지를 모두 만족해야 참이다.
--   · 칸이 정확히 25개
--   · 같은 숫자가 두 번 들어가지 않았다
--   · 모든 숫자가 1~50 안에 있다
--
-- [함수로 뺀 이유]
-- 1~50 중 25개를 고르므로 어떤 숫자가 올지 미리 알 수 없다.
-- "중복이 없나"는 값을 하나씩 펼쳐서(unnest) 세어야 하는데,
-- CHECK 안에는 그런 조회문을 바로 쓸 수 없어서 함수로 감쌌다.
--
-- IMMUTABLE = 같은 값을 넣으면 언제나 같은 답이 나온다.
-- 이 표시가 있어야 CHECK 안에서 쓸 수 있다.
--
-- ★ 50 을 바꾸면 화면(js/app.js)과 서버(server.js)의 빙고최대번호도 같이 바꿔야 한다.
CREATE FUNCTION 빙고판_올바른가(cells INTEGER[]) RETURNS BOOLEAN AS $함수$
  SELECT array_length(cells, 1) = 25
     AND (SELECT count(DISTINCT n) FROM unnest(cells) AS n) = 25
     AND (SELECT count(*) FROM unnest(cells) AS n WHERE n BETWEEN 1 AND 50) = 25;
$함수$ LANGUAGE sql IMMUTABLE;

-- cells 는 왼쪽 위부터 오른쪽으로 읽어 나간 25칸이다.
--   cells[1]  cells[2]  cells[3]  cells[4]  cells[5]
--   cells[6]  cells[7]  ...
-- (SQL 배열은 1번부터 센다. 0번이 아니다.)
--
-- 한 사람당 판은 하나뿐이라 participant_id 를 그대로 기본키로 쓴다.
-- 참가자가 지워지면 판도 같이 지워진다 (ON DELETE CASCADE).
--
-- 화면에서도 판을 검사하지만, 조작된 요청은 화면을 거치지 않는다.
-- 마지막 방어선은 언제나 DB다.
CREATE TABLE "goldenbell-bingo-boards" (
  participant_id INTEGER PRIMARY KEY
                 REFERENCES "goldenbell-participants"(id) ON DELETE CASCADE,
  cells          INTEGER[] NOT NULL,
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT 빙고판_규칙 CHECK (빙고판_올바른가(cells))
);

-- 줄 수 세는 함수. 판(cells)과 부른 번호(called)를 주면 완성된 줄이 몇 개인지 돌려준다.
--
-- [왜 DB가 세나]
-- 참가자 휴대폰, 진행자 콘솔, 프로젝터가 각자 세면 언젠가 숫자가 어긋난다.
-- 한 곳에서만 세면 어긋날 자리가 없다.
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
CREATE FUNCTION 빙고_줄수(cells INTEGER[], called INTEGER[])
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
-- 9) 버전 자동 증가 트리거
-- ------------------------------------------------------------
-- 서버 코드에서 state_version 을 직접 올리게 하면 언젠가 반드시 까먹는다.
-- 까먹은 그 한 번이 "화면이 안 바뀌어요"가 된다.
-- 그래서 DB가 대신 올린다. UPDATE 경로가 무엇이든 무조건 오른다.
CREATE FUNCTION 게임상태_버전올리기() RETURNS TRIGGER AS $$
BEGIN
  NEW.state_version := OLD.state_version + 1;
  NEW.updated_at    := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER 게임상태_변경시
  BEFORE UPDATE ON "goldenbell-game"
  FOR EACH ROW
  EXECUTE FUNCTION 게임상태_버전올리기();


-- ------------------------------------------------------------
-- 9-2) 참가자·답안·빙고판이 바뀔 때도 버전을 올린다
-- ------------------------------------------------------------
-- 화면은 "버전이 안 올랐으면 낡은 소식"이라고 보고 버린다 (js/store.js).
-- 그런데 참가 등록, 답안 제출, 빙고판 제출은 goldenbell-game 줄을 건드리지 않는다.
-- 그대로 두면 프로젝터의 제출 인원이 영영 안 바뀐다.
--
-- 그래서 이 표들이 바뀌면 게임 줄을 한 번 건드려준다.
-- 그러면 위의 트리거가 이어서 버전을 올려준다.
CREATE FUNCTION 게임상태_흔들기() RETURNS TRIGGER AS $$
BEGIN
  UPDATE "goldenbell-game" SET updated_at = now() WHERE id = 1;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ★ UPDATE OF 뒤에 칸을 못 박은 이유
--
-- 참가자 화면은 새 소식을 받을 때마다 서버에 "나 아직 살아 있나요"를 물어보고,
-- 서버는 그때 last_seen_at 을 갱신한다.
-- 만약 모든 UPDATE 에 반응하게 두면
--     소식 도착 → 참가자가 물어봄 → last_seen_at 갱신 → 버전 오름
--     → 소식 도착 → 참가자가 물어봄 → ...
-- 이렇게 끝없이 돌게 된다. 실제로 멈추지 않는다.
--
-- 그래서 화면에 알려야 하는 칸이 바뀔 때만 반응하게 한다.
--   status         = 생존 / 탈락
--   away_now       = 화면 이탈 중 (진행자 콘솔에 바로 떠야 한다)
--   revival_status = 패자부활전 도전 / 실패
-- ★ 화면에 실시간으로 띄울 칸을 새로 만들면 여기에 꼭 더한다.
--   빠뜨리면 DB에는 기록되는데 화면은 알림을 버린다 (away_now 때 실제로 겪었다).
--
-- FOR EACH STATEMENT = 명령 한 번에 한 번만 실행한다.
-- 초기화로 80줄을 한꺼번에 지워도 버전은 한 번만 오른다.
CREATE TRIGGER 참가자_변경시
  AFTER INSERT OR DELETE OR UPDATE OF status, away_now, revival_status
  ON "goldenbell-participants"
  FOR EACH STATEMENT
  EXECUTE FUNCTION 게임상태_흔들기();

CREATE TRIGGER 답안_변경시
  AFTER INSERT OR DELETE OR UPDATE OF grade ON "goldenbell-answers"
  FOR EACH STATEMENT
  EXECUTE FUNCTION 게임상태_흔들기();

-- 누가 판을 제출하면 진행자 콘솔의 "판 제출 인원"이 바로 올라가야 한다.
CREATE TRIGGER 빙고판_변경시
  AFTER INSERT OR UPDATE OR DELETE ON "goldenbell-bingo-boards"
  FOR EACH STATEMENT
  EXECUTE FUNCTION 게임상태_흔들기();


-- ------------------------------------------------------------
-- 10) 참가자·프로젝터에게 내보낼 안전한 뷰
-- ------------------------------------------------------------
-- 뷰(VIEW)는 "미리 저장해둔 SELECT 문"이다. 실제 데이터를 복사하지 않는다.
--
-- 서버는 실시간 전송(SSE)에서 이 뷰만 조회한다. 그래서
--   - 정답은 phase 가 revealed / finished 일 때만 나온다 (그 전엔 무조건 NULL)
--   - 어떤 값이 나가는지 한 곳에서만 관리된다
-- 서버 코드가 실수해도 DB가 막아준다.
-- (문제를 고르기만 한 단계에서 문제 글까지 가리는 일은 server/db.js 가 한다)
--
-- 빙고판은 사람마다 다르므로 여기 넣지 않는다.
-- 이 뷰는 "전원에게 똑같이 나가는 것"만 담는다.
-- 내 판은 /api/me 가 나에게만 따로 보내준다.
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

  -- 게임이 끝났을 때만 생존자(=우승자) 이름을 내보낸다.
  CASE WHEN g.phase = 'finished' THEN (
    SELECT coalesce(json_agg(t.name || ' ' || p.name ORDER BY p.id), '[]'::json)
    FROM "goldenbell-participants" p
    JOIN "goldenbell-teams" t ON t.id = p.team_id
    WHERE p.status = 'active'
  ) END AS winners,

  -- 지금 패자부활전 중인가. 참가자 화면이 도전자 / 쉬는 생존자 화면을 가른다.
  g.revival

FROM "goldenbell-game" g
-- LEFT JOIN = 짝이 없어도 왼쪽 행은 남긴다 (문제 선택 전에도 상태를 보여줘야 하므로)
LEFT JOIN "goldenbell-quizz"       q ON q.id = g.current_question_id
LEFT JOIN "goldenbell-answer-keys" k ON k.question_id = g.current_question_id;


-- ------------------------------------------------------------
-- 11) 팀 8개 (각 정원 10명)
-- ------------------------------------------------------------
-- generate_series(1, 8) 은 1부터 8까지 숫자를 한 줄씩 만들어준다.
-- 여덟 줄을 손으로 쓰는 대신 이 한 줄로 끝낸다.
INSERT INTO "goldenbell-teams" (name, max_members, sort_order)
SELECT n || '팀', 10, n
FROM generate_series(1, 8) AS n;

-- 진행자 계정은 여기 넣지 않는다. 비밀번호 원문이 파일에 남으면 그대로 유출된다.
--     npm run create-admin   (비밀번호를 물어보고 scrypt 로 변환해서 저장한다)


-- ------------------------------------------------------------
-- 확인
-- ------------------------------------------------------------
-- 빙고 함수가 제대로 도는지 바로 확인한다.
--   한줄이면_1 = 1, 판없으면_NULL = NULL (0 이나 12 가 나오면 STRICT 가 빠진 것),
--   중복판_거짓 = false 가 나와야 한다.
SELECT
  (SELECT count(*) FROM "goldenbell-teams") AS 팀,
  빙고_줄수(ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25],
            ARRAY[1,2,3,4,5])                       AS 한줄이면_1,
  빙고_줄수(NULL, ARRAY[1,2,3,4,5])                 AS 판없으면_NULL,
  빙고판_올바른가(ARRAY[1,1,3,4,5,6,7,8,9,10,11,12,13,
                        14,15,16,17,18,19,20,21,22,23,24,25]) AS 중복판_거짓;
