<script lang="ts">
	import type { VTFEditor } from "client/VTF/VTFEditor"
	import type { WebviewApi } from "vscode-webview"
	import { z } from "zod"
	import VTFViewer from "./VTFViewer.svelte"

	interface Props {
		vscode: WebviewApi<State>
		readonly: boolean
		buf: Uint8Array
	}

	const { vscode, readonly, buf }: Props = $props()

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
	<VTFViewer {readonly} {buf} initial={vscode.getState()} {postMessage} {setState} />
</svelte:boundary>
