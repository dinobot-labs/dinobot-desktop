/**
 * UI language. The source text is Korean; `transform.ts` wraps every Korean string literal, template literal and
 * JSX text run at build time in `__t` / `__tf` / `__tj`, and the dictionaries here map that Korean source (with
 * `{0}`, `{1}` placeholders for interpolations) to the other languages. A missing entry falls back to the Korean
 * source, and `test/i18n.test.ts` keeps the English dictionary complete.
 */
import { createElement, Fragment, type ReactNode } from "react";
import { EN } from "./en.ts";

export type Language = "ko" | "en";
export const LANGUAGES: readonly Language[] = ["ko", "en"];

const DICTIONARIES: Record<Language, Readonly<Record<string, string>> | null> = { ko: null, en: EN };

/**
 * The page sets `window.__dnLanguage` in an inline script before any module runs (apps/web/index.html), so text
 * in module scope is already looked up in the right language. Without it (tests, other hosts) the source language.
 */
const preset = (globalThis as { __dnLanguage?: unknown }).__dnLanguage;
let current: Language = preset === "en" || preset === "ko" ? preset : "ko";

/** "ko" / "en" from the setting ("" = follow the OS) and the OS locale (e.g. "ko-KR", "en-US"). */
export function resolveLanguage(setting: string | undefined, osLocale: string | undefined): Language {
	if (setting === "ko" || setting === "en") return setting;
	return /^ko\b/i.test(osLocale ?? "") ? "ko" : "en";
}

export function setLanguage(language: Language): void {
	current = language;
}
export function getLanguage(): Language {
	return current;
}
/** BCP 47 tag for Intl / toLocale* calls in the current language. */
export function localeTag(): string {
	return current === "ko" ? "ko" : "en";
}

function lookup(source: string): string {
	return DICTIONARIES[current]?.[source] ?? source;
}

/** A plain string. */
export function __t(source: string): string {
	return lookup(source);
}

const PLACEHOLDER = /\{(\d+)\}/g;

/** A template literal: `{n}` placeholders filled with String(args[n]) (template literal semantics). */
export function __tf(source: string, args: readonly unknown[]): string {
	return lookup(source).replace(PLACEHOLDER, (_, i: string) => String(args[Number(i)]));
}

const primitive = (v: unknown) => v === null || v === undefined || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/** A JSX text run with embedded expressions: a string when every value is primitive, else a fragment. */
export function __tj(source: string, args: readonly unknown[]): ReactNode {
	const text = lookup(source);
	if (args.every(primitive)) return text.replace(PLACEHOLDER, (_, i: string) => renderPrimitive(args[Number(i)]));
	const parts: ReactNode[] = [];
	let last = 0;
	for (const m of text.matchAll(PLACEHOLDER)) {
		if (m.index > last) parts.push(text.slice(last, m.index));
		parts.push(args[Number(m[1])] as ReactNode);
		last = m.index + m[0].length;
	}
	if (last < text.length) parts.push(text.slice(last));
	return createElement(Fragment, null, ...parts);
}

/** How React renders a primitive child: null, undefined and booleans render nothing. */
function renderPrimitive(v: unknown): string {
	return v === null || v === undefined || typeof v === "boolean" ? "" : String(v);
}
