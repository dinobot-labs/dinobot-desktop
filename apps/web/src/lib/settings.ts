import { DEFAULT_SPECIES, isSpeciesId, type SpeciesId } from "@dinobot/ui/brand";
import { create } from "zustand";
import { GENERAL_ID, normalizePath } from "../state/projects.ts";
import { DEFAULT_FONT_SIZE, type FontFamilySetting, normalizeTypography } from "./typography.ts";

export type ThemeSetting = "system" | "light" | "dark";
export type DagViewSetting = "rail" | "graph";

export interface Settings {
	theme: ThemeSetting;
	/** Dinosaur theme (ADR 0100): the mascot species and the accent family. */
	dino: SpeciesId;
	fontFamily: FontFamilySetting;
	/** Chat body size in px; the rest of the interface scales proportionally. */
	fontSize: number;
	/** Working directory for new threads; null lets the daemon use its workspaceRoot. */
	defaultCwd: string | null;
	/** Sidebar-only folder removal; conversations and files are never deleted. */
	hiddenProjects: string[];
	/** Right work panel; starts collapsed, then the last Ctrl+B choice persists. */
	panelOpen: boolean;
	panelWidth: number;
	sidebarWidth: number;
	/** Work panel DAG view; graph by default. Renamed from `dagView` so the old saved `"rail"` default does not carry over. */
	dagLayout: DagViewSetting;
	notifications: boolean;
	/** Shown as the sender in `<from user=...>`. */
	userName: string;
	/** Ctrl+E: thinking blocks expanded by default. Renamed from `showThinking` so the old saved `true` default does not carry over. */
	thinkingExpanded: boolean;
	/** Ctrl+O: tool rows expanded by default. */
	toolsExpanded: boolean;
	/** Sent with every command (setup copy language). Empty = the OS locale. */
	locale: string;
	showHints: boolean;
}

const KEY = "dn-settings";
const DEFAULTS: Settings = {
	theme: "system",
	dino: DEFAULT_SPECIES,
	fontFamily: "default",
	fontSize: DEFAULT_FONT_SIZE,
	defaultCwd: null,
	hiddenProjects: [],
	panelOpen: false,
	panelWidth: 360,
	sidebarWidth: 260,
	dagLayout: "graph",
	notifications: true,
	userName: "local",
	thinkingExpanded: false,
	toolsExpanded: false,
	locale: "",
	showHints: true,
};

export function loadSettings(): Settings {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
		const { showThinking: _legacy, dagView: _legacyDag, ...saved } = (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Partial<Settings> : {}) as Partial<Settings> & { showThinking?: unknown; dagView?: unknown };
		return { ...DEFAULTS, ...saved, hiddenProjects: Array.isArray(saved.hiddenProjects) ? [...new Set(saved.hiddenProjects.filter((id): id is string => typeof id === "string" && id !== GENERAL_ID && id.trim() !== "").map(normalizePath))] : [], ...normalizeTypography(saved), dino: isSpeciesId(saved.dino) ? saved.dino : DEFAULT_SPECIES };
	} catch {
		return DEFAULTS;
	}
}

export const useSettings = create<Settings & { set: (patch: Partial<Settings>) => void }>((set) => ({
	...loadSettings(),
	set: (patch) =>
		set((state) => {
			const next = { ...state, ...patch, ...normalizeTypography({ ...state, ...patch }) };
			if (!isSpeciesId(next.dino)) next.dino = DEFAULT_SPECIES;
			const { set: _ignored, ...persisted } = next;
			try {
				localStorage.setItem(KEY, JSON.stringify(persisted));
				if (patch.theme) localStorage.setItem("dn-theme", patch.theme);
				// Read by index.html before the first paint, like dn-theme.
				if (patch.dino) localStorage.setItem("dn-dino", next.dino);
			} catch {}
			return next;
		}),
}));

/** The only folder visibility transition. It changes a local preference, never thread or filesystem state. */
export function setProjectHidden(path: string, hidden: boolean): void {
	const id = normalizePath(path);
	if (!id || id === GENERAL_ID) return;
	const state = useSettings.getState();
	const next = new Set(state.hiddenProjects);
	if (hidden) next.add(id);
	else next.delete(id);
	state.set({ hiddenProjects: [...next] });
}

/** Thread titles the daemon does not keep: the first line of the opening message, remembered per key. */
const TITLES = "dn-titles";
export function threadTitles(): Record<string, string> {
	try {
		return JSON.parse(localStorage.getItem(TITLES) ?? "{}") as Record<string, string>;
	} catch {
		return {};
	}
}
export function rememberTitle(key: string, text: string): boolean {
	const title = text.replace(/\s+/g, " ").trim().slice(0, 80);
	if (!title) return false;
	const titles = threadTitles();
	if (titles[key] === title) return false;
	titles[key] = title;
	try {
		localStorage.setItem(TITLES, JSON.stringify(titles));
	} catch {}
	return true;
}

function readJson<T>(key: string, fallback: T): T {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
		return value === null ? fallback : (value as T);
	} catch {
		return fallback;
	}
}

/**
 * Working folder this app bound for a thread (POST /workspace), per key. Daemons before `SessionStatus.cwd` do not
 * report it, so the sidebar falls back to this to place threads made here in their project.
 */
const CWDS = "dn-thread-cwd";
export function threadCwds(): Record<string, string> {
	return readJson<Record<string, string>>(CWDS, {});
}
export function rememberCwd(key: string, cwd: string): boolean {
	const cwds = threadCwds();
	if (cwds[key] === cwd) return false;
	cwds[key] = cwd;
	try {
		localStorage.setItem(CWDS, JSON.stringify(cwds));
	} catch {}
	return true;
}

/** Sidebar projects the person folded, by project id. */
const COLLAPSED = "dn-projects-collapsed";
export function collapsedProjects(): string[] {
	const value = readJson<unknown>(COLLAPSED, []);
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
export function saveCollapsedProjects(ids: readonly string[]): void {
	try {
		localStorage.setItem(COLLAPSED, JSON.stringify([...new Set(ids)]));
	} catch {}
}
