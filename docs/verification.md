# 검증 결과 · 2026-11-12 팝업 업데이트

| 최신 검사                                     | 통과 |
| --------------------------------------------- | ---: |
| Vitest 입력·아이디·정적 보안·팝업 닫기 선호도 |   15 |
| PGlite DB 권한·익명·계정·팝업 관리            |   48 |
| Playwright 일반·회원 fixture·반응형·팝업      |   30 |
| 실제 Supabase 팝업 API                        |    7 |

이번 최신 실행에서 자동 검사 100개를 통과했습니다. 기본 E2E의 실제 계정 생성 테스트 1개는 명시적 활성화 전까지 건너뜁니다. 이전 계정 작업에서 실제 Auth/API 15개·실제 가입/탈퇴 UI 1개·Edge HTTP 보호 8개를 검증한 이력은 progress.md에 남겼으며 이번 팝업 검사와 혼동하지 않습니다.

실제 팝업 API 검증은 임시 계정을 생성해 일반 회원 관리 차단을 확인한 뒤 해당 QA 계정에만 임시 역할을 부여해 비공개 생성·공개 응답 제외·수정/버전·오래된 수정 차단·기본 닫기 제거 차단·삭제를 수행했습니다. 테스트 계정과 팝업 잔여 0건을 확인했습니다. 운영자 admin 계정 및 실제 데이터는 변경하지 않았습니다.

별도로 실제 DB에서 활성 팝업 생성·공개 JSON projection·삭제를 현재 역할/세션 검사와 함께 검증하고 트랜잭션 전체를 롤백했습니다. 실제 방문자에게 QA 팝업을 게시하지 않았습니다. 비회원 공개 RPC는 HTTP 200, 관리 RPC는 401/권한 거절을 확인했습니다.

브라우저 검사는 첫 진입 표시, HTML 원문 텍스트 처리, 기본 닫기 후 메뉴 이동/새로고침, 오늘 하루와 다시 보지 않기 유지, 수정 버전 재표시, 허용된 옵션만 표시, Escape/× 닫기, 순차 팝업, 320px 긴 본문, 관리자 등록/미리보기/중지/수정/삭제를 포함합니다. 캡처는 screenshots/popup-mobile.png 및 popup-preview-desktop.png입니다.

Lint·build를 통과했고 npm audit에서 알려진 취약점 0건을 확인했습니다. popup_preferences의 오늘 날짜는 Asia/Seoul 기준이며 브라우저 저장 차단 시 이번 방문에만 닫았다고 안내합니다.

최신 Security Advisor: RLS 기본 거부의 no policy INFO 24건, Auth 유출 비밀번호 보호 비활성 WARN 1건. [유출 비밀번호 보호 설정](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) 비활성 WARN 1건도 확인했습니다. 팝업과 별개인 Auth 설정이며, 공식 문서상 Pro 이상 기능이므로 임의의 유료 플랜 변경은 하지 않았습니다.
