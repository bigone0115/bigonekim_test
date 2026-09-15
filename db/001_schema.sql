-- ============================================================
--  골든벨 데이터베이스 스키마 (PostgreSQL 17)
-- ============================================================
--  실행 방법
--     npm run migrate          (scripts/migrate.mjs 가 이 파일을 실행한다)
--     또는 psql -f db/001_schema.sql
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
--     (참가자에게 내보낼 뷰는 003_state_view.sql 에 있다)
--  2. 그 줄이 바뀔 때마다 state_version 이 자동으로 1씩 오른다
--  3. 시간은 전부 서버 시각(TIMESTAMPTZ)으로만 다룬다
--  4. 우승자는 저장하지 않는다. status='active' 인 사람이 곧 생존자다
-- ============================================================

-- 이 파일을 여러 번 실행해도 되도록 기존 것을 먼저 지운다.
-- CASCADE = 이 표에 딸린 것들(뷰, 외래키)도 같이 지운다.
DROP VIEW  IF EXISTS "goldenbell-public-state";
DROP TABLE IF EXISTS "goldenbell-answers"      CASCADE;
DROP TABLE IF EXISTS "goldenbell-answer-keys"  CASCADE;
DROP TABLE IF EXISTS "goldenbell-participants" CASCADE;
DROP TABLE IF EXISTS "goldenbell-game"         CASCADE;
DROP TABLE IF EXISTS "goldenbell-quizz"        CASCADE;
DROP TABLE IF EXISTS "goldenbell-teams"        CASCADE;
DROP TABLE IF EXISTS "goldenbell-admin"        CASCADE;
DROP FUNCTION IF EXISTS 게임상태_버전올리기() CASCADE;
DROP FUNCTION IF EXISTS 게임상태_흔들기() CASCADE;


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
--   객관식   → ["송편"]
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

  -- 참가자는 로그인하지 않는다. 대신 휴대폰이 무작위 번호표를 만들어 갖고,
  -- 서버에는 그것을 변환한 값만 저장한다. 원문은 저장하지 않는다.
  session_token_hash TEXT NOT NULL UNIQUE,

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
                        'published',  -- 문제 공개 (아직 제출 불가)
                        'running',    -- 진행 중 (타이머 작동, 제출 가능)
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

  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 시작 상태 한 줄을 넣어둔다.
INSERT INTO "goldenbell-game" (id) VALUES (1);


-- ------------------------------------------------------------
-- 8) 버전 자동 증가 트리거
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
-- 8-2) 참가자·답안이 바뀔 때도 버전을 올린다
-- ------------------------------------------------------------
-- 화면은 "버전이 안 올랐으면 낡은 소식"이라고 보고 버린다.
-- 그런데 참가 등록과 답안 제출은 goldenbell-game 줄을 건드리지 않는다.
-- 그대로 두면 프로젝터의 제출 인원이 영영 안 바뀐다.
--
-- 그래서 참가자·답안이 바뀌면 게임 줄을 한 번 건드려준다.
-- 그러면 위의 트리거가 이어서 버전을 올려준다.
CREATE FUNCTION 게임상태_흔들기() RETURNS TRIGGER AS $$
BEGIN
  UPDATE "goldenbell-game" SET updated_at = now() WHERE id = 1;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ★ UPDATE OF status / UPDATE OF grade 라고 칸을 못 박은 이유
--
-- 참가자 화면은 새 소식을 받을 때마다 서버에 "나 아직 살아 있나요"를 물어보고,
-- 서버는 그때 last_seen_at 을 갱신한다.
-- 만약 모든 UPDATE 에 반응하게 두면
--     소식 도착 → 참가자가 물어봄 → last_seen_at 갱신 → 버전 오름
--     → 소식 도착 → 참가자가 물어봄 → ...
-- 이렇게 끝없이 돌게 된다. 실제로 멈추지 않는다.
--
-- 그래서 정말 알려야 하는 칸(생존 여부, 채점 결과)이 바뀔 때만 반응하게 한다.
--
-- FOR EACH STATEMENT = 명령 한 번에 한 번만 실행한다.
-- 초기화로 80줄을 한꺼번에 지워도 버전은 한 번만 오른다.
CREATE TRIGGER 참가자_변경시
  AFTER INSERT OR DELETE OR UPDATE OF status ON "goldenbell-participants"
  FOR EACH STATEMENT
  EXECUTE FUNCTION 게임상태_흔들기();

CREATE TRIGGER 답안_변경시
  AFTER INSERT OR DELETE OR UPDATE OF grade ON "goldenbell-answers"
  FOR EACH STATEMENT
  EXECUTE FUNCTION 게임상태_흔들기();


-- ------------------------------------------------------------
-- 9) 확인용 질의
-- ------------------------------------------------------------
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
