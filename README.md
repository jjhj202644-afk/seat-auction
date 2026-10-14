# 학급 자리 경매

학급 화폐로 자리를 경매하고, 남는 자리는 임대까지 정하는 수업 도구입니다.

- 교사 화면(TV): `index.html`
- 학생 화면(웨일북·태블릿): `student.html` — 방 코드로 들어옵니다
- 체험하기: `index.html?demo=1` — 서버·학생 없이 가상 학생 25명과 전체 흐름을 해 볼 수 있습니다 (인터넷 없이도 동작)

## 파일

| 파일 | 하는 일 |
|---|---|
| `index.html` | 교사 화면 · 체험 모드 |
| `student.html` | 학생 화면 |
| `js/config.js` | Supabase 주소와 Publishable key |
| `js/core.js` | 경매 규칙, 서버 연결, 체험용 서버 |
| `js/teacher.js` | 교사 화면 |
| `js/student.js` | 학생 화면 |
| `css/app.css` | 화면 디자인 |
| `supabase.sql` | 서버(데이터베이스) 설치 파일 |

## 처음 설치 (한 번만)

### 1. Supabase 준비
1. supabase.com 에서 프로젝트를 엽니다.
2. 왼쪽 **SQL Editor** → **New query**
3. `supabase.sql` 내용을 모두 붙여 넣고 **Run**
4. `Success` 가 나오면 끝입니다. (여러 번 실행해도 괜찮습니다)
5. **Project Settings → API Keys** 에서 `Publishable key` 를 복사해 `js/config.js` 에 넣습니다.
   - `secret` / `service_role` 키는 절대 넣지 마세요.

### 2. GitHub 에 올리기
1. GitHub 에서 새 저장소(예: `seat-auction`)를 만듭니다.
2. **Add file → Upload files** 로 이 폴더의 파일을 폴더 구조 그대로 올립니다.

### 3. Vercel 에 연결
1. vercel.com → **Add New → Project** → 방금 만든 저장소 **Import**
2. 설정은 건드리지 않고 **Deploy**
3. 나온 주소가 교사용 주소입니다. 학생은 TV의 QR 또는 `주소/student.html` 로 들어옵니다.

이후에는 GitHub 의 파일을 고치면 Vercel 이 자동으로 다시 배포합니다.

## 개인정보

- 학생은 **번호와 이름(별명 가능)** 만 넣습니다. 학교·학년·반·교사 이름은 받지 않습니다.
- 보유 자산과 입찰 금액은 본인 화면에만 보이고 TV 에는 나오지 않습니다.
- 모든 기록은 **마치기**를 누르면 즉시, 누르지 않아도 **24시간 뒤** 자동 삭제됩니다.
- 데이터베이스 표는 직접 읽을 수 없게 잠겨 있고, 정해진 기능(함수)으로만 접근합니다.
- 방 코드는 6자리, 1차 경매가 시작되면 새로 들어올 수 없습니다.
