import { Button, Dino, Shimmer } from "@dinobot/ui";
import { IconFileText, IconPlayerPlay, IconRefresh } from "@tabler/icons-react";
import { desktop, isDesktop } from "../lib/bridge.ts";
import { connect, startDaemon, useApp } from "../state/app.ts";

export function ConnectionScreen() {
	const { connection, connectionError, logTail, config } = useApp();
	const busy = connection === "checking" || connection === "starting";
	return (
		<div className="dot-paper flex min-h-0 flex-1 items-center justify-center overflow-auto p-8">
			<div className="flex w-[min(520px,100%)] flex-col items-center text-center">
				<Dino state={busy ? "running" : "waiting"} size={180} ground={busy} />
				<h1 className="mt-6 text-2xl font-semibold tracking-[var(--tr-title)]">
					{connection === "starting" ? <Shimmer>dinobot을 깨우는 중</Shimmer> : connection === "checking" ? <Shimmer>연결하는 중</Shimmer> : "dinobot 데몬에 연결할 수 없어요"}
				</h1>
				{connection === "offline" ? (
					<>
						<p className="mt-2 text-md text-fg-2">{connectionError}</p>
						<div className="mt-6 flex flex-wrap justify-center gap-2">
							{isDesktop && config?.command ? (
								<Button variant="primary" size="lg" onClick={() => void startDaemon()}>
									<IconPlayerPlay /> 데몬 시작
								</Button>
							) : null}
							<Button variant="secondary" size="lg" onClick={() => void connect()}>
								<IconRefresh /> 다시 시도
							</Button>
							{isDesktop && config?.dataDir ? (
								<Button variant="ghost" size="lg" onClick={() => void desktop?.openDaemonLog()}>
									<IconFileText /> 로그 열기
								</Button>
							) : null}
						</div>
						{isDesktop && config && !config.command ? (
							<p className="mt-4 text-sm text-fg-3">
								앱에 들어 있는 dinobot 데몬을 찾지 못했어요. 앱을 다시 설치해 주세요.
							</p>
						) : null}
						{logTail ? (
							<pre className="selectable mt-5 max-h-56 w-full overflow-auto rounded-md border border-line bg-sunken p-3 text-left font-mono text-xs whitespace-pre-wrap text-fg-2">{logTail}</pre>
						) : null}
						{config ? (
							<div className="mt-6 font-mono text-micro text-fg-3">
								{config.manifestPath ?? "manifest 없음"} · 127.0.0.1:{config.port}
							</div>
						) : null}
					</>
				) : null}
			</div>
		</div>
	);
}
