# SchoolPot의 빌드 도구용 보안 수정판

picomatch 4.0.7 (MIT)을 기반으로 한 비공개 로컬 수정판입니다. 공식 신규 릴리스가 아닙니다. `@schoolpot/picomatch` 4.0.7+schoolpot.1로 구분합니다.

CVE-2026-112366 / GHSA-fc5q-39xc-vjpf 대응으로, 반복 extglob `+(...)`/`*(...)`의 본문에 wildcard/group/escape 문법이 있으면 기존 parser의 literal 처리 경로를 사용합니다. 예: `+(*)`, `+(*a)`를 정규식 반복식으로 컴파일하지 않습니다. 호출자가 recursion 검사를 꺼도 적용합니다. 이러한 복잡한 반복 extglob은 리터럴 문자열로 취급됩니다. 일반 globstar, brace, 단순 반복 대안 등은 기존 동작을 유지합니다.

npm overrides는 모든 Vite/Vitest/fdir/tinyglobby 소비자를 이 소스로 연결합니다. 원본 코드 해시와 수정 후 해시는 PROVENANCE.json에 기록합니다. 라이선스는 LICENSE에 보존합니다. 원본 4.0.7에서 lib/parse.js의 방어 분기와 패키지 메타데이터만 변경했습니다. 빌드 전 무결성 검증과 시간 제한을 둔 실제 위험 패턴 회귀 테스트를 수행합니다. 제품 브라우저 번들에는 포함하지 않습니다.

공식 수정 버전이 배포되면 보안 회귀 테스트를 유지하면서 이 fork와 override를 제거합니다. npm audit의 로컬 패키지 탐지만으로 수정 완료를 판단하지 않으며 코드 검증·직접 의존 경로·위험 패턴 테스트가 모두 통과해야 합니다.
