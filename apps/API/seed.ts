import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { sqliteTable } from "drizzle-orm/sqlite-core"
import { open, readdir, rm } from "node:fs/promises"
import { posix } from "node:path"
import { brotliCompressSync } from "node:zlib"
import { VDF } from "vdf"
import { VPK, VPKFileType } from "vpk"
import { z } from "zod"

const teamFortress2Folder = `./dist`

// Delete custom and download folders
await rm(posix.join(teamFortress2Folder, "tf/custom"), { recursive: true, force: true })
await rm(posix.join(teamFortress2Folder, "tf/download"), { recursive: true, force: true })

const { GameInfo: { FileSystem: { SearchPaths: searchPaths } } } = z.object({
	GameInfo: z.object({
		FileSystem: z.object({
			SearchPaths: z.record(z.union([z.string(), z.array(z.string())])).transform((arg) => {
				return Object
					.values(arg)
					.flat()
					.map((value) => {
						return posix.join(teamFortress2Folder, value
							.replace("|all_source_engine_paths|", "")
							.replace("|gameinfo_path|", "tf/"))
							.replace(".vpk", "_dir.vpk")
					})
					.filter((value) => !value.endsWith("*") && !value.endsWith("tf/bin"))
			})
		})
	})
}).parse(VDF.parse(await Bun.file(`${teamFortress2Folder}/tf/gameinfo.txt`).text()))

const fileSystems = await Promise.allSettled([...new Set(searchPaths)].map(async (root) => {
	try {
		if (root.endsWith("_dir.vpk")) {

			if (!(await Bun.file(root).exists())) {
				throw new Error(`VPK ${root} does not exist`)
			}

			const buf = await Bun.file(`./${root}`).bytes()
			const vpk = new VPK(new DataView(buf.buffer))

			return {
				root,
				readDirectory: async function*() {
					async function* iterateDirectory(relativePath: string): AsyncGenerator<{ path: string, data: () => Promise<Uint8Array> }> {
						const entry = vpk.entry(relativePath)
						if (!entry) {
							throw new Error(`entry ${relativePath} does not exist`)
						}

						if (entry.type == VPKFileType.File) {
							throw new Error(`entry ${relativePath} is not a VPKFileType.File`)
						}

						for (const [name, value] of entry.value) {
							const path = posix.join(relativePath, name)

							if (value.type == VPKFileType.File) {
								yield {
									path: path,
									data: async () => {
										const { archiveIndex, entryOffset, entryLength } = value.value

										const fsPath = root.replace("_dir.vpk", `_${archiveIndex == 255 ? "_dir" : archiveIndex.toString().padStart(3, "0")}.vpk`)

										const file = await open(fsPath, "r")
										const buf = Buffer.alloc(entryLength)

										await file.read(buf, 0, entryLength, entryOffset)
										file.close()

										return buf
									}
								}
							}
							else {
								yield* iterateDirectory(path)
							}
						}
					}

					yield* iterateDirectory("")
				}
			}
		}
		else if (await readdir(root)) {
			return {
				root,
				readDirectory: async function*(): AsyncGenerator<{ path: string, data: () => Promise<Uint8Array> }> {
					async function* iterateDirectory(relativePath: string, level = 0) {
						for (const entry of await readdir(posix.join(root, relativePath), { withFileTypes: true })) {
							if (level == 0 && entry.name == "custom") {
								continue
							}

							const path = posix.join(relativePath, entry.name)

							if (entry.isFile()) {
								yield { path: path, data: async () => await Bun.file(posix.join(root, path)).bytes() }
							}
							else if (entry.isDirectory()) {
								yield* iterateDirectory(path, level + 1)
							}
						}
					}

					yield* iterateDirectory("")
				}
			}
		}
		else {
			throw new Error(root)
		}
	}
	catch (error) {
		throw new Error(error.message, { cause: error })
	}
}))

const sqlite = new Database("./tf.db")
sqlite.exec(`PRAGMA cache_size = 1000000000;`)
sqlite.exec(`PRAGMA journal_mode = WAL;`)
sqlite.exec(`PRAGMA synchronous = 0;`)
sqlite.exec(`PRAGMA temp_store = MEMORY;`)

const tf = sqliteTable("tf", (t) => ({
	name: t.text().primaryKey(),
	bytes: t.integer().notNull(),
	data: t.blob().notNull()
}))

const database = drizzle(sqlite, { schema: { tf } })

sqlite.prepare(`
	CREATE TABLE IF NOT EXISTS tf(
		name TEXT PRIMARY KEY,
		bytes INTEGER NOT NULL,
		data BLOB NOT NULL
	);
`).run()

console.log(
	JSON.stringify(
		fileSystems
			.filter((fileSystem) => fileSystem.status == "fulfilled")
			.map((fileSystem) => fileSystem.value.root),
		null,
		2
	)
)

async function* all(): AsyncGenerator<{ path: string, data: () => Promise<Uint8Array> }> {
	for (const fileSystem of fileSystems) {
		if (fileSystem.status == "fulfilled") {
			yield* fileSystem.value.readDirectory()
		}
	}
}

const files = await Array.fromAsync(all()).then((values) => {
	return values
		.flat()
		.filter((value, index, arr) => arr.findIndex((v) => v.path == value.path) == index)
		.toSorted((a, b) => a.path.localeCompare(b.path))
})

for (const file of files) {

	function not(ext: string) {
		return !file.path.endsWith(ext)
	}

	if (not(".vpk") && not(".sound.cache") && not(".exe") && not(".dll") && not(".bsp") && not(".nav")) {
		console.log(file.path)

		const buf = await file.data()
		await database.insert(tf).values({
			name: file.path,
			bytes: buf.length,
			data: brotliCompressSync(buf)
		})
	}
}

sqlite.prepare(`PRAGMA user_version = ${Math.floor(new Date().valueOf() / 1000)}`).run()
