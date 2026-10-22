import type { DataTransformer, TRPCRootObject } from "@trpc/server"
import { observableToAsyncIterable } from "@trpc/server/observable"
import { BSP } from "bsp"
import { usingAsync } from "common/operators/usingAsync"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { concat, concatMap, distinctUntilChanged, filter, from, switchAll } from "rxjs"
import { VDFPosition, VDFRange } from "vdf"
import vscode from "vscode"
import { CompletionItemKind, CompletionItemTag, MarkupKind } from "vscode-languageclient"
import z from "zod"
import type { FileSystemWatcherFactory } from "./FileSystemWatcherFactory"
import { VSCodePositionSchema, VSCodeUriSchema } from "./VSCodeSchemas"
import { VTFDocument } from "./VTF/VTFDocument"

const URISchema = z.object({
	uri: Uri.schema
})

const LocationSchema = z.object({
	uri: Uri.schema,
	range: VDFRange.schema
})

const MarkdownStringSchema = z.object({
	kind: z.enum([MarkupKind.PlainText, MarkupKind.Markdown]).default(MarkupKind.Markdown),
	value: z.string(),
})

const CodeLensSchema = z.array(
	z.object({
		range: VDFRange.schema,
		command: z.object({
			title: z.string(),
			command: z.string(),
			tooltip: z.string().optional(),
			arguments: z.any().array(),
		}).optional(),
	})
)

const CompletionItemProviderSchema = z.object({
	isIncomplete: z.boolean().default(true),
	items: z.array(
		z.object({
			label: z.string(),
			kind: z.enum(CompletionItemKind).optional(),
			tags: z.array(z.enum(CompletionItemTag)).optional(),
			detail: z.string().optional(),
			documentation: MarkdownStringSchema.optional(),
			sortText: z.string().optional(),
			filterText: z.string().optional(),
			preselect: z.boolean().optional(),
			insertText: z.union([
				z.string(),
				z.object({
					value: z.string(),
				}).transform((arg) => arg.value)
			]),
			range: z.union([
				VDFRange.schema,
				z.object({ inserting: VDFRange.schema, replacing: VDFRange.schema })
			]),
			commitCharacters: z.array(z.string()).optional(),
			keepWhitespace: z.boolean().optional(),
		})
	)
})

const DefinitionProviderSchema = z.array(LocationSchema)

const HoverProviderSchema = z.array(
	z.object({
		contents: z.array(MarkdownStringSchema),
		range: VDFRange.schema
	})
)

const InlayHintProviderSchema = z.array(
	z.object({
		position: VDFPosition.schema,
		label: z.union([
			z.string(),
			z.array(
				z.object({
					value: z.string(),
					location: z.object({
						uri: Uri.schema.transform((uri) => uri.toString()),
						range: VDFRange.schema,
					})
				})
			)
		]),
		kind: z.enum(vscode.InlayHintKind),
		paddingLeft: z.boolean().optional(),
		paddingRight: z.boolean().optional(),
	}),
)

const LinkSchema = z.array(
	z.object({
		range: VDFRange.schema,
		target: Uri.schema.optional(),
		tooltip: z.string().optional(),
	})
)

const PrepareRenameProviderSchema = z.object({
	range: VDFRange.schema,
	placeholder: z.string(),
})

const ReferenceProviderSchema = z.array(LocationSchema)

const SignatureHelpProviderSchema = z.object({
	signatures: z.array(
		z.object({
			label: z.string(),
			documentation: z.union([
				z.string(),
				MarkdownStringSchema
			]).optional(),
			parameters: z.array(
				z.object({
					label: z.union([
						z.string(),
						z.tuple([z.number(), z.number()]),
					]),
					documentation: z.union([
						z.string(),
						MarkdownStringSchema
					]).optional()
				})
			),
			activeParameter: z.number().optional(),
		})
	),
	activeSignature: z.number(),
	activeParameter: z.number().optional(),
})

const WorkspaceEditSchema = z
	.instanceof(vscode.WorkspaceEdit)
	.transform((workspaceEdit) => ({ changes: Object.fromEntries(workspaceEdit.entries().map(([uri, edits]) => [new Uri(uri).toString(), edits.map((edit) => ({ range: VDFRange.schema.parse(edit.range), newText: edit.newText }))])) }))

const executeCommand = async <T extends z.ZodType>(schema: T, command: string, ...rest: any[]) => {
	try {
		return schema.parse(await vscode.commands.executeCommand(command, ...rest))
	}
	catch (error) {
		console.error(error instanceof z.ZodError ? z.prettifyError(error) : error)
	}
}

export function TRPCPopfileRouter(
	t: TRPCRootObject<{ client: "vdf" }, object, { transformer: DataTransformer }>,
	fileSystemWatcherFactory: FileSystemWatcherFactory,
	bspFactory: RefCountAsyncDisposableFactory<Uri, BSP> | null,
) {
	return t.router({
		bsp: {
			entities: t
				.procedure
				.input(URISchema)
				.query(async ({ input }) => {
					if (!bspFactory) {
						return null
					}

					try {
						await using bsp = await bspFactory.get(input.uri)
						return z.array(
							z.looseObject({
								classname: z.string(),
								targetname: z.string().optional(),
							}).catchall(z.union([z.string(), z.array(z.string())]))
						).parse(bsp.entities())
					}
					catch (error) {
						console.error(error)
						return null
					}
				})
		},
		classIcon: {
			flags: t
				.procedure
				.input(URISchema)
				.subscription(({ input, signal }) => {
					const flags = async () => VTFDocument.flags(await vscode.workspace.fs.readFile(input.uri))
					return observableToAsyncIterable<number>(
						concat(
							from(Promise.try(flags)),
							usingAsync(async () => await fileSystemWatcherFactory.get(input.uri)).pipe(
								switchAll(),
								filter((event) => event.type == "change"),
								concatMap(flags),
							)
						).pipe(
							distinctUntilChanged(),
						),
						signal!
					)
				})
		},
		vscript: {
			install: t
				.procedure
				.input(
					z.object({
						name: z.string()
					})
				)
				.query(async ({ input }) => {
					const configuration = vscode.workspace.getConfiguration("vscode-vdf")
					if (configuration.get("popfile.vscript.enable") == true) {
						const languages = await vscode.languages.getLanguages()
						const installed = languages.includes("squirrel") || languages.includes("tf2vscript")
						if (!installed) {
							const result = await vscode.window.showInformationMessage(`VScript detected in ${input.name}. Install the TF2 VScript Support extension?`, "Yes", "No", "Don't ask again")
							switch (result) {
								case "Yes":
									await vscode.commands.executeCommand("vscode.open", vscode.Uri.from({ scheme: vscode.env.uriScheme, path: "extension/ocet247.tf2-vscript-support" }))
									break
								case "No":
									break
								case "Don't ask again":
									configuration.update("popfile.vscript.enable", false, true)
									break
							}
						}
					}
				})
		},
		embedded: {
			commands: {
				// Error: Illegal argument
				// https://github.com/microsoft/vscode/blob/main/src/vs/editor/contrib/codelens/browser/codelens.ts#L107
				// executeCodeLensProvider: t
				// 	.procedure
				// 	.input(
				// 		z.object({
				// 			uri: VSCodeUriSchema,
				// 			itemResolveCount: z.number().optional(),
				// 		})
				// 	)
				// 	.query(async ({ input }) => {
				// 		return await executeCommand(
				// 			CodeLensSchema,
				// 			"vscode.executeCodeLensProvider",
				// 			input.uri,
				// 			input.itemResolveCount
				// 		)
				// 	}),
				executeCompletionItemProvider: t
					.procedure
					.input(
						z.object({
							uri: VSCodeUriSchema,
							position: VSCodePositionSchema,
							triggerCharacter: z.string().optional(),
							itemResolveCount: z.number().optional(),
						})
					)
					.query(async ({ input }) => {
						return await executeCommand(
							CompletionItemProviderSchema,
							"vscode.executeCompletionItemProvider",
							input.uri,
							input.position,
							input.triggerCharacter,
							input.itemResolveCount,
						)
					}),
				executeDefinitionProvider: t
					.procedure
					.input(
						z.object({
							uri: VSCodeUriSchema,
							position: VSCodePositionSchema,
						})
					)
					.query(async ({ input }) => {
						return await executeCommand(
							DefinitionProviderSchema,
							"vscode.executeDefinitionProvider",
							input.uri,
							input.position,
						)
					}),
				// Error: Unexpected type
				// https://github.com/microsoft/vscode/issues/342761
				// executeDocumentRenameProvider: t
				// 	.procedure
				// 	.input(
				// 		z.object({
				// 			uri: VSCodeUriSchema,
				// 			position: VSCodePositionSchema,
				// 			newName: z.string(),
				// 		})
				// 	)
				// 	.query(async ({ input }) => {
				// 		return await executeCommand(
				// 			WorkspaceEditSchema,
				// 			"vscode.executeDocumentRenameProvider",
				// 			input.uri,
				// 			input.position,
				// 			input.newName,
				// 		)
				// 	}),
				executeHoverProvider: t
					.procedure
					.input(
						z.object({
							uri: VSCodeUriSchema,
							position: VSCodePositionSchema,
						})
					)
					.query(async ({ input }) => {
						return await executeCommand(
							HoverProviderSchema,
							"vscode.executeHoverProvider",
							input.uri,
							input.position,
						)
					}),
				executeInlayHintProvider: t
					.procedure
					.input(
						z.object({
							uri: VSCodeUriSchema,
							range: VDFRange.schema
						})
					)
					.query(async ({ input }) => {
						return await executeCommand(
							InlayHintProviderSchema,
							"vscode.executeInlayHintProvider",
							input.uri,
							input.range,
						)
					}),
				executeLinkProvider: t
					.procedure
					.input(
						z.object({
							uri: VSCodeUriSchema,
							linkResolveCount: z.number().optional(),
						})
					)
					.query(async ({ input }) => {
						return await executeCommand(
							LinkSchema,
							"vscode.executeLinkProvider",
							input.uri,
							input.linkResolveCount,
						)
					}),
				// Error: Unexpected type
				// https://github.com/microsoft/vscode/issues/342761
				// executePrepareRenameProvider: t
				// 	.procedure
				// 	.input(
				// 		z.object({
				// 			uri: VSCodeUriSchema,
				// 			position: VSCodePositionSchema,
				// 		})
				// 	)
				// 	.query(async ({ input }) => {
				// 		return await executeCommand(
				// 			PrepareRenameProviderSchema,
				// 			"vscode.prepareRename",
				// 			input.uri,
				// 			input.position,
				// 		)
				// 	}),
				executeReferenceProvider: t
					.procedure
					.input(
						z.object({
							uri: VSCodeUriSchema,
							position: VSCodePositionSchema,
						})
					)
					.query(async ({ input }) => {
						return await executeCommand(
							ReferenceProviderSchema,
							"vscode.executeReferenceProvider",
							input.uri,
							input.position,
						)
					}),
				executeSignatureHelpProvider: t
					.procedure
					.input(
						z.object({
							uri: VSCodeUriSchema,
							position: VSCodePositionSchema,
							triggerCharacter: z.string().optional(),
						})
					)
					.query(async ({ input }) => {
						return await executeCommand(
							SignatureHelpProviderSchema,
							"vscode.executeSignatureHelpProvider",
							input.uri,
							input.position,
							input.triggerCharacter,
						)
					}),
			}
		}
	})
}
