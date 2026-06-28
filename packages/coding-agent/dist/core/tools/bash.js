import { constants } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import { Container, Text } from "@earendil-works/pi-tui";
import { spawn } from "child_process";
import { Type } from "typebox";
import { theme } from "../../modes/interactive/theme/theme.js";
import { waitForChildProcess } from "../../utils/child-process.js";
import { getShellConfig, getShellEnv, killProcessTree, trackDetachedChildPid, untrackDetachedChildPid, } from "../../utils/shell.js";
import { OutputAccumulator } from "./output-accumulator.js";
import { str } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "./truncate.js";
const bashSchema = Type.Object({
    command: Type.String({ description: "Bash command to execute" }),
    timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
});
/**
 * Create bash operations using pi's built-in local shell execution backend.
 *
 * This is useful for extensions that intercept user_bash and still want pi's
 * standard local shell behavior while wrapping or rewriting commands.
 */
export function createLocalBashOperations(options) {
    return {
        exec: async (command, cwd, { onData, signal, timeout, env }) => {
            const shellConfig = getShellConfig(options?.shellPath);
            try {
                await fsAccess(cwd, constants.F_OK);
            }
            catch {
                throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
            }
            if (signal?.aborted) {
                throw new Error("aborted");
            }
            const commandFromStdin = shellConfig.commandTransport === "stdin";
            const child = spawn(shellConfig.shell, commandFromStdin ? shellConfig.args : [...shellConfig.args, command], {
                cwd,
                detached: process.platform !== "win32",
                env: env ?? getShellEnv(),
                stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
                windowsHide: true,
            });
            if (commandFromStdin) {
                child.stdin?.on("error", () => { });
                child.stdin?.end(command);
            }
            if (child.pid)
                trackDetachedChildPid(child.pid);
            let timedOut = false;
            let timeoutHandle;
            const onAbort = () => {
                if (child.pid)
                    killProcessTree(child.pid);
            };
            try {
                // Set timeout if provided.
                if (timeout !== undefined && timeout > 0) {
                    timeoutHandle = setTimeout(() => {
                        timedOut = true;
                        if (child.pid)
                            killProcessTree(child.pid);
                    }, timeout * 1000);
                }
                // Stream stdout and stderr.
                child.stdout?.on("data", onData);
                child.stderr?.on("data", onData);
                // Handle abort signal by killing the entire process tree.
                if (signal) {
                    if (signal.aborted)
                        onAbort();
                    else
                        signal.addEventListener("abort", onAbort, { once: true });
                }
                // Handle shell spawn errors and wait for the process to terminate without hanging
                // on inherited stdio handles held by detached descendants.
                const exitCode = await waitForChildProcess(child);
                if (signal?.aborted) {
                    throw new Error("aborted");
                }
                if (timedOut) {
                    throw new Error(`timeout:${timeout}`);
                }
                return { exitCode };
            }
            finally {
                if (child.pid)
                    untrackDetachedChildPid(child.pid);
                if (timeoutHandle)
                    clearTimeout(timeoutHandle);
                if (signal)
                    signal.removeEventListener("abort", onAbort);
            }
        },
    };
}
function resolveSpawnContext(command, cwd, spawnHook) {
    const baseContext = { command, cwd, env: { ...getShellEnv() } };
    return spawnHook ? spawnHook(baseContext) : baseContext;
}
const BASH_PREVIEW_LINES = 5;
const BASH_UPDATE_THROTTLE_MS = 100;
class BashResultRenderComponent extends Container {
    constructor() {
        super(...arguments);
        this.state = {
            cachedWidth: undefined,
            cachedLines: undefined,
            cachedSkipped: undefined,
        };
    }
}
function formatDuration(ms) {
    return `${(ms / 1000).toFixed(1)}s`;
}
function formatBashCall(args, indicator, expanded) {
    const command = str(args?.command);
    const timeout = args?.timeout;
    let commandPreview = command !== null && command ? command : "...";
    if (expanded && commandPreview.length > 20) {
        commandPreview = commandPreview.slice(0, 20) + "...";
    }
    let text = `${indicator} ${theme.fg("toolTitle", theme.bold("Bash"))}(${theme.fg("toolOutput", commandPreview)}`;
    if (timeout !== undefined) {
        text += `, ${theme.fg("toolOutput", `${timeout}s`)}`;
    }
    text += ")";
    return text;
}
function rebuildBashResultRenderComponent(component, result, options, showImages, startedAt, endedAt) {
    const state = component.state;
    component.clear();
}
export function createBashToolDefinition(cwd, options) {
    const ops = options?.operations ?? createLocalBashOperations({ shellPath: options?.shellPath });
    const commandPrefix = options?.commandPrefix;
    const spawnHook = options?.spawnHook;
    return {
        name: "bash",
        label: "Bash",
        description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
        promptSnippet: "Execute bash commands (ls, grep, find, etc.)",
        parameters: bashSchema,
        async execute(_toolCallId, { command, timeout }, signal, onUpdate, _ctx) {
            const resolvedCommand = commandPrefix ? `${commandPrefix}\n${command}` : command;
            const spawnContext = resolveSpawnContext(resolvedCommand, cwd, spawnHook);
            const output = new OutputAccumulator({ tempFilePrefix: "pi-bash" });
            let acceptingOutput = true;
            let updateTimer;
            let updateDirty = false;
            let lastUpdateAt = 0;
            const emitOutputUpdate = () => {
                if (!onUpdate || !updateDirty)
                    return;
                updateDirty = false;
                lastUpdateAt = Date.now();
                const snapshot = output.snapshot({ persistIfTruncated: true });
                onUpdate({
                    content: [{ type: "text", text: snapshot.content || "" }],
                    details: {
                        truncation: snapshot.truncation.truncated ? snapshot.truncation : undefined,
                        fullOutputPath: snapshot.fullOutputPath,
                    },
                });
            };
            const clearUpdateTimer = () => {
                if (updateTimer) {
                    clearTimeout(updateTimer);
                    updateTimer = undefined;
                }
            };
            const scheduleOutputUpdate = () => {
                if (!onUpdate)
                    return;
                updateDirty = true;
                const delay = BASH_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
                if (delay <= 0) {
                    clearUpdateTimer();
                    emitOutputUpdate();
                    return;
                }
                updateTimer ??= setTimeout(() => {
                    updateTimer = undefined;
                    emitOutputUpdate();
                }, delay);
            };
            if (onUpdate) {
                onUpdate({ content: [], details: undefined });
            }
            const handleData = (data) => {
                if (!acceptingOutput)
                    return;
                output.append(data);
                scheduleOutputUpdate();
            };
            const finishOutput = async () => {
                acceptingOutput = false;
                output.finish();
                clearUpdateTimer();
                emitOutputUpdate();
                const snapshot = output.snapshot({ persistIfTruncated: true });
                await output.closeTempFile();
                return snapshot;
            };
            const formatOutput = (snapshot, emptyText = "(no output)") => {
                const truncation = snapshot.truncation;
                let text = snapshot.content || emptyText;
                let details;
                if (truncation.truncated) {
                    details = { truncation, fullOutputPath: snapshot.fullOutputPath };
                    const startLine = truncation.totalLines - truncation.outputLines + 1;
                    const endLine = truncation.totalLines;
                    if (truncation.lastLinePartial) {
                        const lastLineSize = formatSize(output.getLastLineBytes());
                        text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${snapshot.fullOutputPath}]`;
                    }
                    else if (truncation.truncatedBy === "lines") {
                        text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`;
                    }
                    else {
                        text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${snapshot.fullOutputPath}]`;
                    }
                }
                return { text, details };
            };
            const appendStatus = (text, status) => `${text ? `${text}\n\n` : ""}${status}`;
            try {
                let exitCode;
                try {
                    const result = await ops.exec(spawnContext.command, spawnContext.cwd, {
                        onData: handleData,
                        signal,
                        timeout,
                        env: spawnContext.env,
                    });
                    exitCode = result.exitCode;
                }
                catch (err) {
                    const snapshot = await finishOutput();
                    const { text } = formatOutput(snapshot, "");
                    if (err instanceof Error && err.message === "aborted") {
                        throw new Error(appendStatus(text, "Command aborted"));
                    }
                    if (err instanceof Error && err.message.startsWith("timeout:")) {
                        const timeoutSecs = err.message.split(":")[1];
                        throw new Error(appendStatus(text, `Command timed out after ${timeoutSecs} seconds`));
                    }
                    throw err;
                }
                const snapshot = await finishOutput();
                const { text: outputText, details } = formatOutput(snapshot);
                if (exitCode !== 0 && exitCode !== null) {
                    throw new Error(appendStatus(outputText, `Command exited with code ${exitCode}`));
                }
                return { content: [{ type: "text", text: outputText }], details };
            }
            finally {
                clearUpdateTimer();
            }
        },
        renderCall(args, _theme, context) {
            const state = context.state;
            if (context.executionStarted && state.startedAt === undefined) {
                state.startedAt = Date.now();
                state.endedAt = undefined;
            }
            const indicator = context.isError
                ? theme.fg("error", "●")
                : context.isPartial
                    ? theme.fg("warning", "●")
                    : theme.fg("success", "●");
            const text = context.lastComponent ?? new Text("", 0, 0);
            text.setText(formatBashCall(args, indicator, context.expanded));
            return text;
        },
        renderResult(result, options, _theme, context) {
            const state = context.state;
            if (state.startedAt !== undefined && options.isPartial && !state.interval) {
                state.interval = setInterval(() => context.invalidate(), 1000);
            }
            if (!options.isPartial || context.isError) {
                state.endedAt ??= Date.now();
                if (state.interval) {
                    clearInterval(state.interval);
                    state.interval = undefined;
                }
            }
            const component = context.lastComponent ?? new BashResultRenderComponent();
            rebuildBashResultRenderComponent(component, result, options, context.showImages, state.startedAt, state.endedAt);
            component.invalidate();
            return component;
        },
    };
}
export function createBashTool(cwd, options) {
    return wrapToolDefinition(createBashToolDefinition(cwd, options));
}
//# sourceMappingURL=bash.js.map