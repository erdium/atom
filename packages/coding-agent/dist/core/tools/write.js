import { Container, Text } from "@earendil-works/pi-tui";
import { mkdir as fsMkdir, writeFile as fsWriteFile } from "fs/promises";
import { dirname } from "path";
import { Type } from "typebox";
import { keyText } from "../../modes/interactive/components/keybinding-hints.js";
import { withFileMutationQueue } from "./file-mutation-queue.js";
import { resolveToCwd } from "./path-utils.js";
import { renderToolPath, str } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
const writeSchema = Type.Object({
    path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
    content: Type.String({ description: "Content to write to the file" }),
});
const defaultWriteOperations = {
    writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
    mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => { }),
};
function formatWriteCall(args, theme, cwd, indicator) {
    const rawPath = str(args?.file_path ?? args?.path);
    const fileContent = str(args?.content);
    const pathDisplay = renderToolPath(rawPath, theme, cwd);
    let text = `${indicator} ${theme.fg("toolTitle", theme.bold("Create"))}(${pathDisplay})`;
    if (fileContent === null) {
        text += `\n\n${theme.fg("error", "[invalid content arg - expected string]")}`;
    }
    else if (fileContent) {
        const totalBytes = fileContent.length;
        const totalLines = fileContent.split("\n").length;
        text += `\n${theme.fg("toolOutput", `  └  ${totalBytes} bytes · ${totalLines} lines`)}`;
    }
    return text;
}
function formatWriteResult(result, theme) {
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
export function createWriteToolDefinition(cwd, options) {
    const ops = options?.operations ?? defaultWriteOperations;
    return {
        name: "write",
        label: "Create",
        description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
        promptSnippet: "Create or overwrite files",
        promptGuidelines: ["Use write only for new files or complete rewrites."],
        parameters: writeSchema,
        async execute(_toolCallId, { path, content }, signal, _onUpdate, _ctx) {
            const absolutePath = resolveToCwd(path, cwd);
            const dir = dirname(absolutePath);
            return withFileMutationQueue(absolutePath, async () => {
                // Do not reject from an abort event listener here: that would release the
                // mutation queue while an in-flight filesystem operation may still finish.
                // Checking signal.aborted after each await observes the same aborts while
                // keeping the queue locked until the current operation has settled.
                const throwIfAborted = () => {
                    if (signal?.aborted)
                        throw new Error("Operation aborted");
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
            const renderArgs = args;
            const indicator = context.isError
                ? theme.fg("error", "●")
                : context.isPartial
                    ? theme.fg("muted", "○")
                    : theme.fg("success", "●");
            const text = context.lastComponent ?? new Text("", 0, 0);
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
                const component = context.lastComponent ?? new Container();
                component.clear();
                return component;
            }
            const text = context.lastComponent ?? new Text("", 0, 0);
            text.setText(output);
            return text;
        },
    };
}
export function createWriteTool(cwd, options) {
    return wrapToolDefinition(createWriteToolDefinition(cwd, options));
}
//# sourceMappingURL=write.js.map