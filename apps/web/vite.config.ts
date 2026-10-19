import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { dinobotI18n } from "../../packages/ui/src/i18n/vite.ts";

const daemonPort = Number(process.env.DINOBOT_API_PORT ?? 8786);

export default defineConfig({
	base: "./",
	plugins: [dinobotI18n(), react(), tailwindcss()],
	resolve: { dedupe: ["react", "react-dom"] },
	server: {
		port: 5180,
		strictPort: true,
		// The browser dev build reaches the daemon same-origin, like the packaged app does through dinobot-app://app/daemon.
		proxy: { "/daemon": { target: `http://127.0.0.1:${daemonPort}`, rewrite: (p) => p.replace(/^\/daemon/, ""), changeOrigin: true } },
	},
	build: { target: "chrome130", sourcemap: false, chunkSizeWarningLimit: 1500 },
});
