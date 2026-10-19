/**
 * Accounts tab data (TUI /login, /logout, /accounts): provider catalog with "logged in" badges from the login
 * arguments, stored credentials from the logout arguments, account pools parsed from /accounts output.
 */
import type { CommandArgument } from "@dinobot/contracts";
import { create } from "zustand";
import { api, readCommand } from "../lib/api.ts";
import { commandThread } from "./app.ts";

export interface PoolAccount {
	id: string;
	label: string;
	active: boolean;
	state: string;
}
export interface Pool {
	key: string;
	rotates: boolean;
	accounts: PoolAccount[];
}

/** Parses /accounts output: "<key>[  N accounts, rotates…]" then "  * #1  label  state" rows. */
export function parseAccounts(text: string): Pool[] {
	const pools: Pool[] = [];
	for (const raw of text.split(/\r?\n/)) {
		if (!raw.trim() || /no stored credentials/.test(raw)) continue;
		const row = /^\s+(\*)?\s*#(\S+)\s{2,}(.*?)(?:\s{2,}(.*))?$/.exec(raw);
		if (row && pools.length) {
			const [, star, id = "", label = "", state = ""] = row;
			pools.at(-1)?.accounts.push({ id, label: label.trim(), active: Boolean(star), state: state.trim() || (star ? "active" : "") });
			continue;
		}
		if (!/^\s/.test(raw)) {
			const [key = "", ...rest] = raw.trim().split(/\s{2,}/);
			pools.push({ key, rotates: /rotates/.test(rest.join(" ")), accounts: [] });
		}
	}
	return pools;
}

interface AccountsState {
	loading: boolean;
	providers: CommandArgument[];
	stored: CommandArgument[];
	pools: Pool[];
	error?: string;
}

export const useAccounts = create<AccountsState>(() => ({ loading: false, providers: [], stored: [], pools: [] }));

export async function refreshAccounts(): Promise<void> {
	useAccounts.setState({ loading: true });
	const key = commandThread();
	try {
		const [login, logout, accounts] = await Promise.all([
			api.commandArguments("login", key),
			api.commandArguments("logout", key),
			readCommand(key, "accounts"),
		]);
		useAccounts.setState({
			loading: false,
			providers: login.arguments,
			stored: logout.arguments,
			pools: parseAccounts(accounts.lines.map((l) => l.text).join("\n")),
			...(accounts.error ? { error: accounts.error } : {}),
		});
	} catch (error) {
		useAccounts.setState({ loading: false, error: error instanceof Error ? error.message : String(error) });
	}
}
