<p align="center">
  <img src=".github/assets/logo.svg" alt="Dinobot 로고" width="160">
</p>

# Dinobot Desktop

**Dinobot을 위한 데스크톱 인터페이스.**

Electron과 React로 만든 앱에서 대화를 이어가고, 에이전트의 질문에 답하고, 생성된 파일을 확인하세요. Desktop은 클라이언트이며, 에이전트는 호환되는 Dinobot 데몬이 실행합니다.

[English](README.md) · [한국어](README.ko.md) · [简体中文](README.zh-CN.md)

[PolyForm Noncommercial 1.0.0](LICENSE)으로 소스를 공개합니다. OSI 기준의 오픈소스가 아니며, 상업적 사용에는 관련 권리자의 별도 허가가 필요합니다.

## 데모

https://github.com/user-attachments/assets/1955b0cb-3f0f-4266-b968-35b7844964b7

## 사용할 인터페이스 선택

- **Desktop — 이 저장소.** 그래픽 클라이언트, Electron 연동, 공유 React UI 컴포넌트를 제공합니다.
- **Core + 터미널 사용자 인터페이스(TUI).** 에이전트 데몬과 터미널 인터페이스는 별도 저장소에서 관리합니다.

Dinobot core와 TUI
https://github.com/dinobot-labs/dinobot

## 화면에서 할 수 있는 일

| 영역 | 클라이언트 기능 |
| --- | --- |
| 대화 | 텍스트·이미지·파일을 보내고, 에이전트의 질문에 답하고, 실행 중인 턴을 중단합니다. 파일 첨부는 데몬이 같은 컴퓨터에서 실행되는 것을 전제로 합니다. |
| 생성된 파일 | 대화 옆에서 지원되는 로컬 산출물을 확인합니다. 이미지와 HTML 미리보기를 포함합니다. |
| 설정과 사용량 | 계정·모델·플러그인·데몬 설정에 접근합니다. 컨텍스트 사용량은 제공자가 보고한 토큰 수가 있을 때 표시하며, 항목별 사용량을 추정하지 않습니다. |

사용 가능 여부는 연결된 데몬과 실행 환경에 따라 달라집니다. 공유 UI에는 컴포넌트 개발용 스타일가이드가 따로 있습니다.

## 소스로 시작하기

**현재 이 저장소는 소스 빌드를 지원하며, 공개 설치 프로그램을 제공하는 단계는 아닙니다.** 과거 데몬 고정 버전인 `0.7.15-local.browser.1`은 공개 다운로드 가능한 릴리스가 아닙니다. 소스 빌드만으로 설치 가능한 앱이 만들어지지 않습니다.

필요 도구: **Bun 1.4.3**, **Node.js 22 이상**, **Git**. 저장소 루트에서 실행하세요.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check:public
bun run typecheck
bun run test
bun run build
```

빌드는 렌더러, 스타일가이드, Electron main/preload 번들을 만듭니다. 데몬 다운로드, 설치 프로그램 생성, 릴리스 게시를 수행하지 않으며 비공개 저장소도 필요하지 않습니다. 의존성 설치 스크립트는 의도적으로 비활성화합니다. 소스 빌드와 합성 데이터 단위 테스트에는 모델 자격 증명이 필요하지 않습니다.

인터페이스 개발 시 저장소 루트에서 목적에 맞는 명령을 실행하세요.

```sh
bun run dev
bun run dev:styleguide
```

렌더러에는 호환되는 로컬 데몬이 필요합니다. Electron을 로컬에서 실행하려면 Electron이 제공하는 런타임 설치 프로그램도 별도로 실행해야 합니다. 이 다운로드는 소스 전용 검증에 포함되지 않습니다. 프로젝트 구조와 실행 조건은 [개발 가이드](docs/wiki/Development.md)를 참고하세요.

`apps/desktop`의 `dist`, `dist:win`, `dist:mac`, `stage:daemon`은 향후 패키징 작업을 위해 남겨 둔 명령이며, 지원되는 공개 설치 프로그램 제작 안내가 아닙니다. 패키징 전 [릴리스 범위](docs/wiki/Release.md)를 확인하세요.

## 실행 환경과 개인정보

- 모델 자격 증명과 유료 서비스는 포함되지 않습니다. 로컬 인터페이스라고 모든 작업이 오프라인으로 처리되는 것은 아닙니다. 외부 요청은 연결된 데몬과 설정된 제공자에 따라 결정됩니다.
- 운영용 문제 보고 서비스와 비공개 배포 시스템은 이 소스 저장소에 포함되지 않습니다. 문제 보고 화면에는 `dinobot report consent|agree|send --json`을 제공하는 core가 필요합니다. 합성 데이터 테스트는 운영 보고 서비스를 검증하지 않습니다.
- 이슈에는 세션 내보내기, 토큰, 개인 스크린샷 대신 최소한의 합성 재현 사례를 첨부하세요. 취약점은 [보안 안내](SECURITY.md)에 따라 비공개로 제보하세요.

## 문서와 기여

- [개발 가이드](docs/wiki/Development.md) · [위키 원문](docs/wiki/Home.md) · [릴리스 범위](docs/wiki/Release.md)
- [기여 안내](CONTRIBUTING.md) · [행동 강령](CODE_OF_CONDUCT.md) · [보안](SECURITY.md)
- [라이선스 안내](docs/wiki/Licensing.md) · [제3자 고지](THIRD_PARTY_NOTICES.md)

`main`은 고정된 내보내기 사본이 아니라 계속 관리되는 소스입니다. [공개 소스 출처](PUBLIC_SNAPSHOT.md)와 [출처 데이터](SOURCE_PROVENANCE.json)는 현재 소스 변경분, 과거 내보내기, 변경되지 않은 패키징 버전 필드를 구분합니다. [소스 해시](SOURCE_HASHES.json)는 Git blob 원본 바이트 기준입니다. `bun scripts/source-hashes.ts --check`는 스테이징된 인덱스를 검사하며, 리비전을 넘기면 해당 트리를 검사합니다.

## 라이선스

[PolyForm Noncommercial 1.0.0](LICENSE)이 허용하는 용도에는 무료로 사용할 수 있습니다. 상업적 사용에는 관련 권리자의 별도 허가가 필요합니다. 의존성과 폰트에는 각각의 라이선스가 적용됩니다. [제3자 고지](THIRD_PARTY_NOTICES.md)를 확인하세요.

라이선스·보안 문의: dev0jsh@gmail.com.
