import { existsSync, readdirSync, statSync } from "fs"
import { parse, relative, sep } from "path"
import { CompletionItem, CompletionItemKind, CompletionList } from "vscode-languageserver-types"


class CompletionItemSet {
	public items: CompletionItem[] = []
	public add(value: CompletionItem): this {
		value.label = value.label.split(sep).join("/")
		for (const item of this.items) {
			if (item.label == value.label) {
				return this
			}
		}
		this.items.push(value)
		return this
	}
}

export namespace CompletionFiles {
	export function Incremental(startingPath: string, removeExtensions = false): CompletionList | CompletionItem[] {
		const items: CompletionItemSet = new CompletionItemSet()
		if (existsSync(startingPath)) {
			for (const item of readdirSync(startingPath)) {
				items.add({
					label: removeExtensions ? parse(item).name : item,
					kind: statSync(`${startingPath}${sep}${item}`).isFile() ? CompletionItemKind.File : CompletionItemKind.Folder,
					commitCharacters: [
						"/"
					]
				})
			}
			return items.items
		}
		return []
	}
	export function All(root: string, relativePath?: string, removeExtensions = false): CompletionList | CompletionItem[] {
		const items: CompletionItemSet = new CompletionItemSet()
		const iterateDir = (relativeChildPath: string) => {
			for (const item of readdirSync(`${root}${sep}${relativeChildPath}`)) {
				if (!statSync(`${root}${sep}${relativeChildPath}${sep}${item}`).isFile()) {
					iterateDir(`${relativeChildPath}${item}${sep}`)
				}
				else {
					items.add({
						label: relativePath
							? `${relative(relativePath, `${root}${sep}${relativeChildPath}${sep}${removeExtensions ? parse(item).name : item}`)}`
							: removeExtensions ? parse(item).name : `${relativeChildPath}${item}`,
						kind: CompletionItemKind.File
					})
				}
			}
		}
		iterateDir("")
		return items.items
	}
}
