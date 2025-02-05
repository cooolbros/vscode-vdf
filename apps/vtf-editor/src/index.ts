import { filter, firstValueFrom, fromEvent } from "rxjs"
import { mount } from "svelte"
import init from "vtf-canvas"
import App from "./App.svelte"
import "./app.css"

const vscode = acquireVsCodeApi<State>()

const app = mount(App, {
	target: document.getElementById("app")!,
	props: {
		vscode: vscode,
		readonly: document.head.querySelector<HTMLMetaElement>("meta[name=readonly]")?.content == "true",
		buf: await Promise.all([
			init(),
			new Promise<Uint8Array>(async (resolve) => {
				const promise = firstValueFrom(fromEvent<MessageEvent<Uint8Array>>(window, "message").pipe(filter((message) => message.data instanceof Uint8Array)))
				vscode.postMessage({ type: "buf" })
				const { data } = await promise
				resolve(data)
			})
		]).then(([_, buf]) => buf)
	}
})

export default app
