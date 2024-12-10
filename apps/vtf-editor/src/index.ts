import { firstValueFrom, fromEvent } from "rxjs"
import { mount } from "svelte"
import init from "vtf"
import App from "./App.svelte"
import "./app.css"

const app = mount(App, {
	target: document.getElementById("app")!,
	props: {
		vscode: acquireVsCodeApi<State>(),
		readonly: document.head.querySelector<HTMLMetaElement>("meta[name=readonly]")?.content == "true",
		buf: await Promise.all([
			init(),
			(await firstValueFrom(fromEvent<MessageEvent<Uint8Array>>(window, "message"))).data
		]).then(([_, buf]) => buf)
	}
})

export default app
