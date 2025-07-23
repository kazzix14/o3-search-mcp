interface ConversationEntry {
  timestamp: string;
  input: string;
  filePaths?: string[];
  response: string;
}

interface Conversation {
  id: string;
  createdAt: string;
  updatedAt: string;
  entries: ConversationEntry[];
}

export class ConversationStore {
  private conversations: Map<string, Conversation> = new Map();

  getConversation(id: string): Conversation | null {
    return this.conversations.get(id) || null;
  }

  resetConversation(id: string): void {
    this.conversations.delete(id);
  }

  createOrUpdateConversation(
    id: string,
    input: string,
    response: string,
    filePaths?: string[]
  ): void {
    let conversation = this.getConversation(id);
    
    const entry: ConversationEntry = {
      timestamp: new Date().toISOString(),
      input,
      response,
      ...(filePaths && { filePaths })
    };

    if (!conversation) {
      conversation = {
        id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        entries: [entry]
      };
    } else {
      conversation.entries.push(entry);
      conversation.updatedAt = new Date().toISOString();
    }

    this.conversations.set(id, conversation);
  }

  getConversationContext(conversation: Conversation, maxEntries: number = 10): string {
    const recentEntries = conversation.entries.slice(-maxEntries);
    
    if (recentEntries.length === 0) {
      return "";
    }

    let context = "## Previous Conversation Context\n\n";
    
    for (const entry of recentEntries) {
      context += `### User Query (${new Date(entry.timestamp).toLocaleString()}):\n`;
      context += `${entry.input}\n\n`;
      
      if (entry.filePaths && entry.filePaths.length > 0) {
        context += `**Files analyzed:** ${entry.filePaths.join(", ")}\n\n`;
      }
      
      context += `### AI Response:\n`;
      context += `${entry.response}\n\n`;
      context += "---\n\n";
    }

    return context;
  }
}
