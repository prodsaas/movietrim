<script lang="ts">
	import "./layout.css";

	let { children } = $props();
</script>

<svelte:head>
	<title>
		MovieTrim - Trim movies and tv series and hardcode audio and subtitles.
	</title>
	<link rel="icon" href="/favicon.ico" />
</svelte:head>

{@render children()}
