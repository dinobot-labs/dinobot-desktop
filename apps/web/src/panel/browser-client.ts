import type { BrowserReply, BrowserUiAction, BrowserUiBridge } from "../../../desktop/src/browser-types.ts";
import { desktop } from "../lib/bridge.ts";

export type BrowserCall = (action: BrowserUiAction, args?: Record<string, unknown>) => Promise<BrowserReply>;

/** One queue shared by the panel and settings. Transactions cannot be interrupted by frame polling. */
export class BrowserClient {
	private tail: Promise<unknown> = Promise.resolve();
	pending = 0;
	constructor(private readonly transport: BrowserCall) {}
	transaction<T>(run: (call: BrowserCall) => Promise<T>): Promise<T> {
		if (this.pending >= 64) return Promise.reject(new Error("브라우저 입력이 밀렸어요. 잠시 뒤 다시 시도해 주세요."));
		this.pending++;
		const result = this.tail.then(() => run(async (action, args) => {
			const reply = await this.transport(action, args);
			if (!reply.ok) throw new Error(reply.error || "브라우저 요청을 처리하지 못했어요. 연결과 Chrome 원격 디버깅 권한을 확인해 주세요.");
			return reply;
		}));
		this.tail = result.catch(() => undefined);
		return result.finally(() => { this.pending--; });
	}
	request(action: BrowserUiAction, args?: Record<string, unknown>): Promise<BrowserReply> {
		return this.transaction((call) => call(action, args));
	}
}

const bridge = desktop as (typeof desktop & Partial<BrowserUiBridge>);
export const browserAvailable = typeof bridge?.browserCall === "function";
export const browserClient = new BrowserClient(async (action, args) => {
	if (!bridge?.browserCall) throw new Error("브라우저 연결은 최신 데스크톱 앱에서 사용할 수 있어요.");
	return bridge.browserCall(action, args);
});

/** Cookie consent is never inferred. The source is only an opaque profile id, never a path or cookie value. */
export function importChromeProfile(client: BrowserClient, profile: string, confirmed: boolean): Promise<BrowserReply> {
	if (!profile || !confirmed) return Promise.reject(new Error("Chrome 프로필을 고르고 로그인 정보 접근에 동의해 주세요."));
	return client.transaction(async (call) => {
		const before = (await call("state")).state;
		if (!before) throw new Error("브라우저 제어 상태를 확인하지 못했어요. 다시 연결한 뒤 시도해 주세요.");
		const takeover = await call("takeover");
		if (takeover.state?.control !== "user") throw new Error("직접 조작 권한을 얻지 못해 가져오기를 중단했어요.");
		let imported: BrowserReply | undefined;
		let failure: unknown;
		try { imported = await call("import", { profile, confirmed: true }); } catch (error) { failure = error; }
		if (before.control === "agent") {
			try { await call("resume"); } catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				throw new Error(`가져온 쿠키 ${imported?.imported ?? 0}개 · 에이전트에게 제어를 돌려주지 못했어요. 브라우저 탭에서 다시 넘겨 주세요. ${detail}`);
			}
		}
		if (failure) throw failure;
		if (!imported || !Number.isInteger(imported.imported) || (imported.imported ?? 0) <= 0) throw new Error(`가져온 쿠키가 없어요. 건너뜀 ${imported?.skipped ?? 0}개. Chrome 원격 디버깅 권한을 확인하거나 브라우저에서 다시 로그인해 주세요.`);
		return imported;
	});
}
