#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import OpenAI from "openai";
import { z } from "zod";

// Create server instance
const server = new McpServer({
  name: "o3-search-mcp",
  version: "0.0.3",
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
  `An extremely smart reasoning AI with advanced web search capabilities (GPT-o3). Useful for finding latest information and troubleshooting errors. complex problems. like typing errors. or mathmetical problems. or something like that.`,
  {
    input: z
      .string()
      .describe(
        "Ask questions, search for information, or consult about complex problems. like typing errors. or mathmetical problems. or something like that. your input will be prompt for smart LLM. so describe your problem in detail."
      ),
  },
  async ({ input }) => {
    const prompt = `
    あなたは他のAIから相談を受けています。相談に対して、できる限り嘘をつかず、正確に答えてください。
    また、情報が足りない場合はその旨を伝え、現状の情報と追加して別の情報を提供するようにしてください。
    例えばソースコードがさらに欲しい場合は、相手のAIにその旨を伝え、今渡されてる情報と合わせてさらに情報を求めてください。
    相手は、情報へのアクセス手段を持っています。
    `;
    try {
      const response = await openai.responses.create({
        model: "o3",
        input,
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
