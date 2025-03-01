<script lang="ts">
	import type { VTFEditor } from "client/VTF/VTFEditor"
	import { distinctUntilChanged, filter, fromEvent, map, merge, Observable, scan, startWith, switchMap } from "rxjs"
	import { toStore } from "svelte/store"
	import { VTF, VTFImageFormat, VTFPutImageData } from "vtf-canvas"
	import { z } from "zod"

	interface Props {
		readonly: boolean
		buf: Uint8Array
		initial: State | undefined
		postMessage: (message: z.input<(typeof VTFEditor)["commandSchema"]>) => void
		setState(newState: State): void
	}

	const { readonly, buf, initial, postMessage, setState }: Props = $props()

	const vtf = new VTF(buf)
	const { width, height } = vtf.header

	let flags = $state(initial?.flags ?? vtf.header.flags)
	let frame = $state(initial?.frame ?? vtf.header.first_frame)

	function setFrame(value: number) {
		frame = value > 0 && value < vtf.header.frames ? value : value == vtf.header.frames ? 0 : vtf.header.frames - 1
	}

	function onmessage(event: MessageEvent) {
		const flagsCommandSchema = z.object({ type: z.literal("flags"), flags: z.number() })
		const result = flagsCommandSchema.safeParse(event.data)
		if (result.success) {
			flags = result.data.flags
		}
	}

	$effect(() => {
		setState({ flags: flags, frame: frame, scale: $scale$ })
	})

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
		fromEvent<MessageEvent>(window, "message").pipe(
			map((event) => z.object({ type: z.literal("scale"), value: z.number() }).safeParse(event.data)),
			filter((result) => result.success),
			map((result) => ({ set: true, value: result.data.value })),
		),
	).pipe(
		scan((scale, command) => {
			return Math.max(10, Math.min(200, command.set ? command.value : scale + command.value))
		}, initial?.scale ?? 100),
		startWith(initial?.scale ?? 100),
		distinctUntilChanged(),
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

	// svelte-ignore non_reactive_update
	let i = 0

	$effect(() => {
		postMessage({ type: "scale", scale: $scale$ })
	})

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
						postMessage({
							type: "unsupportedVTFFormat",
							format: error.message.replace("FormatError", "").slice(1, -1),
						})
					} else {
						postMessage({
							type: "showErrorMessage",
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
</script>

<svelte:window {onmessage} />

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
					{@render row("Width", vtf.header.width)}
					{@render row("Height", vtf.header.height)}
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
								postMessage({ type: "flags", label: label!, value })
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
