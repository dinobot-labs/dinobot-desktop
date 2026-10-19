import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: { dedupe: ["react", "react-dom"] },
	server: { port: 5178, strictPort: true },
	preview: { port: 5179, strictPort: true },
});
