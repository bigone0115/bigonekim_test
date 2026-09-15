# 골든벨 (HTML · CSS · JavaScript · SQL 버전)

Node.js 서버 + PostgreSQL 로 도는 실시간 골든벨이다.
여러 기기(휴대폰 · 노트북 · 프로젝터)가 같은 게임에 함께 참여한다.

## 폴더 구조

```
goldenbell-web2/
├── index.html          첫 화면 (역할별 링크)
├── schema.sql          데이터베이스 설계도 (표 이름만 잡아둔 상태)
├── html/
│   ├── join.html       참가 등록  (휴대폰)
│   ├── play.html       게임 화면  (휴대폰)
│   ├── screen.html     프로젝터   (대형 화면)
│   ├── login.html      관리자 로그인
│   └── admin.html      진행자 콘솔 (PC)
├── css/
│   └── style.css       전체 디자인
├── js/
│   ├── store.js        서버 통신 + 실시간 수신 (SSE)
│   └── app.js          화면 그리기 + 버튼 동작
├── server/
│   ├── db.js           PostgreSQL 연결 (접속 정보는 .env 에만)
│   └── server.js       Express + API + 실시간 전송
├── db/
│   ├── 001_schema.sql  표 7개 + 안전 뷰 + 버전 트리거
│   └── 002_seed.sql    팀 8, 문제 5, 정답
└── scripts/
    ├── migrate.mjs     SQL 파일을 번호순으로 실행
    └── create-admin.mjs 진행자 계정 만들기
```

## 처음 한 번만 하는 준비

Node.js 22 이상과 PostgreSQL 17 이 필요하다.

```
winget install PostgreSQL.PostgreSQL.17     # PostgreSQL 설치
npm install                                  # express, pg 설치
copy .env.example .env                       # 접속 정보 파일 만들기 (내용 수정)
npm run migrate                              # 표 만들기 + 기본 데이터
npm run create-admin                         # 진행자 계정 만들기
```

`goldenbell-server` 데이터베이스를 미리 만들어야 한다.

```
psql -U postgres -c "CREATE DATABASE \"goldenbell-server\""
```

## 실행 방법

```
npm start
```

브라우저에서 **http://localhost:3000** 에 접속한다.
서버를 끄려면 터미널에서 `Ctrl + C`.

> `npm run migrate` 를 다시 실행하면 표를 지우고 새로 만든다.
> 참가자와 답안이 전부 사라지므로 행사 중에는 실행하지 않는다.

## 혼자 연습해보기

탭 3개를 띄워두면 실시간으로 연결되는 걸 볼 수 있다.

| 탭 | 주소 | 역할 |
|---|---|---|
| 1 | http://localhost:3000/html/login.html | 진행자 로그인 |
| 2 | http://localhost:3000/html/join.html | 참가자 |

프로젝터 화면은 진행자 콘솔 오른쪽 위 **🖥 프로젝터 열기** 버튼으로 새 탭에서 연다.

순서:

1. **탭 3**에서 팀과 이름을 넣고 참가한다
2. **탭 1**에서 로그인 → 콘솔 진입 → 문제 선택 및 공개 → 타이머 시작
3. **탭 3**에 문제가 뜬다. 답을 고르고 제출
4. **탭 1**에서 답변 마감 → 판정 확정 → 정답 공개
5. 다시 **문제 선택 및 공개**로 다음 문제를 고른다 (낸 문제는 목록에서 사라진다)

주관식은 자동 채점이 애매하면 `보류`로 남는다. 탭 1의 참가자 표에서
`정답` / `오답` 버튼으로 직접 판정해야 판정 확정을 누를 수 있다.

## 휴대폰으로 접속하기

노트북과 휴대폰이 같은 Wi-Fi에 있어야 한다.

1. PowerShell에서 `ipconfig` → `IPv4 주소`를 확인 (예: `172.30.1.82`)
2. 휴대폰 브라우저에 `http://172.30.1.82:3000/html/join.html` 입력

처음 접속할 때 Windows 방화벽이 물어보면 **허용**을 눌러야 한다.

프로젝터 화면(`screen.html`) 아래쪽에도 접속할 주소가 자동으로 표시된다.

## 데이터가 저장되는 곳

전부 **PostgreSQL** 에 저장된다. 브라우저에는 참가자 번호표 하나만 남는다.

- 어떤 기기에서 접속해도 같은 게임에 참여한다
- 서버를 껐다 켜도 진행 상황이 그대로 남는다
- 참가자가 휴대폰을 새로고침해도 자기 자리로 돌아온다

실시간은 **SSE**(Server-Sent Events)로 전달된다. 브라우저 내장 기능이라
라이브러리가 없고, 연결이 끊기면 브라우저가 알아서 다시 연결한다.

## 관리자 로그인

메인 화면 오른쪽 위 **🔒 관리자** 버튼 → 로그인 화면.
계정은 `npm run create-admin` 으로 만든다. 비밀번호는 변환해서 저장되므로
DB를 열어봐도 원문을 알 수 없고, 잊으면 같은 명령으로 재설정한다.

## 데이터 전부 지우기

진행자 콘솔 맨 아래 `전체 초기화` 버튼을 누른다.
