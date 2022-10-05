import { execSync } from "child_process"
import { existsSync, mkdirSync, unlinkSync } from "fs"
import { tmpdir } from "os"
import { dirname, join } from "path"

export class VPK {

	private readonly teamFortress2Folder: string | (() => string | Promise<string>)

	constructor(teamFortress2Folder: string | (() => string | Promise<string>)) {
		this.teamFortress2Folder = teamFortress2Folder
	}

	private static async vpkCmd(teamFortress2Folder: string): Promise<string> {
		const vpkExe = join(teamFortress2Folder, "bin/vpk.exe")
		const vpkLinux = join(teamFortress2Folder, "bin/vpk_linux32")
		if (existsSync(vpkExe)) {
			return vpkExe
		}
		if (existsSync(vpkLinux)) {
			return vpkLinux
		}
		throw new Error("Cannot find bin/vpk.exe or bin/vpk_linux32. Please set \"vscode-vdf.teamFortress2Folder\" to a valid Team Fortress 2 installation")
	}

	/**
	 * Extract a file from a VPK
	 * @param vpkPath VPK Path relative to teamFortress2Folder
	 * @param filePath file path inside VPK
	 * @param options Options
	 * @param options.returnNullOnError Return null if any Error is thrown
	 */
	public async extract(vpkFile: string, filePath: string, { deleteOldFile, returnNullOnError }: { deleteOldFile?: boolean, returnNullOnError?: boolean } = {}): Promise<string | null> {
		try {
			const teamFortress2Folder: string = typeof this.teamFortress2Folder == "function"
				? await (async (): Promise<string> => {
					const result = this.teamFortress2Folder()
					return result instanceof Promise ? result : Promise.resolve(result)
				})()
				: this.teamFortress2Folder
			const vpkCmd = await VPK.vpkCmd(teamFortress2Folder)
			const vpkPath = join(teamFortress2Folder, vpkFile)
			const tempDir = tmpdir()
			mkdirSync(join(tempDir, dirname(filePath)), { recursive: true })
			const outputPath = join(tempDir, filePath)
			if (deleteOldFile && existsSync(outputPath)) {
				unlinkSync(outputPath)
			}
			const args = [
				`"${vpkCmd}"`,
				"x",
				`"${vpkPath}"`,
				`"${filePath}"`
			]
			const vpkResult = execSync(args.join(" "), { cwd: tempDir }).toString()
			if (existsSync(outputPath)) {
				return outputPath
			}
			throw new Error(`${vpkResult[0].toUpperCase()}${vpkResult.substring(1)} in "${vpkPath}"`)
		}
		catch (e: any) {
			if (returnNullOnError) {
				return null
			}
			throw e
		}
	}
}
