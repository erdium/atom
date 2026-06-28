import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import { keyText } from "../../modes/interactive/components/keybinding-hints.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.ts";
import { str } from "./render-utils.ts";
import { htmlToText } from "./html-to-text.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const webSearchSchema = Type.Object({
	query: Type.String({ description: "Search query" }),
});

export type WebSearchToolInput = Static<typeof webSearchSchema>;

interface SearchResult {
	url: string;
	title: string;
	snippet: string;
	content: string;
}

/** Parse DuckDuckGo HTML search results page. Returns up to `maxResults` results. */
function parseSearchResults(html: string, maxResults: number): { url: string; title: string; snippet: string }[] {
	const results: { url: string; title: string; snippet: string }[] = [];

	// Extract result__a links (title + URL)
	const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
	const links: { url: string; title: string }[] = [];
	let m: RegExpExecArray | null;
	while ((m = linkRegex.exec(html)) !== null) {
		const titleRaw = m[2].replace(/<[^>]+>/g, "").trim();
		const href = m[1];
		// Extract real URL from DuckDuckGo redirect
		const uddgMatch = href.match(/uddg=([^&]+)/);
		const url = uddgMatch ? decodeURIComponent(uddgMatch[1]) : href;
		// Decode HTML entities in title
		const title = titleRaw.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([\da-fA-F]+);/g, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)));
		links.push({ url, title });
	}

	// Extract result__snippets
	const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
	const snippets: string[] = [];
	while ((m = snippetRegex.exec(html)) !== null) {
		const s = m[1].replace(/<[^>]+>/g, "").trim();
		const decoded = s.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
		snippets.push(decoded);
	}

	for (let i = 0; i < Math.min(links.length, maxResults); i++) {
		results.push({
			url: links[i].url,
			title: links[i].title,
			snippet: snippets[i] ?? "",
		});
	}

	return results;
}

async function fetchPageContent(url: string, signal?: AbortSignal): Promise<string> {
	try {
		const response = await globalThis.fetch(url, {
			signal,
			headers: { "User-Agent": "Mozilla/5.0 (compatible; Atom-CLI/1.0)" },
		});

		if (!response.ok) {
			return `[Error: HTTP ${response.status}]`;
		}

		const html = await response.text();
		const text = htmlToText(html);

		// Limit to first 5000 chars to avoid context overload
		return text.slice(0, 5000);
	} catch {
		return "[Error: failed to fetch]";
	}
}

function formatWebSearchCall(args: { query?: string } | undefined, theme: Theme, indicator: string): string {
	const query = str(args?.query);
	const queryDisplay = query !== null && query ? query : "...";
	return `${indicator} ${theme.fg("toolTitle", theme.bold("WebSearch"))}(${theme.fg("toolOutput", queryDisplay)})`;
}

function formatWebSearchResult(
	result: SearchResult[] | undefined,
	options: ToolRenderResultOptions,
	theme: Theme,
): string {
	if (options.expanded || !result || result.length === 0) {
		return "";
	}

	const count = result.length;
	const collapseHint = theme.fg("muted", ` (${keyText("app.tools.expand")} to collapse)`);
	return `${theme.fg("toolOutput", `  └  ${count} pages`)}${collapseHint}`;
}

export function createWebSearchToolDefinition(): ToolDefinition<typeof webSearchSchema, SearchResult[]> {
	return {
		name: "web_search",
		label: "WebSearch",
		description: "Search the internet using DuckDuckGo. Returns page titles and extracted text content from search results.",
		promptSnippet: "Search the web",
		promptGuidelines: ["Use web_search for internet searches and retrieving web page content."],
		parameters: webSearchSchema,
		async execute(_toolCallId, { query }: { query: string }, signal?, onUpdate?, _ctx?) {
			const results: SearchResult[] = [];

			// Step 1: Search via DuckDuckGo HTML endpoint (returns real search results)
			const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
			const searchResponse = await globalThis.fetch(searchUrl, {
				signal,
				headers: { "User-Agent": "Mozilla/5.0 (compatible; Atom-CLI/1.0)" },
			});

			if (!searchResponse.ok) {
				throw new Error(`DuckDuckGo search returned ${searchResponse.status}`);
			}

			const searchHtml = await searchResponse.text();

			// Step 2: Parse search results (up to 5 links)
			const parsedResults = parseSearchResults(searchHtml, 5);

			if (parsedResults.length === 0) {
				const noResultsText = `No results found for "${query}".`;
				onUpdate?.({ content: [{ type: "text", text: noResultsText }], details: [] });
				return { content: [{ type: "text", text: noResultsText }], details: [] };
			}

			// Step 3: Fetch content from first 3 results in parallel
			const fetchPromises = parsedResults.slice(0, 3).map(async (r) => {
				const content = await fetchPageContent(r.url, signal);
				return { ...r, content };
			});

			const fetchedPages = await Promise.all(fetchPromises);

			// Add remaining results with snippet as content
			for (let i = 3; i < parsedResults.length; i++) {
				fetchedPages.push({ ...parsedResults[i], content: parsedResults[i].snippet });
			}

			results.push(...fetchedPages);

			// Step 4: Build output text
			const outputText = results
				.map((r, i) => {
					const header = `[${i + 1}] ${r.title}`;
					const urlLine = `    URL: ${r.url}`;
					const body = r.content ? `\n\n${r.content.slice(0, 1500)}` : "";
					return `${header}\n${urlLine}${body}`;
				})
				.join("\n\n---\n\n");

			onUpdate?.({
				content: [{ type: "text", text: outputText.slice(0, 2000) }],
				details: results,
			});

			return {
				content: [{ type: "text", text: outputText }],
				details: results,
			};
		},
		renderCall(args, theme, context) {
			const indicator = context.isError
				? theme.fg("error", "●")
				: context.isPartial
					? theme.fg("muted", "○")
					: theme.fg("success", "●");
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const baseCall = formatWebSearchCall(args, theme, indicator);
			const expandHint = context.isPartial
				? theme.fg("muted", ` (${keyText("app.tools.expand")} ${context.expanded ? "to collapse" : "to expand"})`)
				: "";
			text.setText(`${baseCall}${expandHint}`);
			return text;
		},
		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatWebSearchResult(result.details ?? [], options, theme));
			return text;
		},
	};
}

export function createWebSearchTool(): AgentTool<typeof webSearchSchema> {
	return wrapToolDefinition(createWebSearchToolDefinition());
}
