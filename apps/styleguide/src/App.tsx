import { DinoMark, DinoSpeciesProvider, isSpeciesId, SPECIES, SPECIES_IDS, type SpeciesId, Switch, TooltipProvider } from "@dinobot/ui";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { AgentSection } from "./sections/Agent.tsx";
import { AppPreviewSection } from "./sections/AppPreview.tsx";
import { ComponentsSection } from "./sections/Components.tsx";
import { DagSection } from "./sections/Dag.tsx";
import { FoundationsSection } from "./sections/Foundations.tsx";
import { HeroSection } from "./sections/Hero.tsx";
import { ToolsSection } from "./sections/Tools.tsx";

const NAV = [
	["overview", "Overview"],
	["color", "Color"],
	["type", "Type & shape"],
	["motion", "Motion"],
	["dino", "Dino"],
	["shimmer", "Shimmer & status"],
	["components", "Components"],
	["agent", "Agent"],
	["dag", "DAG"],
	["app", "App preview"],
] as const;

function useTheme() {
	const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
	useEffect(() => {
		document.documentElement.classList.toggle("dark", dark);
		try {
			localStorage.setItem("dn-theme", dark ? "dark" : "light");
		} catch {}
	}, [dark]);
	return [dark, setDark] as const;
}

/** The dinosaur theme of the whole guide (ADR 0100): <html data-dino> plus the mascot species. */
function useDino() {
	const [dino, setDino] = useState<SpeciesId>(() => {
		const saved = document.documentElement.dataset.dino;
		return isSpeciesId(saved) ? saved : "rex";
	});
	useEffect(() => {
		document.documentElement.dataset.dino = dino;
		try {
			localStorage.setItem("dn-dino", dino);
		} catch {}
	}, [dino]);
	return [dino, setDino] as const;
}

export function App() {
	const [dark, setDark] = useTheme();
	const [dino, setDino] = useDino();
	return (
		<DinoSpeciesProvider species={dino}>
			<TooltipProvider delay={300}>
				<div className="min-h-screen bg-bg text-fg">
					<aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-line bg-band px-4 py-5 lg:flex">
						<a href="#overview" className="flex items-center gap-2.5 px-2">
							<DinoMark size={22} />
							<span className="text-md font-semibold tracking-[-0.01em]">dinobot</span>
							<span className="font-mono text-micro text-fg-3">design</span>
						</a>
						<nav className="mt-6 flex flex-col gap-0.5">
							{NAV.map(([id, label]) => (
								<a key={id} href={`#${id}`} className="rounded-sm px-2 py-1.5 text-sm text-fg-2 hover:bg-hover hover:text-fg">
									{label}
								</a>
							))}
						</nav>
						<div className="mt-auto flex gap-1 rounded-md border border-line bg-surface p-1" role="radiogroup" aria-label="Dinosaur theme">
							{SPECIES_IDS.map((id) => (
								<button
									key={id}
									type="button"
									role="radio"
									aria-checked={dino === id}
									title={`${SPECIES[id].name.en} · ${SPECIES[id].theme}`}
									onClick={() => setDino(id)}
									className={`flex flex-1 cursor-pointer justify-center rounded-sm py-1.5 ${dino === id ? "bg-accent-tint" : "hover:bg-hover"}`}
								>
									<DinoMark species={id} size={22} />
								</button>
							))}
						</div>
						<label className="mt-2 flex items-center justify-between rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-fg-2">
							<span className="flex items-center gap-1.5">{dark ? <IconMoon size={14} /> : <IconSun size={14} />} {dark ? "Signal Night" : "Signal Paper"}</span>
							<Switch checked={dark} onCheckedChange={setDark} aria-label="Dark theme" />
						</label>
						<div className="mt-3 px-2 font-mono text-micro text-fg-3">@dinobot/ui 0.1.0</div>
					</aside>
					<main className="px-6 py-10 lg:ml-56 lg:px-12">
						<div className="mx-auto max-w-[1080px]">
							<HeroSection />
							<FoundationsSection />
							<ToolsSection />
							<ComponentsSection />
							<AgentSection />
							<DagSection />
							<AppPreviewSection />
						</div>
					</main>
				</div>
			</TooltipProvider>
		</DinoSpeciesProvider>
	);
}
