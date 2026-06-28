import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Container, Text } from "@earendil-works/pi-tui";
import { mkdir as fsMkdir, writeFile as fsWriteFile } from "fs/promises";
import { dirname } from "path";
import { type Static, Type } from "typebox";
import { keyText } from "../../modes/interactive/components/keybinding-hints.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { withFileMutationQueue } from "./file-mutation-queue.ts";
import { resolveToCwd } from "./path-utils.ts";
import { renderToolPath, str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const writeSchema = Type.Object({
	path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
	content: Type.String({ description: "Content to write to the file" }),
});

export type WriteToolInput = Static<typeof writeSchema>;

/**
 * Pluggable operations for the write tool.
 * Override these to delegate file writing to remote systems (for example SSH).
 */
export interface WriteOperations {
	/** Write content to a file */
	writeFile: (absolutePath: string, content: string) => Promise<void>;
	/** Create directory recursively */
	mkdir: (dir: string) => Promise<void>;
}

const defaultWriteOperations: WriteOperations = {
	writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
	mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
};

export interface WriteToolOptions {
	/** Custom operations for file writing. Default: local filesystem */
	operations?: WriteOperations;
}

function formatWriteCall(
	args: { path?: string; file_path?: string; content?: string } | undefined,
	theme: Theme,
	cwd: string,
	indicator: string,
): string {
	const rawPath = str(args?.file_path ?? args?.path);
	const fileContent = str(args?.content);
	const pathDisplay = renderToolPath(rawPath, theme, cwd);
	let text = `${indicator} ${theme.fg("toolTitle", theme.bold("Create"))}(${pathDisplay})`;

	if (fileContent === null) {
		text += `\n\n${theme.fg("error", "[invalid content arg - expected string]")}`;
	} else if (fileContent) {
		const totalBytes = fileContent.length;
		const totalLines = fileContent.split("\n").length;
		text += `\n${theme.fg("toolOutput", `  └  ${totalBytes} bytes · ${totalLines} lines`)}`;
	}

	return text;
}

function formatWriteResult(
	result: { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean },
	theme: Theme,
): string | undefined {
	if (!result.isError) {
		return undefined;
	}
	const output = result.content
		.filter((c) => c.type === "text")
		.map((c) => c.text || "")
		.join("\n");
	if (!output) {
		return undefined;
	}
	return `\n${theme.fg("error", output)}`;
}

export function createWriteToolDefinition(
	cwd: string,
	options?: WriteToolOptions,
): ToolDefinition<typeof writeSchema, undefined> {
	const ops = options?.operations ?? defaultWriteOperations;
	return {
		name: "write",
		label: "Create",
		description:
			"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		promptSnippet: "Create or overwrite files",
		promptGuidelines: ["Use write only for new files or complete rewrites."],
		parameters: writeSchema,
		async execute(
			_toolCallId,
			{ path, content }: { path: string; content: string },
			signal?: AbortSignal,
			_onUpdate?,
			_ctx?,
		) {
			const absolutePath = resolveToCwd(path, cwd);
			const dir = dirname(absolutePath);
			return withFileMutationQueue(absolutePath, async () => {
				// Do not reject from an abort event listener here: that would release the
				// mutation queue while an in-flight filesystem operation may still finish.
				// Checking signal.aborted after each await observes the same aborts while
				// keeping the queue locked until the current operation has settled.
				const throwIfAborted = (): void => {
					if (signal?.aborted) throw new Error("Operation aborted");
				};

				throwIfAborted();
				// Create parent directories if needed.
				await ops.mkdir(dir);
				throwIfAborted();

				// Write the file contents.
				await ops.writeFile(absolutePath, content);
				throwIfAborted();

				return {
					content: [{ type: "text", text: `Successfully wrote ${content.length} bytes to ${path}` }],
					details: undefined,
				};
			});
		},
		renderCall(args, theme, context) {
			const renderArgs = args as { path?: string; file_path?: string; content?: string } | undefined;
			const indicator = context.isError
				? theme.fg("error", "●")
				: context.isPartial
					? theme.fg("muted", "○")
					: theme.fg("success", "●");
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const baseCall = formatWriteCall(renderArgs, theme, context.cwd, indicator);
			const expandHint = context.isPartial
				? theme.fg("muted", ` (${keyText("app.tools.expand")} ${context.expanded ? "to collapse" : "to expand"})`)
				: "";
			text.setText(`${baseCall}${expandHint}`);
			return text;
		},
		renderResult(result, _options, theme, context) {
			const output = formatWriteResult({ ...result, isError: context.isError }, theme);
			if (!output) {
				const component = (context.lastComponent as Container | undefined) ?? new Container();
				component.clear();
				return component;
			}
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(output);
			return text;
		},
	};
}

export function createWriteTool(cwd: string, options?: WriteToolOptions): AgentTool<typeof writeSchema> {
	return wrapToolDefinition(createWriteToolDefinition(cwd, options));
}
