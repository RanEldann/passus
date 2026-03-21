export interface Transport {
  sendMessage(userId: string, text: string): Promise<void>;
  onMessage(handler: (userId: string, text: string) => Promise<void>): void;
}
