export interface MessageInterface {
  role: string;
  content: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export class Message implements MessageInterface {
  role: string;
  content: string;
  timestamp: string;
  metadata: Record<string, unknown>;

  constructor(role: string, content: string, timestamp: string, metadata: Record<string, unknown>) {
    this.role = role;
    this.content = content;
    this.timestamp = timestamp;
    this.metadata = metadata;
  }

  toJSON(): MessageInterface {
    return {
      role: this.role,
      content: this.content,
      timestamp: this.timestamp,
      metadata: this.metadata,
    };
  }

  static fromJSON(json: MessageInterface): Message {
    return new Message(json.role, json.content, json.timestamp, json.metadata);
  }
}
