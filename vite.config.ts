import { defineConfig, loadEnv } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const PORT = parseInt(env.PORT || '5000', 10);

	return {
		server: {
			port: PORT,
			strictPort: true
		},
		plugins: [
			sveltekit({
				compilerOptions: {
					runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				adapter: adapter({ precompress: true }),
				csrf: { trustedOrigins: ["*"] }
			}),
			tailwindcss()
		]
	}
});
