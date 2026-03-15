// MessageCallback is invoked by a Channel implementation whenever a new user
// message arrives. sessionId is the platform-agnostic session/channel
// identifier (e.g. a Telegram chat ID stringified). The orchestration layer
// (index.ts) registers this callback and drives the full AI workflow.
export type MessageCallback = (
	sessionId: string,
	content: string,
) => Promise<void>;

// MessageSentCallback is invoked by the channel after updateOrSendMessage
// completes. Use this to persist the delivered content to the database without
// duplicating the same arguments at the call site.
// platformMsgId is the ID of the message that was delivered:
//   - the ack message ID when the ack was edited in place
//   - the newly created message's ID when a new message was sent
export type MessageSentCallback = (
	sessionId: string,
	platformMsgId: string,
	content: string,
) => Promise<void>;

// Channel abstracts any messaging platform (Telegram, Discord, CLI, …).
// Only the concrete implementation (channels/telegram.ts, etc.) is allowed
// to contain platform-specific code.
export interface Channel {
	// Register the callback invoked for every incoming user message.
	onMessage(callback: MessageCallback): void;

	// Register the callback invoked after updateOrSendMessage completes.
	// Fired internally by the channel — use it to sync the DB instead of
	// repeating the same arguments after every call.
	onMessageSent(callback: MessageSentCallback): void;

	// Send an initial acknowledgement (e.g. "🔄 Working…") and return the
	// platform message ID so it can be referenced later. Returns undefined on
	// platforms that do not support sending an ack message.
	sendAckMessage(
		sessionId: string,
		content: string,
	): Promise<string | undefined>;

	// Deliver content to the user.
	// If platformMsgId is provided (platform supported sendAckMessage), edit
	// that message in place. Otherwise send a new message.
	// Fires the onMessageSent callback once delivery is confirmed.
	updateOrSendMessage(
		sessionId: string,
		content: string,
		platformMsgId?: string,
	): Promise<void>;

	// Start the channel — begin receiving messages.
	start(): Promise<void>;

	// Stop the channel gracefully.
	stop(): void;
}
