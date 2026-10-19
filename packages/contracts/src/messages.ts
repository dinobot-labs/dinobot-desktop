/**
 * Model message shapes as they appear on the wire (entries, partial messages, tool results).
 * Mirrored from @earendil-works/pi-ai dist/types.d.ts:24-432 (TextContent .. Message) and
 * dist/auth/types.d.ts:105-152 (AuthPrompt, AuthEvent). Not imported: the desktop has no pi-ai dependency.
 */

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

/** pi-ai types.d.ts:24-25 */
export type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ModelThinkingLevel = "off" | ThinkingLevel;

/** pi-ai types.d.ts:263 */
export type TextContent = { type: "text"; text: string; textSignature?: string };
/** pi-ai types.d.ts:268. `redacted`: provider safety filter hid the text; the opaque payload is in the signature. */
export type ThinkingContent = { type: "thinking"; thinking: string; thinkingSignature?: string; redacted?: boolean };
/** pi-ai types.d.ts:277. `data` is base64 without a data: prefix. */
export type ImageContent = { type: "image"; data: string; mimeType: string };
/**
 * pi-ai types.d.ts:282. While streaming (generation partial, `toolcall_start`/`block` changes) the live daemon also sends
 * provider scratch fields `partialArgs` (raw JSON text so far) and `streamIndex`; `arguments` is the best-effort parse.
 * Covered by synthetic stream replay tests.
 */
export type ToolCall = {
	type: "toolCall";
	id: string;
	name: string;
	arguments: JsonObject;
	thoughtSignature?: string;
	namespace?: string;
	partialArgs?: string;
	streamIndex?: number;
};
export type AssistantContent = TextContent | ThinkingContent | ToolCall;

/** pi-ai types.d.ts:291 */
export type Usage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cacheWrite1h?: number;
	/** Subset of `output`. */
	reasoning?: number;
	totalTokens: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
};

/** pi-ai types.d.ts:313. `pending` only on in-flight partials. */
export type StopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";

/** pi-ai utils/diagnostics.d.ts:8 */
export type AssistantMessageDiagnostic = { type: string; timestamp: number; error?: JsonValue; details?: JsonObject };

/** pi-ai types.d.ts:352. Leading system message = system prompt; later ones patch `sections`/tools. */
export type SystemMessage = {
	role: "system";
	content: string | TextContent[];
	sections?: Record<string, string | null>;
	toolsAdded?: JsonValue[];
	toolsRemoved?: JsonValue[];
	timestamp: number;
};

/**
 * pi-ai types.d.ts:369. Channel input is framed by the daemon as `<from user="U" channel="C"/>\n<text>`
 * (dinobot src/core/input.ts:9-24): a plain string without images, else `[{type:"text", text: header+text}, ...images]`.
 */
export type UserMessage = { role: "user"; content: string | (TextContent | ImageContent)[]; timestamp: number };

/** pi-ai types.d.ts:374 */
export type AssistantMessage = {
	role: "assistant";
	content: AssistantContent[];
	api: string;
	provider: string;
	model: string;
	responseModel?: string;
	responseId?: string;
	providerThinkingLevel?: string;
	thinkingLevel?: ModelThinkingLevel;
	diagnostics?: AssistantMessageDiagnostic[];
	usage: Usage;
	stopReason: StopReason;
	deferred?: JsonObject;
	errorMessage?: string;
	rawStopReason?: string;
	endTurn?: boolean;
	timestamp: number;
};

/** pi-ai types.d.ts:393-420 */
export type NestedToolCallRecord = {
	id: string;
	name: string;
	arguments?: JsonObject;
	argumentsBytes?: number;
	status: "ok" | "error" | "unfinished";
	durationMs?: number;
	error?: string;
};

/** pi-ai types.d.ts:420. `details` is tool-specific JSON (see ui-contract.ts for the ones the UI reads). */
export type ToolResultMessage = {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: (TextContent | ImageContent)[];
	details?: JsonValue;
	usage?: Usage;
	nestedCalls?: { calls: NestedToolCallRecord[]; complete: boolean };
	isError: boolean;
	timestamp: number;
};

/** pi-ai types.d.ts:432 */
export type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

/** pi-ai auth/types.d.ts:132. Login progress a command run forwards in `{type:"auth"}` events. */
export type AuthEvent =
	| { type: "info"; message: string; links?: readonly { url: string; label?: string }[] }
	| { type: "auth_url"; url: string; instructions?: string }
	| { type: "device_code"; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number }
	| { type: "progress"; message: string };
