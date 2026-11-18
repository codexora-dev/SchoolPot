# PWA 사용·개발 안내

## 설치

SchoolPot / 짧은 이름 스쿨팟, standalone, 기존 녹색(#287560)과 모자 로고를 사용합니다. manifest의 id/start_url/scope와 아이콘은 상대 경로로 구성하여 GitHub Pages `/SchoolPot/`를 지원합니다.

하단 서비스 안내 또는 계정의 앱 설치 안내를 엽니다. Chromium 계열이 beforeinstallprompt를 제공하면 설치 버튼이 나타납니다. iOS는 Safari 공유 → 홈 화면에 추가로 안내합니다. standalone 상태·설치 완료 이벤트에서는 설치 버튼을 숨깁니다. 설치를 강제하지 않고 나중에 홈으로 돌아갈 수 있습니다.

지원 조건은 브라우저·OS 버전에 따라 다릅니다. iOS 웹 푸시는 홈 화면에 추가한 앱과 지원되는 OS에서 확인해야 합니다. 모바일·PC OS 설치 및 실제 푸시 수신은 기기별 배포 후 검증 대상입니다.

## 빌드와 업데이트

`npm run build`에서 `scripts/pwa-plugin.js`가 번들·worker 코드·공개 정적 리소스의 해시로 sw.js를 생성합니다. 개발 서버에서는 SW를 등록하지 않습니다. 기존 boot 화면을 시작 화면으로 사용합니다.

새 worker는 waiting으로 대기합니다. 빌드 식별자가 있는 업데이트 안내에서 사용자가 업데이트 적용을 선택해야 skipWaiting을 요청합니다. 입력 값이 있는 경우 확인 대화상자를 표시합니다. 거절·나중에를 선택하면 새로고침하지 않습니다. 다른 탭은 자동 새로고침하지 않습니다. 계정 저장소·임시 저장소를 업데이트 과정에서 지우지 않습니다.

정적 캐시는 현재 버전과 직전 버전을 남겨 업데이트를 미룬 탭을 지원합니다. 더 오래된 캐시는 activation 때 정리합니다. 오래 미룬 탭에서 이전 chunk를 불러오지 못하면 기존 재시도 화면으로 복구합니다.

## 오프라인과 캐시 경계

캐시에 넣는 것은 빌드 시 정해진 JS/CSS/정적 HTML/manifest/로고/오프라인 화면입니다. 외부 API, Supabase Auth/PostgREST/Edge, POST, 일반 사용자 콘텐츠, 알 수 없는 경로와 URL 쿼리는 캐시하지 않습니다. 네트워크 navigation 응답도 캐시에 쓰지 않습니다.

연결이 끊긴 상태의 새로고침은 `offline.html`을 보여 줍니다. 네트워크 복구 시 상태를 알리고 다시 시도 버튼으로 연결합니다. 앱이 이미 열려 있으면 기존 연결 상태 안내와 API 오류를 사용합니다. 게시글 전체의 오프라인 열람은 제공하지 않습니다.

## 임시 저장

글쓰기·글 수정은 계정과 글별 키로 자동 저장하고 재방문 시 복원합니다. 직접 임시 저장·삭제도 가능합니다. 같은 기기의 localStorage를 사용하며 서버로 초안을 보내지 않습니다. 24시간 만료 후 다음 초안 접근 시 지우며, 게시 완료·로그아웃·탈퇴 때 해당 계정의 초안을 정리합니다. 저장소 차단·손상은 안내하고 글 게시를 막지 않습니다. 공용 기기 사용 후 로그아웃을 안내합니다.

## 검증

`npm run test:pwa`는 테스트 전용 공개 키를 사용해 프로덕션 빌드·`/SchoolPot/` preview 서버를 실행합니다. Chromium에서 SW 등록, manifest/아이콘, 오프라인 새로고침·복구, 명시적 업데이트와 저장 상태 보존을 실제 실행합니다. 설치 UI와 업데이트 코드가 없는 Vite dev 서버 검사로 대체하지 않습니다. 산출물은 tests/.local에만 저장합니다. 테스트 후 운영용 환경으로 다시 빌드해야 합니다.

참고: [MDN Service Worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers), [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API).
