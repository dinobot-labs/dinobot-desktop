import { expect, test } from "bun:test";
import { parseAccounts } from "../src/state/accounts.ts";

test("parses /accounts output into pools", () => {
	const pools = parseAccounts(["anthropic  2 accounts, rotates on rate/usage limits", "  * #1  you@x (Org)  active", "    #2  other@y  usage limit for 47m", "openai-codex", "  * #1  oauth  active"].join("\n"));
	expect(pools).toEqual([
		{ key: "anthropic", rotates: true, accounts: [{ id: "1", label: "you@x (Org)", active: true, state: "active" }, { id: "2", label: "other@y", active: false, state: "usage limit for 47m" }] },
		{ key: "openai-codex", rotates: false, accounts: [{ id: "1", label: "oauth", active: true, state: "active" }] },
	]);
	expect(parseAccounts("no stored credentials; /login adds accounts")).toEqual([]);
});
