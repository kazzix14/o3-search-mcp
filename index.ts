#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import OpenAI from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses.js";
import { z } from "zod";
import { readFile } from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { ConversationStore } from "./conversationStore.js";
import { startClaudeSupervision, stopClaudeSupervision, closeClaudeClient } from "./claudeClient.js";
import { viewFile, editFile, listDirectory, writeFile, runBash, grepFiles } from "./claudeTools.js";

const execFileAsync = promisify(execFile);

async function setupServer() {
  // Create server instance
  const server = new McpServer({
    name: "o3-search-mcp",
    version: "0.1.0",
  });

  // Initialize OpenAI client
  if (!process.env.OPENAI_API_KEY) {
    process.stderr.write("Error: OPENAI_API_KEY environment variable is required\n");
    process.exit(1);
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Initialize conversation store
  const conversationStore = new ConversationStore();

  // Wait for conversation store to initialize
  await new Promise(resolve => setTimeout(resolve, 100));

  // Generate unique default conversation ID for this server session
  const defaultConversationId = `default_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

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

  // Git diff analysis function
  async function executeDiff(from: string, to?: string, unstaged?: boolean): Promise<{
    content: string;
    summary: string;
    command: string;
    lineCount: number;
  }> {
    // Validate git refs to prevent command injection and option injection
    const refPattern = /^(?!-)[a-zA-Z0-9/_.\-~^]+$/;
    if (!refPattern.test(from)) {
      throw new Error(`Invalid git reference format: ${from}`);
    }
    if (to && !refPattern.test(to)) {
      throw new Error(`Invalid git reference format: ${to}`);
    }

    // Build git diff arguments array
    const args = ['--no-pager', 'diff', '--no-ext-diff', '--no-color'];
    
    if (to) {
      // Compare between two refs
      args.push(from, to);
    } else {
      // Compare from ref to working directory
      const shouldIncludeUnstaged = unstaged !== false; // Default to true when to is not specified
      
      if (shouldIncludeUnstaged) {
        // Include unstaged changes: compare from ref to working directory
        args.push(from);
        // Add -- to separate refs from paths (only for working directory comparison)
        args.push('--');
      } else {
        // Exclude unstaged changes: compare from ref to HEAD
        args.push(from, 'HEAD');
      }
    }

    // Execute git diff
    const { stdout, stderr } = await execFileAsync('git', args, { 
      maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      cwd: process.cwd()
    });

    const command = `git ${args.join(' ')}`;

    if (stderr && !stderr.includes('warning')) {
      throw new Error(`Git diff failed: ${stderr}`);
    }

    const diffContent = stdout;
    const lines = diffContent.split('\n');
    const lineCount = lines.length;

    // Check size limit (10,000 lines)
    if (lineCount > 10000) {
      throw new Error(`Diff too large (${lineCount} lines, limit: 10,000). Consider:
- Specifying a smaller commit range
- Adding file paths to limit scope
- Breaking down the analysis into smaller parts`);
    }

    // Generate summary - exclude file headers (+++/---) and count only actual content lines
    const addedLines = lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length;
    const removedLines = lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length;
    const changedFiles = new Set(
      lines
        .filter(line => line.startsWith('diff --git'))
        .map(line => line.split(' ')[3]?.replace('b/', '') || '')
        .filter(Boolean)
    ).size;

    const summary = `${changedFiles} files changed, ${addedLines} insertions(+), ${removedLines} deletions(-)`;

    return {
      content: diffContent,
      summary: summary,
      command: command,
      lineCount: lineCount
    };
  }

  // Define the o3-search tool
  server.tool(
    "ask-gpt-o3-extremely-smart",
  `Advanced reasoning AI powered by OpenAI's o3 model with web search, persistent conversation memory, and git diff analysis.

Key features:
- State-of-the-art reasoning with OpenAI's o3 model
- Real-time web search for up-to-date information
- Automatic file content analysis (just provide absolute file paths)
- Git diff analysis for code change debugging (NEW!)
- Persistent conversation memory by default - all conversations continue seamlessly
- Support for multiple isolated conversations using custom conversation IDs

Git diff analysis:
- Compare code changes between commits, branches, or working directory
- Identify what broke after refactoring or changes
- Automatic detection of common issues like missing error handling, broken dependencies
- Simply provide 'from' parameter to enable diff analysis

Default behavior:
- Without conversation_id: Uses a default conversation that persists across all calls
- With conversation_id: Creates/continues a separate conversation thread
- Without 'to' parameter: Includes unstaged changes by default

Perfect for:
- "It was working before..." debugging scenarios
- Post-refactoring issue identification
- Code review and change impact analysis
- Complex problem solving and debugging
- Research with web search combined with code analysis
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
    from: z
      .string()
      .optional()
      .describe(
        "Git reference (branch, commit, tag) to compare from. Enables diff analysis when provided. Example: 'HEAD~1', 'main', 'abc123'"
      ),
    to: z
      .string()
      .optional()
      .describe(
        "Git reference to compare to. If not provided, compares against working directory (includes unstaged changes by default)."
      ),
    unstaged: z
      .boolean()
      .optional()
      .describe(
        "Whether to include unstaged changes in diff analysis. Defaults to true when 'to' is not specified, false otherwise."
      ),
  },
  async ({ input, file_paths, conversation_id, from, to, unstaged }) => {
    try {
      // Use provided conversation ID or default
      const convId = conversation_id || defaultConversationId;
      
      // Get conversation history if it exists
      const conversation = conversationStore.getConversation(convId);
      const conversationContext = !conversation ? "" : conversationStore.getConversationContext(conversation);
      
      // Execute git diff analysis if 'from' is provided
      let diffAnalysis: string = '';
      if (from) {
        try {
          const diffResult = await executeDiff(from, to, unstaged);
          diffAnalysis = `
## Git Diff Analysis

**Command executed:** \`${diffResult.command}\`
**Summary:** ${diffResult.summary}

### Code Changes:
\`\`\`diff
${diffResult.content}
\`\`\`

**Analysis Instructions:**
The above diff shows code changes that may be related to the reported issue. Please:
1. Identify what functionality was added, modified, or removed
2. Look for potential issues like missing error handling, broken dependencies, or logic errors
3. Consider the impact of these changes on the overall system behavior
4. Suggest specific fixes if problems are identified

`;
        } catch (diffError) {
          // Return error directly to user as requested
          return {
            content: [{
              type: "text",
              text: `Error: ${(diffError as Error).message}`
            }]
          };
        }
      }

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

    const systemPrompt = `他のAIからの相談に正確に答えてください。必要に応じてツールを使用し、その結果を踏まえて簡潔で実用的な回答を日本語で提供してください。${diffAnalysis ? 'Git差分が提供されている場合は、問題の原因特定と解決策を優先してください。' : ''}`;

    // Prepare structured input items instead of string concatenation
    const inputItems: ResponseInputItem[] = [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: `${conversationContext}${input}` }
        ]
      }
    ];

    // Add diff analysis as a system message if present
    if (diffAnalysis) {
      inputItems.push({
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: diffAnalysis }]
      });
    }

    // Add file contents as a system message if present
    if (fileContents) {
      inputItems.push({
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: `## Files:\n${fileContents}` }]
      });
    }
      
      process.stderr.write(`[DEBUG] About to call OpenAI API with model: o3\n`);
      process.stderr.write(`[DEBUG] Input items count: ${inputItems.length}\n`);
      
      // Define tools for o3 - separate web search and function tools for better type safety
      const tools: any[] = [
        {
          type: "web_search_preview",
          search_context_size: searchContextSize,
        },
        {
          type: "function",
          name: "claude_view",
          description: "Read a file using Claude Code's Read tool",
          parameters: {
            type: "object",
            properties: {
              file_path: {
                type: "string",
                description: "Absolute path to the file to read"
              }
            },
            required: ["file_path"],
            additionalProperties: false
          },
          strict: true
        },
        {
          type: "function",
          name: "claude_edit",
          description: "Edit a file using Claude Code's Edit tool for string replacement",
          parameters: {
            type: "object",
            properties: {
              file_path: {
                type: "string",
                description: "Absolute path to the file to edit"
              },
              old_string: {
                type: "string",
                description: "The exact text to find and replace"
              },
              new_string: {
                type: "string",
                description: "The replacement text"
              }
            },
            required: ["file_path", "old_string", "new_string"],
            additionalProperties: false
          },
          strict: true
        },
        {
          type: "function",
          name: "claude_ls",
          description: "List directory contents using Claude Code's LS tool",
          parameters: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false
          },
          strict: true
        },
        {
          type: "function",
          name: "claude_write",
          description: "Create a new file using Claude Code's Write tool. REQUIRES USER CONFIRMATION.",
          parameters: {
            type: "object",
            properties: {
              file_path: {
                type: "string",
                description: "Absolute path where to create the new file"
              },
              content: {
                type: "string",
                description: "Content to write to the file"
              },
              confirm: {
                type: "string",
                enum: ["yes"],
                description: "MUST be 'yes' to create the file. User confirmation required."
              }
            },
            required: ["file_path", "content", "confirm"],
            additionalProperties: false
          },
          strict: true
        },
        {
          type: "function",
          name: "claude_bash",
          description: "Execute a command using Claude Code's Bash tool. REQUIRES USER CONFIRMATION for potentially dangerous commands.",
          parameters: {
            type: "object",
            properties: {
              command: {
                type: "string",
                description: "Command to execute"
              },
              confirm: {
                type: "string",
                enum: ["yes"],
                description: "MUST be 'yes' to execute the command. User confirmation required."
              }
            },
            required: ["command", "confirm"],
            additionalProperties: false
          },
          strict: true
        },
        {
          type: "function",
          name: "claude_grep",
          description: "Search files using Claude Code's Grep tool",
          parameters: {
            type: "object",
            properties: {
              pattern: {
                type: "string",
                description: "Pattern to search for"
              }
            },
            required: ["pattern"],
            additionalProperties: false
          },
          strict: true
        }
      ];

      // N-stage loop: Continue until text response is returned
      let responseText = "";
      let allToolResults: string[] = [];
      let depth = 0;
      const maxDepth = 30; // Maximum iterations for complex tasks
      let lastResponseId: string | undefined; // Store previous response ID for conversation continuity

      while (depth < maxDepth) {
        depth++;
        process.stderr.write(`[DEBUG] Stage ${depth}: Making API call\n`);
        
        const response = await openai.responses.create({
          model: "o3",
          instructions: systemPrompt, // Move system prompt to instructions
          input: inputItems, // Use structured items instead of string
          tools: tools,
          tool_choice: "auto",
          parallel_tool_calls: true,
          reasoning: { effort: reasoningEffort },
          ...(lastResponseId && { previous_response_id: lastResponseId }), // Include previous response context
        });

        // Check for function calls
        let hasFunctionCalls = false;
        const toolOutputItems: ResponseInputItem[] = []; // Store structured tool outputs
        
        for (const outputItem of response.output || []) {
          if (outputItem.type === 'function_call' && 'name' in outputItem && 'arguments' in outputItem) {
            hasFunctionCalls = true;
            const functionCall = outputItem as any;
            const functionName = functionCall.name;
            const argumentsStr = functionCall.arguments;
            const callId = functionCall.id || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            try {
              const args = JSON.parse(argumentsStr);
              let result: any;
              
              switch (functionName) {
                case 'claude_view':
                  result = await viewFile(args.file_path);
                  break;
                case 'claude_edit':
                  result = await editFile(args.file_path, args.old_string, args.new_string);
                  break;
                case 'claude_ls':
                  result = await listDirectory('.');
                  break;
                case 'claude_write':
                  if (args.confirm === 'yes') {
                    result = await writeFile(args.file_path, args.content);
                  } else {
                    result = { content: [{ type: "text", text: "Write operation cancelled. User confirmation required." }], isError: true };
                  }
                  break;
                case 'claude_bash':
                  if (args.confirm === 'yes') {
                    result = await runBash(args.command);
                  } else {
                    result = { content: [{ type: "text", text: "Command execution cancelled. User confirmation required." }], isError: true };
                  }
                  break;
                case 'claude_grep':
                  result = await grepFiles(args.pattern);
                  break;
                default:
                  result = { content: [{ type: "text", text: `Unknown function: ${functionName}` }], isError: true };
              }
              
              const resultText = result.content?.map((item: any) => item.text).join('\n') || 'No result';
              
              // Add as structured function_call_output item
              toolOutputItems.push({
                type: "function_call_output",
                call_id: callId,
                output: resultText
              } as ResponseInputItem);
              
              // Keep for final display
              allToolResults.push(`**${functionName}** result:\n${resultText}`);
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              
              // Add error as function_call_output item
              toolOutputItems.push({
                type: "function_call_output",
                call_id: callId,
                output: `Error: ${errorMsg}`
              } as ResponseInputItem);
              
              // Keep for final display
              allToolResults.push(`**${functionName}** error: ${errorMsg}`);
            }
          }
        }

        // Extract text response first
        let currentResponseText = "";
        if (response.output) {
          const messageItems = response.output.filter((item: any) => item.type === 'message');
          const textContents: string[] = [];
          
          for (const messageItem of messageItems) {
            const msgItem = messageItem as any;
            if (msgItem.content && Array.isArray(msgItem.content)) {
              for (const contentItem of msgItem.content) {
                if (contentItem.type === 'output_text' && contentItem.text) {
                  textContents.push(contentItem.text);
                }
              }
            }
          }
          
          if (textContents.length > 0) {
            currentResponseText = textContents.join('\n');
          }
        }

        // Complete if no function calls AND meaningful text output exists
        if (!hasFunctionCalls && currentResponseText.trim().length > 0) {
          responseText = currentResponseText;
          break;
        }
        
        // If no function calls but no meaningful text, continue (this shouldn't happen normally)
        if (!hasFunctionCalls && !currentResponseText.trim()) {
          process.stderr.write(`[DEBUG] Stage ${depth}: No function calls but no text output, continuing...\n`);
          // Continue to next iteration, but set a fallback message in case we hit max depth
          if (depth >= maxDepth - 1) {
            responseText = "ツールの実行は完了しましたが、最終的な回答を取得できませんでした。";
            break;
          }
        }

        // Store response ID for next iteration to maintain conversation context
        lastResponseId = response.id;

        // Add tool results to input items for next iteration
        if (toolOutputItems.length > 0) {
          inputItems.push(...toolOutputItems);
        }
      }

      // Add tool results to final response
      if (allToolResults.length > 0) {
        responseText += "\n\n---\n**Tools Used:**\n" + allToolResults.join('\n\n');
      }
      
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
      process.stderr.write(`[DEBUG] Error occurred: ${error instanceof Error ? error.message : String(error)}\n`);
      process.stderr.write(`[DEBUG] Error stack: ${error instanceof Error ? error.stack : 'No stack'}\n`);
      
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

  // Define Claude Code proxy tools
  server.tool(
    "claude-view",
    "Read a file using Claude Code's Read tool",
    {
      file_path: z.string().describe("Absolute path to the file to read"),
    },
    async ({ file_path }) => {
      const result = await viewFile(file_path);
      return result;
    }
  );

  server.tool(
    "claude-edit",
    "Edit a file using Claude Code's Edit tool for string replacement",
    {
      file_path: z.string().describe("Absolute path to the file to edit"),
      old_string: z.string().describe("The exact text to find and replace"),
      new_string: z.string().describe("The replacement text"),
    },
    async ({ file_path, old_string, new_string }) => {
      const result = await editFile(file_path, old_string, new_string);
      return result;
    }
  );

  server.tool(
    "claude-ls",
    "List directory contents using Claude Code's LS tool",
    {},
    async ({}) => {
      const result = await listDirectory();
      return result;
    }
  );

  server.tool(
    "claude-write",
    "Create a new file using Claude Code's Write tool. REQUIRES USER CONFIRMATION.",
    {
      file_path: z.string().describe("Absolute path where to create the new file"),
      content: z.string().describe("Content to write to the file"),
      confirm: z.enum(["yes"]).describe("MUST be 'yes' to create the file. User confirmation required."),
    },
    async ({ file_path, content, confirm }) => {
      if (confirm !== "yes") {
        return {
          content: [{ type: "text", text: "Write operation cancelled. User confirmation required." }],
          isError: true
        };
      }
      const result = await writeFile(file_path, content);
      return result;
    }
  );

  server.tool(
    "claude-bash",
    "Execute a command using Claude Code's Bash tool. REQUIRES USER CONFIRMATION for potentially dangerous commands.",
    {
      command: z.string().describe("Command to execute"),
      confirm: z.enum(["yes"]).describe("MUST be 'yes' to execute the command. User confirmation required."),
    },
    async ({ command, confirm }) => {
      if (confirm !== "yes") {
        return {
          content: [{ type: "text", text: "Command execution cancelled. User confirmation required." }],
          isError: true
        };
      }
      const result = await runBash(command);
      return result;
    }
  );

  server.tool(
    "claude-grep",
    "Search files using Claude Code's Grep tool",
    {
      pattern: z.string().describe("Pattern to search for"),
    },
    async ({ pattern }) => {
      const result = await grepFiles(pattern);
      return result;
    }
  );

  return server;
}

async function main() {
  const server = await setupServer();
  
  // Start Claude supervision
  startClaudeSupervision();
  
  // Setup graceful shutdown
  const shutdown = async () => {
    stopClaudeSupervision();
    await closeClaudeClient();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGQUIT', shutdown);
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
}

main().catch((error) => {
  process.stderr.write(`Fatal error in main(): ${error.message}\n`);
  process.exit(1);
});
