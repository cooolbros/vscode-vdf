<script lang="ts">
	import type { VTFEditor } from "client/VTF/VTFEditor"
	import type { WebviewApi } from "vscode-webview"
	import { z } from "zod"
	import VTFViewer from "./VTFViewer.svelte"

	interface Props {
		vscode: WebviewApi<{ flags: number; scale: number }>
		buf: Uint8Array
	}

	const { vscode, buf }: Props = $props()

	function postMessage(message: z.input<(typeof VTFEditor)["commandSchema"]>) {
		vscode.postMessage(message)
	}

	function setState(newState: State) {
		vscode.setState(newState)
	}
</script>

<svelte:boundary
	onerror={(error) => postMessage({ type: "showErrorMessage", message: (error as Error).message, items: [] })}
>
	<VTFViewer {buf} initial={vscode.getState()} {postMessage} {setState} />
</svelte:boundary>
