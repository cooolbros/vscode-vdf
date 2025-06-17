<script module lang="ts">
	import { type Readable } from "svelte/store"

	function fromReadable<T>(store: Readable<T>): Observable<T> {
		return new Observable<T>((subscriber) => store.subscribe((value) => subscriber.next(value)))
	}
</script>

<script lang="ts">
	import "@vscode/codicons/dist/codicon.ttf"
	import type { HUDEnemyData, WaveStatus } from "client/commands/showWaveStatusPreviewToSide"
	import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
	import { combineLatest, concatMap, map, Observable, of, share, shareReplay, switchMap } from "rxjs"
	import { toStore } from "svelte/store"
	import { contextMenu$, trpc } from "./TRPCClient"

	const SCALE = 6

	const CREDITS_GREEN = "rgb(94 150 49)"
	const RED_SOLID = "rgb(192 28 0)"
	const TAN_LIGHT = "rgb(235 226 202)"

	const WAVE_HEIGHT = 70 * SCALE

	const images = new Map<string, Observable<ImageBitmap | null>>()

	let canvas: HTMLCanvasElement = $state()!

	const image = (path: string) => {
		return new Observable<{ width: number; height: number; buf: Uint8Array } | null>((subscriber) => {
			return trpc.png.subscribe(
				{ path },
				{
					onData: (value) => subscriber.next(value),
					onError: (err) => subscriber.error(err),
					onComplete: () => subscriber.complete(),
				},
			)
		}).pipe(
			concatMap(async (png) => {
				if (!png) {
					return null
				}

				return {
					width: png.width,
					height: png.height,
					image: await createImageBitmap(new Blob([png.buf], { type: "image/png" })),
				}
			}),
			shareReplay(1),
		)
	}

	const font = (path: string, name: string) => {
		return new Observable<Uint8Array | null>((subscriber) => {
			return trpc.font.subscribe(
				{ path },
				{
					onData: (value) => subscriber.next(value),
					onError: (err) => subscriber.error(err),
					onComplete: () => subscriber.complete(),
				},
			)
		}).pipe(
			concatMap(async (buf) => {
				if (buf) {
					document.fonts.add(await new FontFace(name, buf).load())
				}
			}),
		)
	}

	const data$ = combineLatest({
		canvas: fromReadable(toStore(() => canvas)),
		skyname: new Observable<{ width: number; height: number; buf: Uint8Array } | null>((subscriber) => {
			return trpc.skyname.subscribe(undefined, {
				onData: (value) => subscriber.next(value),
				onError: (err) => subscriber.error(err),
				onComplete: () => subscriber.complete(),
			})
		}).pipe(
			concatMap(async (png) => {
				if (!png) {
					return null
				}

				return {
					width: png.width,
					height: png.height,
					image: await createImageBitmap(new Blob([png.buf], { type: "image/png" })),
				}
			}),
		),
		leaderboard_class_critical: image("materials/hud/leaderboard_class_critical.vmt"),
		tournament_panel_blu: image("materials/hud/tournament_panel_blu.vmt"),
		tournament_panel_brown: image("materials/hud/tournament_panel_brown.vmt"),
		tournament_panel_tan: image("materials/hud/tournament_panel_tan.vmt"),
		font: combineLatest([
			font("resource/tf2build.ttf", "TF2 Build"),
			font("resource/tf2secondary.ttf", "TF2 Secondary"),
		]),
		configuration: new Observable<VSCodeVDFConfiguration["popfile"]["waveStatusPreview"]>((subscriber) => {
			return trpc.configuration.subscribe(undefined, {
				onData: (value) => subscriber.next(value),
				onError: (err) => subscriber.error(err),
				onComplete: () => subscriber.complete(),
			})
		}),
		data: new Observable<WaveStatus>((subscriber) => {
			return trpc.waveStatus.subscribe(undefined, {
				onData: (value) => subscriber.next(value),
				onError: (err) => subscriber.error(err),
				onComplete: () => subscriber.complete(),
			})
		}).pipe(
			switchMap((waveStatus) => {
				const icons = new Set(
					waveStatus.waves
						.values()
						.flatMap((wave) => [...wave.icons.miniboss, ...wave.icons.normal, ...wave.icons.support])
						.map((icon) => icon.classIconName)
						.filter((path) => path != null),
				)

				if (!icons.size) {
					return of({ waveStatus: waveStatus, icons: {} as Record<string, ImageBitmap | null> })
				}

				for (const path of icons.values().filter((path) => !images.has(path))) {
					images.set(path, image(path).pipe(map((png) => png?.image ?? null)))
				}

				return combineLatest(Object.fromEntries(icons.values().map((path) => [path, images.get(path)!]))).pipe(
					map((icons) => ({ waveStatus, icons })),
				)
			}),
		),
	}).pipe(share())

	data$.subscribe(
		({
			canvas,
			skyname,
			leaderboard_class_critical,
			tournament_panel_blu,
			tournament_panel_brown,
			tournament_panel_tan,
			configuration,
			data: { waveStatus, icons },
		}) => {
			const context = canvas.getContext("2d")!
			context.reset()
			context.imageSmoothingEnabled = true
			context.textRendering = "optimizeLegibility"

			const { starting, waves } = waveStatus

			const widths = waves.map((wave) => {
				const count = Math.min(
					wave.icons.miniboss.length + wave.icons.normal.length + wave.icons.support.length,
					24,
				)

				const enemy = count * 20
				const spacer = (count - 1) * 5
				const separator = wave.icons.support.length > 0 ? 1 + 5 : 0
				const total = enemy + spacer + separator

				const needed = total
				return needed
			})

			let width = Math.max(200, ...widths)

			context.beginPath()
			context.font = `400 ${11 * SCALE}px/1 '${configuration.font.bold}'`
			const supportText = context.measureText("Support")

			// Expand width for Support label
			for (const wave of waves.values().filter((wave) => wave.icons.support.length > 0)) {
				const enemyTotal = Math.min(24, wave.icons.miniboss.length + wave.icons.normal.length)
				const enemyWidth = enemyTotal * 20 + (enemyTotal - 1) * 5

				const supportTotal = Math.min(24, wave.icons.support.length)
				const supportWidth = supportTotal * 20 + (supportTotal - 1) * 5

				const barWidth = 5 + 1 + 5

				const totalWidth = enemyWidth + barWidth + supportWidth

				const startX = width / 2 - totalWidth / 2

				const supportX = startX + enemyWidth + barWidth

				const supportEnd = supportX + supportText.width / SCALE

				if (supportEnd > width) {
					const delta = supportEnd - width + 5 * 1.5
					width += delta * 2
				}
			}

			canvas.width = (width + 5 * 3) * SCALE
			canvas.height = WAVE_HEIGHT * waves.length

			canvas.style.width = `${canvas.width / (SCALE / 2)}px`
			canvas.style.height = `${canvas.height / (SCALE / 2)}px`

			context.fillStyle = configuration.background.colour
			context.fillRect(0, 0, canvas.width, canvas.height)

			if (configuration.background.sky && skyname != null) {
				const r = Math.max(canvas.width / skyname.width, canvas.height / skyname.height)
				const width = skyname.width * r
				const height = skyname.height * r

				context.drawImage(
					skyname.image,
					0,
					0,
					skyname.width,
					skyname.height,
					canvas.width / 2 - width / 2,
					canvas.height / 2 - height / 2,
					width,
					height,
				)
			}

			for (const [index, wave] of waves.entries()) {
				const y = WAVE_HEIGHT * index

				// Background
				if (configuration.panel.enable) {
					drawSourceImage(
						context,
						tournament_panel_brown!.image,
						{ width: 128, height: 128, corner: 22 },
						{
							x: 0,
							y: y,
							width: canvas.width,
							height: WAVE_HEIGHT,
							corner: 5 * SCALE,
						},
					)
				}

				const labelY = y + 6 * SCALE + (15 / 2) * SCALE

				// WaveCountLabel
				context.beginPath()
				context.font = `${11 * SCALE}px/1 '${configuration.font.bold}'`
				context.fillStyle = TAN_LIGHT
				context.textAlign = "center"
				context.textBaseline = "middle"
				context.letterSpacing = "2px"
				const waveCountLabelText = `Wave ${index + 1} / ${waves.length}`
				const waveCountLabelWidth = context.measureText(waveCountLabelText)
				context.fillText(waveCountLabelText, canvas.width / 2, labelY)
				context.letterSpacing = "0px"

				// Wave Currency
				context.beginPath()
				context.font = `400 ${11 * SCALE}px/1 '${configuration.font.bold}'`
				context.fillStyle = CREDITS_GREEN
				context.textAlign = "left"
				context.textBaseline = "middle"
				context.fillText(
					`$${wave.currency}`,
					canvas.width / 2 + waveCountLabelWidth.width / 2 + 5 * SCALE,
					labelY,
				)

				// ProgressBarBG
				drawSourceImage(
					context,
					tournament_panel_tan!.image,
					{ width: 64, height: 64, corner: 22 },
					{
						x: canvas.width / 2 - (180 * SCALE) / 2,
						y: y + 19 * SCALE,
						width: 180 * SCALE,
						height: 12 * SCALE,
						corner: 5 * SCALE,
					},
				)

				// ProgressBar
				drawSourceImage(
					context,
					tournament_panel_blu!.image,
					{ width: 64, height: 64, corner: 22 },
					{
						x: canvas.width / 2 - (178 * SCALE) / 2,
						y: y + 20 * SCALE,
						width: Math.floor(178 * wave.percentage * SCALE),
						height: 10 * SCALE,
						corner: 5 * SCALE,
					},
				)

				let x = (() => {
					const count = Math.min(24, wave.icons.miniboss.length + wave.icons.normal.length)
					let width = count * 20 + (count - 1) * 5

					if (wave.icons.support.length > 0) {
						width += 5 + 1 + 5
						width += wave.icons.support.length * 20
						width += (wave.icons.support.length - 1) * 5
					}

					return canvas.width / 2 - (width * SCALE) / 2
				})()

				function EnemyCountPanel(icon: HUDEnemyData, x: number, y: number, count: boolean) {
					// EnemyCountCritImageBG
					if (icon.alwayscrit) {
						context.drawImage(leaderboard_class_critical!.image, x + 1 * SCALE, y, 18 * SCALE, 18 * SCALE)
					}

					// EnemyCountImageBG
					context.beginPath()
					context.fillStyle = icon.miniboss ? RED_SOLID : TAN_LIGHT
					context.roundRect(x + 2 * SCALE, y + 1 * SCALE, 16 * SCALE, 16 * SCALE, 4 * SCALE)
					context.fill()

					// EnemyCountImage
					const image = icons[icon.classIconName ?? ""]
					if (image) {
						context.drawImage(image, x + 3 * SCALE, y + 2 * SCALE, 14 * SCALE, 14 * SCALE)
					} else {
						const size = (14 * SCALE) / 4
						for (let i = 0; i < 4; i++) {
							for (let j = 0; j < 4; j++) {
								context.beginPath()
								context.fillStyle = (i + j) & 1 ? "rgb(0 0 0)" : "rgb(255 0 255)"
								context.fillRect(x + 3 * SCALE + j * size, y + 2 * SCALE + i * size, size, size)
								context.closePath()
							}
						}
					}

					// EnemyCount
					if (count) {
						context.font = `500 ${14 * SCALE}px/1 '${configuration.font.regular}'`
						context.fillStyle = TAN_LIGHT
						context.textAlign = "center"
						context.textBaseline = "top"
						context.letterSpacing = "0px"

						let text = icon.count.toString()
						if (context.measureText(text).width <= 20 * SCALE) {
							context.fillText(text, x + 10 * SCALE, y + 18 * SCALE)
						} else {
							let len = text.length - 1
							while (width >= 20 * SCALE) {
								text = text.substring(0, len)
								width = context.measureText(`${text}…`).width
								len--
							}
							context.fillText(`${text}…`, x + 10 * SCALE, y + 18 * SCALE)
						}
					}
				}

				const enemy = [...wave.icons.miniboss, ...wave.icons.normal]
				for (const icon of enemy) {
					EnemyCountPanel(icon, x, y + 32 * SCALE, true)
					x += 20 * SCALE
					if (icon != enemy.at(-1)) {
						x += 5 * SCALE
					}
				}

				if (wave.icons.support.length > 0) {
					x += 5 * SCALE

					// SeparatorBar
					context.beginPath()
					context.fillStyle = TAN_LIGHT
					context.fillRect(x, y + 32 * SCALE, 1 * SCALE, 30 * SCALE)
					x += 1 * SCALE

					x += 5 * SCALE

					// SupportLabel
					context.beginPath()
					context.font = `400 ${11 * SCALE}px/1 '${configuration.font.bold}'`
					context.fillStyle = TAN_LIGHT
					context.textAlign = "left"
					context.textBaseline = "middle"
					// + 12 * SCALE + 30
					context.fillText("Support", x, y + 6 * SCALE + 32 * SCALE + 20 * SCALE)

					for (const icon of wave.icons.support) {
						EnemyCountPanel(icon, x, y + 32 * SCALE, false)
						x += 20 * SCALE
						if (icon != wave.icons.support.at(-1)) {
							x += 5 * SCALE
						}
					}
				}
			}
		},
	)

	function drawSourceImage(
		context: CanvasRenderingContext2D,
		image: ImageBitmap,
		source: {
			width: number
			height: number
			corner: number
		},
		dest: {
			x: number
			y: number
			width: number
			height: number
			corner: number
		},
	) {
		// Top Left Corner
		context.drawImage(image, 0, 0, source.corner, source.corner, dest.x, dest.y, dest.corner, dest.corner)

		// Top Edge
		context.drawImage(
			image,
			source.corner,
			0,
			source.width - source.corner * 2,
			source.corner,
			dest.x + dest.corner,
			dest.y,
			dest.width - dest.corner * 2,
			dest.corner,
		)

		// Top Right Corner
		context.drawImage(
			image,
			source.width - source.corner,
			0,
			source.corner,
			source.corner,
			dest.x + dest.width - dest.corner,
			dest.y,
			dest.corner,
			dest.corner,
		)

		// Left Edge
		context.drawImage(
			image,
			0,
			source.corner,
			source.corner,
			source.height - source.corner * 2,
			dest.x,
			dest.y + dest.corner,
			dest.corner,
			dest.height - dest.corner * 2,
		)

		// Center
		context.drawImage(
			image,
			source.corner,
			source.corner,
			source.width - source.corner * 2,
			source.height - source.corner * 2,
			dest.x + dest.corner,
			dest.y + dest.corner,
			dest.width - dest.corner * 2,
			dest.height - dest.corner * 2,
		)

		// Right Edge
		context.drawImage(
			image,
			source.width - source.corner,
			source.corner,
			source.corner,
			source.height - source.corner * 2,
			dest.x + dest.width - dest.corner,
			dest.y + dest.corner,
			dest.corner,
			dest.height - dest.corner * 2,
		)

		// Bottom Left Corner
		context.drawImage(
			image,
			0,
			source.height - source.corner,
			source.corner,
			source.corner,
			dest.x,
			dest.y + dest.height - dest.corner,
			dest.corner,
			dest.corner,
		)

		// Bottom Edge
		context.drawImage(
			image,
			source.corner,
			source.height - source.corner,
			source.width - source.corner * 2,
			source.corner,
			dest.x + dest.corner,
			dest.y + dest.height - dest.corner,
			dest.width - dest.corner * 2,
			dest.corner,
		)

		// Bottom Right Corner
		context.drawImage(
			image,
			source.width - source.corner,
			source.width - source.corner,
			source.corner,
			source.corner,
			dest.x + dest.width - dest.corner,
			dest.y + dest.height - dest.corner,
			dest.corner,
			dest.corner,
		)
	}

	contextMenu$.subscribe(async (message) => {
		switch (message.command) {
			case "vscode-vdf.waveStatusPreviewSaveImageAs":
				await saveAs()
				break
			case "vscode-vdf.waveStatusPreviewCopyImage":
				await navigator.clipboard.write([new ClipboardItem({ "image/png": await save() })])
				break
		}
	})

	async function saveAs() {
		const uriPromise = trpc.showSaveDialog.query()
		const [uri, buf] = await Promise.all([
			uriPromise,
			save().then(async (blob) => new Uint8Array(await blob.arrayBuffer())),
		])
		if (uri) {
			// @ts-ignore
			await trpc.save.mutate({ uri: uri, buf: buf })
		}
	}

	async function save() {
		const out = new OffscreenCanvas(canvas.width / 2, canvas.height / 2)
		const ctx = out.getContext("2d")!
		ctx.imageSmoothingEnabled = true
		ctx.textRendering = "optimizeLegibility"
		ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, out.width, out.height)
		return await out.convertToBlob({ type: "image/png", quality: 1 })
	}
</script>

<main
	data-vscode-context={JSON.stringify({ id: document.head.querySelector<HTMLMetaElement>("meta[name=id]")!.content })}
	style:display={$data$ != undefined ? "grid" : "none"}
>
	<canvas data-vscode-context={JSON.stringify({ webviewSection: "canvas" })} bind:this={canvas}></canvas>
	<div>
		<button class="settings" onclick={() => trpc.openSettings.query()}>
			<i class="codicon codicon-settings-gear"></i>
		</button>
		<button class="floating-click-widget" onclick={saveAs}>Save</button>
	</div>
</main>

<style>
	@import "@vscode/codicons/dist/codicon.css";

	:global(:root) {
		font-family:
			Segoe WPC,
			Segoe UI,
			sans-serif;
		text-rendering: optimizeLegibility;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
	}

	:global(body) {
		margin: 0;
		padding: 0;
		box-sizing: border-box;
		overflow-y: scroll;
	}

	:global(div#app) {
		display: grid;
		place-items: center;
		height: 100vh;
	}

	main {
		gap: 0.5rem;
		justify-items: center;
		padding: 1rem;

		div {
			display: grid;
			grid-template-columns: auto auto;
			align-items: stretch;
			gap: 0.5rem;

			button {
				color: var(--vscode-button-foreground, var(--vscode-editor-foreground));
				padding: 0px;
				background: none;
				border: none;
				cursor: pointer;
				z-index: 1;
			}

			button.settings {
				display: grid;
				place-items: center;

				i {
					font-size: 16px;
					color: var(--vscode-editor-foreground);
				}
			}

			button.floating-click-widget {
				font-family: inherit;
				padding: 6px 11px;
				border-radius: 2px;
				background-color: var(--vscode-button-background, var(--vscode-editor-background));
				border: 1px solid var(--vscode-contrastBorder);
			}
		}
	}
</style>
