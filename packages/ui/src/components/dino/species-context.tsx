import { createContext, type ReactNode, useContext } from "react";
import { DEFAULT_SPECIES, type SpeciesId } from "../../brand/species.ts";

/** The dinosaur theme (ADR 0100) every Dino and DinoMark draws unless it is given an explicit `species`. */
const DinoSpeciesContext = createContext<SpeciesId>(DEFAULT_SPECIES);

export function DinoSpeciesProvider({ species, children }: { species: SpeciesId; children: ReactNode }) {
	return <DinoSpeciesContext.Provider value={species}>{children}</DinoSpeciesContext.Provider>;
}

/** The species of the nearest DinoSpeciesProvider; the T-rex without one. */
export function useDinoSpecies(): SpeciesId {
	return useContext(DinoSpeciesContext);
}
