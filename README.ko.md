# ReMux 🚀 (한국어)

[![Latest Release](https://img.shields.io/github/v/release/daystar7777/ReMux?color=blue&label=Release)](https://github.com/daystar7777/ReMux/releases)
[![Build Status](https://img.shields.io/badge/Build-Passed-success)](https://github.com/daystar7777/ReMux)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-lightgrey)](https://github.com/daystar7777/ReMux)
[![Language](https://img.shields.io/badge/Language-English%20%7C%20%ED%95%9C%EA%B5%AD%EC%96%B4-orange)](#translations)

**ReMux**는 **Tauri**, **React**, **Jotai**, 그리고 **xterm.js**로 구축된 **tmux** 세션용 고성능 프리미엄 데스크톱 GUI 매니저입니다. macOS 및 Windows 환경에 맞춰 네이티브로 설계되었으며, 기존의 터미널 멀티플렉싱 환경을 매우 부드럽고 시각적이며 직관적인 개발자 전용 워크스페이스로 한 단계 끌어올립니다.

---

## 🌐 번역 / Translations

* **[English README (영어 리드미)](README.md)**
* **[Interactive HTML Usage Guide / 사용법 가이드](docs/usage.html)**

---

## 📥 v0.1.0-Beta 다운로드

원하시는 플랫폼을 선택하여 최신 릴리즈 빌드를 바로 다운로드할 수 있습니다:

*   🍎 **macOS**: **[macOS용 ReMux 다운로드 (v0.1.0-Beta)](https://github.com/daystar7777/ReMux/releases/download/v0.1.0-beta/REMUX-macOS.zip)**
*   🪟 **Windows**: **[Windows용 ReMux 다운로드 (.msi)](https://github.com/daystar7777/ReMux/releases)** ([GitHub Releases](https://github.com/daystar7777/ReMux/releases) 페이지에서 직접 확인 및 다운로드 가능)

---

## ✨ 핵심 기능 요약

*   **재귀적 터미널 패널 분할 (Splits Grid)**: 워크스페이스 안에서 세로(`Ctrl+Shift+E`) 및 가로(`Ctrl+Shift+D`) 패널 분할을 자유롭게 재귀적으로 수행하여 최적의 타일링 그리드를 구성합니다.
*   **동시 입력 브로드캐스트 모드**: 현재 탭 내의 모든 활성화된 분할 패널에 키보드 입력을 동시에 전송합니다. 활성화 시 네온 펄스 경고 테두리가 켜져 오입력을 직관적으로 방지합니다.
*   **실시간 세션 및 윈도우 인벤토리 사이드바**: 로컬 및 원격의 모든 tmux 인스턴스를 트리 구조로 시각화합니다. 마우스 호버 시 윈도우 생성, 확인창이 동반된 삭제, 동적 이름 변경 기능이 부드럽게 노출됩니다.
*   **지능형 Tmux 버전 자동 호환 (Try-and-Fallback)**: Rust 백엔드가 접속 환경의 tmux 버전을 감지하여 자동으로 대처합니다. (2.1 미만 서버에서는 옛날 마우스 옵션 세트를 일괄 자동 적용하며, 3.0 미만 서버에서 패널 이름 변경 시 크래시 없이 직관적인 호환 경고 배너를 노출).
*   **맞춤형 성능 및 백엔드 폴링 슬라이더**: 백엔드 텔레메트리(CPU/메모리 실시간 정보) 및 인벤토리 폴링 주기를 맞춤형 프리셋 프로필(Eco, Battery Saver, Balanced, High Performance)로 세밀하게 조정하여 시스템 자원을 최적으로 관리합니다.
*   **Elite 단축키 및 순환 포커스 이동**: 단축키 하나로 분할 패널 간(`Ctrl+Shift+Tab`) 또는 탭 간(`Ctrl+Tab`) 경계를 자유롭게 넘나들며 포커스를 순환합니다. VS Code 스타일의 패널 토글 단축키(`Cmd+B`, `Cmd+Shift+I`, `Cmd+,`)도 지원합니다.
*   **PasteGuard 및 드래그 복사 시스템 클립보드**: 터미널 드래그 영역을 마우스에서 떼는 순간 macOS 시스템 클립보드로 즉시 복사하고 드래그 모드를 해제합니다. PasteGuard가 여러 줄 스크립트 붙여넣기 시 예상치 못한 실행을 감지하여 사용자를 보호합니다.
*   **보안 Keychain 연동 및 하트비트 연결 회복**: macOS 네이티브 Keychain API를 연동하여 SSH 비밀번호를 완벽하게 보호합니다. 네트워크 연결이 일시적으로 끊어지면 자동 재연결 오버레이가 실행되어 스크롤백 손실 없이 원격 tmux 세션을 안전하게 복구합니다.

---

## ⌨️ 글로벌 단축키 가이드

| 단축키 조합 | 실행 동작 설명 |
| :--- | :--- |
| `Cmd + B` | 기본 왼쪽 사이드바 패널 토글 (프로필/호스트 CRUD) |
| `Cmd + Shift + I` | 실시간 Tmux 인벤토리 사이드바 토글 |
| `Cmd + ,` | 테마 설정 및 성능/폴링 조절 우측 패널 토글 |
| `Ctrl + Tab` | 다음 탭으로 포커스 이동 (경계 순환) |
| `Ctrl + Shift + Tab` | 다음 분할 패널로 포커스 이동 (경계 순환) |
| `Ctrl + Shift + E` | 현재 활성화된 터미널 패널을 **세로**로 분할 |
| `Ctrl + Shift + D` | 현재 활성화된 터미널 패널을 **가로**로 분할 |
| `Ctrl + Shift + W` | 활성화된 패널 닫기 (마지막 패널인 경우 탭이 닫힘) |
| `Ctrl + Shift + C` | 드래그 강조된 텍스트를 macOS 클립보드에 복사하고 드래그 모드 해제 |
| `Ctrl + Shift + V` | macOS 클립보드 내용 붙여넣기 (PasteGuard 다중 라인 보안 검증 거침) |
| `Ctrl + Alt + 방향키` | 방향키 방향에 인접한 분할 패널로 포커스 즉시 이동 |

---

## 🛠️ 개발 및 컴파일 방법

로컬에서 개발 모드로 ReMux를 실행하려면 다음 단계를 수행하세요:

```bash
# 1. 리포지토리 클론
git clone https://github.com/daystar7777/ReMux.git
cd ReMux/app

# 2. 패키지 설치
npm install

# 3. Tauri 개발 환경 실행
npm run dev
```

### 릴리즈 빌드 및 무결성 검증

타입 체크, 유닛 테스트, 로컬 tmux 스모크 시뮬레이션 게이트를 일괄 작동시키려면 다음 명령을 사용합니다:

```bash
npm run verify:release
```

---

## 🛡️ 라이선스

MIT 라이선스에 따라 배포됩니다. 자세한 내용은 `LICENSE` 파일을 참고해 주세요.
