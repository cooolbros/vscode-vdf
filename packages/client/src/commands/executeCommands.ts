import * as vscode from "vscode"

export async function executeCommands(commands: { command: string, rest?: any[] }[]) {
	await Promise.allSettled(commands.map(async ({ command, rest }) => await vscode.commands.executeCommand(command, ...(rest ?? []))))
}
