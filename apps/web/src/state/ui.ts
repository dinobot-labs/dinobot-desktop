import { create } from "zustand";

/** Overlay state of the main window (dialogs and panels other than preferences). */
export const useUi = create<{
	switcherOpen: boolean;
	agentsOpen: boolean;
	dagOpen: boolean;
	askOpen: boolean;
	helpOpen: boolean;
	searchOpen: boolean;
	searchQuery: string;
	findOpen: boolean;
	shortcutsOpen: boolean;
	/** Ctrl+T or a click on the todo caption: the full todo list opens above the composer (TUI T163). */
	todoOpen: boolean;
}>(() => ({
	todoOpen: false,
	switcherOpen: false,
	agentsOpen: false,
	dagOpen: false,
	askOpen: false,
	helpOpen: false,
	searchOpen: false,
	searchQuery: "",
	findOpen: false,
	shortcutsOpen: false,
}));
