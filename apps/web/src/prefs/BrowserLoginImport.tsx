import { Button } from "@dinobot/ui";
import { useEffect, useRef, useState } from "react";
import type { ChromeProfile } from "../../../desktop/src/browser-types.ts";
import { browserAvailable, browserClient, importChromeProfile } from "../panel/browser-client.ts";
import { Section } from "./kit.tsx";

export function BrowserLoginImport() {
	const [profiles, setProfiles] = useState<ChromeProfile[]>([]);
	const [profile, setProfile] = useState("");
	const [confirmed, setConfirmed] = useState(false);
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
	const live = useRef(true);
	const running = useRef(false);
	const load = async () => {
		if (!browserAvailable || running.current) return;
		running.current = true; setLoading(true); setError("");
		try {
			// Metadata-only; this action must not launch Chrome or read cookie contents.
			const reply = await browserClient.request("profiles");
			if (!live.current) return;
			setProfiles(reply.profiles ?? []); setProfile(""); setConfirmed(false); setResult(null);
		} catch (error) { if (live.current) setError(error instanceof Error ? error.message : String(error)); }
		finally { running.current = false; if (live.current) setLoading(false); }
	};
	useEffect(() => { live.current = true; void load(); return () => { live.current = false; }; }, []);
	const runImport = async () => {
		if (!profile || !confirmed || running.current) return;
		running.current = true; setBusy(true); setError(""); setResult(null);
		try {
			const reply = await importChromeProfile(browserClient, profile, confirmed);
			if (live.current) { setResult({ imported: reply.imported!, skipped: reply.skipped ?? 0 }); setConfirmed(false); }
		} catch (error) { if (live.current) setError(error instanceof Error ? error.message : String(error)); }
		finally { running.current = false; if (live.current) setBusy(false); }
	};
	return (
		<Section title="Chrome 로그인 가져오기" description="에이전트와 함께 쓰는 실제 Chrome에 쿠키 기반 로그인을 가져와요.">
			{browserAvailable ? <div className="flex flex-col gap-3 rounded-md border border-line p-3" data-testid="browser-login-import">
				<p className="text-xs text-fg-3">선택한 Chrome 프로필의 쿠키만 가져와요. 비밀번호와 패스키는 복사하지 않아요.</p>
				<p className="text-xs text-fg-3">가져온 로그인으로 에이전트가 사이트에 접근할 수 있어요. 일부 사이트는 다시 로그인해야 해요.</p>
				<p className="text-xs text-fg-3">Chrome의 원격 디버깅 허용이 필요해요. Windows의 앱 바인딩 보호는 우회하지 않아 가져오지 못할 수 있어요.</p>
				<div className="flex flex-wrap items-center gap-2">
					<label className="text-xs text-fg" htmlFor="chrome-import-profile">Chrome 프로필</label>
					<select id="chrome-import-profile" value={profile} disabled={busy || loading} onChange={(e) => { setProfile(e.target.value); setConfirmed(false); setResult(null); setError(""); }} className="min-w-0 max-w-full flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm text-fg">
						<option value="">{loading ? "프로필을 확인하는 중…" : "프로필을 골라 주세요"}</option>
						{profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
					</select>
					<Button size="sm" variant="ghost" disabled={busy || loading} onClick={() => void load()}>목록 새로고침</Button>
				</div>
				{!loading && !profiles.length ? <p className="text-xs text-fg-3">Chrome 프로필이 없어요. Chrome을 설치하고 프로필을 만든 뒤 목록을 새로고침해 주세요.</p> : null}
				<label className="flex items-start gap-2 text-xs text-fg"><input type="checkbox" checked={confirmed} disabled={!profile || busy || loading} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" /><span>이 프로필의 로그인 정보를 에이전트와 공유하는 데 동의해요.</span></label>
				<Button size="sm" className="self-start" disabled={!profile || !confirmed || busy || loading} onClick={() => void runImport()}>{busy ? "로그인 정보를 가져오는 중…" : "동의하고 로그인 가져오기"}</Button>
				{result ? <p role="status" className="text-xs text-fg">쿠키 {result.imported}개 가져옴 · {result.skipped}개 건너뜀. 필요한 사이트는 브라우저 탭에서 확인해 주세요.</p> : null}
				{error ? <div role="alert" className="break-words text-xs text-status-failed-fg"><p>{error}</p><p>Chrome 권한을 확인한 뒤 다시 시도하거나 브라우저 탭에서 직접 로그인해 주세요.</p></div> : null}
			</div> : <p className="text-xs text-fg-3">브라우저 연결은 최신 데스크톱 앱에서 사용할 수 있어요.</p>}
		</Section>
	);
}
