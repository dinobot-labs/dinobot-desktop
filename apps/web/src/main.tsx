import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";
import { startTypographySync } from "./lib/typography-sync.ts";

const stopTypographySync = startTypographySync(document.documentElement.style);
if (import.meta.hot) import.meta.hot.dispose(stopTypographySync);

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
