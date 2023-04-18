import type { VSCodeVDFFileSystem } from "$lib/types/VSCodeVDFFileSystem"
import { extname, parse } from "path"
import { CompletionItem, CompletionItemKind, Connection } from "vscode-languageserver"

export class CompletionItemSet {
	public readonly items: CompletionItem[] = []
	public add(value: CompletionItem): void {
		if (this.items.some((item) => item.label == value.label)) {
			return
		}
		this.items.push(value)
	}
}

export async function incremental(
	connection: Connection,
	fileSystem: VSCodeVDFFileSystem,
	query: `?${string}` | "",
	startingPath: string,
	relativePath: string | undefined,
	extensions: string[] | undefined,
	removeExtensions: boolean
): Promise<CompletionItem[]> {

	const set = new CompletionItemSet()

	try {
		for (const [name, type] of await fileSystem.readDirectory(`${startingPath}${relativePath ? `/${relativePath}` : ""}${query}`)) {
			if (type == 1 ? (extensions ? extensions.includes(extname(name)) : true) : true) {
				set.add({
					label: name, // Display file extension in label so VSCode displays the associated icon
					kind: type == 1 ? CompletionItemKind.File : CompletionItemKind.Folder,
					insertText: removeExtensions ? parse(name).name : name,
					commitCharacters: ["/"],
				})
			}
		}
		return set.items
	}
	catch (error: any) {
		connection.console.log(error.stack)
		return set.items
	}
}

export async function all(
	connection: Connection,
	fileSystem: VSCodeVDFFileSystem,
	query: `?${string}` | "",
	startingPath: string,
	extensions: string[] | undefined,
	removeExtensions: boolean
): Promise<CompletionItem[]> {

	const set = new CompletionItemSet()

	try {

		const iterateDirectory = async (relativeChildPath: string): Promise<void> => {

			for (const [name, type] of await fileSystem.readDirectory(`${startingPath}/${relativeChildPath}${query}`)) {
				if (type == 2) {
					await iterateDirectory(`${relativeChildPath}${name}/`)
				}
				else if (extensions ? extensions.includes(extname(name)) : true) {
					set.add({
						label: `${relativeChildPath}${name}`, // Display file extension in label so VSCode displays the associated icon
						kind: CompletionItemKind.File,
						insertText: `${relativeChildPath}${removeExtensions ? parse(name).name : name}`
					})
				}
			}
		}

		await iterateDirectory("")

		return set.items
	}
	catch (error: any) {
		connection.console.log(error.stack)
		return set.items
	}
}
