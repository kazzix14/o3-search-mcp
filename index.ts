#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import OpenAI from "openai";
import { z } from "zod";
import { readFile } from "fs/promises";
import path from "path";
import { ConversationStore } from "./conversationStore.js";

async function setupServer() {
  // Create server instance
  const server = new McpServer({
    name: "o3-search-mcp",
    version: "0.0.7",
  });

  // Initialize OpenAI client
  if (!process.env.OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY environment variable is required");
    process.exit(1);
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Initialize conversation store
  const conversationStore = new ConversationStore();

  // Wait for conversation store to initialize
  await new Promise(resolve => setTimeout(resolve, 100));

  // Default conversation ID for this server session
  const defaultConversationId = "default_conversation";

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
  `Advanced reasoning AI powered by OpenAI's o3 model with web search and persistent conversation memory.

Key features:
- State-of-the-art reasoning with OpenAI's o3 model
- Real-time web search for up-to-date information
- Automatic file content analysis (just provide absolute file paths)
- Persistent conversation memory by default - all conversations continue seamlessly
- Support for multiple isolated conversations using custom conversation IDs

Default behavior:
- Without conversation_id: Uses a default conversation that persists across all calls
- With conversation_id: Creates/continues a separate conversation thread

Perfect for:
- Complex problem solving and debugging
- Code analysis and review
- Research with web search
- Technical documentation analysis
- Multi-step reasoning tasks that benefit from context retention`,
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
    conversation_id: z
      .string()
      .optional()
      .describe(
        "Optional conversation ID to use. If not provided, uses the default conversation that persists across all calls."
      ),
  },
  async ({ input, file_paths, conversation_id }) => {
    // Use provided conversation ID or default
    const convId = conversation_id || defaultConversationId;
    
    // Get conversation history if it exists
    const conversation = conversationStore.getConversation(convId);
    const conversationContext = !conversation ? "" : conversationStore.getConversationContext(conversation);
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

    const systemPrompt = `あなたは他のAIから相談を受けています。相談に対して、できる限り嘘をつかず、正確に答えてください。
また、情報が足りない場合はその旨を伝え、現状の情報と追加して別の情報を提供するようにしてください。
例えばソースコードがさらに欲しい場合は、相手のAIにその旨を伝え、今渡されてる情報と合わせてさらに情報を求めてください。
相手は、情報へのアクセス手段を持っています。

提供されたファイルがある場合は、その内容を詳しく分析し、具体的で実用的な回答を提供してください。
会話履歴が提供されている場合は、過去のコンテキストを考慮して回答してください。`;

    const fullInput = `${systemPrompt}

${conversationContext}${input}

${fileContents ? `

## Provided Files
The following files have been read and their contents are included below for analysis:

${fileContents}

Please analyze these files in the context of the question/request above.` : ''}`;
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

      const responseText = response.output_text || "No response text available.";
      
      // Save conversation
      await conversationStore.createOrUpdateConversation(
        convId,
        input,
        responseText,
        file_paths
      );
      
      return {
        content: [
          {
            type: "text",
            text: responseText,
          },
          {
            type: "text", 
            text: `\n\n---\nConversation ID: ${convId}`,
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

  // Define the reset-conversation tool
  server.tool(
    "reset-conversation",
  `Clear conversation history to start fresh. Useful when switching topics or avoiding context confusion.

Use cases:
- Starting a completely new topic
- Clearing accumulated context that might cause confusion
- Resetting after errors or misunderstandings
- Managing memory usage for long conversations

Default behavior:
- Without conversation_id: Clears the default conversation (affects all future calls without conversation_id)
- With conversation_id: Clears only the specified conversation thread`,
  {
    conversation_id: z
      .string()
      .optional()
      .describe(
        "Optional conversation ID to reset. If not provided, resets the default conversation."
      ),
  },
  async ({ conversation_id }) => {
    const convId = conversation_id || defaultConversationId;
    await conversationStore.resetConversation(convId);
    
    return {
      content: [
        {
          type: "text",
          text: `Conversation "${convId}" has been reset successfully.`,
        },
      ],
    };
  }
  );

  return server;
}

async function main() {
  const server = await setupServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
