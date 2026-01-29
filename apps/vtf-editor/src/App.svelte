<script lang="ts">
	import type { VTFEditor } from "client/VTF/VTFEditor"
	import { createTRPCClient } from "common/web/TRPCClient"
	import {
		distinctUntilChanged,
		filter,
		fromEvent,
		map,
		merge,
		Observable,
		scan,
		share,
		startWith,
		switchMap,
	} from "rxjs"
	import { toStore } from "svelte/store"
	import init, { VTF, VTFImageFormat, VTFPutImageData } from "vtf-canvas"

	type AppRouter = ReturnType<VTFEditor["router"]>

	const uri = document.head.querySelector<HTMLMetaElement>("meta[name=uri]")!.content
	const readonly = document.head.querySelector<HTMLMetaElement>("meta[name=readonly]")?.content == "true"

	const vscode = acquireVsCodeApi<State>()
	const initial = vscode.getState()

	const { trpc, contextMenu$ } = createTRPCClient<AppRouter>(vscode)

	const vtf = await Promise.all([trpc.buf.query(), init()]).then(([buf]) => new VTF(buf))
	const { width, height } = vtf.header

	let flags = $state(initial?.flags ?? vtf.header.flags)
	trpc.flags.events.subscribe(undefined, {
		onData: (value) => (flags = value),
	})

	let frame = $state(initial?.frame ?? vtf.header.first_frame)
	function setFrame(value: number) {
		frame = value > 0 && value < vtf.header.frames ? value : value == vtf.header.frames ? 0 : vtf.header.frames - 1
	}

	let canvas = $state<HTMLCanvasElement>()

	const scale$ = merge(
		merge(
			new Observable<HTMLCanvasElement | undefined>((subscriber) => {
				return toStore(() => canvas).subscribe((canvas) => subscriber.next(canvas))
			}).pipe(
				filter((canvas) => canvas != undefined),
				switchMap((canvas) => {
					return fromEvent<MouseEvent>(canvas, "click").pipe(map((event) => (event.ctrlKey ? -1 : 1)))
				}),
			),
			fromEvent<WheelEvent>(document, "wheel").pipe(
				filter((event) => event.ctrlKey),
				map((event) => (event.deltaY < 0 ? 1 : -1)),
			),
		).pipe(map((value) => ({ set: false, value: value * 10 }))),
		new Observable<number>((subscriber) => {
			trpc.scale.events.subscribe(undefined, {
				onData: (value) => subscriber.next(value),
				onError: (err) => subscriber.error(err),
				onComplete: () => subscriber.complete(),
			})
		}).pipe(map((value) => ({ set: true, value: value }))),
	).pipe(
		scan((scale, command) => {
			return Math.max(10, Math.min(200, command.set ? command.value : scale + command.value))
		}, initial?.scale ?? 100),
		startWith(initial?.scale ?? 100),
		distinctUntilChanged(),
		share(),
	)

	const ctrl$ = merge(
		fromEvent<KeyboardEvent>(window, "keydown").pipe(
			filter((event) => event.key == "Control"),
			map(() => true),
		),
		fromEvent<KeyboardEvent>(window, "keyup").pipe(
			filter((event) => event.key == "Control"),
			map(() => false),
		),
	).pipe(startWith(false))

	$effect(() => {
		vscode.setState({ flags: flags, frame: frame, scale: $scale$ })
	})

	$effect(() => {
		trpc.scale.set.mutate($scale$)
	})

	// svelte-ignore non_reactive_update
	let i = 0

	function extract(node: HTMLCanvasElement, { vtf, frame }: { vtf: VTF; frame: number }) {
		function paint(frame: number) {
			const context = node.getContext("2d")!
			context.reset()
			VTFPutImageData(vtf, context, vtf.header.mipmap_count - 1, frame)
		}

		setTimeout(() => {
			try {
				paint(frame)
			} catch (error) {
				console.error(error)
				if (error instanceof Error) {
					if (error.message.startsWith("FormatError")) {
						trpc.unsupportedVTFFormat.mutate({
							format: error.message.replace("FormatError", "").slice(1, -1),
						})
					} else {
						trpc.showErrorMessage.query({
							message: error.message,
							items: [],
						})
					}
				}
			}
			node.style.display = "block"
		}, 0)

		return {
			update({ frame }: { vtf: VTF; frame: number }) {
				paint(frame)
			},
		}
	}

	contextMenu$.subscribe(async (message) => {
		switch (message.command) {
			case "vscode-vdf.VTFEditorSaveImageAs":
				await saveImageAs()
				break
			case "vscode-vdf.VTFEditorCopyImage":
				await copyImage()
				break
		}
	})

	async function saveImageAs() {
		const [uri, buf] = await Promise.all([
			trpc.showSaveDialog.query(),
			save().then(async (blob) => new Uint8Array(await blob.arrayBuffer())),
		])
		if (uri) {
			await trpc.save.mutate({ uri: uri, buf: buf })
		}
	}

	async function copyImage() {
		focus()
		const blob = await save()
		await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
	}

	async function save() {
		return new Promise<Blob>((resolve) => {
			canvas!.toBlob((blob) => resolve(blob!), "image/png", 1)
		})
	}
</script>

<div id="container">
	<div>
		<fieldset>
			<legend>File Info</legend>
			<table>
				{#snippet row(name: string, value: any)}
					<tr>
						<td>{name}:</td>
						<td>{value}</td>
					</tr>
				{/snippet}
				<tbody>
					{@render row("Version", `${vtf.header.version_major}.${vtf.header.version_minor}`)}
					{@render row("Format", VTFImageFormat[vtf.header.high_res_image_format])}
					{@render row("Width", width)}
					{@render row("Height", height)}
					{@render row("Flags", flags)}
					{#if vtf.header.frames > 1}
						{@render row("Frames", vtf.header.frames)}
						<tr>
							<td>Frame:</td>
							<td>
								<input type="number" bind:value={() => frame, setFrame} />
							</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</fieldset>
	</div>
	<div id="vtf-container">
		<canvas
			style:display="none"
			{width}
			{height}
			data-vscode-context={JSON.stringify({ uri: uri, webviewSection: "canvas" })}
			bind:this={canvas}
			use:extract={{ vtf, frame }}
			class="zoom-{$ctrl$ ? 'out' : 'in'}"
			style:transform="scale({$scale$}%)"
		></canvas>
	</div>
	<div>
		<fieldset>
			<legend>Flags</legend>

			{#snippet checkbox(label: string | null)}
				{@const id = label?.replaceAll(/\s/g, "-").toLowerCase()}
				{@const value = 1 << i++}
				{@const unused = id == null}
				<div class="checkbox-container" class:readonly={readonly || unused} class:unused>
					<label for={id}>
						<input
							type="checkbox"
							{id}
							checked={id != null && (flags & value) == value}
							tabindex={id != null ? 0 : -1}
							onchange={() => {
								flags ^= value
								trpc.flags.set.mutate({ label: label!, value: value })
							}}
						/>
						<span>{label ?? "Unused"}</span>
					</label>
				</div>
			{/snippet}

			<div>
				{@render checkbox("Point Sample")}
				{@render checkbox("Trilinear")}
				{@render checkbox("Clamp S")}
				{@render checkbox("Clamp T")}
				{@render checkbox("Anisotropic")}
				{@render checkbox("Hint DXT5")}
				{@render checkbox("SRGB")}
				{@render checkbox("Normal Map")}
				{@render checkbox("No Mipmap")}
				{@render checkbox("No Level Of Detail")}
				{@render checkbox("No Minimum Mipmap")}
				{@render checkbox("Procedural")}
				{@render checkbox("One Bit Alpha")}
				{@render checkbox("Eight Bit Alpha")}
				{@render checkbox("Environment Map")}
				{@render checkbox("Render Target")}
				{@render checkbox("Depth Render Target")}
				{@render checkbox("No Debug Override")}
				{@render checkbox("Single Copy")}
				{@render checkbox(null)}
				{@render checkbox(null)}
				{@render checkbox(null)}
				{@render checkbox(null)}
				{@render checkbox("No Depth Buffer")}
				{@render checkbox(null)}
				{@render checkbox("Clamp U")}
				{@render checkbox("Vertex Texture")}
				{@render checkbox("SSBump")}
				{@render checkbox("Clamp All")}
			</div>
		</fieldset>
	</div>
</div>

<style>
	div#container {
		display: grid;
		grid-template-columns: min-content 1fr;
		grid-template-rows: auto minmax(0, 1fr);
		gap: 0.5rem;
		margin: 0.25rem 0.5rem 0.5rem 0.5rem;
		height: calc(100vh - 1rem);

		> div {
			max-height: 100%;
		}

		fieldset {
			border: 1px solid rgba(0, 0, 0, 0.2);
			border-radius: 4px;
			padding: 5px 0.5rem 0.5rem 0.5rem;
			max-height: 100%;

			legend {
				font-size: 14px;
				margin-left: 0.5rem;
			}

			table {
				width: 100%;
				table-layout: fixed;
				margin: 0;

				td {
					width: 50%;

					input[type="number"] {
						color: var(--vscode-editor-foreground);
						width: 100%;
						background: none;
						border: none;
						border-radius: 2px;

						&::-webkit-inner-spin-button,
						&::-webkit-outer-spin-button {
							opacity: 1;
						}
					}

					/* app.css */
				}
			}

			> div {
				height: 100%;
				overflow: hidden scroll;
				scrollbar-width: thin;

				div.checkbox-container {
					label {
						display: flex;
						align-items: center;
						gap: 5px;
						cursor: pointer;
					}

					> * {
						display: block;
					}
					span {
						width: 100%;
						padding-right: 2rem;
						white-space: nowrap;
					}

					&.unused {
						opacity: 0.2;
					}

					&.readonly {
						cursor: not-allowed;
						label {
							pointer-events: none;
						}
					}
				}
			}
		}

		div#vtf-container {
			grid-row: span 2;
			margin-top: 9px;
			overflow: auto;

			:global(canvas) {
				--max: 90%;
				max-width: var(--max);
				max-height: var(--max);
				background-image: linear-gradient(
						45deg,
						rgb(20, 20, 20) 25%,
						transparent 25%,
						transparent 75%,
						rgb(20, 20, 20) 75%,
						rgb(20, 20, 20)
					),
					linear-gradient(
						45deg,
						rgb(20, 20, 20) 25%,
						transparent 25%,
						transparent 75%,
						rgb(20, 20, 20) 75%,
						rgb(20, 20, 20)
					);
				background-position:
					0 0,
					8px 8px;
				background-size: 16px 16px;
				transform-origin: top left;

				&.zoom-in {
					cursor: zoom-in;
				}

				&.zoom-out {
					cursor: zoom-out;
				}
			}
		}
	}
</style>
