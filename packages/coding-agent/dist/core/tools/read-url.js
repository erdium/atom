import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { keyText } from "../../modes/interactive/components/keybinding-hints.js";
import { str } from "./render-utils.js";
import { htmlToText } from "./html-to-text.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
const readUrlSchema = Type.Object({
    url: Type.String({ description: "URL to read and extract text from" }),
});
function formatReadUrlCall(args, theme, indicator) {
    const url = str(args?.url);
    let urlDisplay = url !== null && url ? url : "...";
    if (urlDisplay.length > 20) {
        urlDisplay = urlDisplay.slice(0, 20) + "...";
    }
    return `${indicator} ${theme.fg("toolTitle", theme.bold("ReadURL"))}(${theme.fg("toolOutput", urlDisplay)})`;
}
function formatReadUrlResult(charCount, options, theme) {
    if (charCount === 0) {
        return "";
    }
    const collapseHint = theme.fg("muted", ` (${keyText("app.tools.expand")} to collapse)`);
    return `${theme.fg("toolOutput", `  └  ${charCount} chars`)}${collapseHint}`;
}
export function createReadUrlToolDefinition() {
    return {
        name: "read_url",
        label: "ReadURL",
        description: "Read the content of a web page by URL. Downloads the HTML, extracts readable text, and returns it.",
        promptSnippet: "Read a web page",
        promptGuidelines: ["Use read_url to fetch and extract text content from a specific URL."],
        parameters: readUrlSchema,
        async execute(_toolCallId, { url }, signal, onUpdate, _ctx) {
            const response = await globalThis.fetch(url, {
                signal,
                headers: { "User-Agent": "Mozilla/5.0 (compatible; Atom-CLI/1.0)" },
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const html = await response.text();
            const text = htmlToText(html);
            const length = text.length;
            onUpdate?.({
                content: [{ type: "text", text: text.slice(0, 2000) }],
                details: length,
            });
            return {
                content: [{ type: "text", text }],
                details: length,
            };
        },
        renderCall(args, theme, context) {
            const text = context.lastComponent ?? new Text("", 0, 0);
            const indicator = context.isError
                ? theme.fg("error", "●")
                : context.isPartial
                    ? theme.fg("muted", "○")
                    : theme.fg("success", "●");
            const callLine = formatReadUrlCall(args, theme, indicator);
            const expandHint = context.isPartial
                ? theme.fg("muted", ` (${keyText("app.tools.expand")} ${context.expanded ? "to collapse" : "to expand"})`)
                : "";
            text.setText(callLine + expandHint);
            return text;
        },
        renderResult(result, options, theme, context) {
            const text = context.lastComponent ?? new Text("", 0, 0);
            text.setText(formatReadUrlResult(result.details ?? 0, options, theme));
            return text;
        },
    };
}
export function createReadUrlTool() {
    return wrapToolDefinition(createReadUrlToolDefinition());
}
//# sourceMappingURL=read-url.js.map