import { Button } from "@dinobot/ui";
import { IconFileText, IconPlayerStop, IconRefresh, IconWand } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { desktop, isDesktop } from "../lib/bridge.ts";
import { restartDaemon, runCommandUi, useApp } from "../state/app.ts";
import { Section } from "./kit.tsx";

export function DaemonTab() {
	const daemon = useApp((s) => s.daemon);
	const config = useApp((s) => s.config);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	useEffect(() => {
		void api.daemon().then((info) => useApp.setState({ daemon: info })).catch(() => {});
	}, []);
	const owned = daemon?.owner === "tui";
	const idle = (daemon?.busy.length ?? 1) === 0;
	return (
		<div className="flex flex-col gap-6">
			<Section title="데몬" description="창을 닫아도 데몬은 계속 돌아요. 다른 터미널의 dinobot도 같은 데몬을 써요.">
				<div className="rounded-lg border border-line bg-sunken px-3 py-2.5 font-mono text-xs leading-relaxed text-fg-2" data-testid="daemon-info">
					<div>
						버전 {daemon?.version ?? "?"} · pid {daemon?.pid ?? "?"} · {owned ? "로컬 클라이언트가 시작함" : "외부에서 시작함 (dinobot serve)"}
					</div>
					<div className="truncate">설정 파일 {daemon?.manifestPath ?? config?.manifestPath ?? "?"}</div>
					<div className="truncate">데이터 {config?.dataDir ?? "?"}</div>
					<div>주소 127.0.0.1:{config?.port ?? 8786}</div>
					{daemon?.setup.startedAt && !daemon.setup.completedAt ? <div className="text-status-running-fg">설정을 아직 마치지 않았어요</div> : null}
					{daemon?.busy.length ? <div className="text-status-running-fg">작업 중인 스레드 {daemon.busy.length}개: {daemon.busy.join(", ")}</div> : null}
				</div>
				<div className="flex flex-wrap gap-2">
					<Button size="sm" onClick={() => runCommandUi("setup")}>
						<IconWand /> 설정 마법사
					</Button>
					{isDesktop ? (
						<Button size="sm" onClick={() => void desktop?.openDaemonLog()}>
							<IconFileText /> 로그 열기
						</Button>
					) : null}
					{isDesktop ? (
						<Button
							size="sm"
							disabled={!owned || !idle || busy}
							onClick={() => {
								setBusy(true);
								void restartDaemon()
									.then((error) => setMessage(error ?? "다시 시작했어요"))
									.finally(() => setBusy(false));
							}}
						>
							<IconRefresh /> {busy ? "다시 시작하는 중" : "다시 시작"}
						</Button>
					) : null}
					<Button
						size="sm"
						variant="danger"
						disabled={!owned || !idle || busy}
						onClick={() => {
							if (!daemon) return;
							void api.shutdown(daemon.pid).then((r) => setMessage(r.status === "stopping" ? "데몬을 껐어요. 다시 켜려면 연결 화면에서 시작하세요." : `끌 수 없어요: ${"error" in r ? r.error : ""}`));
						}}
					>
						<IconPlayerStop /> 끄기
					</Button>
				</div>
				{!owned && daemon ? <div className="text-xs text-fg-3">직접 시작한 데몬(dinobot serve)은 여기서 다시 시작하거나 끌 수 없어요.</div> : !idle ? <div className="text-xs text-fg-3">작업 중인 스레드가 있으면 다시 시작하거나 끌 수 없어요.</div> : null}
				{message ? <div className="text-xs text-fg-2">{message}</div> : null}
			</Section>
			<div className="font-mono text-micro text-fg-3">dinobot desktop {desktop?.version ?? "web"}</div>
		</div>
	);
}
