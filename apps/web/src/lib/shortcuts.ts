/** The shortcut registry: the cheatsheet (Ctrl+/) and the hint bar both read it (TUI T147/T148). */
export interface Shortcut {
	keys: string;
	label: string;
	section: "기본" | "대화 이동" | "패널" | "명령";
}

export const SHORTCUTS: Shortcut[] = [
	{ keys: "Enter", label: "보내기 (작업 중이면 진행 방향 바꾸기)", section: "기본" },
	{ keys: "Shift+Enter", label: "줄바꿈", section: "기본" },
	{ keys: "Esc", label: "실행 중인 답·명령 멈추기", section: "기본" },
	{ keys: "↑", label: "이전 입력 (빈 입력창에서 대기 메시지 되돌리기)", section: "기본" },
	{ keys: "Shift+Tab", label: "추론 강도 바꾸기", section: "기본" },
	{ keys: "Ctrl+V", label: "이미지·텍스트 붙여넣기", section: "기본" },
	{ keys: "Ctrl+Alt+V", label: "마지막 이미지 빼기", section: "기본" },
	{ keys: "@", label: "파일·폴더·diff·git 참조", section: "기본" },
	{ keys: "/", label: "명령", section: "기본" },
	{ keys: "Ctrl+N", label: "새 스레드", section: "명령" },
	{ keys: "Ctrl+K", label: "명령 팔레트", section: "명령" },
	{ keys: "Ctrl+P", label: "스레드로 이동", section: "명령" },
	{ keys: "Ctrl+Shift+F", label: "모든 스레드 검색", section: "명령" },
	{ keys: "Ctrl+,", label: "설정", section: "명령" },
	{ keys: "Ctrl+/", label: "단축키 보기", section: "명령" },
	{ keys: "Ctrl+F", label: "이 대화에서 찾기", section: "대화 이동" },
	{ keys: "Ctrl+↑", label: "이전 질문으로", section: "대화 이동" },
	{ keys: "Ctrl+↓", label: "다음 질문으로", section: "대화 이동" },
	{ keys: "PageUp", label: "한 화면 위로", section: "대화 이동" },
	{ keys: "PageDown", label: "한 화면 아래로", section: "대화 이동" },
	{ keys: "Ctrl+Home", label: "처음으로", section: "대화 이동" },
	{ keys: "Ctrl+End", label: "최신으로", section: "대화 이동" },
	{ keys: "Ctrl+O", label: "도구 결과 펼치기/접기", section: "패널" },
	{ keys: "Ctrl+E", label: "생각 과정 펼치기/접기", section: "패널" },
	{ keys: "Ctrl+B", label: "작업 패널", section: "패널" },
	{ keys: "Ctrl+T", label: "Todo 목록 펼치기/접기", section: "패널" },
	{ keys: "Ctrl+J", label: "질문에 답하기", section: "패널" },
];
