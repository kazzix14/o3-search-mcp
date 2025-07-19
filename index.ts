#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import OpenAI from "openai";
import { z } from "zod";
import { readFile } from "fs/promises";
import path from "path";

// Create server instance
const server = new McpServer({
  name: "o3-search-mcp",
  version: "0.0.4",
});

// Initialize OpenAI client
if (!process.env.OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY environment variable is required");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Configuration from environment variables
const validSearchContextSizes = ["low", "medium", "high"] as const;
const validReasoningEfforts = ["low", "medium", "high"] as const;

const searchContextSize = validSearchContextSizes.includes(
  process.env.SEARCH_CONTEXT_SIZE as any
)
  ? (process.env.SEARCH_CONTEXT_SIZE as "low" | "medium" | "high")
  : "medium";

const reasoningEffort = validReasoningEfforts.includes(
  process.env.REASONING_EFFORT as any
)
  ? (process.env.REASONING_EFFORT as "low" | "medium" | "high")
  : "medium";

// Define the o3-search tool
server.tool(
  "ask-gpt-o3-extremely-smart",
  `An extremely smart reasoning AI with advanced web search capabilities (GPT-o3). Useful for finding latest information and troubleshooting errors, complex problems, typing errors, mathematical problems, and code analysis. 

Key features:
- Advanced reasoning with OpenAI's o3 model
- Web search capabilities for up-to-date information
- File content analysis - specify file paths to have their contents automatically read and analyzed
- Perfect for code review, debugging, documentation analysis, and technical problem solving

Usage: Provide your question/problem in 'input' and optionally specify file paths in 'file_paths' for detailed file analysis.`,
  {
    input: z
      .string()
      .describe(
        "Your question, problem, or request for the AI. Be specific and detailed. Examples: 'Analyze this code for bugs', 'Explain how this algorithm works', 'Help me fix this error', 'What's the latest information about X?'"
      ),
    file_paths: z
      .array(z.string())
      .optional()
      .describe(
        "Optional array of ABSOLUTE file paths to analyze. MUST use absolute paths (starting with / on Unix or C:\\ on Windows). Relative paths are NOT supported. The server will automatically read these files and include their contents in the analysis. Supports any text-based files (code, config, docs, etc.). Example: ['/Users/name/project/file1.ts', '/home/user/code/file2.py', 'C:\\\\projects\\\\config.json']"
      ),
  },
  async ({ input, file_paths }) => {
    // Read file contents if file_paths are provided
    let fileContents = '';
    if (file_paths && file_paths.length > 0) {
      for (const filePath of file_paths) {
        try {
          const content = await readFile(filePath, 'utf-8');
          fileContents += `
## File: ${filePath}
\`\`\`
${content}
\`\`\`

`;
        } catch (error) {
          fileContents += `
## File: ${filePath}
Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}

`;
        }
      }
    }

    const fullInput = `${input}

${fileContents ? `

## Provided Files
The following files have been read and their contents are included below for analysis:

${fileContents}

Please analyze these files in the context of the question/request above.` : ''}`;

    const systemPrompt = `
    あなたは他のAIから相談を受けています。相談に対して、できる限り嘘をつかず、正確に答えてください。
    また、情報が足りない場合はその旨を伝え、現状の情報と追加して別の情報を提供するようにしてください。
    例えばソースコードがさらに欲しい場合は、相手のAIにその旨を伝え、今渡されてる情報と合わせてさらに情報を求めてください。
    相手は、情報へのアクセス手段を持っています。
    
    提供されたファイルがある場合は、その内容を詳しく分析し、具体的で実用的な回答を提供してください。
    `;
    try {
      const response = await openai.responses.create({
        model: "o3",
        input: fullInput,
        tools: [
          {
            type: "web_search_preview",
            search_context_size: searchContextSize,
          },
        ],
        tool_choice: "auto",
        parallel_tool_calls: true,
        reasoning: { effort: reasoningEffort },
      });

      return {
        content: [
          {
            type: "text",
            text: response.output_text || "No response text available.",
          },
        ],
      };
    } catch (error) {
      console.error("Error calling OpenAI API:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${
              error instanceof Error ? error.message : "Unknown error occurred"
            }`,
          },
        ],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
